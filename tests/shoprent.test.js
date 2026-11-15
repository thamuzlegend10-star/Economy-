import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as SC from "../js/screens.js";
import { act, newForms } from "../js/actions.js";
import { balance, totals } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 20, days: 60, capital: 80000, seed: 14, ...o });
test("a new game pays the daily rate; terms cut the daily rent", () => {
  const s = mk(); const base = E.dailyRent(s.location, s.area); assert.equal(E.shopRent(s), base);
  assert.equal(E.setShopTerm(s, "month").ok, true); assert.ok(Math.abs(E.shopRent(s) - base * 0.8) < 0.01);
});
test("a running term fixes the shop size and cannot be swapped", () => {
  const s = mk(); E.setShopTerm(s, "week"); const q = E.spaceQuote(s, 50); assert.equal(q.ok, false); assert.match(q.errors[0], /fixed/);
  assert.equal(E.rentMoreSpace(s, 50).ok, false); assert.equal(E.setShopTerm(s, "month").ok, false);
  s.day += 7; assert.equal(E.shopTermNow(s).id, "day"); assert.equal(E.rentMoreSpace(s, 50).ok, true);
});
test("the daily rent charge follows the term, and the books balance", () => {
  const a = mk(), b = mk(); E.setShopTerm(b, "month"); while (a.day < 4) { E.tick(a, 1); E.tick(b, 1); }
  assert.ok(balance(b.ledger, "rent") < balance(a.ledger, "rent")); assert.ok(totals(b.ledger).balanced); assert.equal(E.reconcile(b).ok, true);
});
test("old saves without a term pay the daily rate; add-space still works", () => {
  const s = mk(); delete s.rentTerm; assert.equal(E.shopRent(s), E.dailyRent(s.location, s.area)); assert.equal(E.rentMoreSpace(s, 50).ok, true);
});
test("the rent term card and action work", () => {
  const s = mk(), f = newForms(); assert.match(SC.rentTermCard(s), /Rent term/); const r = act(s, f, "shopTerm", { id: "week" }); assert.equal(r.ok, true); assert.equal(s.rentTerm.id, "week");
  assert.match(SC.rentTermCard(s), /days left/);
});
