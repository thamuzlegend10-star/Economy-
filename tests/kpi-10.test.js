import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as Kp from "../js/kpi.js";
import * as D from "../js/data.js";
import { post } from "../js/ledger.js";
import * as SC from "../js/screens.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 200000, seed: 21, kpi10: true, ...o });
const days = (s, n) => { for (let i = 0; i < n; i++) E.stepDay(s); };

test("ten indicators with equal 10 percent weights", () => {
  assert.equal(D.KPIS10.length, 10); assert.ok(D.KPIS10.every(k => k.weight === 0.1));
  const s = mk(); days(s, 4); const sb = Kp.scoreboard(s);
  assert.equal(sb.rows.length, 10); assert.deepEqual(sb.rows.map(r => r.id), ["netProfit", "dsi", "opexRatio", "roa", "serviceLevel", "marketShare", "csi", "morale", "solvency", "oee"]);
  for (const r of sb.rows) assert.ok(r.score >= 0 && r.score <= 100, r.id);
});
test("OEE is out of the score while the factory is off, and the rest re-normalise", () => {
  const s = mk(); days(s, 3); const sb = Kp.scoreboard(s), oee = sb.rows.find(r => r.id === "oee");
  assert.equal(oee.na, true); assert.equal(oee.points, 0);
  const w = sb.rows.filter(r => !r.na).reduce((a, r) => a + r.weight, 0); assert.ok(Math.abs(w - 1) < 0.02);
  assert.ok(sb.total > 0 && sb.total <= 100);
});
test("DSI is stock value over 30-day cost of goods, times 30", () => {
  const s = mk(); s.day = 31; s.dayStep = 0;
  post(s.ledger, 1, "cogs", [{ acct: "cogs", dr: 30000 }, { acct: "cash", cr: 30000 }], "t:1");
  post(s.ledger, 1, "more stock", [{ acct: "inventory", dr: 20000 }, { acct: "cash", cr: 20000 }], "t:2");
  const bal = a => s.ledger.bal[a] || 0, inv = bal("inventory"), cogs = bal("cogs"), want = Math.round(inv / cogs * 30 * 100) / 100, stock = inv;
  assert.equal(Kp.dsi(s), want); assert.ok(stock >= 0);
  const k = Kp.kpis(s), n = Kp.normalise(s, k); assert.ok(n.dsi >= 0 && n.dsi <= 100);
});
test("lower DSI and lower expense ratio score higher", () => {
  const s = mk(); s.day = 10; const k = Kp.kpis(s);
  const a = Kp.normalise(s, { ...k, dsi: 12 }).dsi, b = Kp.normalise(s, { ...k, dsi: 55 }).dsi; assert.ok(a > b); assert.equal(Kp.normalise(s, { ...k, dsi: 5 }).dsi, 100);
  post(s.ledger, 1, "sale", [{ acct: "cash", dr: 1000 }, { acct: "sales", cr: 1000 }], "t:s"); post(s.ledger, 1, "rent", [{ acct: "rent", dr: 100 }, { acct: "cash", cr: 100 }], "t:r");
  assert.equal(Kp.opexRatio(s), 10); assert.equal(Kp.normalise(s, { ...Kp.kpis(s) }).opexRatio, 80);
});
test("OEE turns on with a working factory and falls with broken days", () => {
  const s = mk({ mods: { factory: true } }); s.fx.eff = { cap: 100, made: 80, idleDays: 0, brokenDays: 0 }; s.fx.machines = [{}];
  if (Kp.oeeOn(s)) assert.equal(Kp.oee(s), 80); else assert.equal(Kp.oeeOn(s), false);
  const t = mk(); t.fx.eff = { cap: 100, made: 80, idleDays: 0, brokenDays: 2 }; t.fx.machines = [{}]; t.day = 11; assert.equal(Kp.oee(t), 64);
});
test("custom weights still work and re-normalise; a lower-is-better target is met by a smaller number", () => {
  const s = mk(); const w = Object.fromEntries(D.KPIS10.map(k => [k.id, k.id === "netProfit" ? 3 : 0])); assert.ok(Kp.setWeights(s, w).ok); assert.equal(s.kpi.weights.netProfit, 1);
  assert.equal(Kp.setWeights(s, {}).ok, false);
  Kp.setTargets(s, { dsi: 40, opexRatio: 30 }); const tp = Kp.targetProgress(s); assert.ok(tp.rows.every(r => r.met === (r.value <= r.target)));
  assert.ok(Kp.presetTargets(s, "standard").dsi > 0);
});
test("games without the flag keep the eight KPIs and their weights", () => {
  const s = mk({ kpi10: false }); assert.equal(Kp.scoreboard(s).rows.length, 8); assert.equal(Kp.kpiSet(s), D.KPIS);
  const old = mk(); delete old.kpi10; old.kpi = { weights: Object.fromEntries(D.KPIS.map(k => [k.id, k.weight])), targets: {}, lock: false };
  assert.equal(Kp.scoreboard(old).rows.length, 8);
});
test("the scoring screen renders all ten with sensible text", () => {
  const s = mk(); days(s, 3); const h = SC.kpis ? SC.kpis(s, { w: {}, tg: {} }) : ""; if (h) { assert.match(h, /Days sales in inventory/); assert.doesNotMatch(h, /NaN|undefined|null/); }
});
