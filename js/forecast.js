// Demand forecasting (spec section 5). Uses real sales history: de-seasonalise by weekday, fit a straight-line trend, forecast ahead.
// Safety stock and reorder points come from demand noise, lead time and supplier reliability. Nothing here changes state.
import { ensureJshop, shopPerDay as shopPerDay0 } from "./juiceshop.js";
import * as D from "./data.js";
import { PRODUCT, WEEK, expectedDemand, distanceKm, unitCost, spaceFree, whFree } from "./engine.js";
import { JUICE } from "./factory.js";
import { round2 } from "./ledger.js";
import { expectedPrice } from "./economy.js";
import { getLocation } from "./locations.js";
import { seasonMult } from "./season.js";

const c = round2;
const sum = a => a.reduce((x, y) => x + y, 0);

// Observed daily demand (units sold plus units customers wanted but could not buy), de-seasonalised.
export function series(s, pid, n = D.FORECAST.window) {
  return s.history.slice(-n).map(h => ({ day: h.day, raw: (h.units[pid] || 0) + (h.lost[pid] || 0), y: ((h.units[pid] || 0) + (h.lost[pid] || 0)) / WEEK[h.day % 7] / seasonMult(s, D.PRODUCTS.find(x => x.id === pid).cat, h.day) }));
}
function fit(pts) {                                        // least squares y = a + b * i, i = 0..n-1. a is the level at the first point
  const n = pts.length, xs = pts.map((_, i) => i), mx = sum(xs) / n, my = sum(pts.map(p => p.y)) / n;
  const sxx = sum(xs.map(x => (x - mx) ** 2)), b = sxx ? sum(xs.map((x, i) => (x - mx) * (pts[i].y - my))) / sxx : 0;
  return { a: my - b * mx, b };
}
export function model(s, pid, pts = series(s, pid)) {
  const n = pts.length;
  if (n < D.FORECAST.minPoints) { const lvl = expectedDemand(s, pid) / WEEK[s.day % 7] / seasonMult(s, PRODUCT[pid].cat); return { level: lvl, trend: 0, sigma: lvl * 0.15, n, basis: "model" }; }
  const { a, b } = fit(pts), resid = pts.map((p, i) => p.y - (a + b * i)), sigma = Math.sqrt(sum(resid.map(r => r * r)) / Math.max(1, n - 2));
  const last = a + b * (n - 1); return { level: Math.max(0, last), trend: b, sigma: Math.max(sigma, last * 0.03), n, basis: "history" };
}
// Forecast for the day k days after the last closed day (k = 1 is the day in progress). Weekday pattern is put back.
export function forecastDay(s, pid, k, m = model(s, pid)) {
  const lastClosed = s.history.length ? s.history[s.history.length - 1].day : s.day - 1, day = lastClosed + k;
  return Math.max(0, (m.level + m.trend * k) * WEEK[day % 7] * seasonMult(s, PRODUCT[pid].cat, day) * outlook(s, pid, day));
}
// What is known about the future that the sales history cannot show: rival prices (they follow a known wave and any announced cut) and scenario events already running.
// Both are compared with their average over the history window, so the forecast moves only by the difference.
const evMult = (s, day) => (s.scn ? s.scn.events.filter(e => e.kind === "demand" && e.from <= day && e.until >= day).reduce((a, e) => a * e.mult, 1) : 1);
export function outlook(s, pid, day) {
  const p = D.PRODUCTS.find(x => x.id === pid); if (!p || !s.history.length) return 1;
  const L = getLocation(s.location), price = Math.max(0.01, s.prices[pid]), ex = p.elast * L.priceSens;
  const at = d => Math.pow(expectedPrice(s, p, d) / price, ex) * evMult(s, d);
  const last = s.history[s.history.length - 1].day; let base = 0, n = 0;
  for (let d = Math.max(1, last - D.FORECAST.window + 1); d <= last; d++) { base += at(d); n++; }
  const f = n ? at(day) / (base / n) : 1;
  return Math.min(1.5, Math.max(0.6, f));
}
export const forecastTotal = (s, pid, days, from = 1) => { const m = model(s, pid); let t = 0; for (let k = from; k < from + days; k++) t += forecastDay(s, pid, k, m); return t; };
export const dailyAverage = (s, pid, days = 7) => forecastTotal(s, pid, days) / days;
// Mean absolute percentage error of one-day-ahead forecasts over the last few days (only data known at the time is used).
export function forecastError(s, pid) {
  const all = series(s, pid, D.FORECAST.window + D.FORECAST.errorWindow), errs = [];
  for (let i = D.FORECAST.minPoints; i < all.length; i++) {
    const m = model(s, pid, all.slice(Math.max(0, i - D.FORECAST.window), i)), pred = Math.max(0, m.level + m.trend) * WEEK[all[i].day % 7] * seasonMult(s, PRODUCT[pid].cat, all[i].day);
    if (all[i].raw > 0) errs.push(Math.abs(pred - all[i].raw) / all[i].raw);
  }
  return errs.length ? sum(errs.slice(-D.FORECAST.errorWindow)) / Math.min(errs.length, D.FORECAST.errorWindow) : null;
}
export const trendPct = (s, pid) => { const m = model(s, pid); return m.level > 0 ? m.trend / m.level : 0; };

// ---------- lead time and safety stock ----------
// A supplier is late with chance (1 - reliability), by about one day. So the expected lead time is a little longer than the quote.
export function vendorLead(s, v) {
  const days = Math.max(1, Math.ceil(distanceKm(s.location, v) / v.speed + v.prep)), late = 1 - v.reliability;
  return { days, expected: days + late * D.FORECAST.lateDayRisk, sigma: Math.sqrt(v.reliability * late) * D.FORECAST.lateDayRisk };
}
// Safety stock covers both noisy demand and a late delivery: z * sqrt(L * sigma_d^2 + d^2 * sigma_L^2).
export const safetyFromLead = (perDay, sigmaDay, lt) => D.FORECAST.z * Math.sqrt(lt.days * sigmaDay ** 2 + perDay ** 2 * lt.sigma ** 2);

// ---------- retail purchasing advice ----------
export function bestSupplier(s, pid) {                    // price per unit divided by reliability: a cheap supplier that is often late is not cheap
  let best = null;
  for (const sp of D.SUPPLIERS) { const score = unitCost(s, sp, pid) / sp.reliability; if (!best || score < best.score) best = { sp, score }; }
  return best.sp;
}
export function retailAdvice(s, pid) {
  const m = model(s, pid), sp = bestSupplier(s, pid), lt = vendorLead(s, sp), per = dailyAverage(s, pid, D.FORECAST.reviewDays);
  const ss = safetyFromLead(per, m.sigma, lt), rop = per * lt.expected + ss;
  const position = s.qty[pid] + s.wh.qty[pid] + s.orders.filter(o => o.pid === pid && o.dest !== "wh").reduce((a, o) => a + o.qty, 0);
  const upTo = per * (lt.expected + D.FORECAST.reviewDays) + ss, p = PRODUCT[pid];
  let qty = position <= rop ? Math.max(0, upTo - position) : 0;
  const room = Math.max(0, Math.floor(spaceFree(s) / p.space)); const limited = qty > room; qty = Math.floor(Math.min(qty, room, D.MAX_QTY) / 100) * 100;
  return { pid, supplier: sp.id, level: c(m.level), perDay: Math.round(per), sigma: c(m.sigma), trend: m.trend, ss: Math.round(ss), rop: Math.round(rop), position, qty, limited, lead: lt.days, leadExp: c(lt.expected), error: forecastError(s, pid), basis: m.basis,
    daysCover: per > 0 ? c(position / per) : null };
}

// ---------- production advice for juices ----------
// Needs: open B2B contracts not yet covered, plus a few days of webstore sales for juices in the catalog.
export function juiceAdvice(s, jid) {
  const fg = s.fx.fg.qty[jid], queued = Object.values(s.fx.machines).reduce((a, m) => a + (m.queue || []).filter(b => b.juice === jid).reduce((x, b) => x + (b.qty - b.done), 0), 0);
  const contracts = (s.b2b ? s.b2b.active : []).filter(k => k.pid === jid).reduce((a, k) => a + k.qty, 0);
  const days = Math.max(1, s.day - 1);
  const webPerDay = s.ecom && s.ecom.active && s.ecom.catalog.includes(jid) ? (s.ecom.stats.units / days) / Math.max(1, s.ecom.catalog.length) : 0, webNeed = webPerDay * D.FORECAST.reviewDays;
  const js = ensureJshop(s), shopPerDay = js.listed[jid] ? shopPerDay0(s, jid) : 0, onShelf = js.qty[jid] + js.moves.filter(m => m.jid === jid).reduce((a, m) => a + m.qty, 0), shopNeed = Math.max(0, shopPerDay * D.FORECAST.reviewDays - onShelf);
  const need = contracts + webNeed + shopNeed, have = fg + queued, qty = Math.max(0, Math.ceil((need - have) / 100) * 100);
  return { jid, fg, queued, contracts, webPerDay: c(webPerDay), shopPerDay: c(shopPerDay), onShelf, need: Math.round(need), qty };
}
