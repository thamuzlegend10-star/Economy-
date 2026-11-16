// Business intelligence (module 13): the eight scoring KPIs, a configurable weighted score, and competitor price tracking.
import * as Sv from "./services.js";
import { totals, balance, round2, OPEX } from "./ledger.js";
import { modOn } from "./modules.js";
import { getLocation } from "./locations.js";
import * as D from "./data.js";
import { rivalPrices } from "./economy.js";
import { PRODUCT, whOverflow, capacityOf, spaceUsed } from "./engine.js";

const c = round2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const kpiSet = s => (s && s.kpi10 ? D.KPIS10 : D.KPIS);
export const newKpi = s => ({ weights: Object.fromEntries(kpiSet(s).map(k => [k.id, k.weight])), targets: {}, lock: false });
export const ensureKpi = s => { const k = (s.kpi = s.kpi || newKpi(s)); if (!k.targets) { k.targets = {}; k.lock = false; } return k; };
export function setWeights(s, w) {
  const k = ensureKpi(s), out = {}; let sum = 0;
  for (const d of kpiSet(s)) { const v = Math.max(0, Number(w && w[d.id])); out[d.id] = Number.isFinite(v) ? v : 0; sum += out[d.id]; }
  if (sum <= 0) return { ok: false, error: "Give at least one KPI a weight above zero." };
  for (const d of kpiSet(s)) out[d.id] = Math.round(out[d.id] / sum * 10000) / 10000;
  k.weights = out; return { ok: true, weights: out };
}
function marketShare(s) {
  const L = getLocation(s.location), days = Math.max(1, s.day - 1 + (s.dayStep / s.stepsPerDay || 0));
  let rival = 0; for (const p of D.PRODUCTS) rival += p.base * L.demand * L.cat[p.cat] * L.competition * 0.6 * days;
  const mine = s.stats.units + (s.ecom ? s.ecom.stats.units : 0) + (s.b2b ? s.b2b.history.filter(h => h.revenue).reduce((a, h) => a + h.qty, 0) : 0);
  return mine / Math.max(1, mine + rival) * 100;
}
// ---------- targets ----------
// A team (or the facilitator, in a live room) can set a target for each KPI. Progress is value / target, capped at 100, and the target score is the
// weighted average over the KPIs that have a target. It is shown beside the normal score and never changes it.
const TARGET_LEVELS = { easy: 0.6, standard: 1, hard: 1.4 };
export const targetLevels = () => Object.keys(TARGET_LEVELS);
export function presetTargets(s, level) {
  const m = TARGET_LEVELS[level], base = Math.max(1, s.startNetWorth || 1); if (!m) return null;
  const pc = (v, cap) => Math.min(cap, Math.round(v * m * 10) / 10);
  return { netProfit: Math.round(0.25 * base * m), revenue: Math.round(1.5 * base * m), roa: pc(10, 100), serviceLevel: Math.min(98, Math.round(90 * (m > 1 ? 1.05 : m < 1 ? 0.9 : 1))), marketShare: pc(15, 100), csi: Math.min(95, Math.round(75 * (m > 1 ? 1.1 : m < 1 ? 0.9 : 1))), morale: Math.min(95, Math.round(70 * (m > 1 ? 1.1 : m < 1 ? 0.9 : 1))), solvency: pc(3, 10), ...(s.kpi10 ? { dsi: Math.round(30 / m), opexRatio: Math.round(25 / m), oee: Math.min(95, Math.round(60 * m)) } : {}) };
}
export function setTargets(s, t, { lock = false, force = false } = {}) {
  const k = ensureKpi(s); if (k.lock && !force) return { ok: false, error: "The facilitator set these targets. They cannot be changed." };
  const out = {};
  for (const d of kpiSet(s)) { const v = Number(t && t[d.id]); if (t && t[d.id] != null && t[d.id] !== "" && (!Number.isFinite(v) || v < 0)) return { ok: false, error: `${d.name}: enter a number of zero or more.` }; if (Number.isFinite(v) && v > 0) out[d.id] = c(v); }
  k.targets = out; k.lock = !!lock && Object.keys(out).length > 0; return { ok: true, targets: out };
}
export function applyPreset(s, level, lock = false) { const p = presetTargets(s, level); return p ? setTargets(s, p, { lock, force: true }) : { ok: false, error: "Unknown target level." }; }
export function targetProgress(s) {
  const k = kpis(s), tg = ensureKpi(s).targets, w = s.kpi.weights;
  const rows = kpiSet(s).filter(d => tg[d.id] > 0 && !(d.id === "oee" && !oeeOn(s))).map(d => { const pct = clamp(d.lower ? (k[d.id] > 0 ? tg[d.id] / k[d.id] * 100 : 100) : k[d.id] / tg[d.id] * 100, 0, 100); return { id: d.id, name: d.name, unit: d.unit, value: k[d.id], target: tg[d.id], pct: c(pct), met: d.lower ? k[d.id] <= tg[d.id] : k[d.id] >= tg[d.id], weight: w[d.id] }; });
  const wsum = rows.reduce((a, r) => a + r.weight, 0);
  return { rows, total: rows.length ? c(wsum > 0 ? rows.reduce((a, r) => a + r.pct * r.weight, 0) / wsum : rows.reduce((a, r) => a + r.pct, 0) / rows.length) : null, met: rows.filter(r => r.met).length, locked: !!s.kpi.lock };
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
    csi: c(s.srv ? s.srv.csi : D.SRV.csiStart), morale: c(s.hr ? s.hr.morale : D.HR.morale.start), solvency: c(Math.min(10, t.assets / Math.max(1, t.liabilities))), cash: c(cash), dsi: dsi(s), opexRatio: opexRatio(s), oee: oee(s) };
}

// ---------- the three added indicators ----------
export const oeeOn = s => !!(s.kpi10 && modOn(s, "factory") && s.fx && s.fx.eff && s.fx.eff.cap > 0);
// Days sales in inventory = stock value / cost of goods sold over the last 30 days x 30 (the whole game so far when it is younger than 30 days).
export function dsi(s) {
  const b = a => balance(s.ledger, a), stock = b("inventory") + b("inv_raw") + b("inv_fg"), cogs = b("cogs") + b("cogs_labor"), days = Math.max(1, Math.min(30, s.day - 1 + (s.dayStep / s.stepsPerDay || 0)));
  if (cogs <= 0.004) return stock > 0.004 ? 999 : 0;
  return c(Math.min(999, stock / (cogs / days * 30) * 30));
}
export function opexRatio(s) {
  const b = a => balance(s.ledger, a), rev = totals(s.ledger).revenue, opex = OPEX.reduce((a, x) => a + b(x), 0);
  return rev > 0.004 ? c(opex / rev * 100) : 0;
}
// Overall equipment effectiveness: finished units over full machine capacity, less the share of days machines sat broken (0 when the factory is off).
export function oee(s) {
  const e = s.fx && s.fx.eff; if (!e || e.cap <= 0) return 0;
  const days = Math.max(1, s.day - 1), avail = clamp(1 - (e.brokenDays || 0) / (days * Math.max(1, s.fx.machines.length)), 0, 1);
  return c(clamp(e.made / e.cap, 0, 1) * avail * 100);
}
// Each KPI is mapped to 0..100 before weighting so no single unit dominates.
const dsiScore = (s, k) => (k.dsi >= 999 ? 0 : k.dsi === 0 && balance(s.ledger, "cogs") <= 0 ? 50 : clamp(100 * (60 - k.dsi) / 50, 0, 100));   // 10 days or less scores 100, 60 or more scores 0
const opexScore = (s, k) => (totals(s.ledger).revenue > 0.004 ? clamp(100 - k.opexRatio * 2, 0, 100) : 50);                        // no revenue yet: neutral
export function normalise(s, k) {
  const base = Math.max(1, s.startNetWorth || 1);
  return { netProfit: clamp(50 + 50 * k.netProfit / base, 0, 100), revenue: clamp(100 * k.revenue / (base * 3), 0, 100), roa: clamp(50 + k.roa * 2.5, 0, 100),
    serviceLevel: clamp(k.serviceLevel, 0, 100), marketShare: clamp(k.marketShare * 1.5, 0, 100), csi: clamp(k.csi, 0, 100), morale: clamp(k.morale, 0, 100), solvency: clamp((k.solvency - 1) / 4 * 100, 0, 100), dsi: dsiScore(s, k), opexRatio: opexScore(s, k), oee: clamp(k.oee, 0, 100) };
}
// Score with the DEFAULT weights, so a player cannot raise it by changing the weights. Used for live rooms.
const live = s => kpiSet(s).filter(d => d.id !== "oee" || oeeOn(s));
export function defaultScore(s) { const n = normalise(s, kpis(s)), L = live(s); return c(L.reduce((a, d) => a + n[d.id] * d.weight, 0) / L.reduce((a, d) => a + d.weight, 0)); }
export function scoreboard(s) {
  const k = kpis(s), n = normalise(s, k), w = ensureKpi(s).weights, L = live(s), act = new Set(L.map(d => d.id));
  const wsum = L.reduce((a, d) => a + (w[d.id] || 0), 0) || 1;              // the weights of the KPIs in play re-normalise, so OEE off does not cap the score
  const rows = kpiSet(s).map(d => { const on = act.has(d.id), wt = on ? (w[d.id] || 0) / wsum : 0; return { id: d.id, name: d.name, unit: d.unit, value: k[d.id], score: c(n[d.id]), weight: s.kpi10 ? c(wt) : w[d.id], points: c(on ? n[d.id] * wt : 0), na: !on }; });
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
  { const v = s.svcj; if (v && v.jobs.length) { const fin = Sv.project(s), risk = v.jobs.filter(j => (fin[j.id] == null ? 99 : fin[j.id]) > j.deadline).length; if (risk) w.push({ level: "warn", text: `${risk} service job${risk === 1 ? " is" : "s are"} on course to finish late.`, where: ["b2b", "services"] }); } }
  if (lostToday > 0) w.push({ level: "warn", text: `Shoppers left without goods: ${lostToday.toLocaleString("en-US")} units missed today.`, where: ["retail", "procurement"] });
  if (s.srv && s.srv.csi < W.csiLow) w.push({ level: "warn", text: `Customer satisfaction is ${Math.round(s.srv.csi)}. Demand is falling.`, where: ["hr", ""] });
  if (s.hr && s.hr.morale < W.moraleLow) w.push({ level: "warn", text: `Staff morale is ${Math.round(s.hr.morale)}. People will quit.`, where: ["hr", ""] });
  for (const m of s.fx.machines) { if (m.status === "broken") w.push({ level: "bad", text: `${m.name} is broken.`, where: ["factory", "machines"] }); else if (m.health < W.healthLow) w.push({ level: "warn", text: `${m.name} health is ${Math.round(m.health)}%. Service it.`, where: ["factory", "machines"] }); }
  for (const k of s.b2b.active) if (s.day > k.due) w.push({ level: "bad", text: `B2B contract #${k.id} is ${k.lateDays + 1} day(s) late.`, where: ["b2b", "contracts"] });
  const ov = whOverflow(s); if (ov > 0) w.push({ level: "warn", text: `Warehouse over capacity by ${Math.round(ov).toLocaleString("en-US")} space. Overflow fees apply.`, where: ["warehouse", "stock"] });
  if (spaceUsed(s) > W.storageHigh * capacityOf(s.area)) w.push({ level: "warn", text: "The shop storage is almost full.", where: ["retail", "location"] });
  return w;
}
