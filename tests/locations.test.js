// Locations must change the actual simulation, not just a label.
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import * as LOC from "../js/locations.js";
import { balance } from "../js/ledger.js";

const mk = (location, o = {}) => E.newGame({ seed: 99, difficulty: "normal", mode: "standard", dayLimit: 10, location, ...o });
const clean = s => assert.deepEqual(E.reconcile(s), { ok: true, problems: [] });
// identical plan for every location: same stock, same prices, same staff, same seed
function play(location, days = 6) {
  const s = mk(location);
  for (let d = 0; d < days; d++) {
    if (E.supplierAvailable(s, E.supplier("metro"))) E.placeOrder(s, { supplier: "metro", lines: [{ pid: "water", qty: 60 }, { pid: "bread", qty: 40 }, { pid: "milk", qty: 40 }, { pid: "apple", qty: 40 }], pay: "bank", cmdId: "o" + d });
    for (const id of ["apple", "bread", "milk", "water"]) { s.shelfTarget[id] = 20; }
    while (s.phase === "open") E.tick(s, 0.25);
    if (!s.ended) E.nextDay(s);
  }
  return s;
}
const total = (s, k) => s.history.reduce((a, h) => a + h[k], 0);

test("catalog: Indonesia and Medan are configured, no two playable sites are identical", () => {
  assert.ok(LOC.countries().includes("Indonesia"));
  assert.ok(LOC.search("medan").length >= 2);
  const sigs = LOC.playableLocations().map(l => JSON.stringify([l.demand, l.rent, l.wage, l.utilities, l.logistics, l.power, l.priceSens, l.competition, l.cat]));
  assert.equal(new Set(sigs).size, sigs.length);
  LOC.playableLocations().forEach(l => assert.ok(l.provenance && l.simulated));
});
test("unknown location id falls back to the neutral start", () => {
  const s = mk("nope"); assert.equal(s.loc, "default"); assert.equal(E.locOf(s).id, "default");
});
test("neutral location keeps the original rules (rent, utilities, forecast)", () => {
  const a = E.newGame({ seed: 5 }), b = E.newGame({ seed: 5, location: "default" });
  assert.equal(E.serialize(a), E.serialize(b));
});
test("small town vs dense city: same plan and seed, differences follow configured rules", () => {
  const town = play("id-siantar-town"), city = play("id-jakarta-central");
  assert.ok(total(city, "customers") > total(town, "customers") * 1.5, "dense city has more customers");
  assert.ok(E.rent(city) > E.rent(town) * 2, "city rent is higher");
  clean(town); clean(city);
  // the larger city is not guaranteed to win: this only asserts both books are consistent and rules differ
  assert.notEqual(total(city, "net"), total(town, "net"));
});
test("category taste: a drinks-heavy location sells a larger share of drinks", () => {
  const tourist = play("id-denpasar-tourist", 4), resid = play("id-medan-residential", 4);
  const share = s => { const u = s.stats.units; const dr = (u.milk || 0) + (u.water || 0) + (u.juice || 0); const all = Object.values(u).reduce((a, b) => a + b, 0) || 1; return dr / all; };
  assert.ok(share(tourist) > share(resid), `drinks share ${share(tourist)} vs ${share(resid)}`);
});
test("purchasing power and price sensitivity change how price affects demand", () => {
  const rich = mk("sg-central"), poor = mk("id-siantar-town");
  for (const s of [rich, poor]) for (const p of D.PRODUCTS) s.prices[p.id] = Math.round(p.ref * 1.4 * 100) / 100;
  const w = s => D.PRODUCTS.filter(p => p.unlockDay <= 1).reduce((a, p) => a + E.unitDemand(s)[p.id], 0);
  assert.ok(w(rich) > w(poor), "same high prices hurt the lower-power site more");
});
test("competition lowers the forecast", () => {
  const a = mk("id-medan-residential"), b = mk("id-medan-residential"); b.loc = "id-jakarta-central";
  const lowComp = E.forecast(a, 1)[0].expected / LOC.getLocation(a.loc).demand;
  const hiComp = E.forecast(b, 1)[0].expected / LOC.getLocation(b.loc).demand;
  assert.ok(lowComp > hiComp);
});
test("remote site: higher delivery fee, longer lead, a supplier that does not serve it", () => {
  const town = mk("id-siantar-town"), base = mk("default");
  assert.ok(E.supFee(town, E.supplier("metro")) > E.supFee(base, E.supplier("metro")));
  assert.ok(E.supLead(town, E.supplier("metro")) > E.supLead(base, E.supplier("metro")));
  const r = E.placeOrder(town, { supplier: "quickship", lines: [{ pid: "water", qty: 20 }], pay: "bank", cmdId: "q" });
  assert.equal(r.ok, false); assert.match(r.error, /does not deliver/);
  clean(town);
});
test("order fee and ledger use the location fee", () => {
  const s = mk("us-nyc-manhattan"), before = balance(s.ledger, "bank");
  const r = E.placeOrder(s, { supplier: "metro", lines: [{ pid: "water", qty: 40 }], pay: "bank", cmdId: "f" });
  assert.ok(r.ok); assert.equal(balance(s.ledger, "delivery"), E.supFee(s, E.supplier("metro")));
  assert.ok(before - balance(s.ledger, "bank") > 0); clean(s);
});
test("wages scale with the location", () => {
  const a = mk("jp-tokyo-central"), b = mk("id-medan-central");
  const avg = s => s.candidates.reduce((x, c) => x + c.wage / D.ROLES[c.role].base, 0) / s.candidates.length;
  assert.ok(avg(a) > avg(b));
});
test("site estimate and suitability are explained, ranged and differ by location", () => {
  const a = E.siteEstimate("sg-central"), b = E.siteEstimate("id-siantar-town");
  assert.ok(a.customers[0] < a.customers[1] && a.revenue[0] < a.revenue[1] && a.assumptions.length > 10);
  assert.ok(a.fixedPerDay > b.fixedPerDay);
  const sa = E.siteSuitability("sg-central");
  assert.equal(sa.parts.reduce((x, p) => x + p.w, 0), 100); assert.ok(sa.parts.every(p => p.why));
  assert.notEqual(sa.total, E.siteSuitability("id-siantar-town").total);
});
test("same seed and location is reproducible; save keeps the location; v4 save migrates to neutral", () => {
  assert.equal(E.serialize(play("id-medan-central", 3)), E.serialize(play("id-medan-central", 3)));
  const s = play("id-denpasar-tourist", 2), v = E.validateSave(E.serialize(s));
  assert.ok(v.ok, v.error); assert.equal(v.state.loc, "id-denpasar-tourist");
  const old = JSON.parse(E.serialize(s)); delete old.loc; old.v = 4;
  const m = E.validateSave(old); assert.ok(m.ok, m.error); assert.equal(m.state.loc, "default");
  const bad = JSON.parse(E.serialize(s)); bad.loc = "mars"; assert.equal(E.validateSave(bad).ok, false);
});
