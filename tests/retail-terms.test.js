import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import { balance, totals } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 200000, seed: 4, ...o });
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };
const lines = [{ pid: "noodles", qty: 2000 }];

test("net terms on a shop order cost a little more per unit and defer the goods bill, shipping is paid now", () => {
  const s = mk(), cod = E.quoteMulti(s, "metro", lines), n14 = E.quoteMulti(s, "metro", lines, "retail", "hired", null, "net14");
  assert.ok(cod.ok && n14.ok);
  assert.equal(n14.lines[0].unit, Math.round(cod.lines[0].unit * 1.02 * 100) / 100);
  assert.equal(n14.credit, n14.goods); assert.equal(n14.need, Math.round((n14.total - n14.goods) * 100) / 100);
  assert.equal(cod.credit, 0);
  const cash0 = balance(s.ledger, "cash"), r = E.placeOrders(s, { supplier: "metro", lines, terms: "net14" }); assert.ok(r.ok, r.error);
  assert.equal(Math.round((cash0 - balance(s.ledger, "cash")) * 100), Math.round(n14.ship * 100), "only shipping leaves cash today");
  assert.equal(balance(s.ledger, "payables"), n14.goods);
  assert.ok(totals(s.ledger).balanced);
});

test("the invoice is paid on its due day from cash and the liability clears", () => {
  const s = mk(); const r = E.placeOrders(s, { supplier: "metro", lines, terms: "net7" }); assert.ok(r.ok, r.error);
  const owed = balance(s.ledger, "payables"), due = s.day + 7; assert.ok(owed > 0);
  while (s.day < due - 1) runDay(s); assert.equal(balance(s.ledger, "payables"), owed, "still owed before the due day");
  const cash0 = balance(s.ledger, "cash"); while (s.day <= due) runDay(s);
  assert.equal(balance(s.ledger, "payables"), 0);
  assert.ok(balance(s.ledger, "cash") < cash0);
  assert.ok(E.reconcile(s).ok);
});

test("with credit terms the cash check uses only what is paid now", () => {
  const s = mk({ capital: 20000 }), big = [{ pid: "noodles", qty: 40000 }];
  const cod = E.quoteMulti(s, "metro", big); assert.ok(!cod.ok && cod.total > balance(s.ledger, "cash"), "too dear for cash");
  const net = E.quoteMulti(s, "metro", big, "retail", "hired", null, "net30"); assert.ok(net.need < net.total);
  assert.equal(E.placeOrders(s, { supplier: "metro", lines: big }).ok, false);
});

test("an unknown term falls back to cash on delivery", () => {
  const s = mk(), q = E.quoteMulti(s, "metro", lines, "retail", "hired", null, "net99"); assert.equal(q.terms, "cod"); assert.equal(q.credit, 0);
});

test("bulk warehouse orders take Net terms the same way", () => {
  const s = mk({ capital: 400000 }); assert.ok(E.rentWarehouse(s, 2500).ok);
  const wl = [{ pid: "noodles", qty: 100000 }], cash0 = balance(s.ledger, "cash");
  const r = E.placeOrders(s, { supplier: "harbor", dest: "wh", lines: wl, terms: "net30" }); assert.ok(r.ok, r.error);
  const goods = balance(s.ledger, "payables"); assert.ok(goods > 0);
  assert.ok(cash0 - balance(s.ledger, "cash") < goods, "the goods bill was not paid up front");
  assert.ok(totals(s.ledger).balanced);
  for (let i = 0; i < 31; i++) runDay(s);
  assert.equal(balance(s.ledger, "payables"), 0);
  assert.ok(E.reconcile(s).ok);
});
