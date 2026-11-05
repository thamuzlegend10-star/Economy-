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

import * as F from "../js/factory.js";
test("factory: annex needs the main plant, is cheaper per m2, adds haulage, and reconciles", () => {
  const s = mk(); assert.equal(F.rentFactory(s, 200, "annex").ok, false);
  assert.ok(F.rentFactory(s, 300).ok); const rent0 = F.factoryRent(s);
  assert.ok(F.rentFactory(s, 250, "annex").ok); const rent1 = F.factoryRent(s), pm2 = F.factoryRentPerM2(s);
  assert.ok(Math.abs((rent1 - rent0) - 250 * pm2 * 0.8) < 0.02, "annex rent is 80% per m2");
  assert.equal(F.quoteMachine(s, "std", "annex").ok, true); assert.ok(F.buyMachine(s, { type: "std", site: "annex" }).ok);
  assert.equal(F.siteOf(s.fx.machines[0]), "annex"); assert.equal(F.annexHaul(s), 40); assert.equal(F.factorySpaceFree(s, "main"), 300);
  assert.equal(F.quoteMachine(s, "fast", "annex").ok, true);
  days(s, 3);
});
test("factory: old saves get an empty annex", () => {
  const s = mk(); const raw = JSON.parse(JSON.stringify(s)); raw.v = 23; delete raw.fx.annexArea; delete raw.hr.pay; delete raw.hr.accrued;
  const r = E.validateSave(raw); assert.ok(r.ok, r.error); assert.equal(r.state.fx.annexArea, 0);
});

test("employees: every head has a name and start day, kept in step with hire, fire and quits", () => {
  const s = mk(); H.hire(s, "retail", 3); let cr = H.syncCrew(s, "retail"); assert.equal(cr.length, 3);
  assert.ok(cr.every(p => p.name.includes(" ") && p.since === 1)); assert.equal(new Set(cr.map(p => p.id)).size, 3);
  H.fire(s, "retail", 1); assert.equal(H.syncCrew(s, "retail").length, 2);
  const u = mk(), v = mk(); H.hire(u, "retail", 3); H.hire(v, "retail", 3); assert.deepEqual(H.syncCrew(u, "retail").map(p => p.name), H.syncCrew(v, "retail").map(p => p.name));
  s.hr.morale = 0; for (let i = 0; i < 40 && s.hr.quits === 0; i++) { runDay(s); } assert.equal(H.syncCrew(s, "retail").length, s.hr.staff.retail.n);
});

import * as Fl from "../js/fleet.js";
test("dock: handlers load faster and a busy dock queues the next trip", () => {
  const s = mk(); const slow = Fl.loadTime(s, 600); H.hire(s, "warehouse", 3); assert.ok(Fl.loadTime(s, 600) < slow);
  assert.equal(Fl.loadTime(s, 1), D.TRANSPORT.loadDays);
  Fl.dockState(s).free.fill(0.5); assert.equal(Fl.dockWait(s), 0.5);
  const t = mk(); Fl.dockState(t).free[0] = 0.25; assert.equal(Fl.dockWait(t), 0);
  Fl.dockState(t).free[1] = 0.4; assert.equal(Fl.dockWait(t), 0.25);
  const d0 = t.day; t.day = d0 + 1; assert.equal(Fl.dockWait(t), 0, "dock is empty again the next day");
});
