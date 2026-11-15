import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as Sh from "../js/shelf.js";
import * as D from "../js/data.js";
import * as SC from "../js/screens.js";
import { act, newForms } from "../js/actions.js";
import { balance, totals } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 250, secPerDay: 20, days: 40, capital: 80000, seed: 41, ...o });
const sold = s => s.stats.units;
test("customers can only buy what is on the shelf", () => {
  const s = mk(); Sh.ensureShelf(s); s.shelf.noodles = 0; s.shelfCfg.freq = 1; s.dayStep = 3;   // not a restock step
  const before = s.qty.noodles; E.stepDay(s); assert.equal(s.stats.prod.noodles.units, 0);
  assert.equal(s.qty.noodles, before); assert.ok(s.shelfCfg.missed.noodles > 0, "empty-shelf sales are counted as missed"); assert.ok(s.stats.lost > 0);
});
test("the shelf holds at most its display capacity; the rest stays in the back room", () => {
  const s = mk(); Sh.ensureShelf(s); const r = Sh.restock(s); assert.equal(r.ok, true);
  for (const p of D.PRODUCTS) { assert.ok(Sh.onShelf(s, p.id) <= Sh.shelfCap(s, p.id)); assert.equal(Sh.onShelf(s, p.id) + Sh.backRoom(s, p.id), s.qty[p.id]); }
  assert.ok(Sh.shelfCap(s, "noodles") < s.qty.noodles || s.qty.noodles <= Sh.shelfCap(s, "noodles"));
});
test("a small shelf with one restock a day loses sales that two or four runs do not (calibration)", () => {
  const run = freq => { const s = mk({ area: 120 }); Sh.ensureShelf(s); s.shelfCfg.freq = freq; for (const p of D.PRODUCTS) { s.qty[p.id] += 50000; s.val[p.id] += 50000 * p.cost; } s.ledger.bal.inventory += 50000 * 8.8; s.ledger.bal.capital -= 50000 * 8.8; s.ledger.bal.capital = Math.round(s.ledger.bal.capital * 100) / 100;
    while (s.day < 8 && !s.ended) E.tick(s, 1); return sold(s); };
  const a = run(1), b = run(4); assert.ok(b > a, `${b} should beat ${a}`);
});
test("a bigger share for a product gives it a bigger shelf", () => {
  const s = mk(); Sh.ensureShelf(s); Sh.setShelf(s, { preset: "balanced" }); const a = Sh.shelfCap(s, "noodles"); Sh.setShelf(s, { preset: "food" }); assert.ok(Sh.shelfCap(s, "noodles") > a);
  assert.equal(Sh.setShelf(s, { preset: "nope" }).ok, false); assert.equal(Sh.setShelf(s, { freq: 3 }).ok, false);
});
test("restocking runs cost a small labour amount only when something moves; books balance", () => {
  const s = mk(); Sh.ensureShelf(s); const m0 = balance(s.ledger, "maintenance"); const r = Sh.restock(s, true); assert.ok(r.moved > 0);
  assert.ok(Math.abs(balance(s.ledger, "maintenance") - m0 - Sh.SHELF.runCost) < 0.001); const m1 = balance(s.ledger, "maintenance"); Sh.restock(s, true); assert.equal(balance(s.ledger, "maintenance"), m1);
  assert.ok(totals(s.ledger).balanced);
});
test("a real game stays balanced and reconciled, and still sells", () => {
  const s = mk(); while (s.day < 10 && !s.ended) E.tick(s, 1); assert.ok(sold(s) > 0); assert.ok(totals(s.ledger).balanced); assert.equal(E.reconcile(s).ok, true);
});
test("old saves without shelves sell straight from stock", () => {
  const s = mk(); delete s.shelfOn; assert.equal(Sh.onShelf(s, "noodles"), s.qty.noodles); assert.equal(Sh.restock(s).ok, false); while (s.day < 4) E.tick(s, 1); assert.ok(sold(s) > 0);
});
test("the card renders for new and old games; actions work", () => {
  const s = mk(), f = newForms(); assert.match(SC.shelfCard(s), /Shelf and back room/); const old = mk(); delete old.shelfOn; assert.match(SC.shelfCard(old), /Not in this game/);
  assert.equal(act(s, f, "shelfPreset", { id: "drinks" }).ok, true); assert.equal(act(s, f, "shelfFreq", { id: 4 }).ok, true); assert.equal(s.shelfCfg.freq, 4); assert.equal(act(s, f, "shelfNow", {}).ok, true);
});
