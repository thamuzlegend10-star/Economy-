// Business intelligence (module 13): the eight scoring KPIs, a configurable weighted score, and competitor price tracking.
import { totals, balance, round2 } from "./ledger.js";
import { getLocation } from "./locations.js";
import * as D from "./data.js";
import { rivalPrices } from "./economy.js";
import { PRODUCT, whOverflow, capacityOf, spaceUsed } from "./engine.js";

const c = round2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const newKpi = () => ({ weights: Object.fromEntries(D.KPIS.map(k => [k.id, k.weight])) });
export const ensureKpi = s => (s.kpi = s.kpi || newKpi());
export function setWeights(s, w) {
  const k = ensureKpi(s), out = {}; let sum = 0;
  for (const d of D.KPIS) { const v = Math.max(0, Number(w && w[d.id])); out[d.id] = Number.isFinite(v) ? v : 0; sum += out[d.id]; }
  if (sum <= 0) return { ok: false, error: "Give at least one KPI a weight above zero." };
  for (const d of D.KPIS) out[d.id] = Math.round(out[d.id] / sum * 10000) / 10000;
  k.weights = out; return { ok: true, weights: out };
}
function marketShare(s) {
  const L = getLocation(s.location), days = Math.max(1, s.day - 1 + (s.dayStep / s.stepsPerDay || 0));
  let rival = 0; for (const p of D.PRODUCTS) rival += p.base * L.demand * L.cat[p.cat] * L.competition * 0.6 * days;
  const mine = s.stats.units + (s.ecom ? s.ecom.stats.units : 0) + (s.b2b ? s.b2b.history.filter(h => h.revenue).reduce((a, h) => a + h.qty, 0) : 0);
  return mine / Math.max(1, mine + rival) * 100;
}
// Report ratios from the ledger. Values are null when the divisor is zero or negative, so the screen shows n/a instead of nonsense.
export function ratios(s) {
  const L = s.ledger, t = totals(L), net = c(t.revenue - t.costs), b = a => balance(L, a), owed = t.liabilities, eq = t.equity;
  const div = (n, d) => (d > 0.004 ? c(n / d) : null);
  const liquid = b("cash") + b("receivables"), cur = liquid + b("inventory") + b("inv_raw") + b("inv_fg");
  return { roa: div(net * 100, t.assets), roe: div(net * 100, eq), debtToEquity: div(owed, eq), current: owed > 0.004 ? div(cur, owed) : null, quick: owed > 0.004 ? div(liquid, owed) : null };
}
export function kpis(s) {
  const t = totals(s.ledger), sold = s.stats.units + (s.ecom ? s.ecom.stats.units : 0), lost = s.stats.lost + (s.ecom ? s.ecom.stats.lost : 0), netProfit = c(t.revenue - t.costs);
  const cash = balance(s.ledger, "cash");
  return { netProfit, revenue: t.revenue, roa: c(netProfit / Math.max(1, t.assets) * 100), serviceLevel: c(sold / Math.max(1, sold + lost) * 100), marketShare: c(marketShare(s)),
    csi: c(s.srv ? s.srv.csi : D.SRV.csiStart), morale: c(s.hr ? s.hr.morale : D.HR.morale.start), solvency: c(Math.min(10, t.assets / Math.max(1, t.liabilities))), cash: c(cash) };
}
// Each KPI is mapped to 0..100 before weighting so no single unit dominates.
export function normalise(s, k) {
  const base = Math.max(1, s.startNetWorth || 1);
  return { netProfit: clamp(50 + 50 * k.netProfit / base, 0, 100), revenue: clamp(100 * k.revenue / (base * 3), 0, 100), roa: clamp(50 + k.roa * 2.5, 0, 100),
    serviceLevel: clamp(k.serviceLevel, 0, 100), marketShare: clamp(k.marketShare * 1.5, 0, 100), csi: clamp(k.csi, 0, 100), morale: clamp(k.morale, 0, 100), solvency: clamp((k.solvency - 1) / 4 * 100, 0, 100) };
}
// Score with the DEFAULT weights, so a player cannot raise it by changing the weights. Used for live rooms.
export function defaultScore(s) { const n = normalise(s, kpis(s)); return c(D.KPIS.reduce((a, d) => a + n[d.id] * d.weight, 0) / D.KPIS.reduce((a, d) => a + d.weight, 0)); }
export function scoreboard(s) {
  const k = kpis(s), n = normalise(s, k), w = ensureKpi(s).weights;
  const rows = D.KPIS.map(d => ({ id: d.id, name: d.name, unit: d.unit, value: k[d.id], score: c(n[d.id]), weight: w[d.id], points: c(n[d.id] * w[d.id]) }));
  return { rows, total: c(rows.reduce((a, r) => a + r.points, 0)), kpis: k };
}
// Rival shops' prices for the three retail products: slow waves around the local reference price.
export function competitorPrices(s) {
  return D.PRODUCTS.map(p => ({ pid: p.id, name: p.name, you: s.prices[p.id], rivals: rivalPrices(s, p) }));
}

// Business warnings from real state. Each: { level: "bad"|"warn", text, where: [main tab, sub tab] }.
export function warnings(s) {
  const w = [], W = D.WARN, cash = balance(s.ledger, "cash"), od = balance(s.ledger, "overdraft");
  if (od > 0) w.push({ level: "bad", text: `Overdraft ${Math.round(od).toLocaleString("en-US")} dollars. Three days in a row ends the game.`, where: ["finance", "bank"] });
  else if (cash < W.cashLow) w.push({ level: "warn", text: `Cash is low (${Math.round(cash).toLocaleString("en-US")} dollars).`, where: ["finance", "bank"] });
  const lostToday = s.today ? Object.values(s.today.lost).reduce((a, b) => a + b, 0) : 0;
  if (lostToday > 0) w.push({ level: "warn", text: `Shoppers left without goods: ${lostToday.toLocaleString("en-US")} units missed today.`, where: ["retail", "procurement"] });
  if (s.srv && s.srv.csi < W.csiLow) w.push({ level: "warn", text: `Customer satisfaction is ${Math.round(s.srv.csi)}. Demand is falling.`, where: ["hr", ""] });
  if (s.hr && s.hr.morale < W.moraleLow) w.push({ level: "warn", text: `Staff morale is ${Math.round(s.hr.morale)}. People will quit.`, where: ["hr", ""] });
  for (const m of s.fx.machines) { if (m.status === "broken") w.push({ level: "bad", text: `${m.name} is broken.`, where: ["factory", "machines"] }); else if (m.health < W.healthLow) w.push({ level: "warn", text: `${m.name} health is ${Math.round(m.health)}%. Service it.`, where: ["factory", "machines"] }); }
  for (const k of s.b2b.active) if (s.day > k.due) w.push({ level: "bad", text: `B2B contract #${k.id} is ${k.lateDays + 1} day(s) late.`, where: ["b2b", "contracts"] });
  const ov = whOverflow(s); if (ov > 0) w.push({ level: "warn", text: `Warehouse over capacity by ${Math.round(ov).toLocaleString("en-US")} space. Overflow fees apply.`, where: ["warehouse", "stock"] });
  if (spaceUsed(s) > W.storageHigh * capacityOf(s.area)) w.push({ level: "warn", text: "The shop storage is almost full.", where: ["retail", "location"] });
  return w;
}
