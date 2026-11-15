import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import * as UI from "../js/ui.js";
import { balance, totals } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 80, capital: 400000, seed: 8, ...o });
const rate = s => E.whRentPerM2(s.location);

test("longer terms are cheaper per day", () => {
  const s = mk(), a = E.whRentQuote(s, 500, "day"), w = E.whRentQuote(s, 500, "week"), m = E.whRentQuote(s, 500, "month");
  assert.ok(m.newRent < w.newRent && w.newRent < a.newRent);
  assert.equal(a.newRent, Math.round(rate(s) * 500 * 100) / 100);
});
test("renting with a term sets the term and the daily rent", () => {
  const s = mk(); const r = E.rentWarehouse(s, 500, "month"); assert.equal(r.ok, true);
  assert.equal(s.wh.term, "month"); assert.equal(s.wh.until, s.day + 30); assert.equal(E.whRent(s), r.rent); assert.equal(E.whTermLeft(s), 30);
});
test("after the term ends the rent goes back to daily", () => {
  const s = mk(); E.rentWarehouse(s, 500, "week"); const cheap = E.whRent(s); s.day += 7;
  assert.ok(E.whRent(s) > cheap); assert.equal(E.whTermNow(s).id, "day");
});
test("picking daily inside a running term keeps the term; picking a term restarts it", () => {
  const s = mk(); E.rentWarehouse(s, 500, "month"); const q = E.whRentQuote(s, 500, "day"); assert.equal(q.keptTerm, true); assert.equal(q.term.id, "month");
  s.day += 5; E.rentWarehouse(s, 500, "day"); assert.equal(s.wh.term, "month"); assert.equal(s.wh.until, 31);
  E.rentWarehouse(s, 500, "week"); assert.equal(s.wh.term, "week"); assert.equal(s.wh.until, s.day + 7);
});
test("an old save without a term pays the daily rate", () => {
  const s = mk(); s.wh.area = 500; delete s.wh.term; delete s.wh.until; assert.equal(E.whRent(s), Math.round(rate(s) * 500 * 100) / 100);
});
test("giving up inside a term costs the rent still owed, and the books balance", () => {
  const s = mk(); E.rentWarehouse(s, 500, "month"); s.day += 10; const daily = E.whRent(s), cash0 = balance(s.ledger, "cash");
  const r = E.releaseWarehouse(s); assert.equal(r.ok, true); assert.ok(Math.abs(r.fee - daily * 20) < 0.02);
  assert.ok(Math.abs(cash0 - balance(s.ledger, "cash") - r.fee) < 0.02); assert.equal(s.wh.area, 0); assert.equal(E.whRent(s), 0); assert.ok(totals(s.ledger).balanced);
});
test("giving up after the term, or on a daily term, is free", () => {
  const s = mk(); E.rentWarehouse(s, 500, "week"); s.day += 8; assert.equal(E.releaseWarehouse(s).fee, 0);
  const t = mk(); E.rentWarehouse(t, 500, "day"); assert.equal(E.releaseWarehouse(t).fee, 0);
});
test("cannot give up a warehouse that holds goods or has deliveries coming", () => {
  const s = mk(); E.rentWarehouse(s, 500, "day"); s.wh.qty.milk = 10; assert.equal(E.releaseWarehouse(s).ok, false);
  s.wh.qty.milk = 0; s.orders.push({ id: 1, dest: "wh", kind: "buy", eta: 99 }); assert.equal(E.releaseWarehouse(s).ok, false);
  assert.equal(E.releaseWarehouse(mk()).ok, false);
});
test("daily rent is charged at the term rate in a real day run", () => {
  const s = mk(); E.rentWarehouse(s, 500, "month"); const r0 = balance(s.ledger, "rent"); while (s.day < 3) E.tick(s, 1);
  assert.ok(totals(s.ledger).balanced); assert.equal(E.reconcile(s).ok, true); assert.ok(balance(s.ledger, "rent") > r0);
});
test("the rent form shows terms", () => {
  const s = mk(); assert.match(UI.spaceForm(s, 500, "wh", "week"), /Rent term[\s\S]*7 days/);
});
