import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as K from "../js/market.js";
import * as Kp from "../js/kpi.js";
import { post } from "../js/ledger.js";
import * as SC from "../js/screens.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 200000, seed: 21, ...o });

test("seller has no stars before 8 orders, then stars follow late deliveries", () => {
  const s = mk(); K.ensureEcom(s);
  assert.equal(K.sellerStars(s), null); assert.equal(K.sellerFactor(s), 1);
  s.ecom.stats.orders = 100; s.ecom.stats.late = 0; assert.equal(K.sellerStars(s), 5); assert.equal(K.sellerFactor(s), 1);
  s.ecom.stats.late = 10; assert.equal(K.sellerStars(s), 3.5);
  s.ecom.stats.late = 50; assert.equal(K.sellerStars(s), 0); assert.ok(Math.abs(K.sellerFactor(s) - 0.8) < 1e-9);
});
test("ratios give numbers for a funded game and null when equity is gone", () => {
  const s = mk(), R = Kp.ratios(s);
  assert.ok(R.roe != null && R.debtToEquity != null);
  post(s.ledger, s.day, "wipe", [{ acct: "wages", dr: 500000 }, { acct: "cash", cr: 500000 }], "t:1");
  assert.equal(Kp.ratios(s).roe, null);
});
test("statements screen shows the ratios", () => {
  assert.match(SC.statements(mk()), /Return on equity/);
});
