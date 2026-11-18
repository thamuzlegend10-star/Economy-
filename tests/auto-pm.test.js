import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as F from "../js/factory.js";
import * as D from "../js/data.js";
import { balance } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 40, capital: 400000, seed: 11, ...o });
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };

test("auto service restores a worn machine at its threshold and books the cost", () => {
  const s = mk(); F.rentFactory(s, 300); F.buyMachine(s, { type: "std" });
  const m = s.fx.machines[0]; m.health = 55;
  assert.equal(F.setAutoPm(s, m.id, 60).ok, true);
  const before = balance(s.ledger, "maintenance"); runDay(s);
  assert.ok(balance(s.ledger, "maintenance") - before >= D.MACHINES[0].pmCost - 1e-6);
  assert.ok(m.health >= D.MAINT.restoreTo - 1e-6);
  assert.ok(E.reconcile(s).ok);
});

test("auto service off or above health does nothing; bad value refused", () => {
  const s = mk(); F.rentFactory(s, 300); F.buyMachine(s, { type: "std" });
  const m = s.fx.machines[0]; m.health = 90; F.setAutoPm(s, m.id, 60);
  runDay(s);
  assert.ok(!s.fx.today.auto, "no auto service above the threshold");
  assert.equal(F.setAutoPm(s, m.id, 33).ok, false);
  assert.equal(F.setAutoPm(s, m.id, "off").ok, true); assert.equal(m.autoPmThreshold, null);
});
