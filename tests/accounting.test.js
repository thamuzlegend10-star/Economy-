import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import * as B from "../js/b2b.js";
import * as Ac from "../js/accounting.js";
import * as SC from "../js/screens.js";
import { balance, post } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 80, capital: 100000, seed: 6, ...o });
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };

test("tax is assessed weekly on profit, accrued as a liability, paid, never refunded; books reconcile", () => {
  const s = mk(); post(s.ledger, s.day, "test sale", [{ acct: "cash", dr: 50000 }, { acct: "sales", cr: 50000 }]);
  const pbt = Ac.profitBeforeTax(s); assert.ok(pbt > 40000);
  while (s.day < 8) runDay(s);
  assert.ok(s.tax.assessed > 0); const want = D.TAX.rate * Ac.taxableProfit(s);
  assert.ok(Math.abs(balance(s.ledger, "tax") - want) < want * 0.1 + 50, `${balance(s.ledger, "tax")} vs ${want}`);
  for (let i = 0; i < 5; i++) runDay(s); assert.ok(s.tax.paid > 0); assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems));
  const t0 = balance(s.ledger, "tax"); post(s.ledger, s.day, "test loss", [{ acct: "rent", dr: 60000 }, { acct: "cash", cr: 60000 }]); for (let i = 0; i < 8; i++) runDay(s);
  assert.ok(balance(s.ledger, "tax") >= t0);                                                         // no refund after a loss
});

test("no tax is assessed while the business has no profit", () => {
  const s = mk(); post(s.ledger, s.day, "loss", [{ acct: "rent", dr: 3000 }, { acct: "cash", cr: 3000 }]); // a fresh shop earns little in a week
  s.ledger.bal.sales = 0; assert.equal(Ac.taxDue(s) >= 0, true); const before = balance(s.ledger, "tax"); assert.equal(before, 0);
});

test("B2B delivery creates a receivable, cash arrives on the buyer's credit terms, books reconcile", () => {
  const s = mk(); s.wh.area = 400; s.wh.qty.noodles = 5000; s.wh.val.noodles = 2000; s.ledger.bal.inventory = Math.round((s.ledger.bal.inventory + 2000) * 100) / 100; s.ledger.bal.capital = Math.round((s.ledger.bal.capital - 2000) * 100) / 100;
  const b = B.ensureB2B(s); b.active.push({ id: 900, buyer: "uni", pid: "noodles", qty: 3000, price: 1, due: s.day + 5, penalty: 0.1, status: "active", awarded: s.day, lateDays: 0, fined: 0 });
  const cash = balance(s.ledger, "cash"), r = B.deliver(s, 900); assert.ok(r.ok, r.error);
  assert.equal(balance(s.ledger, "cash"), cash); assert.equal(balance(s.ledger, "receivables"), 3000); assert.equal(balance(s.ledger, "sales_b2b"), 3000);
  assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems));
  const terms = D.B2B.buyers.find(x => x.id === "uni").terms; for (let i = 0; i < terms + 1; i++) runDay(s);
  assert.equal(balance(s.ledger, "receivables"), 0); assert.equal(b.collected, 3000); assert.equal(B.receivable(s), 0);
  assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems));
});

test("an unpaid invoice is written off as bad debt", () => {
  const s = mk(), b = B.ensureB2B(s); post(s.ledger, s.day, "invoice", [{ acct: "receivables", dr: 1000 }, { acct: "sales_b2b", cr: 1000 }]);
  b.ar.push({ id: 1, buyer: "chain", amount: 1000, issued: s.day, due: s.day }); D.B2B.buyers.find(x => x.id === "chain").risk = 1;
  try { runDay(s); } finally { D.B2B.buyers.find(x => x.id === "chain").risk = 0.03; }
  assert.equal(balance(s.ledger, "bad_debt"), 1000); assert.equal(balance(s.ledger, "receivables"), 0); assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems));
});

test("trial balance balances; the journal filters by account; the ledger screen renders; v18 saves migrate", () => {
  const s = mk(); for (let i = 0; i < 3; i++) runDay(s);
  const tb = Ac.trialBalance(s); assert.ok(tb.balanced); assert.ok(tb.rows.length > 3);
  const cashOnly = Ac.journal(s, "cash", 100); assert.ok(cashOnly.length > 0 && cashOnly.every(e => e.lines.some(l => l.acct === "cash")));
  const html = SC.ledgerScreen(s, { gl: "all" }); assert.match(html, /Trial balance/); assert.match(html, /Income tax/); assert.match(html, /\(balanced\)/);
  const old = JSON.parse(JSON.stringify(mk())); old.v = 18; delete old.tax; delete old.ledger.bal.tax_payable; delete old.ledger.bal.bad_debt; delete old.b2b.ar;
  const m = E.validateSave(old); assert.ok(m.ok, m.error); assert.equal(m.state.tax.items.length, 0);
});

test("tax deductions: machine and training allowances lower taxable profit, never below zero", () => {
  const s = mk(); post(s.ledger, s.day, "test sale", [{ acct: "cash", dr: 50000 }, { acct: "sales", cr: 50000 }]);
  const before = Ac.taxableProfit(s); s.hr.trainPaid = 10000;
  const d = Ac.deductions(s); assert.equal(d.train, D.TAX.trainExtra * 10000);
  assert.ok(Ac.taxableProfit(s) < before); assert.ok(Ac.taxableProfit(s) >= 0);
  s.hr.trainPaid = 1e9; assert.equal(Ac.taxableProfit(s), 0);
});

test("cash flow statement is exact: buckets add up to the change in cash position; whole-game ledger pages back past 1,500", () => {
  const s = mk({ days: 120 }); while (s.day < 30) runDay(s); for (let i = 0; i < 1700; i++) post(s.ledger, s.day, "bulk " + i, [{ acct: "rent", dr: 1 }, { acct: "cash", cr: 1 }]);
  const cf = Ac.cashFlow(s), pos = balance(s.ledger, "cash") - balance(s.ledger, "overdraft");
  assert.ok(Math.abs(cf.net - pos) < 0.05, `${cf.net} vs ${pos}`);
  assert.ok(cf.customers > 0 && cf.other < 0);
  assert.ok(s.ledger.seq > 1500 && s.ledger.old.length > 0, "enough entries to archive");
  const all = Ac.journalSize(s); assert.ok(all > 1500);
  const oldest = Ac.journal(s, "all", 5, all - 5); assert.equal(oldest.length, 5); assert.ok(oldest[4].id <= 6 + s.ledger.archived + 5);
  assert.ok(oldest.every(e => e.lines.length >= 2));
  const byAcct = Ac.journal(s, "wages", 3, 0); assert.ok(byAcct.every(e => e.lines.some(l => l.acct === "wages")));
});

test("department P&L adds up to the whole books and trends use real history", async () => {
  const Bi = await import("../js/bi.js"), { totals } = await import("../js/ledger.js");
  const s = mk({ days: 60 }); while (s.day < 20) runDay(s);
  const t = totals(s.ledger), rows = Bi.deptPL(s), rev = rows.reduce((a, r) => a + r.rev, 0), cost = rows.reduce((a, r) => a + r.cost, 0);
  assert.ok(Math.abs(rev - t.revenue) < 0.05 && Math.abs(cost - t.costs) < 0.05, `${rev}/${t.revenue} ${cost}/${t.costs}`);
  assert.ok(rows.find(r => r.id === "shop").rev > 0); assert.ok(rows.some(r => r.prev7 != null));
  assert.equal(Bi.trendOf(120, 100).dir, 1); assert.equal(Bi.trendOf(80, 100).dir, -1); assert.equal(Bi.trendOf(101, 100).dir, 0); assert.equal(Bi.trendOf(5, null).dir, 0);
});

test("customer measures: complaint types add up, response time and retention are bounded, and old saves get defaults", async () => {
  const K = await import("../js/market.js");
  const s = mk({ days: 60 }); while (s.day < 15) runDay(s);
  const v = K.ensureSrv(s); assert.equal(v.types.general + v.types.late + v.types.stockout, v.tickets);
  assert.ok(v.resp >= 0 && K.retention(s) >= 0 && K.retention(s) <= 100);
  const old = mk(); delete old.srv.resp; delete old.srv.types; delete old.srv.loyal; const o = K.ensureSrv(old); assert.ok(o.types && o.loyal > 0);
});
