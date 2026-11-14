import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as Se from "../js/season.js";
import * as Fc from "../js/forecast.js";
import * as D from "../js/data.js";
import * as SC from "../js/screens.js";
import { totals } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 120, capital: 200000, seed: 21, ...o });
const runDays = (s, n) => { const end = s.day + n; while (s.day < end && !s.ended) E.tick(s, 1); };
const prod = cat => D.PRODUCTS.find(p => p.cat === cat);

test("the calendar: periods sit inside the year, the year repeats, and multipliers are sane", () => {
  for (const p of D.SEASON.periods) { assert.ok(p.from >= 1 && p.to <= D.SEASON.year && p.from <= p.to); for (const v of Object.values(p.mult)) assert.ok(v >= 0.8 && v <= 1.5); }
  assert.equal(Se.dayOfYear(1), 1); assert.equal(Se.dayOfYear(D.SEASON.year), D.SEASON.year); assert.equal(Se.dayOfYear(D.SEASON.year + 1), 1); assert.equal(Se.dayOfYear(2 * D.SEASON.year + 9), 9);
  const s = mk(); assert.equal(Se.seasonMult(s, "food", 1), 1); assert.ok(Se.seasonMult(s, "food", 16) > 1.25); assert.ok(Se.seasonMult(s, "electronics", 24) > 1.2); assert.ok(Se.seasonMult(s, "drinks", 35) > 1.2); assert.ok(Se.seasonMult(s, "food", 45) < 1);
  assert.equal(Se.seasonMult(s, "food", 16 + D.SEASON.year), Se.seasonMult(s, "food", 16));
});
test("a save without the calendar flag behaves exactly as before", () => {
  const s = mk(); s.cal = false; for (let d = 1; d <= 60; d++) assert.equal(Se.seasonMult(s, "food", d), 1);
  const old = JSON.parse(E.serialize(mk())); delete old.cal; const v = E.validateSave(old); assert.ok(v.ok, v.error); assert.equal(Se.seasonMult(v.state, "food", 16), 1);
});
test("demand really follows the calendar: electronics demand in Back to school beats a quiet day, same shop", () => {
  const a = mk(), b = mk(); a.day = 26; b.day = 26; b.cal = false;
  const p = prod("electronics"); a.noise = 1; b.noise = 1;
  const ratio = E.demandFor(a, p) / E.demandFor(b, p); assert.ok(Math.abs(ratio - Se.seasonMult(a, "electronics", 26)) < 1e-9, "ratio " + ratio);
});
test("the forecast knows the calendar: the same history forecasts exactly the holiday multiplier higher on a holiday", () => {
  const s = mk(); s.history = []; const p = prod("food"), week = d => [1, 0.9, 0.9, 1, 1.1, 1.35, 1.2][d % 7];
  for (let d = 1; d <= 7; d++) s.history.push({ day: d, units: Object.fromEntries(D.PRODUCTS.map(x => [x.id, x.id === p.id ? 1000 * week(d) : 0])), lost: Object.fromEntries(D.PRODUCTS.map(x => [x.id, 0])) });
  s.day = 8; const k = 16 - 7, on = Fc.forecastDay(s, p.id, k, Fc.model(s, p.id)); s.cal = false; const off = Fc.forecastDay(s, p.id, k, Fc.model(s, p.id));
  assert.ok(Math.abs(on / off - Se.seasonMult({ cal: true }, "food", 16)) < 1e-9, `${on} / ${off}`); assert.ok(on / off > 1.25);
});
test("upcoming lists what starts soon, warns three days ahead by mail, and a long game stays balanced and deterministic", () => {
  const s = mk(); s.day = 5; const up = Se.upcoming(s, 28); assert.ok(up.length >= 2); assert.equal(up[0].id, "fast"); assert.equal(up[0].inDays, 3);
  const run = () => { const x = mk(); runDays(x, 20); return x; }, a = run(), b = run();
  assert.equal(E.serialize(a), E.serialize(b)); assert.equal(E.reconcile(a).ok, true); assert.ok(totals(a.ledger).balanced);
  assert.ok(a.mail.items.some(m => /Fasting month starts in 3 days/.test(m.subject)));
  assert.match(SC.forecast(a), /Calendar/);
  assert.equal(SC.forecast(Object.assign(mk(), { cal: false })).includes("Calendar"), false);
});
