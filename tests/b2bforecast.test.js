import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as B from "../js/b2b.js";
import * as Bf from "../js/b2bforecast.js";
import * as D from "../js/data.js";
import * as SC from "../js/screens.js";
import { streamNext, seedFrom } from "../js/rng.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 200, capital: 200000, seed: 21, ...o });
const runDays = (s, n) => { const end = s.day + n; while (s.day < end && !s.ended) E.tick(s, 1); };

test("the model rate matches what the tender generator really produces (calibration over 20000 days)", () => {
  const s = mk(); const b = { rng: seedFrom(7, 1), seq: 0, open: [], active: [], history: [], ar: [] }; const tot = {}, days = 20000;
  for (let d = 0; d < days; d++) { s.day = d + 1; b.open = []; s.b2b = b; B.b2bDay(s); for (const t of b.open.filter(x => x.kind === "tender")) tot[t.pid] = (tot[t.pid] || 0) + t.qty; b.history = []; b.active = []; }
  for (const it of Bf.items(s)) { const real = (tot[it.id] || 0) / days, theory = Bf.modelRate(s, it.id); assert.ok(Math.abs(real - theory) / theory < 0.1, `${it.id}: real ${real.toFixed(0)} vs model ${theory.toFixed(0)}`); }
});
test("with no history the outlook rests on the buyer list; with history it moves toward what was seen", () => {
  const s = mk(); const first = Bf.outlook(s, "noodles"); assert.equal(first.basis, "buyer list"); assert.ok(Math.abs(first.rate - Bf.modelRate(s, "noodles")) < 1);
  runDays(s, 40); const o = Bf.outlook(s, "noodles"); assert.equal(o.basis, "history"); assert.ok(o.rate > 0);
  const ob = Bf.observed(s, "noodles"); assert.ok(ob.count > 0);
  const blend = (Bf.modelRate(s, "noodles") * Bf.OUT.priorDays + ob.units) / (Bf.OUT.priorDays + ob.days); assert.ok(Math.abs(o.rate - blend) < 1e-6);
});
test("win rate uses your bids once there are enough, else a stated prior; stock plan adds what you already owe and never goes below zero", () => {
  const s = mk(); assert.equal(Bf.winRate(s), Bf.OUT.priorWin); const b = B.ensureB2B(s); b.won = 6; b.lost = 2; assert.equal(Bf.winRate(s), 0.75);
  b.active.push({ pid: "noodles", qty: 5000, status: "active", kind: "tender", posted: s.day, due: s.day + 5 }); s.wh.qty.noodles = 100000;
  const o = Bf.outlook(s, "noodles"); assert.equal(o.committed, 5000); assert.equal(o.gap, 0); assert.equal(o.need, Math.ceil(o.winnable * Bf.OUT.horizon + 5000));
  s.wh.qty.noodles = 0; assert.ok(Bf.outlook(s, "noodles").gap === Bf.outlook(s, "noodles").need);
});
test("modules off: only goods from running departments are forecast; the screen shows the card; old saves work", () => {
  const s = mk(); assert.ok(Bf.items(s).length >= 4); assert.match(SC.b2bMarket(s, { bid: {} }), /Demand outlook/);
  const old = JSON.parse(E.serialize(mk())); delete old.b2b.cr; const v = E.validateSave(old); assert.ok(v.ok); assert.ok(Bf.allOutlook(v.state).every(r => Number.isFinite(r.rate) && r.gap >= 0));
});
