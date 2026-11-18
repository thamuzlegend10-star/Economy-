import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as R from "../js/routemap.js";
import { ensureFleet } from "../js/fleet.js";

const mk = () => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 30, capital: 100000, seed: 5 });

test("map has nine distinct city nodes with your own district first", () => {
  const n = R.cityNodes(mk()); assert.equal(n.length, 9); assert.ok(n[0].home);
  assert.equal(new Set(n.map(x => x.city)).size, 9);
  assert.ok(n.slice(1).every((x, i, a) => x.km > 0 && (i === 0 || x.km >= a[i - 1].km)), "nearest first, real distances");
});

test("a trip is drawn on the road with a progress between 0 and 1, and gone after its ETA", () => {
  const s = mk(), f = ensureFleet(s), nodes = R.cityNodes(s);
  const km = nodes[3].km; assert.equal(R.destFor(nodes, km).id, nodes[3].id);
  f.trips.push({ id: 1, day: s.day, kind: "order", km, trucks: [], rounds: 1, fuel: 0, eta: s.day + 4, delay: 0 });
  const p = R.tripProgress(s, f.trips[0]); assert.ok(p >= 0 && p <= 1);
  assert.equal(R.activeTrips(s).length, 1);
  assert.ok(R.routeMapSvg(s).includes('class="rm-truck"'));
  s.day += 6; assert.equal(R.activeTrips(s).length, 0);
  assert.ok(!R.routeMapSvg(s).includes('class="rm-truck"'));
});

test("yard shows crates only when stock overflows, and spoils after three days", () => {
  const s = mk(); assert.equal(R.yardSvg(s, 0), "");
  assert.equal(R.yardInfo(s, 60).crates, 3);
  assert.equal(R.yardInfo(s, 1e9).crates, R.MAX_CRATES);
  s.whOverDays = 2; assert.ok(!R.yardSvg(s, 60).includes("crate old"));
  s.whOverDays = 4; assert.ok(R.yardSvg(s, 60).includes("crate old"));
});

test("trip list shows progress, ETA and a breakdown warning", () => {
  const s = mk(), f = ensureFleet(s), km = R.cityNodes(s)[2].km;
  f.trips.push({ id: 7, day: s.day, kind: "order", km, trucks: [], rounds: 1, fuel: 0, eta: s.day + 3, delay: 0 });
  let h = R.tripListHtml(s); assert.ok(h.includes("arrives in 3 days") && h.includes("meter") && !h.includes("Breakdown"));
  f.trips[0].delay = 2; h = R.tripListHtml(s); assert.ok(h.includes("Breakdown on the road: 2 days late"));
  assert.ok(R.routeMapSvg(s).includes("rm-warn"), "a broken-down trip is marked on the map");
});

test("factory picture shows both lines and lights the one that has a run", async () => {
  const F = await import("../js/factory.js");
  const s = mk(); F.rentFactory(s, 300);
  assert.ok(R.factorySceneSvg(s).includes("0 machines") && R.factorySceneSvg(s).includes("idle"));
  F.buyMachine(s, { type: "smtStandard" });
  const h = R.factorySceneSvg(s); assert.ok(h.includes("Electronics assembly line · 1 machine · running") && h.includes("Juice line · 0 machines · idle"));
});
