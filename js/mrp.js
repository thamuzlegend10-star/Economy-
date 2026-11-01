// Material requirements planning (spec module 7). Looks ahead at machine schedules and B2B contracts, compares with raw stock
// and purchases on the way, and proposes (or, with autoPO, places) raw orders in economic lot sizes.
import * as D from "./data.js";
import { distanceKm } from "./engine.js";
import { round2 } from "./ledger.js";
import { RAWM, JUICE, VENDOR, TERM, MACHINE, ensureFactory, createPR, approvePR, rawIncoming, workOf } from "./factory.js";
import { whFree } from "./engine.js";
import { vendorLead, safetyFromLead } from "./forecast.js";

const c = round2;
export const newMrp = () => ({ autoPO: false, reorderPoint: {}, targetStock: {}, lastPlan: null });
export const ensureMrp = s => (s.mrp = s.mrp || newMrp());

// Raw units needed per day by the machine schedule, and extra raw needed for juice B2B contracts not covered by finished stock.
export function demandPerDay(s) {
  const d = {}; for (const r of D.RAW) d[r.id] = 0;
  for (const m of ensureFactory(s).machines) { const w = workOf(m); if (!w) continue; const j = JUICE[w.juice], n = Math.min(w.qty, MACHINE[m.type].perDay); for (const [rid, q] of Object.entries(j.bom)) d[rid] += q * n; }
  return d;
}
export function contractDemand(s) {
  const d = {}; for (const r of D.RAW) d[r.id] = 0;
  const b = s.b2b; if (!b) return d;
  const need = {}; for (const k of b.active) if (JUICE[k.pid]) need[k.pid] = (need[k.pid] || 0) + k.qty;
  for (const [pid, qty] of Object.entries(need)) { const short = Math.max(0, qty - s.fx.fg.qty[pid]); for (const [rid, q] of Object.entries(JUICE[pid].bom)) d[rid] += q * short; }
  return d;
}
export const eoq = (perDay, unitCost) => perDay > 0 ? Math.sqrt(2 * perDay * D.MRP.orderCost / (D.MRP.holdRate * Math.max(unitCost, 1e-6))) : 0;

// Best vendor for a material: cheapest unit cost among vendors with reliability >= 0.9, else the most reliable.
export function bestVendor(s, rid) {
  const list = D.RAW_VENDORS.filter(v => v.sells.includes(rid));
  const ok = list.filter(v => v.reliability >= 0.9), pool = ok.length ? ok : list;
  return pool.slice().sort((a, b) => a.price - b.price || b.reliability - a.reliability)[0];
}
export function plan(s, { horizon = D.MRP.horizonDays, safety = D.MRP.safetyDays } = {}) {
  ensureFactory(s); const m = ensureMrp(s), per = demandPerDay(s), cont = contractDemand(s), inc = rawIncoming(s), rows = [];
  for (const r of D.RAW) {
    const v = bestVendor(s, r.id), lt = vendorLead(s, v), lead = lt.days;
    const ss = per[r.id] > 0 ? Math.max(safetyFromLead(per[r.id], 0, lt), per[r.id] * D.FORECAST.minSafetyDays) : 0;
    const need = per[r.id] * horizon + ss + cont[r.id], onHand = s.fx.raw.qty[r.id], coming = inc[r.id];
    const target = m.targetStock[r.id] ?? 0, rop = m.reorderPoint[r.id] ?? per[r.id] * lt.expected + ss;
    const projected = onHand + coming, shortage = Math.max(0, need + target - projected), triggered = projected < rop + cont[r.id] || shortage > 0;
    let qty = 0, limited = false;
    if (triggered && (per[r.id] > 0 || cont[r.id] > 0)) {
      const lot = eoq(per[r.id], r.cost * v.price);
      qty = Math.ceil(Math.max(shortage, Math.min(lot, per[r.id] * 30)) / 10) * 10;
      if (s.wh.area > 0) { const room = Math.max(0, Math.floor(whFree(s) / r.space)); if (qty > room) { qty = Math.floor(room / 10) * 10; limited = true; } }   // a rented warehouse has a size: do not suggest more than fits
    }
    rows.push({ ss: c(ss), leadExp: c(lt.expected), limited, rid: r.id, perDay: c(per[r.id]), contract: c(cont[r.id]), onHand: c(onHand), incoming: c(coming), need: c(need), rop: c(rop), shortage: c(shortage), vendor: v.id, lead, qty, eoq: Math.round(eoq(per[r.id], r.cost * v.price)) });
  }
  m.lastPlan = { day: s.day, rows }; return m.lastPlan;
}
// Turn the plan into one requisition per vendor. Returns the PRs. With approve:true they are approved straight away.
export function generatePRs(s, { approve = false, terms = "cod" } = {}) {
  const p = plan(s), by = {}, out = [];
  for (const r of p.rows) if (r.qty > 0) (by[r.vendor] = by[r.vendor] || []).push({ rid: r.rid, qty: r.qty });
  for (const [vendor, lines] of Object.entries(by)) {
    const pr = createPR(s, { vendor, lines, terms }); if (!pr.ok) { out.push({ vendor, error: pr.error }); continue; }
    if (approve) { const a = approvePR(s, pr.pr.id); out.push(a.ok ? { vendor, pr: pr.pr, po: a.po } : { vendor, pr: pr.pr, error: a.error }); } else out.push({ vendor, pr: pr.pr });
  }
  return out;
}
export function mrpDay(s) { const m = ensureMrp(s); if (m.autoPO && ensureFactory(s).machines.length) generatePRs(s, { approve: true, terms: "net7" }); }
