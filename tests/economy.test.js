import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import * as Ec from "../js/economy.js";
import * as Sn from "../js/scenario.js";
import * as Kp from "../js/kpi.js";
import * as SC from "../js/screens.js";
import { playableLocations } from "../js/locations.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 100000, seed: 17, ...o });
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };

test("rival prices drive demand: a rival price cut lowers your sales, a rise lifts them", () => {
  const s = mk(), base = E.expectedDemand(s, "milk");
  Sn.inject(s, { kind: "rival", mult: 0.7, days: 5 }); const cut = E.expectedDemand(s, "milk"); assert.ok(cut < base * 0.95, `${cut} vs ${base}`);
  Sn.stopEvent(s, s.scn.events[0].id); Sn.inject(s, { kind: "rival", mult: 1.3, days: 5 }); assert.ok(E.expectedDemand(s, "milk") > base * 1.05);
});

test("a rival price cut hurts more where competition is high than where it is low", () => {
  const locs = playableLocations().filter(l => l.competition != null).sort((x, y) => x.competition - y.competition), lo = locs[0], hi = locs[locs.length - 1];
  assert.ok(hi.competition > lo.competition, "the data has locations with different competition");
  const drop = id => { const s = mk({ location: id }), base = Ec.expectedPrice(s, D.PRODUCTS[0]); Sn.inject(s, { kind: "rival", mult: 0.7, days: 5 }); return 1 - Ec.expectedPrice(s, D.PRODUCTS[0]) / base; };
  assert.ok(drop(hi.id) > drop(lo.id), `${drop(hi.id)} vs ${drop(lo.id)}`);
});

test("consumer confidence and tastes move demand; the price level moves supplier prices", () => {
  const s = mk(), d0 = E.expectedDemand(s, "milk"), sp = D.SUPPLIERS[0], c0 = E.unitCost(s, sp, "milk");
  s.econ.conf = 0.9; assert.ok(E.expectedDemand(s, "milk") < d0 * 0.95); s.econ.conf = 1;
  s.econ.pref.food = 1.1; s.econ.pref.drinks = 1.1; assert.ok(E.expectedDemand(s, "milk") > d0); s.econ.pref.food = 1; s.econ.pref.drinks = 1;
  s.econ.infl = 1.1; assert.ok(E.unitCost(s, sp, "milk") > c0 * 1.08);
});

test("the economy wanders but stays inside its bounds, deterministically, and returns toward normal", () => {
  const run = () => { const s = mk({ days: 60 }); let lo = 9, hi = 0, ilo = 9, ihi = 0; while (!s.ended) { runDay(s); lo = Math.min(lo, s.econ.conf); hi = Math.max(hi, s.econ.conf); ilo = Math.min(ilo, s.econ.infl); ihi = Math.max(ihi, s.econ.infl); } return { s, lo, hi, ilo, ihi }; };
  const a = run(), b = run(); assert.equal(JSON.stringify(a.s.econ), JSON.stringify(b.s.econ));
  assert.ok(a.lo >= D.MARKET.confMin && a.hi <= D.MARKET.confMax); assert.ok(a.ilo >= D.MARKET.inflMin && a.ihi <= D.MARKET.inflMax);
  assert.ok(a.hi - a.lo > 0.01, "it actually moves"); assert.ok(E.reconcile(a.s).ok);
});

test("v20 saves migrate to v21; the competitors screen shows the economy and the rival table uses the shared prices", () => {
  const old = JSON.parse(JSON.stringify(mk())); old.v = 20; delete old.econ; const m = E.validateSave(old); assert.ok(m.ok, m.error); assert.equal(m.state.econ.conf, 1);
  const s = mk(); const cp = Kp.competitorPrices(s)[0]; assert.deepEqual(cp.rivals, Ec.rivalPrices(s, D.PRODUCTS[0]));
  assert.match(SC.competitors(s), /The economy/); assert.match(SC.competitors(s), /Consumer confidence/);
});
