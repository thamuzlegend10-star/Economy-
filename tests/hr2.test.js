import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import * as H from "../js/hr.js";
import * as SC from "../js/screens.js";
import { balance } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 100000, seed: 4, ...o });
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };

test("hiring costs a recruitment fee booked as wages; firing costs severance; both reconcile", () => {
  const s = mk(), c0 = balance(s.ledger, "cash"), fee = H.recruitFee(s, "retail", 2);
  assert.ok(fee > 0); assert.ok(H.hire(s, "retail", 2).ok);
  assert.ok(Math.abs(c0 - balance(s.ledger, "cash") - fee) < 0.02); assert.equal(s.hr.recruitPaid, fee);
  const c1 = balance(s.ledger, "cash"), sev = Math.round(H.wageOf(s, "retail") * D.HR.severanceDays * 100) / 100;
  assert.ok(H.fire(s, "retail", 1).ok); assert.ok(Math.abs(c1 - balance(s.ledger, "cash") - sev) < 0.02);
  assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems));
});

test("hiring or firing without cash is refused and changes nothing", () => {
  const s = mk({ capital: 2000 }); s.ledger.bal.cash = 10; s.ledger.bal.capital = -10;
  const r = H.hire(s, "factory", 3); assert.equal(r.ok, false); assert.equal(s.hr.staff.factory.n, 0);
});

test("temps cost a premium, never quit, cannot be fired, and end on schedule", () => {
  const s = mk(); H.hire(s, "service", 1, "temp", 7); assert.equal(H.tempN(s, "service"), 1); assert.equal(H.permN(s, "service"), 0);
  const w = H.wageOf(s, "service"); assert.ok(Math.abs(H.dailyPayroll(s) - w * (1 + D.HR.tempPremium)) < 0.02);
  assert.equal(H.fire(s, "service", 1).ok, false); assert.equal(H.hire(s, "service", 1, "temp", 5).ok, false);
  s.hr.morale = 0; for (let i = 0; i < 6; i++) runDay(s); assert.equal(s.hr.staff.service.n, 1);          // no quits for temps, even at zero morale
  for (let i = 0; i < 3; i++) runDay(s); assert.equal(s.hr.staff.service.n, 0); assert.equal(s.hr.temps.length, 0);
  assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems));
});

test("buying a machine includes the operator recruitment fee in its cash check", () => {
  const s = mk(); const F = import("../js/factory.js"); return F.then(F => { F.rentFactory(s, 250); const q = F.quoteMachine(s, D.MACHINES[0].id); assert.ok(q.ok);
    const c0 = balance(s.ledger, "cash"); assert.ok(F.buyMachine(s, { type: D.MACHINES[0].id }).ok);
    assert.ok(c0 - balance(s.ledger, "cash") > q.total); assert.ok(E.reconcile(s).ok); });
});

test("v17 saves migrate to v18; the people screen shows needs and contract buttons", () => {
  const old = JSON.parse(JSON.stringify(mk())); old.v = 17; delete old.hr.temps; delete old.hr.recruitPaid;
  const m = E.validateSave(old); assert.ok(m.ok, m.error); assert.deepEqual(m.state.hr.temps, []);
  const html = SC.hrScreen(mk(), { tempDays: 14 }); assert.match(html, /Temp \+1/); assert.match(html, /Recruitment paid/);
});
