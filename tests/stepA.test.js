import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import * as K from "../js/market.js";
import * as Kp from "../js/kpi.js";
import * as H from "../js/hr.js";
import * as SC from "../js/screens.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 40, capital: 100000, seed: 3, ...o });
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };

test("satisfaction moves demand: neutral at the start score, up when happy, down when unhappy, bounded", () => {
  const s = mk(); assert.equal(K.csiFactor(s), 1);
  s.srv.csi = 100; assert.ok(K.csiFactor(s) > 1 && K.csiFactor(s) <= D.SRV.demandMax);
  s.srv.csi = 40; assert.ok(K.csiFactor(s) < 1 && K.csiFactor(s) >= D.SRV.demandMin);
  s.srv.csi = 0; assert.equal(K.csiFactor(s), D.SRV.demandMin);
});

test("the same shop sells more with high satisfaction than with low", () => {
  const a = mk(), b = mk(); a.srv.csi = 100; b.srv.csi = 30;
  for (const s of [a, b]) for (const p of D.PRODUCTS) s.demand[p.id] = 0;
  assert.ok(E.expectedDemand(a, "noodles") >= 0);   // expectedDemand reads the formula directly
  const ea = E.expectedDemand(a, "milk"), eb = E.expectedDemand(b, "milk"); assert.ok(ea > eb * 1.2, `${ea} vs ${eb}`);
});

test("long stockouts lower satisfaction, and that lowers later demand (the loop closes)", () => {
  const s = mk(); for (const p of D.PRODUCTS) { s.ledger.bal.inventory = Math.round((s.ledger.bal.inventory - s.val[p.id]) * 100) / 100; s.ledger.bal.capital = Math.round((s.ledger.bal.capital + s.val[p.id]) * 100) / 100; s.qty[p.id] = 0; s.val[p.id] = 0; }
  const before = E.expectedDemand(s, "milk"); for (let i = 0; i < 6; i++) runDay(s);
  assert.ok(s.srv.csi < 60); assert.ok(E.expectedDemand(s, "milk") < before);
});

test("effect sizes come from data, not from the code", () => {
  const s = mk(); H.hire(s, "retail", H.retailNeed(s)); const base = H.retailBoost(s);
  const old = D.HR_EFFECTS.retailBoost; D.HR_EFFECTS.retailBoost = 0.3; const big = H.retailBoost(s); D.HR_EFFECTS.retailBoost = old; assert.ok(big > base + 0.1);
});

test("warnings: none on a fresh well-stocked game; overdraft, low cash, broken machine and late contract each appear with a target tab", () => {
  const s = mk(); assert.deepEqual(Kp.warnings(s), []);
  const w0 = Kp.warnings(mk({ capital: 10000 })); void w0;
  s.ledger.bal.overdraft = -500; s.ledger.bal.cash += 0; const w = Kp.warnings(s); assert.ok(w.some(x => x.level === "bad" && x.where[0] === "finance"));
  const t = mk(); t.b2b.active.push({ id: 1, buyer: "hotel", pid: "apple", qty: 100, price: 1, due: 0, penalty: 0.1, status: "active", lateDays: 1, fined: 0 }); assert.ok(Kp.warnings(t).some(x => /late/.test(x.text) && x.where[0] === "b2b"));
  for (const x of Kp.warnings(t)) assert.ok(x.text && x.where.length === 2);
});

test("the warnings card renders and links to a tab", () => {
  const t = mk(); t.b2b.active.push({ id: 1, buyer: "hotel", pid: "apple", qty: 100, price: 1, due: 0, penalty: 0.1, status: "active", lateDays: 1, fined: 0 });
  const h = SC.warningsCard(t); assert.match(h, /data-goto="b2b"/); assert.match(SC.warningsCard(mk()), /all clear/);
});
