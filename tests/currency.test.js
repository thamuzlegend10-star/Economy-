import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as Cu from "../js/currency.js";
import * as Bk from "../js/bank.js";
import * as D from "../js/data.js";
import * as SC from "../js/screens.js";
import { balance, post } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 200000, seed: 21, ...o });

test("the index and policy rate wander inside their bounds and are deterministic", () => {
  const a = mk(), b = mk({ seed: 21 });
  for (let i = 0; i < 400; i++) { a.day++; Cu.curDay(a); b.day++; Cu.curDay(b); const k = a.cur; assert.ok(k.rate >= Cu.FX.rateLo && k.rate <= Cu.FX.rateHi && k.policy >= Cu.FX.policyLo && k.policy <= Cu.FX.policyHi); }
  assert.deepEqual(a.cur, b.cur); assert.ok(a.cur.hist.length <= 60);
  assert.notEqual(mk({ seed: 22 }).cur.rate, undefined);
});
test("import suppliers follow the index, the local co-op does not", () => {
  const s = mk(), sp = id => [...D.SUPPLIERS, ...D.WH_SUPPLIERS].find(x => x.id === id);
  const metro0 = E.unitCost(s, sp("metro"), D.PRODUCTS[0].id), loc0 = E.unitCost(s, sp("local"), D.PRODUCTS[0].id);
  s.cur.rate = Math.round(s.cur.rate * 1.2 * 1e4) / 1e4;
  assert.ok(E.unitCost(s, sp("metro"), D.PRODUCTS[0].id) > metro0 * 1.15); assert.equal(E.unitCost(s, sp("local"), D.PRODUCTS[0].id), loc0);
  assert.equal(Cu.exchangeFactor(s, "local"), 1);
});
test("a higher policy rate lowers the index target and makes the bank dearer", () => {
  const s = mk(); s.cur.policy = 3; const f3 = Cu.policyFactor(s), t3 = Cu.targetFor(3);
  s.cur.policy = 8; assert.ok(Cu.policyFactor(s) > f3); assert.ok(Cu.targetFor(8) < t3);
  const a = mk(), b = mk(); a.cur.policy = 1; b.cur.policy = 9; Bk.ensureBank(a); Bk.ensureBank(b);
  assert.ok(Bk.takeLoan(a, { kind: "long", amount: 30000 }).ok && Bk.takeLoan(b, { kind: "long", amount: 30000 }).ok);
  assert.ok(b.bank.loans[0].rate > a.bank.loans[0].rate);
});
test("forecast: expected value moves from today's index toward the target, the band widens, and it brackets the mean", () => {
  const s = mk(); s.cur.rate = 1.1; s.cur.policy = 3;
  const f1 = Cu.forecastRate(s, 1), f7 = Cu.forecastRate(s, 7), f30 = Cu.forecastRate(s, 30);
  assert.ok(f1.mean < 1.1 && f7.mean < f1.mean && f30.mean < f7.mean && f30.mean >= 1);
  assert.ok(f7.hi - f7.lo > f1.hi - f1.lo);
  for (const f of [f1, f7, f30]) assert.ok(f.lo <= f.mean && f.mean <= f.hi);
});
test("the forecast is honest: over many seeds about 80 percent of next-week outcomes land in the band", () => {
  let inside = 0, n = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const s = mk({ seed }); const k = s.cur; k.policy = 3;      // hold the policy rate fixed so the band's assumption holds
    for (let d = 0; d < 20; d++) { const f = Cu.forecastRate(s, 7), save = k.policy;
      for (let i = 0; i < 7; i++) { s.day++; Cu.curDay(s); k.policy = 3; }
      n++; if (k.rate >= f.lo - 1e-9 && k.rate <= f.hi + 1e-9) inside++; void save; }
  }
  const share = inside / n; assert.ok(share > 0.7 && share < 0.92, "share " + share);
});
test("old saves without currency state load and the screen renders", () => {
  const s = mk(); delete s.cur; assert.ok(Cu.ensureCur(s).rate > 0); assert.match(SC.currency(s), /Outlook/);
  assert.ok(E.validateSave(JSON.parse(E.serialize(s))).ok);
});
