import test from "node:test";
import assert from "node:assert/strict";
import { LAND, WATER, onLand, nearLand, inside } from "../js/worldmap.js";
import { playableLocations } from "../js/locations.js";

test("every playable location is drawn on land", () => {
  for (const l of playableLocations()) assert.ok(onLand(l.lat, l.lon), `${l.id} (${l.lat}, ${l.lon}) is in the sea on the map`);
});
test("ocean points are not land", () => {
  for (const [la, lo] of [[0, -150], [-40, -120], [10, -30], [-30, 80], [30, 160], [-50, 20], [35, -40]]) assert.ok(!nearLand(la, lo, 0.5), `${la},${lo}`);
});
test("known land is land and known water is water", () => {
  for (const [la, lo] of [[48, 2], [40, -100], [-25, 135], [60, 100], [5, 20], [-15, -55]]) assert.ok(onLand(la, lo), `${la},${lo}`);
  for (const [la, lo] of [[43, 35], [44, -86.5], [41, 50]]) assert.ok(!onLand(la, lo), `water ${la},${lo}`);   // Black Sea, Lake Michigan, Caspian
});
const seg = (a, b, c, d) => {                         // proper crossing of segment ab and cd, ignoring shared endpoints
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};
test("outlines are clean: enough points, valid range, no repeated points, no self-crossing", () => {
  for (const [name, set] of [["land", LAND], ["water", WATER]]) set.forEach((ring, i) => {
    assert.ok(ring.length >= 3, `${name} ${i} too short`);
    ring.forEach(([la, lo], j) => { assert.ok(la >= -90 && la <= 90 && lo >= -180 && lo <= 180, `${name} ${i} point ${j}`); const n = ring[(j + 1) % ring.length]; assert.ok(!(n[0] === la && n[1] === lo), `${name} ${i} repeats a point at ${j}`); });
    for (let a = 0; a < ring.length; a++) for (let b = a + 2; b < ring.length; b++) { if (a === 0 && b === ring.length - 1) continue; assert.ok(!seg(ring[a], ring[(a + 1) % ring.length], ring[b], ring[(b + 1) % ring.length]), `${name} ${i} crosses itself at ${a}/${b}`); }
  });
});
test("water sits inside land (seas and lakes are holes in a continent)", () => {
  for (const [i, w] of WATER.entries()) assert.ok(w.some(([la, lo]) => LAND.some(r => inside(r, la, lo))), `water ${i} is not on land`);
});
