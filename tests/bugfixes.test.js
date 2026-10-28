// Regression tests for the bugfixes-1 review. Each test was written to FAIL on the code before its fix.
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import { balance, post } from "../js/ledger.js";

const fresh = (o = {}) => E.newGame({ seed: 4242, difficulty: "normal", mode: "standard", dayLimit: 8, ...o });
const bal = (s, a) => balance(s.ledger, a);
const run = (s, secs) => { for (let i = 0; i < secs * 4; i++) E.tick(s, 0.25); };
const clean = s => assert.deepEqual(E.reconcile(s), { ok: true, problems: [] });
const cust = (o = {}) => ({ id: 1, state: "queue", t: 0, want: [], basket: [], basketPrices: [], wait: 0, patience: 999, look: 1, lane: -1, ...o });
const addCashiers = (s, n) => { for (let i = 0; i < n; i++) s.staff.push({ id: 900 + i, name: "C" + i, role: "cashier", skill: 3, wage: 10 }); };

// ---------- 1. autosave must not lose stock held in baskets ----------
test("1: serialize puts basket items back on the shelf without touching live state", () => {
  const s = fresh();
  const shelf0 = s.stock.apple.shelf;
  s.stock.apple.shelf -= 2;                                   // two apples are in a customer's basket
  s.customers.push(cust({ state: "queue", basket: ["apple", "apple"], basketPrices: [2.8, 2.8] }));
  const raw = E.serialize(s);
  assert.equal(s.stock.apple.shelf, shelf0 - 2, "live state must not change");
  assert.equal(s.customers.length, 1, "live customers must stay");
  const v = E.validateSave(raw);
  assert.ok(v.ok, v.error);
  assert.equal(v.state.stock.apple.shelf, shelf0, "units are back on the shelf after load");
  assert.equal(E.unitsTotal(v.state, "apple"), E.unitsTotal(s, "apple") + 2, "no units vanish");
  clean(v.state);
});

// ---------- 3. save shape validation ----------
const mutate = fn => { const s = fresh(); const o = JSON.parse(E.serialize(s)); fn(o); return E.validateSave(o); };
for (const [name, fn] of [
  ["stats missing", o => { delete o.stats; }],
  ["stats not an object", o => { o.stats = 5; }],
  ["history missing", o => { delete o.history; }],
  ["history entry without numbers", o => { o.history = [{ day: 1 }]; }],
  ["archive missing", o => { delete o.archive; }],
  ["archive revenue NaN-like", o => { o.archive = { days: 0, revenue: "x", profit: 0 }; }],
  ["staff wage negative", o => { o.staff = [{ id: 1, name: "A", role: "cashier", skill: 3, wage: -5 }]; }],
  ["staff wage not finite", o => { o.staff = [{ id: 1, name: "A", role: "cashier", skill: 3, wage: "lots" }]; }],
  ["staff unknown role", o => { o.staff = [{ id: 1, name: "A", role: "wizard", skill: 3, wage: 5 }]; }],
  ["upgrade above max", o => { o.upgrades.shelves = 99; }],
  ["upgrade not integer", o => { o.upgrades.dock = 0.5; }],
  ["upgrade missing", o => { delete o.upgrades.counter; }],
  ["loan broken", o => { o.loans = [{ id: 1, kind: "small", name: "x", remaining: "a", dailyRate: 0.01, installment: 5 }]; }],
  ["price zero", o => { o.prices.apple = 0; }],
  ["price negative", o => { o.prices.milk = -3; }],
  ["price NaN-like", o => { o.prices.bread = "free"; }],
  ["ledger account missing", o => { delete o.ledger.bal.sales; }],
  ["ledger account not a number", o => { o.ledger.bal.rent = "x"; }],
  ["tasks missing", o => { delete o.tasks; }],
  ["events missing", o => { delete o.events; }],
  ["order broken", o => { o.orders = [{ id: 1, goods: "x" }]; }],
]) {
  test(`3: validateSave rejects a save with ${name} (no throw)`, () => {
    let r;
    assert.doesNotThrow(() => { r = mutate(fn); });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
  });
}
test("3: a normal save still validates", () => { assert.ok(mutate(() => {}).ok); });

// ---------- 4. cost of goods with items in other baskets ----------
test("4: baskets of other customers count when averaging cost; COGS equals inventory removed", () => {
  const s = fresh();
  const apples = s.stock.apple.wh + s.stock.apple.shelf, total = s.val.apple;
  s.stock.apple.shelf -= 2;                                       // two customers each hold one apple
  s.customers.push(cust({ id: 1, state: "pay", lane: 0, payTime: 0.1, basket: ["apple"], basketPrices: [3] }));
  s.customers.push(cust({ id: 2, state: "pay", lane: 1, payTime: 9999, basket: ["apple"], basketPrices: [3] }));
  s.spawnAcc = -1e9;
  const invBefore = bal(s, "inventory");
  E.tick(s, 0.25); E.tick(s, 0.25);
  const e = s.ledger.entries.find(x => x.memo === "COGS sale #1");
  assert.ok(e, "COGS entry exists");
  const cogs = e.lines.find(l => l.acct === "cogs").dr;
  assert.ok(Math.abs(cogs - total / apples) < 0.02, `COGS ${cogs} should be one unit's average cost ${total / apples}`);
  assert.ok(Math.abs((invBefore - bal(s, "inventory")) - cogs) < 0.005, "inventory ledger fell by exactly the COGS");
  clean(s);
});

test("4: the dump-the-rest rule only applies when no units remain anywhere", () => {
  const s = fresh();
  const total = s.val.apple, n = s.stock.apple.wh + s.stock.apple.shelf;
  s.stock.apple.wh = 0; s.stock.apple.shelf = 0;                 // everything is in two baskets
  s.customers.push(cust({ id: 1, state: "pay", lane: 0, payTime: 0.1, basket: Array(n - 1).fill("apple"), basketPrices: Array(n - 1).fill(3) }));
  s.customers.push(cust({ id: 2, state: "pay", lane: 1, payTime: 9999, basket: ["apple"], basketPrices: [3] }));
  E.tick(s, 0.25); E.tick(s, 0.25);
  const e = s.ledger.entries.find(x => x.memo === "COGS sale #1");
  const cogs = e.lines.find(l => l.acct === "cogs").dr;
  assert.ok(Math.abs(cogs - total * (n - 1) / n) < 0.02, `first sale should carry ${(n - 1)}/${n} of the value, got ${cogs} of ${total}`);
  clean(s);
});

// ---------- 5. billing exploits ----------
test("5: a basket line is paid at the price it was picked at", () => {
  const s = fresh();
  const old = s.prices.apple;
  const c = cust({ id: 7, state: "browse", t: 0, browse: 0.01, want: ["apple"], payTime: 1, patience: 999 });
  s.customers.push(c);
  s.spawnAcc = -1e9;                                              // no other arrivals
  E.tick(s, 0.25);                                                // browsing ends, items picked
  assert.ok(c.basket.length >= 1, "customer picked something");
  E.setPrice(s, "apple", old * 2);                                // price changes while the customer queues
  const before = bal(s, "sales");
  const n = c.basket.length;
  for (let i = 0; i < 40 && s.customers.some(x => x.id === 7 && x.state !== "leave"); i++) E.tick(s, 0.25);
  const revenue = bal(s, "sales") - before;
  assert.ok(Math.abs(revenue - old * n) < 0.011, `revenue ${revenue} should be ${old} x ${n}`);
  clean(s);
});

// ---------- 6. checkout lanes ----------
test("6: a new customer takes a FREE lane, never one that is already in use", () => {
  const s = fresh(); s.upgrades.counter = 1; addCashiers(s, 2);
  s.customers.push(cust({ id: 1, state: "pay", lane: 0, payTime: 0.1, basket: [], basketPrices: [] }));
  s.customers.push(cust({ id: 2, state: "pay", lane: 1, payTime: 9999, basket: [], basketPrices: [] }));
  s.customers.push(cust({ id: 3, state: "queue", queuedAt: 1, basket: ["apple"], basketPrices: [3] })); s.stock.apple.shelf -= 1;
  s.spawnAcc = -1e9;
  E.tick(s, 0.25); E.tick(s, 0.25);
  const c3 = s.customers.find(c => c.id === 3);
  assert.equal(c3.state, "pay");
  assert.equal(c3.lane, 0, "lane 0 was freed by customer 1; lane 1 is still busy");
  const lanes = s.customers.filter(c => c.state === "pay").map(c => c.lane);
  assert.equal(new Set(lanes).size, lanes.length, "no two paying customers share a lane");
});
test("6: the queue is first-in-first-out by the time customers joined it", () => {
  const s = fresh(); s.spawnAcc = -1e9;
  s.stock.apple.shelf -= 2;
  s.customers.push(cust({ id: 1, state: "queue", queuedAt: 20, basket: ["apple"], basketPrices: [3] }));   // spawned first, queued later
  s.customers.push(cust({ id: 2, state: "queue", queuedAt: 10, basket: ["apple"], basketPrices: [3] }));
  E.tick(s, 0.25);
  assert.equal(s.customers.find(c => c.id === 2).state, "pay", "customer 2 joined the queue first");
  assert.equal(s.customers.find(c => c.id === 1).state, "queue");
});
test("6: customers get a queuedAt time when they join the queue", () => {
  const s = fresh(); s.spawnAcc = -1e9;
  s.customers.push(cust({ id: 5, state: "browse", t: 0, browse: 0.01, want: ["apple"] }));
  s.upgrades.counter = 0;
  E.tick(s, 0.25);
  const c = s.customers.find(x => x.id === 5);
  assert.ok(c.state === "queue" || c.state === "pay");
  assert.equal(typeof c.queuedAt, "number");
});

// ---------- 7. idempotency ----------
test("7: a command that fails validation can be retried with the same cmdId", () => {
  const s = fresh();
  // order: not enough bank
  const bank = bal(s, "bank");
  assert.ok(E.withdraw(s, bank, "w0").ok);                         // empty the bank
  const lines = [{ pid: "apple", qty: 20 }];
  const bad = E.placeOrder(s, { supplier: "metro", lines, pay: "bank", cmdId: "same" });
  assert.equal(bad.ok, false); assert.match(bad.error, /Not enough/);
  assert.ok(E.deposit(s, bal(s, "cash"), "d0").ok);                // fund the bank again
  const retry = E.placeOrder(s, { supplier: "metro", lines, pay: "bank", cmdId: "same" });
  assert.ok(retry.ok, retry.error);
  assert.equal(E.placeOrder(s, { supplier: "metro", lines, pay: "bank", cmdId: "same" }).ok, false, "a success is still recorded");
  assert.equal(s.orders.length, 1);
});
test("7: deposit, withdraw and loan retry after an error", () => {
  const s = fresh();
  assert.equal(E.deposit(s, 1e6, "a").ok, false); assert.ok(E.deposit(s, 10, "a").ok);
  assert.equal(E.withdraw(s, 1e7, "b").ok, false); assert.ok(E.withdraw(s, 10, "b").ok);
  assert.equal(E.takeLoan(s, "nope", "c").ok, false); assert.ok(E.takeLoan(s, "small", "c").ok);
});
test("7: repayLoan retries after 'not enough in the bank'", () => {
  const s = fresh(); E.takeLoan(s, "small", "l"); const id = s.loans[0].id;
  E.withdraw(s, bal(s, "bank"), "w");                              // bank is empty now
  assert.equal(E.repayLoan(s, id, 20, "rep").ok, false);
  E.deposit(s, bal(s, "cash"), "d");
  assert.ok(E.repayLoan(s, id, 20, "rep").ok, "same id retried after funds exist");
});
test("7: restructureDebt retries after 'no overdraft'", () => {
  const s = fresh();
  assert.equal(E.restructureDebt(s, "r").ok, false);
  s.ledger.bal.overdraft = -50; s.ledger.bal.bank += 50;            // an overdraft appears (balanced move)
  assert.ok(E.restructureDebt(s, "r").ok, "same id retried after the cause appeared");
});
test("7: buyUpgrade retries after 'not enough funds'", () => {
  const s = fresh();
  post(s.ledger, s.day, "test: burn the bank", [{ acct: "rent", dr: bal(s, "bank") }, { acct: "bank", cr: bal(s, "bank") }]);
  assert.equal(E.buyUpgrade(s, "shelves", "up").ok, false);
  post(s.ledger, s.day, "test: fresh funds", [{ acct: "bank", dr: 500 }, { acct: "capital", cr: 500 }]);
  assert.ok(E.buyUpgrade(s, "shelves", "up").ok, "same id retried once funds exist");
});

// ---------- 9. loan fees outside the trading day ----------
test("9: a loan fee taken in the report phase appears in the next day's report", () => {
  const s = fresh();
  while (s.phase === "open") E.tick(s, 0.25);
  assert.equal(s.phase, "report");
  const r = E.takeLoan(s, "small", "fee1"); assert.ok(r.ok);
  const fee = r.terms.fee; assert.ok(fee > 0);
  E.nextDay(s);
  while (s.phase === "open") E.tick(s, 0.25);
  assert.ok(s.lastReport.opex.fees >= fee - 0.001, `fees ${s.lastReport.opex.fees} should include ${fee}`);
  clean(s);
});

// ---------- 10. small things ----------
test("10: loan daysLeft counts down at each closing", () => {
  const s = fresh(); E.takeLoan(s, "small", "l");
  const d0 = s.loans[0].daysLeft;
  while (s.phase === "open") E.tick(s, 0.25);
  assert.equal(s.loans[0].daysLeft, d0 - 1);
});
test("10: manager and supplier-delay descriptions match the real effects", () => {
  assert.doesNotMatch(D.ROLES.manager.desc, /shrink|waste/i);
  assert.match(D.ROLES.manager.desc, /satisfaction/i);
  const ev = D.EVENTS.find(e => e.id === "delay");
  assert.match(ev.text, /new orders/i);
});
