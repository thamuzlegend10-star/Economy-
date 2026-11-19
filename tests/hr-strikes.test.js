import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as H from "../js/hr.js";
import * as F from "../js/factory.js";
import * as B from "../js/b2b.js";
import * as D from "../js/data.js";
import { balance, post } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 20, days: 60, capital: 200000, seed: 9, mods: { warehouse: true, factory: true }, ...o });
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };

test("morale under 35 percent starts a strike in the departments that have staff, and a mail says so", () => {
  const s = mk(); H.hire(s, "retail", 2); H.hire(s, "warehouse", 1);
  runDay(s); assert.equal(H.strikeOf(s), null, "happy staff do not strike");
  s.hr.morale = 20; runDay(s);
  const k = H.strikeOf(s); assert.ok(k, "strike started"); assert.deepEqual(k.depts.sort(), ["retail", "warehouse"]);
  assert.ok(s.mail.items.some(m => /on strike/i.test(m.subject)));
});

test("striking factory staff halt the machines, and the shop loses half its checkouts", () => {
  const s = mk(); F.rentFactory(s, 300); F.buyMachine(s, { type: "std" }); H.hire(s, "factory", 2); H.hire(s, "retail", 2);
  const out0 = H.crew(s).out, boost0 = H.retailBoost(s); assert.ok(out0 > 0);
  s.hr.strike = { since: s.day, why: "test", depts: ["factory", "retail"] };
  assert.equal(H.crew(s).out, 0); assert.equal(H.retailBoost(s), 0.5);
});

test("a striking warehouse closes the loading dock: transfers, B2B deliveries from stock and truck trips are refused", () => {
  const s = mk(); H.hire(s, "warehouse", 1); s.hr.strike = { since: s.day, why: "test", depts: ["warehouse"] };
  assert.match(E.quoteTransfer(s, [{ pid: "noodles", qty: 100 }]).error || "", /strike|warehouse/i);
  const b = B.ensureB2B(s); post(s.ledger, s.day, "stock", [{ acct: "inventory", dr: 1500 }, { acct: "capital", cr: 1500 }], "t:s"); s.wh.qty.noodles = 1000; s.wh.val.noodles = 1500;
  b.active.push({ id: 900, buyer: "airline", pid: "noodles", qty: 1000, price: 2, due: s.day + 5, penalty: 0.1, status: "active", awarded: s.day, lateDays: 0, fined: 0 });
  assert.match(B.quoteDelivery(s, 900).errors[0], /strike/i); assert.equal(B.deliver(s, 900).ok, false);
});

test("a payday paid from overdraft starts a strike even with good morale", () => {
  const s = mk(); H.hire(s, "retail", 3); H.setPayday(s, "daily");
  post(s.ledger, s.day, "cash gone", [{ acct: "capital", dr: 5e6 }, { acct: "cash", cr: 5e6 }], "t:gone");   // far more than the till holds, so wages cannot be paid in cash
  for (let i = 0; i < 3 && !H.strikeOf(s); i++) runDay(s);
  assert.ok(H.strikeOf(s)); assert.match(H.strikeOf(s).why, /payday/);
});

test("settling pays two days of payroll, lifts morale and ends the strike; with no strike it refuses", () => {
  const s = mk(); H.hire(s, "retail", 2); assert.equal(H.settleStrike(s).ok, false);
  s.hr.morale = 10; s.hr.strike = { since: s.day, why: "test", depts: ["retail"] };
  const w0 = balance(s.ledger, "wages"), r = H.settleStrike(s); assert.ok(r.ok);
  assert.ok(Math.abs(balance(s.ledger, "wages") - w0 - H.dailyPayroll(s) * D.STRIKE.bonusDays) < 0.02);
  assert.equal(H.strikeOf(s), null); assert.ok(s.hr.morale >= D.STRIKE.settleMorale); assert.ok(E.reconcile(s).ok);
});

test("a strike ends by itself once morale is back above the recovery level and wages are paid", () => {
  const s = mk(); H.hire(s, "retail", 2); s.hr.morale = 20; s.hr.strike = { since: s.day, why: "test", depts: ["retail"] };
  s.hr.wageMult = 1.6; s.hr.training = 2000; for (let i = 0; i < 40 && H.strikeOf(s); i++) runDay(s);
  assert.equal(H.strikeOf(s), null);
});

test("old saves and beginner games never strike", () => {
  const old = mk(); delete old.strikeRule; H.hire(old, "retail", 2); old.hr.morale = 5; runDay(old); assert.equal(H.strikeOf(old), null); assert.equal(H.retailBoost(old) > 0.5, true);
  assert.equal(mk({ level: "beginner" }).strikeRule, false); assert.equal(mk().strikeRule, true);
});
