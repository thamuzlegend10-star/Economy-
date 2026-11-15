import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as In from "../js/intel.js";
import * as SC from "../js/screens.js";
import { act, newForms } from "../js/actions.js";
import { balance, totals } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 20, days: 40, capital: 60000, seed: 21, ...o });
test("new games lock rival prices until you subscribe; old saves see them free", () => {
  const s = mk(); assert.equal(In.intelActive(s), false); assert.match(SC.competitors(s), /Locked/);
  const old = mk(); delete old.intelFee; assert.equal(In.intelActive(old), true); assert.match(SC.competitors(old), /Rival A/);
});
test("subscribing unlocks the prices and charges the fee every night; cancelling stops it", () => {
  const s = mk(), f = newForms(); assert.equal(act(s, f, "intelOn", {}).ok, true); assert.equal(act(s, f, "intelOn", {}).ok, false);
  assert.match(SC.competitors(s), /Rival A/); const m0 = balance(s.ledger, "marketing"); E.stepDay(s); E.stepDay(s);
  assert.ok(Math.abs(balance(s.ledger, "marketing") - m0 - 2 * In.INTEL.fee) < 0.01); assert.equal(s.intel.days, 2);
  assert.equal(act(s, f, "intelOff", {}).ok, true); const m1 = balance(s.ledger, "marketing"); E.stepDay(s); assert.equal(balance(s.ledger, "marketing"), m1);
  assert.ok(totals(s.ledger).balanced); assert.equal(E.reconcile(s).ok, true);
});
test("subscribing in a game without the feature is refused", () => { const s = mk(); delete s.intelFee; assert.equal(In.subscribe(s).ok, false); });
