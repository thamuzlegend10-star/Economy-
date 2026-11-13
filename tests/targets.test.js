import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as Kp from "../js/kpi.js";
import * as L from "../js/live.js";
import * as SC from "../js/screens.js";
import * as D from "../js/data.js";
import { act, newForms } from "../js/actions.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 200000, seed: 21, ...o });

test("targets: set, validate, progress is capped at 100 and the normal score does not change", () => {
  const s = mk(); const score0 = Kp.scoreboard(s).total;
  assert.equal(Kp.targetProgress(s).total, null);
  assert.equal(Kp.setTargets(s, { csi: -5 }).ok, false); assert.equal(Kp.setTargets(s, { csi: "abc" }).ok, false);
  assert.ok(Kp.setTargets(s, { csi: 50, serviceLevel: 95, revenue: "" }).ok);
  const tp = Kp.targetProgress(s); assert.equal(tp.rows.length, 2); assert.ok(tp.rows.every(r => r.pct >= 0 && r.pct <= 100)); assert.ok(tp.total >= 0 && tp.total <= 100);
  assert.equal(Kp.scoreboard(s).total, score0);
  assert.ok(Kp.setTargets(s, { csi: 1 }).ok); assert.equal(Kp.targetProgress(s).rows[0].met, true); assert.equal(Kp.targetProgress(s).rows[0].pct, 100);
  assert.ok(Kp.setTargets(s, {}).ok); assert.equal(Kp.targetProgress(s).total, null);
});
test("presets scale with the level and a locked set cannot be changed by the player", () => {
  const s = mk(), e = Kp.presetTargets(s, "easy"), h = Kp.presetTargets(s, "hard");
  for (const d of D.KPIS) assert.ok(h[d.id] >= e[d.id], d.id);
  assert.equal(Kp.presetTargets(s, "nope"), null);
  assert.ok(Kp.applyPreset(s, "standard", true).ok); assert.equal(s.kpi.lock, true);
  assert.match(Kp.setTargets(s, { csi: 1 }).error, /facilitator/);
  assert.match(SC.scoring(s, newForms()), /Set by the facilitator/);
});
test("live settings carry the target level; bad values are dropped", () => {
  assert.equal(L.cleanSettings({ targets: "hard" }).targets, "hard"); assert.equal(L.cleanSettings({ targets: "x" }).targets, "");
});
test("actions and screen work; old saves without targets load", () => {
  const s = mk(), f = newForms(); delete s.kpi.targets;
  assert.match(SC.scoring(s, f), /Save targets/);
  assert.ok(act(s, f, "targetsPreset", { id: "easy" }).ok); assert.ok(Kp.targetProgress(s).rows.length === 8);
  f.tg = { csi: 60 }; assert.ok(act(s, f, "targets", {}).ok); assert.equal(Kp.targetProgress(s).rows.length, 1);
  assert.ok(act(s, f, "targetsClear", {}).ok);
  assert.ok(E.validateSave(JSON.parse(E.serialize(s))).ok);
});
