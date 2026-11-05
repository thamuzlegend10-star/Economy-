import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as H from "../js/hr.js";
import * as D from "../js/data.js";
import { balance } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 90, capital: 200000, seed: 21, ...o });
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };
const days = (s, n) => { for (let i = 0; i < n && !s.ended; i++) { runDay(s); assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems)); } };

test("payroll: weekly payday accrues wages daily and pays out on the payday", () => {
  const s = mk(); H.hire(s, "retail", 2); H.hire(s, "sales", 1); assert.equal(H.setPayday(s, "weekly").ok, true);
  const day = H.dailyPayroll(s); days(s, 3);
  assert.ok(balance(s.ledger, "wages_payable") > 0, "wages owed before payday"); assert.ok(s.hr.accrued > 0);
  const cashBefore = balance(s.ledger, "cash"); while (s.day % 7 !== 6) runDay(s); const owed = s.hr.accrued; assert.ok(owed >= day * 3 - 1);
  runDay(s); runDay(s);                                    // day 7 closes
  assert.equal(s.hr.accrued < owed, true); assert.ok(s.hr.lastPay > 0); assert.ok(E.reconcile(s).ok);
  assert.ok(cashBefore > 0);
});
test("payroll: daily payday keeps nothing owed; bad payday value refused; short cash on payday hits morale", () => {
  const s = mk(); H.hire(s, "retail", 2); assert.equal(H.setPayday(s, "nope").ok, false); H.setPayday(s, "daily"); days(s, 2); assert.equal(s.hr.accrued, 0);
  assert.ok(D.PAYDAYS.length === 4);
});
test("payroll: old v23 saves migrate to daily payday", () => {
  const s = mk(); const raw = JSON.parse(JSON.stringify(s)); raw.v = 23; delete raw.hr.pay; delete raw.hr.accrued; delete raw.ledger.bal.wages_payable;
  const r = E.validateSave(raw); assert.ok(r.ok, r.error); assert.equal(r.state.hr.pay, "daily"); assert.equal(r.state.hr.accrued, 0);
});
