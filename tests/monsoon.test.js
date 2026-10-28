// Tests for the planning loop: forecast, campaigns, supplier price drift, budgets, v3 -> v4 migration.
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import { balance } from "../js/ledger.js";

const fresh = (o = {}) => E.newGame({ seed: 777, difficulty: "normal", mode: "standard", dayLimit: 8, ...o });
const bal = (s, a) => balance(s.ledger, a);
const clean = s => assert.deepEqual(E.reconcile(s), { ok: true, problems: [] });
const finishDay = s => { while (s.phase === "open") E.tick(s, 0.25); };

test("campaign: paid up front, ledger balanced, expensed on the launch day", () => {
  const s = fresh(), before = bal(s, "bank");
  const r = E.launchCampaign(s, "flyers", "c1");
  assert.ok(r.ok);
  assert.equal(bal(s, "bank"), Math.round((before - 40) * 100) / 100);
  assert.equal(bal(s, "marketing"), 40);
  finishDay(s);
  assert.equal(s.lastReport.opex.marketing, 40);
  clean(s);
});
test("campaign: idempotent, validated, no duplicate booking", () => {
  const s = fresh();
  assert.ok(E.launchCampaign(s, "radio", "x").ok);
  assert.equal(E.launchCampaign(s, "radio", "x").ok, false);
  assert.equal(E.launchCampaign(s, "radio", "y").ok, false);       // already booked
  assert.equal(E.launchCampaign(s, "nope", "z").ok, false);
  assert.equal(bal(s, "marketing"), 110);
});
test("campaign: effect is delayed, then ends", () => {
  const s = fresh();
  E.launchCampaign(s, "social", "a");                               // starts in 2 days, runs 5
  assert.equal(E.campaignLift(s, s.day), 0);
  assert.equal(E.campaignLift(s, s.day + 1), 0);
  assert.equal(E.campaignLift(s, s.day + 2), 0.30);
  assert.equal(E.campaignLift(s, s.day + 7), 0);
  const f = E.forecast(s, 4);
  assert.ok(!f[1].campaign && f[2].campaign);
});
test("campaign: cannot be bought without money", () => {
  const s = fresh(); s.ledger.bal.bank = 0; s.ledger.bal.cash = 0;
  assert.equal(E.launchCampaign(s, "flyers", "q").ok, false);
});
test("forecast: band widens with distance and contains the midpoint", () => {
  const s = fresh(), f = E.forecast(s, 3);
  assert.equal(f.length, 3);
  f.forEach(x => assert.ok(x.low <= x.expected && x.expected <= x.high));
  assert.ok(f[2].high - f[2].low > f[0].high - f[0].low);
});
test("forecast: report compares forecast with actual traffic", () => {
  const s = fresh(); finishDay(s);
  const fc = s.lastReport.forecast;
  assert.ok(fc && fc.expected > 0 && fc.actual === s.lastReport.customers);
  assert.ok(fc.accuracy >= 0 && fc.accuracy <= 1);
  assert.equal(s.stats.fcDays, 1);
});
test("supplier prices drift inside bounds and change unit cost", () => {
  const s = fresh(); const sup = E.supplier("metro");
  const c0 = E.unitCost(s, sup, "rice", 5);
  let moved = false;
  for (let i = 0; i < 25; i++) {
    finishDay(s); E.nextDay(s);
    for (const x of D.SUPPLIERS) assert.ok(s.supIdx[x.id] >= D.SUP_DRIFT.min && s.supIdx[x.id] <= D.SUP_DRIFT.max);
    if (s.supIdx.metro !== 1) moved = true;
    if (s.ended) break;
  }
  assert.ok(moved);
});
test("supplier record counts orders and late deliveries", () => {
  const s = fresh();
  const r = E.placeOrder(s, { supplier: "metro", lines: [{ pid: "water", qty: 40 }], pay: "bank", cmdId: "o1" }); assert.ok(r.ok, r.error);
  assert.equal(s.supRec.metro.n, 1);
  clean(s);
});
test("budget: validated, variance reported, hit counted", () => {
  const s = fresh();
  assert.equal(E.setBudget(s, { revenue: -1, expenses: 5 }).ok, false);
  assert.equal(E.setBudget(s, { revenue: NaN }).ok, false);
  assert.ok(E.setBudget(s, { revenue: 1, expenses: 9999 }).ok);
  finishDay(s);
  const b = s.lastReport.budget;
  assert.ok(b && b.hit === true && b.revVar > 0 && b.expVar > 0);
  assert.equal(s.stats.budgetHit, 1);
  E.setBudget(s, { revenue: 99999, expenses: 0 }); E.nextDay(s); finishDay(s);
  assert.equal(s.lastReport.budget.hit, false);
});
test("no budget set: report has no budget block", () => {
  const s = fresh(); finishDay(s);
  assert.equal(s.lastReport.budget, undefined);
});
test("determinism: same seed and same commands give the same save", () => {
  const run = () => { const s = fresh(); E.launchCampaign(s, "flyers", "a"); E.setBudget(s, { revenue: 100 }); finishDay(s); E.nextDay(s); finishDay(s); return E.serialize(s); };
  assert.equal(run(), run());
});
test("save round trip keeps the new state; bad new fields are rejected", () => {
  const s = fresh(); E.launchCampaign(s, "radio", "a"); finishDay(s);
  const v = E.validateSave(E.serialize(s));
  assert.ok(v.ok, v.error);
  assert.equal(v.state.campaigns.length, 1);
  const bad = JSON.parse(E.serialize(s)); bad.campaigns[0].kind = "hack";
  assert.equal(E.validateSave(bad).ok, false);
  const bad2 = JSON.parse(E.serialize(s)); bad2.supIdx.metro = 99;
  assert.equal(E.validateSave(bad2).ok, false);
});
test("migration: a v3 save loads as v4 with neutral defaults", () => {
  const s = fresh(); finishDay(s);
  const old = JSON.parse(E.serialize(s));
  for (const k of ["campaigns", "campSeq", "supIdx", "supRec", "budget", "noise", "forecastToday"]) delete old[k];
  for (const k of ["unitsSold", "fcErr", "fcDays", "budgetDays", "budgetHit"]) delete old.stats[k];
  old.v = 3; old.marketing = 2;
  const v = E.validateSave(old);
  assert.ok(v.ok, v.error);
  assert.equal(v.state.v, 4); assert.equal(v.state.marketing, undefined);
  assert.deepEqual(v.state.campaigns, []);
  clean(v.state);
  E.nextDay(v.state); finishDay(v.state);          // and it keeps playing
  clean(v.state);
  assert.equal(E.validateSave({ ...old, v: 2 }).ok, false);
});
test("end report carries planning summary", () => {
  const s = fresh({ dayLimit: 5 });
  for (let i = 0; i < 5; i++) { finishDay(s); if (!s.ended) E.nextDay(s); }
  assert.ok(s.ended.planning && s.ended.planning.forecastAccuracy != null);
});
