// Currency and central bank. Foreign suppliers price in a foreign currency, so their prices move with an exchange index (1.00 = neutral, above 1
// means the foreign currency is dearer). The index leans toward a level set by the central bank's policy rate: a higher rate strengthens your
// currency and pulls the index down. The same policy rate nudges what the bank charges you. Own random stream. Nothing here uses the shop's stream.
import { round2 } from "./ledger.js";
import { streamNext, seedFrom } from "./rng.js";

const c = round2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const FX = { start: 1, pull: 0.12, noise: 0.04, policyStart: 3, policyLo: 0.5, policyHi: 9, rateLo: 0.8, rateHi: 1.25, perPoint: 0.012, bankPerPoint: 0.1 };
export const newCur = seed => ({ rng: seedFrom(seed, 0xf17c), rate: FX.start, policy: FX.policyStart, hist: [] });
export const ensureCur = s => (s.cur = s.cur || newCur(s.seed));
export const IMPORT_FREE = "local";                                    // the local co-op prices in your own currency
export const exchangeFactor = (s, supId) => (supId === IMPORT_FREE ? 1 : ensureCur(s).rate);
// Level the index leans toward at a given policy rate.
export const targetFor = p => clamp(1 - FX.perPoint * (p - FX.policyStart), 0.85, 1.15);
// Factor on the bank's interest from the policy rate (1.00 at the starting rate of 3%).
export const policyFactor = s => c(clamp(1 + FX.bankPerPoint * (ensureCur(s).policy - FX.policyStart), 0.6, 1.8));

export function curDay(s) {
  const k = ensureCur(s), o = k;
  k.policy = c(clamp(k.policy + (streamNext(o) - 0.5) * 0.18 + (3.5 - k.policy) * 0.01, FX.policyLo, FX.policyHi));
  k.rate = Math.round(clamp(k.rate + (targetFor(k.policy) - k.rate) * FX.pull + (streamNext(o) - 0.5) * FX.noise, FX.rateLo, FX.rateHi) * 10000) / 10000;
  k.hist.push({ day: s.day, rate: k.rate, policy: k.policy }); if (k.hist.length > 60) k.hist.splice(0, k.hist.length - 60);
}

// Expected index k days ahead if the policy rate stays where it is, with an 80% band. A model, not a promise: the central bank can move.
export function forecastRate(s, k) {
  const m = ensureCur(s), t = targetFor(m.policy), keep = 1 - FX.pull, sigma = FX.noise / Math.sqrt(12);
  let varSum = 0; for (let i = 0; i < k; i++) varSum += Math.pow(keep, 2 * i);
  const mean = t + (m.rate - t) * Math.pow(keep, k), sd = sigma * Math.sqrt(varSum);
  return { day: s.day + k, mean: Math.round(mean * 1e4) / 1e4, lo: Math.round(clamp(mean - 1.28 * sd, FX.rateLo, FX.rateHi) * 1e4) / 1e4, hi: Math.round(clamp(mean + 1.28 * sd, FX.rateLo, FX.rateHi) * 1e4) / 1e4 };
}
