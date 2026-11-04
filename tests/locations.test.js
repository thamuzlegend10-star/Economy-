import test from "node:test";
import assert from "node:assert/strict";
import { playableLocations, countries, search, getLocation } from "../js/locations.js";
import * as E from "../js/engine.js";

const L = playableLocations();
test("catalog is large, ids unique, countries spread", () => {
  assert.ok(L.length >= 45); assert.equal(new Set(L.map(l => l.id)).size, L.length); assert.ok(countries().length >= 25);
});
test("every location has valid coordinates, time zone and sane coefficients", () => {
  for (const l of L) {
    assert.ok(l.lat >= -90 && l.lat <= 90 && l.lon >= -180 && l.lon <= 180, l.id);
    assert.doesNotThrow(() => new Intl.DateTimeFormat("en", { timeZone: l.tz }), l.id + " tz");
    for (const k of ["demand", "rent", "wage", "utilities", "logistics", "power", "priceSens"]) assert.ok(l[k] > 0.2 && l[k] < 4, l.id + " " + k);
    assert.ok(l.competition >= 0 && l.competition < 1, l.id); assert.ok(l.name && l.country && l.city && l.district && l.currency, l.id);
    for (const v of Object.values(l.cat)) assert.ok(v > 0.3 && v < 2, l.id);
  }
});
test("no two sites share a spot (markers must be tappable)", () => {
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) if (L[i].city !== L[j].city) assert.ok(Math.hypot(L[i].lat - L[j].lat, L[i].lon - L[j].lon) > 0.08, L[i].id + " / " + L[j].id);
});
test("search finds new places; every site starts a playable, deterministic game", () => {
  assert.ok(search("bangkok").length === 1); assert.ok(search("brazil").length >= 1); assert.equal(getLocation("nope").id, "default");
  for (const l of L) { const a = E.newGame(E.cleanSetup({ location: l.id, seed: 5 })), b = E.newGame(E.cleanSetup({ location: l.id, seed: 5 })); for (let i = 0; i < 300; i++) { E.tick(a, 0.1); E.tick(b, 0.1); } assert.equal(E.serialize(a), E.serialize(b), l.id); assert.ok(a.day >= 1, l.id); }
});
