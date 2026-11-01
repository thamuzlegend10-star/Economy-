// Business intelligence (module 13): the eight scoring KPIs, a configurable weighted score, and competitor price tracking.
import { totals, balance, round2 } from "./ledger.js";
import { getLocation } from "./locations.js";
import * as D from "./data.js";
import { PRODUCT } from "./engine.js";

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
export function scoreboard(s) {
  const k = kpis(s), n = normalise(s, k), w = ensureKpi(s).weights;
  const rows = D.KPIS.map(d => ({ id: d.id, name: d.name, unit: d.unit, value: k[d.id], score: c(n[d.id]), weight: w[d.id], points: c(n[d.id] * w[d.id]) }));
  return { rows, total: c(rows.reduce((a, r) => a + r.points, 0)), kpis: k };
}
// Rival shops' prices for the three retail products: slow waves around the local reference price.
export function competitorPrices(s) {
  const L = getLocation(s.location);
  return D.PRODUCTS.map(p => ({ pid: p.id, name: p.name, you: s.prices[p.id], rivals: [0, 1, 2].map(i => c(p.ref * L.power * (1 + 0.05 * Math.sin(s.day * 0.6 + i * 2.1 + p.base % 7) + 0.02 * (i - 1)))) }));
}
