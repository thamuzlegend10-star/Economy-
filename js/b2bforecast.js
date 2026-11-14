// B2B demand outlook. Institutional buyers post tenders on a known pattern (how many a day, which buyer, which goods, how large). This turns that pattern
// and the tenders seen so far into an expected volume per product, how much of it you can expect to win, and how much stock that calls for.
// Nothing here changes state.
import * as D from "./data.js";
import { modOn } from "./modules.js";
import { PRODUCT } from "./engine.js";
import { JUICE } from "./factory.js";
import { ensureB2B, available } from "./b2b.js";

const mean = ([a, b]) => (a + b) / 2, sum = a => a.reduce((x, y) => x + y, 0);
export const OUT = { priorDays: 14, window: 28, horizon: 14, priorWin: 0.35, minBids: 3 };
const wants = (s, buyer) => buyer.want.filter(p => (PRODUCT[p] ? modOn(s, "warehouse") : modOn(s, "factory")));
export const items = s => [...D.PRODUCTS.filter(p => modOn(s, "warehouse") && D.B2B.buyers.some(b => b.want.includes(p.id))), ...(modOn(s, "factory") ? Object.values(JUICE).filter(j => D.B2B.buyers.some(b => b.want.includes(j.id))) : [])];

// Expected units a day that buyers ask for, from the buyer list alone. Tender size is uniform, rounded to 100.
export function modelRate(s, pid, kind = "tender") {
  const perDay = kind === "fixed" ? mean(D.B2B.fixedDeals.perDay) : mean(D.B2B.tendersPerDay), size = kind === "fixed" ? 0.6 : 1, n = D.B2B.buyers.length;
  return perDay * sum(D.B2B.buyers.map(b => { const w = wants(s, b); return w.includes(pid) ? size * mean(b.qty) / (n * w.length) : 0; }));
}
// Units asked for in tenders over the last `window` days, from what you have seen (finished, open and running).
export function observed(s, pid, kind = "tender") {
  const b = ensureB2B(s), from = s.day - OUT.window, days = Math.max(0, Math.min(OUT.window, s.day - 1));
  const seen = [...b.history, ...b.open, ...b.active].filter(t => t.kind === kind && t.pid === pid && t.posted >= from);
  return { units: sum(seen.map(t => t.qty)), count: seen.length, days };
}
export const winRate = s => { const b = ensureB2B(s), n = b.won + b.lost; return n >= OUT.minBids ? b.won / n : OUT.priorWin; };

export function outlook(s, pid) {
  const b = ensureB2B(s), ob = observed(s, pid), obf = observed(s, pid, "fixed"), mT = modelRate(s, pid), mF = modelRate(s, pid, "fixed");
  const rate = (mT * OUT.priorDays + ob.units) / (OUT.priorDays + ob.days), fixed = (mF * OUT.priorDays + obf.units) / (OUT.priorDays + obf.days), win = winRate(s);
  const committed = sum(b.active.filter(k => k.pid === pid).map(k => k.qty)), stock = available(s, pid), winnable = rate * win;
  const need = Math.ceil(winnable * OUT.horizon + committed), gap = Math.max(0, need - stock);
  return { pid, rate, fixed, win, winnable, committed, stock, need, gap, basis: ob.days >= 7 ? "history" : "buyer list", days: ob.days };
}
export const allOutlook = s => items(s).map(it => ({ item: it, ...outlook(s, it.id) }));
