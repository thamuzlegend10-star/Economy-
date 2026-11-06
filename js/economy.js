// The wider economy (spec section 9): rival shop prices that shoppers compare you with, consumer confidence, a price level (inflation) that moves
// supplier prices, and shifting tastes by product category. Own random stream, so the shop's main stream is untouched. All numbers live in D.MARKET.
import * as D from "./data.js";
import { getLocation } from "./locations.js";
import { streamNext, seedFrom } from "./rng.js";
import { mailPost } from "./mail.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), c2 = n => Math.round(n * 100) / 100;
const CATS = ["food", "drinks", "household", "stationery", "electronics"];
export const newEcon = (seed = 0) => ({ rng: seedFrom(seed, 0xec0), conf: 1, infl: 1, pref: Object.fromEntries(CATS.map(k => [k, 1])), notes: 0 });
export const ensureEcon = s => (s.econ = s.econ || newEcon(s.seed));

// Rival prices: three rival shops move in slow waves around the local reference price. A scenario event can start a rival price cut.
export function rivalPrices(s, p, day = s.day) {
  const L = getLocation(s.location), cut = s.scn ? s.scn.events.filter(e => e.kind === "rival" && e.from <= day && e.until >= day).reduce((a, e) => a * e.mult, 1) : 1;
  return [0, 1, 2].map(i => c2(p.ref * L.power * cut * (1 + 0.05 * Math.sin(day * 0.6 + i * 2.1 + p.base % 7) + 0.02 * (i - 1))));
}
export const rivalAvg = (s, p, day = s.day) => { const r = rivalPrices(s, p, day); return r.reduce((a, b) => a + b, 0) / r.length; };
// The price shoppers expect: partly the local reference, partly what rivals charge. More competition means rivals weigh more.
export function expectedPrice(s, p, day = s.day) {
  const L = getLocation(s.location), w = clamp(D.MARKET.rivalBase + D.MARKET.rivalPerCompetition * L.competition, 0, D.MARKET.rivalMax);
  return (1 - w) * p.ref * L.power + w * rivalAvg(s, p, day);
}
export const demandMood = (s, cat) => ensureEcon(s).conf * (ensureEcon(s).pref[cat] || 1);
export const priceLevel = s => ensureEcon(s).infl;

export function econDay(s) {
  const e = ensureEcon(s), M = D.MARKET, before = e.conf, beforeI = e.infl;
  e.conf = c2(clamp(e.conf + (1 - e.conf) * M.confPull + (streamNext(e) - 0.5) * 2 * M.confShock, M.confMin, M.confMax));
  e.infl = Math.round(clamp(e.infl + (1 - e.infl) * M.inflPull + (streamNext(e) - 0.5) * 2 * M.inflShock, M.inflMin, M.inflMax) * 1000) / 1000;
  for (const k of CATS) e.pref[k] = c2(clamp(e.pref[k] + (1 - e.pref[k]) * M.prefPull + (streamNext(e) - 0.5) * 2 * M.prefShock, M.prefMin, M.prefMax));
  if (Math.abs(e.conf - 1) >= M.newsAt && Math.abs(before - 1) < M.newsAt) mailPost(s, { from: "Market news", subject: e.conf < 1 ? "Consumer confidence is falling" : "Consumer confidence is rising", body: `Shoppers are ${e.conf < 1 ? "cutting back" : "spending more"}. Demand is about ${Math.abs(Math.round((e.conf - 1) * 100))}% ${e.conf < 1 ? "lower" : "higher"} than normal.`, goto: ["data", "market"], level: e.conf < 1 ? "warn" : "info" });
  if (e.infl - beforeI > 0 && e.infl >= M.inflNews && beforeI < M.inflNews) mailPost(s, { from: "Market news", subject: "Prices are rising", body: `Supplier prices are about ${Math.round((e.infl - 1) * 100)}% above normal.`, goto: ["data", "market"], level: "warn" });
}
