import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as St from "../js/stock.js";
import * as D from "../js/data.js";
import * as SC from "../js/screens.js";
import { act, newForms } from "../js/actions.js";
import { balance, totals, post } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 80, capital: 200000, seed: 21, ...o });
const runDays = (s, n) => { const end = s.day + n; while (s.day < end && !s.ended) E.tick(s, 1); };
const addMilk = (s, n) => { const v = Math.round(n * 1.95 * 100) / 100; s.qty.milk += n; s.val.milk = Math.round((s.val.milk + v) * 100) / 100; post(s.ledger, s.day, "test milk", [{ acct: "inventory", dr: v }, { acct: "capital", cr: v }], "t:m" + s.day); };
const clearMilk = s => { const v = s.val.milk; if (v > 0) post(s.ledger, s.day, "test clear", [{ acct: "capital", dr: v }, { acct: "inventory", cr: v }], "t:c"); s.qty.milk = 0; s.val.milk = 0; St.ensureStk(s).age.milk = []; };
const age = (s, n) => { for (let i = 0; i < n; i++) { s.day++; St.stockDay(s); } };   // time passes with no customers, so only age and loss move the stock
const noSales = () => {};

test("only milk has a shelf life; the data says so", () => { assert.deepEqual(St.perishables().map(p => p.id), ["milk"]); });
test("an old batch goes off after its shelf life and is booked as a loss at cost", () => {
  const s = mk(); noSales(s); clearMilk(s); addMilk(s, 100);
  const cash0 = balance(s.ledger, "cash"); age(s, D.PRODUCTS.find(p => p.id === "milk").shelf - 2);
  assert.ok(s.qty.milk > 80); const before = s.qty.milk; age(s, 4);
  assert.ok(s.qty.milk < before && s.stk.spoiled > 50, "spoiled " + s.stk.spoiled);
  assert.ok(balance(s.ledger, "shrinkage") > 50); assert.ok(totals(s.ledger).balanced); assert.equal(E.reconcile(s).ok, true);
  void cash0;
});
test("batches follow stock in and out: sales take the oldest first, arrivals make a new batch", () => {
  const s = mk(); noSales(s); clearMilk(s);
  addMilk(s, 50); age(s, 3); addMilk(s, 70); age(s, 1);
  const b = St.batchesOf(s, "milk"); assert.equal(b.length, 2); assert.ok(b[0].left < b[1].left);
  assert.equal(b.reduce((a, x) => a + x.q, 0), s.qty.milk);
  const take = Math.min(s.qty.milk, b[0].q + 5); s.qty.milk -= take; s.val.milk = Math.max(0, Math.round((s.val.milk - take * 1.95) * 100) / 100); post(s.ledger, s.day, "t", [{ acct: "capital", dr: Math.round(take * 1.95 * 100) / 100 }, { acct: "inventory", cr: Math.round(take * 1.95 * 100) / 100 }], "t:o");
  age(s, 1); const a = St.batchesOf(s, "milk"); assert.equal(a.length, 1); assert.equal(a.reduce((x, y) => x + y.q, 0), s.qty.milk);
});
test("unbooked loss builds up, a stock take books it, costs staff time, and halves the rate for two weeks", () => {
  const s = mk(); age(s, 12);
  const gap = Object.values(s.stk.gap).reduce((a, b) => a + b, 0); assert.ok(gap > 0.5, "gap " + gap);
  const cash0 = balance(s.ledger, "cash"), inv0 = balance(s.ledger, "inventory"), sh0 = balance(s.ledger, "shrinkage");
  const r = St.stockTake(s); assert.ok(r.ok); assert.equal(r.fee, St.STOCK.countFee);
  assert.ok(balance(s.ledger, "shrinkage") >= sh0); assert.ok(balance(s.ledger, "inventory") <= inv0); assert.ok(cash0 - balance(s.ledger, "cash") >= St.STOCK.countFee - 0.01);
  assert.ok(totals(s.ledger).balanced); assert.equal(E.reconcile(s).ok, true);
  assert.ok(Object.values(s.stk.gap).every(g => g >= 0 && g < 1)); assert.match(St.stockTake(s).error, /ago/);   // too soon
  assert.equal(St.canCount(s), false);
});
test("a count the player cannot afford is refused; the loss rate really halves after a count", () => {
  const poor = mk({ capital: 1000 }); poor.ledger.bal.cash = 10;
  assert.match(St.stockTake(poor).error, /staff time/);
  const a = mk({ seed: 5 }), b = mk({ seed: 5 }); age(a, 3); age(b, 3); St.stockTake(b); const ga = Object.values(a.stk.gap).reduce((x, y) => x + y, 0), gb0 = Object.values(b.stk.gap).reduce((x, y) => x + y, 0);
  age(a, 10); age(b, 10); const da = Object.values(a.stk.gap).reduce((x, y) => x + y, 0) - ga, db = Object.values(b.stk.gap).reduce((x, y) => x + y, 0) - gb0;
  assert.ok(db < da, `after count ${db} vs none ${da}`);
});
test("screen, action and old saves", () => {
  const s = mk(), f = newForms(); delete s.stk; delete s.ledger.bal.shrinkage;
  assert.match(SC.freshness(s), /Count the shelves/);
  runDays(s, 5); assert.ok(act(s, f, "stockTake", {}).ok);
  const back = E.validateSave(JSON.parse(E.serialize(mk()))); assert.ok(back.ok);
  const old = JSON.parse(E.serialize(mk())); delete old.ledger.bal.shrinkage; delete old.stk; const v = E.validateSave(old); assert.ok(v.ok, v.error); runDays(v.state, 3); assert.equal(E.reconcile(v.state).ok, true);
});

test("a full game with milk spoilage and counts stays balanced, deterministic and reconciled", () => {
  const run = () => { const s = mk(); for (let d = 0; d < 6; d++) { runDays(s, 5); if (d % 2) St.stockTake(s); } return s; };
  const a = run(), b = run(); assert.equal(E.reconcile(a).ok, true); assert.ok(totals(a.ledger).balanced); assert.equal(E.serialize(a), E.serialize(b));
});
