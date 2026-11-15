import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import { totals, post } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 20, days: 30, capital: 60000, seed: 12, ...o });
test("stepDay runs to exactly the next day and stops", () => {
  const s = mk(); const d = s.day; assert.ok(E.stepDay(s) > 0); assert.equal(s.day, d + 1); E.stepDay(s); assert.equal(s.day, d + 2);
  assert.ok(totals(s.ledger).balanced); assert.equal(E.reconcile(s).ok, true);
});
test("stepping a day at a time gives the same game as running the clock", () => {
  const a = mk(), b = mk(); for (let i = 0; i < 6; i++) E.stepDay(a); while (b.day < a.day) E.tick(b, 1);
  assert.equal(JSON.stringify(a.history.map(h => h.revenue)), JSON.stringify(b.history.map(h => h.revenue)));
});
test("stepDay does nothing once the game has ended", () => {
  const s = mk({ days: 5 }); while (!s.ended) E.stepDay(s); const d = s.day; assert.equal(E.stepDay(s), 0); assert.equal(s.day, d);
});
test("restart gives the same setup from day 1 with the same market", () => {
  const s = mk(); for (let i = 0; i < 4; i++) E.stepDay(s);
  const r = E.restartSame(s); assert.equal(r.day, 1); for (const k of ["location", "area", "secPerDay", "days", "capital", "seed", "scenario", "difficulty"]) assert.deepEqual(r[k], s[k], k);
  assert.deepEqual(r.mods, s.mods); const x = mk(); for (let i = 0; i < 4; i++) { E.stepDay(r); E.stepDay(x); } assert.equal(JSON.stringify(r.history.map(h => h.revenue)), JSON.stringify(x.history.map(h => h.revenue)));
});

test("the bankruptcy limit is a setup choice; old games keep three days", () => {
  assert.equal(mk().bkDays, 3); assert.equal(mk({ bkDays: 20 }).bkDays, 20); assert.equal(mk({ bkDays: 7 }).bkDays, 3);
  const s = mk({ bkDays: 5 }); assert.equal(E.bankruptDays(s), 5); delete s.bkDays; assert.equal(E.bankruptDays(s), 3);
});
test("overdrawn long enough ends the game, and not before the limit", () => {
  for (const lim of [3, 10]) {
    const s = mk({ bkDays: lim }); post(s.ledger, s.day, "test overdraft", [{ acct: "capital", dr: 5e7 }, { acct: "overdraft", cr: 5e7 }], "t:od");
    let n = 0; while (!s.ended && n < 80) { E.stepDay(s); n++; }
    assert.equal(s.ended && s.ended.reason, "bankrupt"); assert.equal(n, lim, "limit " + lim);
  }
});

test("price sensitivity is a per-product setup choice that changes how much price matters", () => {
  const a = mk(), hi = mk({ elastSet: { noodles: "high", milk: "bogus" } }), lo = mk({ elastSet: { noodles: "low" } });
  assert.deepEqual(a.elastSet, {}); assert.deepEqual(hi.elastSet, { noodles: "high" });
  const p = D.PRODUCTS.find(x => x.id === "noodles"); for (const g of [a, hi, lo]) E.setPrice(g, "noodles", g.prices.noodles * 1.3);
  const da = E.expectedDemand(a, "noodles"), dh = E.expectedDemand(hi, "noodles"), dl = E.expectedDemand(lo, "noodles");
  assert.ok(dh < da && da < dl, `${dh} < ${da} < ${dl}`); assert.equal(E.elastOf(a, p), p.elast);
  const same = E.expectedDemand(hi, "milk") === E.expectedDemand(a, "milk"); assert.equal(same, true);
});
test("restart keeps the price sensitivity; old games without it behave as normal", () => {
  const s = mk({ elastSet: { earbuds: "low" } }); assert.deepEqual(E.restartSame(s).elastSet, { earbuds: "low" });
  const old = mk(); delete old.elastSet; assert.equal(E.elastOf(old, D.PRODUCTS[0]), D.PRODUCTS[0].elast);
});
