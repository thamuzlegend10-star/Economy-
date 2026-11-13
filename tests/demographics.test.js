import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as K from "../js/market.js";
import * as D from "../js/data.js";
import * as SC from "../js/screens.js";
import { act, newForms } from "../js/actions.js";
import { totals } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 200000, seed: 21, ...o });
const runDays = (s, n) => { const end = s.day + n; while (s.day < end && !s.ended) E.tick(s, 1); };

test("an unfocused campaign reaches every group and category equally, as before", () => {
  const k = { channel: "social", demo: "all" };
  for (const g of D.MKT_DEMO.groups) assert.equal(K.reachOf(k, g.id), 1);
  assert.equal(K.reachOf({ channel: "social" }, "seniors"), 1);                       // old saves have no audience
  for (const c of ["food", "drinks", "electronics"]) assert.ok(Math.abs(K.mixReach(k, c) - 1) < 1e-9);
});
test("a focused campaign wins where the audience matches and loses where it does not", () => {
  const radioSeniors = { channel: "radio", demo: "seniors" }, socialJuniors = { channel: "social", demo: "juniors" }, socialSeniors = { channel: "social", demo: "seniors" };
  assert.ok(K.mixReach(socialJuniors, "electronics") > 1.3);                          // juniors buy electronics, social suits juniors
  assert.ok(K.mixReach(radioSeniors, "food") > 0.9 && K.mixReach(radioSeniors, "food") > K.mixReach(radioSeniors, "electronics"));
  assert.ok(K.mixReach(socialSeniors, "electronics") < 0.7);                          // seniors rarely buy electronics and social misses them
  for (const m of Object.values(D.MKT_DEMO.mix)) assert.ok(Math.abs(Object.values(m).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});
test("starting a campaign validates the audience, books marketing cost, and lifts demand per the audience", () => {
  const s = mk(); assert.equal(K.startCampaign(s, { channel: "social", budget: 500, days: 7, demo: "pensioners" }).ok, false);
  const a = mk(), b = mk();
  assert.ok(K.startCampaign(a, { channel: "social", budget: 1000, days: 7, cat: "electronics", demo: "juniors" }).ok);
  assert.ok(K.startCampaign(b, { channel: "social", budget: 1000, days: 7, cat: "electronics", demo: "seniors" }).ok);
  runDays(a, 4); runDays(b, 4);
  assert.ok(K.awareness(a, "electronics") > K.awareness(b, "electronics") * 2);
  assert.ok(K.groupAwareness(a, "juniors") > K.groupAwareness(a, "seniors"));
  assert.ok(totals(a.ledger).balanced); assert.ok(E.reconcile(a).ok);
});
test("screen and action: audience select, group awareness, old campaign without audience", () => {
  const s = mk(), f = newForms(); f.mkt.demo = "adults"; f.mkt.channel = "search";
  assert.ok(act(s, f, "mktStart", {}).ok); assert.equal(s.mkt.campaigns[0].demo, "adults");
  assert.match(SC.marketing(s, f), /Audience/); assert.match(SC.marketing(s, f), /Age groups/);
  delete s.mkt.campaigns[0].demo; assert.ok(K.awareness(s, "food") >= 0); assert.match(SC.marketing(s, f), /Age groups/);
  assert.ok(E.validateSave(JSON.parse(E.serialize(s))).ok);
});
