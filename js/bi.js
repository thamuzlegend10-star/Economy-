// Business intelligence dashboard numbers (spec module 13). Everything here is read from the ledger and from counters the game keeps while it runs.
import { totals, balance, round2, DEPTS, newDp } from "./ledger.js";
import { PRODUCT } from "./engine.js";
import * as D from "./data.js";

const c = round2;
export const ensurePerf = s => (s.perf = s.perf || { sup: {}, lateOrders: 0, orders: 0 });
// Called when a supplier delivery arrives. who: supplier or vendor id. late: it arrived after the quoted day.
export function trackArrival(s, who, late) {
  const p = ensurePerf(s), v = (p.sup[who] = p.sup[who] || { n: 0, late: 0 }); v.n++; p.orders++; if (late) { v.late++; p.lateOrders++; }
}
export function trackProduction(s, cap, made) { const fx = s.fx; fx.eff = fx.eff || { cap: 0, made: 0, idleDays: 0, brokenDays: 0 }; fx.eff.cap += cap; fx.eff.made += made; }
const nameOf = id => (D.SUPPLIERS.concat(D.WH_SUPPLIERS, D.RAW_VENDORS).find(x => x.id === id) || { name: id }).name;

export function bi(s) {
  const t = totals(s.ledger), rev = t.revenue, cogs = balance(s.ledger, "cogs") + balance(s.ledger, "cogs_labor"), gross = c(rev - cogs);
  const inv = c(balance(s.ledger, "inventory") + balance(s.ledger, "inv_raw") + balance(s.ledger, "inv_fg")), days = Math.max(1, s.day - 1 + (s.dayStep / s.stepsPerDay || 0));
  const perDayCogs = cogs / days, turnoverYear = inv > 0 ? c(perDayCogs * 365 / inv) : 0, daysOfStock = perDayCogs > 0 ? c(inv / perDayCogs) : null;
  const eff = (s.fx && s.fx.eff) || { cap: 0, made: 0 }, prodEff = eff.cap > 0 ? c(eff.made / eff.cap * 100) : null;
  const b = s.b2b, bDone = b.ontime + b.late, p = ensurePerf(s);
  const suppliers = Object.entries(p.sup).map(([id, v]) => ({ id, name: nameOf(id), n: v.n, late: v.late, onTime: c((v.n - v.late) / v.n * 100) })).sort((a, z) => z.n - a.n);
  const net = c(rev - t.costs), opEx = c(t.costs - cogs);
  return {
    revenue: rev, cogs: c(cogs), gross, grossMargin: rev > 0 ? c(gross / rev * 100) : null, opEx, net, netMargin: rev > 0 ? c(net / rev * 100) : null,
    inventory: inv, turnoverYear, daysOfStock, prodEff, madeUnits: eff.made, capUnits: eff.cap,
    b2bOnTime: bDone ? c(b.ontime / bDone * 100) : null, b2bDone: bDone, supplierOnTime: p.orders ? c((p.orders - p.lateOrders) / p.orders * 100) : null, supplierOrders: p.orders, suppliers,
    channels: [["Shop", balance(s.ledger, "sales")], ["B2B", balance(s.ledger, "sales_b2b")], ["Web", balance(s.ledger, "sales_ecom")]].map(([name, v]) => ({ name, v: c(v) })),
    costMix: [["Goods", balance(s.ledger, "cogs") + balance(s.ledger, "cogs_labor")], ["Wages", balance(s.ledger, "wages")], ["Rent and utilities", balance(s.ledger, "rent") + balance(s.ledger, "utilities")], ["Shipping", balance(s.ledger, "delivery")], ["Marketing", balance(s.ledger, "marketing")], ["Interest and fees", balance(s.ledger, "interest") + balance(s.ledger, "fees")], ["Tax", balance(s.ledger, "tax")], ["Other", balance(s.ledger, "depreciation") + balance(s.ledger, "maintenance") + balance(s.ledger, "repairs") + balance(s.ledger, "penalties") + balance(s.ledger, "overflow") + balance(s.ledger, "bad_debt")]].map(([name, v]) => ({ name, v: c(v) })).filter(x => x.v > 0.004),
    series: s.history.slice(-60).map(h => ({ day: h.day, revenue: h.revenue, net: h.net, cash: h.cash })),
  };
}

// Profit and loss per department, with a trend: the last 7 days against the 7 before. Revenue departments earn, the others cost.
export function trendOf(now, before, eps = 1) { if (now == null || before == null) return { dir: 0, pct: null }; const d = now - before; return { dir: Math.abs(d) < Math.max(eps, Math.abs(before) * 0.05) ? 0 : d > 0 ? 1 : -1, pct: Math.abs(before) > eps ? c(d / Math.abs(before) * 100) : null }; }
export function deptPL(s) {
  const dp = s.ledger.dp || newDp(), h = s.history, n = h.length, at = (i, k) => (i >= 0 && i < n && h[i].dp ? h[i].dp[k] || 0 : null);
  return DEPTS.map(([id, name]) => { const v = dp[id] || { rev: 0, cost: 0 }, a = n ? at(n - 1, id) : null, b = n > 7 ? at(n - 8, id) : null, z = n > 14 ? at(n - 15, id) : null;
    const last7 = a != null && b != null ? c(a - b) : null, prev7 = b != null && z != null ? c(b - z) : null;
    return { id, name, rev: c(v.rev), cost: c(v.cost), net: c(v.rev - v.cost), last7, prev7, trend: trendOf(last7, prev7) }; }).filter(r => r.rev > 0.004 || r.cost > 0.004);
}
export function kpiTrends(s) {
  const h = s.history, n = h.length; if (n < 8) return {};
  const sum = (from, to, f) => h.slice(Math.max(0, from), to).reduce((a, x) => a + f(x), 0), m = f => { const w = sum(n - 7, n, f), p = n >= 14 ? sum(n - 14, n - 7, f) : null; return trendOf(w, p); };
  return { revenue: m(x => x.revenue), net: m(x => x.net) };
}
