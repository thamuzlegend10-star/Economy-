import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import { totals, balance } from "../js/ledger.js";

const fresh = (o = {}) => E.newGame({ seed: 12345, difficulty: "normal", mode: "standard", dayLimit: 5, ...o });
const bal = (s, a) => balance(s.ledger, a);
const run = (s, secs) => { for (let i = 0; i < secs * 4; i++) E.tick(s, 0.25); };
const clean = s => assert.deepEqual(E.reconcile(s), { ok: true, problems: [] });

test("new game balances and reconciles", () => { const s = fresh(); clean(s); assert.ok(totals(s.ledger).balanced); });

test("ordering reduces cash, creates order, receives goods exactly once", () => {
  const s = fresh(); const before = bal(s, "bank"), wh0 = s.stock.apple.wh;
  const r = E.placeOrder(s, { supplier: "quickship", lines: [{ pid: "apple", qty: 10 }], pay: "bank", cmdId: "o1" });
  assert.ok(r.ok, r.error);
  assert.ok(bal(s, "bank") < before);
  assert.equal(s.orders.length, 1); assert.equal(s.stock.apple.wh, wh0);   // not sellable until received
  clean(s);
  run(s, 12);
  assert.equal(s.stock.apple.wh, wh0 + 10); assert.equal(s.orders.length, 0);
  run(s, 5); assert.equal(s.stock.apple.wh, wh0 + 10);                      // no double receive
  clean(s);
});

test("duplicate cmdId cannot repeat a purchase, deposit or loan", () => {
  const s = fresh();
  assert.ok(E.placeOrder(s, { supplier: "metro", lines: [{ pid: "apple", qty: 5 }], cmdId: "x" }).ok);
  assert.equal(E.placeOrder(s, { supplier: "metro", lines: [{ pid: "apple", qty: 5 }], cmdId: "x" }).ok, false);
  assert.equal(s.orders.length, 1);
  const b = bal(s, "bank");
  assert.ok(E.takeLoan(s, "small", "l1").ok); assert.equal(E.takeLoan(s, "small", "l1").ok, false);
  assert.equal(s.loans.length, 1); assert.ok(bal(s, "bank") > b);
});

test("invalid inputs are rejected", () => {
  const s = fresh();
  for (const qty of [0, -3, 1.5, 1e9, NaN]) assert.equal(E.placeOrder(s, { supplier: "metro", lines: [{ pid: "apple", qty }] }).ok, false);
  assert.equal(E.placeOrder(s, { supplier: "nope", lines: [{ pid: "apple", qty: 1 }] }).ok, false);
  assert.equal(E.placeOrder(s, { supplier: "metro", lines: [{ pid: "earbuds", qty: 1 }] }).ok, false);       // locked
  assert.equal(E.placeOrder(s, { supplier: "freshfarm", lines: [{ pid: "soap", qty: 20 }] }).ok, false);    // wrong category
  assert.equal(E.setPrice(s, "apple", -1).ok, false); assert.equal(E.setPrice(s, "apple", 1e9).ok, false);
  assert.equal(E.deposit(s, -5).ok, false); assert.equal(E.deposit(s, 1e9).ok, false); assert.equal(E.withdraw(s, 1e9).ok, false);
  assert.equal(E.placeOrder(s, { supplier: "metro", lines: [{ pid: "apple", qty: 999 }] }).ok, false);        // warehouse too small
  clean(s);
});

test("restock moves goods between locations without creating inventory", () => {
  const s = fresh(); const total = () => s.stock.apple.wh + s.stock.apple.shelf; const t0 = total();
  assert.ok(E.restock(s, "apple", 10).ok);
  run(s, 20);
  // customers may buy apples meanwhile, so only sales can lower the total, and never create stock
  assert.ok(total() <= t0 && t0 - total() <= (s.stats.units.apple || 0) + 4); assert.ok(s.stock.apple.shelf > 5);
  assert.equal(E.restock(s, "apple", 500).ok, false);
  clean(s);
});

test("sales never exceed stock, record revenue, COGS and keep books balanced", () => {
  const s = fresh(); E.restock(s, "apple", 12); E.setPrice(s, "apple", 2.5);
  const rev0 = balance(s.ledger, "sales");
  run(s, 100);
  assert.ok(balance(s.ledger, "sales") > rev0, "should have sold something");
  assert.ok(balance(s.ledger, "cogs") > 0);
  for (const st of Object.values(s.stock)) { assert.ok(st.shelf >= 0 && st.wh >= 0); }
  clean(s);
});

test("closing charges rent/utilities exactly once and produces a report", () => {
  const s = fresh(); const rent0 = balance(s.ledger, "rent");
  run(s, D.DAY_LEN + 1);
  assert.equal(s.phase, "report");
  assert.equal(balance(s.ledger, "rent") - rent0, E.rent(s));
  const rentAfter = balance(s.ledger, "rent");
  E.tick(s, 5); assert.equal(balance(s.ledger, "rent"), rentAfter);          // no ticking while at the report
  assert.ok(s.lastReport.revenue >= 0 && s.lastReport.reconciled);
  clean(s);
});

test("loan proceeds, interest and repayment update debt and cash correctly", () => {
  const s = fresh(); const t = E.loanTerms(D.LOANS[0]);
  const bank0 = bal(s, "bank"); assert.ok(E.takeLoan(s, "small").ok);
  assert.equal(bal(s, "bank"), Math.round((bank0 + 1000 - t.fee) * 100) / 100); assert.equal(bal(s, "loan"), 1000);
  run(s, D.DAY_LEN + 1);
  assert.equal(bal(s, "loan"), 1000 - t.installment); assert.ok(bal(s, "interest") > 0);
  const id = s.loans[0].id; assert.ok(E.repayLoan(s, id, 100000).ok);
  assert.equal(s.loans.length, 0); assert.equal(bal(s, "loan"), 0); clean(s);
});

test("overdraft covers bills, never negative bank, and can be restructured", () => {
  const s = fresh({ capital: 300 });
  E.withdraw(s, bal(s, "bank")); E.deposit(s, 0.01); // drain
  // spend everything
  for (const a of ["cash", "bank"]) { const v = bal(s, a); if (v > 0) { s.ledger.bal[a] = 0; s.ledger.bal.capital += v; } }  // test-only reset of liquidity
  s.staff.push({ id: 99, name: "Test", role: "cashier", skill: 1, wage: 900 });   // bills far above any sales
  run(s, D.DAY_LEN + 1);
  assert.ok(bal(s, "overdraft") > 0); assert.ok(bal(s, "bank") >= 0 && bal(s, "cash") >= 0);
  assert.ok(E.restructureDebt(s).ok); assert.equal(bal(s, "overdraft"), 0); assert.ok(bal(s, "loan") > 0);
  assert.equal(E.restructureDebt(s).ok, false);
});

test("Standard ends at the day limit with a final report; Infinite goes on", () => {
  const s = fresh({ dayLimit: 5 });
  for (let d = 0; d < 5; d++) { run(s, D.DAY_LEN + 1); if (s.ended) break; E.nextDay(s); }
  assert.ok(s.ended && s.ended.reason === "completed" && s.ended.day === 5 && s.ended.score.total >= 0);
  const i = E.newGame({ seed: 1, mode: "infinite" });
  for (let d = 0; d < 8; d++) { run(i, D.DAY_LEN + 1); assert.equal(i.ended, null); E.nextDay(i); }
  assert.ok(i.day >= 9); clean(i);
});

test("same seed and commands give the same results", () => {
  const a = fresh(), b = fresh(); run(a, 90); run(b, 90);
  assert.equal(JSON.stringify(a.ledger.bal), JSON.stringify(b.ledger.bal));
});

test("save/load preserves state; corrupt and old saves fail gracefully", () => {
  const s = fresh(); E.takeLoan(s, "small"); E.buyUpgrade(s, "counter"); E.hire(s, s.candidates[0].id); run(s, 30);
  const r = E.validateSave(E.serialize(s)); assert.ok(r.ok, r.error);
  assert.equal(r.state.mode, s.mode); assert.equal(r.state.loans.length, 1); assert.equal(r.state.upgrades.counter, 1);
  assert.equal(r.state.staff.length, 1); assert.deepEqual(r.state.stock, s.stock); assert.deepEqual(r.state.ledger.bal, s.ledger.bal);
  assert.equal(E.validateSave("{not json").ok, false);
  assert.equal(E.validateSave(JSON.stringify({ v: 2 })).ok, false);
  const bad = JSON.parse(E.serialize(s)); bad.ledger.bal.cash += 50;
  assert.equal(E.validateSave(bad).ok, false);
});

test("upgrades raise capacity and can't exceed max", () => {
  const s = fresh(); const c0 = E.shelfCap(s);
  assert.ok(E.buyUpgrade(s, "shelves").ok); assert.equal(E.shelfCap(s), c0 + D.SHELF_PER_LVL);
  E.buyUpgrade(s, "dock"); assert.equal(E.buyUpgrade(s, "dock").ok, false); clean(s);
});

test("order cancel refunds goods but not the delivery fee", () => {
  const s = fresh(); const b = bal(s, "bank");
  const r = E.placeOrder(s, { supplier: "metro", lines: [{ pid: "apple", qty: 10 }] });
  assert.ok(E.cancelOrder(s, r.id).ok);
  assert.equal(Math.round((b - bal(s, "bank")) * 100) / 100, 10); clean(s);
});
