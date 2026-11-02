// Business intelligence dashboard numbers (spec module 13). Everything here is read from the ledger and from counters the game keeps while it runs.
import { totals, balance, round2 } from "./ledger.js";
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
