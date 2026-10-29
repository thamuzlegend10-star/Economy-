// Rivals are real entities: they have prices and promotions, react to the player, and take a share of demand.
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";

const mk = (location = "id-jakarta-central", o = {}) => E.newGame({ seed: 7, difficulty: "normal", mode: "standard", dayLimit: 20, location, ...o });
const endDay = s => { while (s.phase === "open") E.tick(s, 0.25); if (!s.ended) E.nextDay(s); };
const clean = s => assert.deepEqual(E.reconcile(s), { ok: true, problems: [] });
const setPrices = (s, k) => { for (const p of D.PRODUCTS) s.prices[p.id] = Math.round(p.ref * k * 100) / 100; };

test("neutral location has no rivals and full share", () => {
  const s = mk("default");
  assert.equal(s.rivals.length, 0);
  assert.equal(E.marketShare(s), 1);
});
test("busy sites get rivals with names, kinds and prices", () => {
  const s = mk("us-nyc-manhattan");
  assert.ok(s.rivals.length >= 2);
  for (const r of s.rivals) { assert.ok(r.name && E.RIVAL_KIND[r.kind]); assert.ok(r.price > 0.5 && r.price < 2); }
  assert.equal(new Set(s.rivals.map(r => r.name)).size, s.rivals.length);
});
test("making rivals does not consume the game rng", () => {
  const a = mk("id-jakarta-central"), b = mk("id-jakarta-central");
  assert.equal(a.rng, b.rng);
  assert.deepEqual(a.rivals, b.rivals);
});
test("share falls when you price above the market and rises when you price below", () => {
  const s = mk(); setPrices(s, 1.0); const base = E.marketShare(s);
  setPrices(s, 1.5); const high = E.marketShare(s);
  setPrices(s, 0.8); const low = E.marketShare(s);
  assert.ok(high < base && base < low, `${high} ${base} ${low}`);
});
test("share responds to reputation and to stockouts", () => {
  const s = mk();
  assert.ok(E.marketShare(s, 90) > E.marketShare(s, 30));
  const base = E.marketShare(s); s.stockoutRate = 0.8;
  assert.ok(E.marketShare(s) < base);
});
test("a rival promotion takes share", () => {
  const s = mk(); const base = E.marketShare(s);
  s.rivals.forEach(r => { r.promo = 2; });
  assert.ok(E.marketShare(s) < base);
});
test("rivals undercut a much cheaper player over time", () => {
  const s = mk("us-nyc-manhattan"); setPrices(s, 0.7);
  const before = s.rivals.map(r => r.price);
  for (let i = 0; i < 12; i++) endDay(s);
  assert.ok(s.rivals.some((r, i) => r.price < before[i]));
});
test("same seed gives same rival history", () => {
  const run = () => { const s = mk(); for (let i = 0; i < 8; i++) endDay(s); return JSON.stringify(s.rivals); };
  assert.equal(run(), run());
});
test("ledger stays balanced and share is recorded", () => {
  const s = mk(); for (let i = 0; i < 6; i++) endDay(s);
  clean(s);
  assert.ok(s.history.length >= 1);
  assert.ok(s.shareLast > 0 && s.shareLast <= 1);
  assert.equal(typeof s.history.length, "number");
});
test("save round trip keeps rivals; v5 saves migrate with rivals added", () => {
  const s = mk(); for (let i = 0; i < 3; i++) endDay(s);
  const r = E.validateSave(JSON.stringify(s));
  assert.ok(r.ok, r.error); assert.deepEqual(r.state.rivals, s.rivals);
  const old = JSON.parse(JSON.stringify(s)); old.v = 5; delete old.rivals; delete old.shareLast; delete old.stockoutRate;
  const m = E.validateSave(old);
  assert.ok(m.ok, m.error); assert.equal(m.state.v, D.SAVE_VERSION); assert.ok(m.state.rivals.length >= 1);
});
test("crafted rival data is rejected", () => {
  const s = mk(); const o = JSON.parse(JSON.stringify(s)); o.rivals[0].price = -5;
  assert.equal(E.validateSave(o).ok, false);
});
