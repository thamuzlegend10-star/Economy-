// Marketing (module 10), e-commerce (module 11) and customer service (module 12).
import { post, balance, round2 } from "./ledger.js";
import * as D from "./data.js";
import { streamNext, seedFrom } from "./rng.js";
import { log, PRODUCT } from "./engine.js";
import { JUICE } from "./factory.js";
import { serviceCapacity, retailBoost } from "./hr.js";

const c = round2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const err = error => ({ ok: false, error }), ok = (o = {}) => ({ ok: true, ...o });
const CH = Object.fromEntries(D.MKT_CHANNELS.map(x => [x.id, x]));
const CATS = ["food", "drinks", "electronics"];
const item = pid => PRODUCT[pid] || JUICE[pid];
function payOut(s, acct, amount, memo, ref) {
  amount = c(amount); if (amount <= 0) return;
  const cash = Math.max(0, balance(s.ledger, "cash")), paid = c(Math.min(cash, amount)), short = c(amount - paid);
  const lines = [{ acct, dr: amount }]; if (paid > 0) lines.push({ acct: "cash", cr: paid }); if (short > 0) lines.push({ acct: "overdraft", cr: short });
  post(s.ledger, s.day, memo, lines, ref);
}

// ================= marketing =================
export const newMkt = () => ({ seq: 0, campaigns: [] });
export const ensureMkt = s => (s.mkt = s.mkt || newMkt());
export function startCampaign(s, { channel, budget, days, cat = "all" } = {}) {
  if (s.ended) return err("The game is over."); const ch = CH[channel]; if (!ch) return err("Unknown channel.");
  budget = Math.round(Number(budget)); days = Math.round(Number(days));
  if (!Number.isFinite(budget) || budget < ch.minBudget) return err(`${ch.name} needs a budget of at least $${ch.minBudget}.`);
  if (!Number.isFinite(days) || days < D.MKT.duration.min || days > D.MKT.duration.max) return err(`Run it for ${D.MKT.duration.min} to ${D.MKT.duration.max} days.`);
  if (cat !== "all" && !CATS.includes(cat)) return err("Unknown product category.");
  const m = ensureMkt(s), k = { id: ++m.seq, channel, cat, budget, days, left: days, daily: c(budget / days), aw: 0, started: s.day, district: s.location };
  m.campaigns.push(k); log(s, `Started a ${ch.name.toLowerCase()} campaign: $${budget} over ${days} days.`); return ok({ campaign: k });
}
export function stopCampaign(s, id) { const k = ensureMkt(s).campaigns.find(x => x.id === id); if (!k) return err("Unknown campaign."); k.left = 0; return ok(); }
export const awareness = (s, cat) => clamp(ensureMkt(s).campaigns.filter(k => k.cat === "all" || k.cat === cat).reduce((a, k) => a + k.aw, 0), 0, D.MKT.maxAwareness);
export const demandLift = (s, cat) => 1 + D.MKT.trafficLift * awareness(s, cat) / 100;
export const priceCut = (s, cat) => 1 - D.MKT.priceSensitivityCut * awareness(s, cat) / 100;     // multiplies the demand elasticity
export function mktDay(s) {
  const m = ensureMkt(s);
  for (const k of m.campaigns) {
    if (k.left > 0) { payOut(s, "marketing", k.daily, `Marketing: ${CH[k.channel].name} #${k.id}`, "mkt:" + k.id + ":" + s.day); k.aw = c(k.aw + CH[k.channel].reach * k.daily / 1000 * 10); k.left--; }
    k.aw = c(k.aw * (1 - CH[k.channel].decay));
  }
  m.campaigns = m.campaigns.filter(k => k.left > 0 || k.aw >= 0.5);
}

// ================= e-commerce =================
export const newEcom = seed => ({ rng: seedFrom(seed, 0xec0), active: false, catalog: [], prices: {}, adBudget: 0, seq: 0, orders: [], acc: 0, stats: { orders: 0, units: 0, revenue: 0, lost: 0, late: 0 }, today: null });
// Seller rating (0 to 5 stars, halves allowed) from delivery timeliness, as in MonsoonSIM's Web Market. A new seller has none until 8 orders are in. A poor rating cuts conversion by up to 20%.
export function sellerStars(s) {
  const e = s.ecom; if (!e || !e.stats || e.stats.orders < 8) return null;
  return Math.round(clamp(5 - 15 * (e.stats.late || 0) / e.stats.orders, 0, 5) * 2) / 2;
}
export const sellerFactor = s => { const st = sellerStars(s); return st == null ? 1 : 1 - 0.04 * (5 - st); };
export const ensureEcom = s => (s.ecom = s.ecom || newEcom(s.seed));
export function openWebstore(s) {
  if (s.ended) return err("The game is over."); const e = ensureEcom(s); if (e.active) return err("The webstore is already open.");
  const cash = balance(s.ledger, "cash"); if (D.ECOM.setupFee > cash + 0.004) return err(`Not enough cash: setup costs $${D.ECOM.setupFee}.`);
  post(s.ledger, s.day, "Webstore setup", [{ acct: "fees", dr: D.ECOM.setupFee }, { acct: "cash", cr: D.ECOM.setupFee }], "ecom:setup"); e.active = true; log(s, "The webstore is open."); return ok();
}
export function setCatalog(s, pids) {
  const e = ensureEcom(s), list = [...new Set(pids)].filter(p => item(p)); if (list.length > D.ECOM.catalogMax) return err(`The catalog holds up to ${D.ECOM.catalogMax} products.`);
  e.catalog = list; for (const p of list) if (!e.prices[p]) e.prices[p] = c(item(p).ref * 1.1); return ok({ catalog: list });
}
export function setWebPrice(s, pid, price) { const e = ensureEcom(s), p = item(pid); if (!p) return err("Unknown product."); e.prices[pid] = c(clamp(Number(price) || p.ref, p.ref * 0.5, p.ref * 2.5)); return ok({ price: e.prices[pid] }); }
export function setAdBudget(s, v) { ensureEcom(s).adBudget = clamp(Math.round(Number(v) || 0), 0, 5000); return ok({ adBudget: s.ecom.adBudget }); }
function stockOf(s, pid) { return PRODUCT[pid] ? s.wh : s.fx.fg; }
export function webTraffic(s) { const e = ensureEcom(s); return Math.round(D.ECOM.baseTraffic * (1 + D.MKT.trafficLift * awareness(s, "all") / 100) + e.adBudget / D.ECOM.cpc); }
export function ecomDay(s) {
  const e = ensureEcom(s); e.today = { orders: 0, units: 0, revenue: 0, lost: 0 };
  // release escrow for parcels delivered long enough ago
  for (const o of e.orders.filter(x => x.release <= s.day)) {
    const fee = c(o.amount * D.ECOM.gatewayRate);
    post(s.ledger, s.day, `Escrow released for web order #${o.id}`, [{ acct: "cash", dr: o.amount }, { acct: "escrow", dr: o.amount }, { acct: "receivables", cr: o.amount }, { acct: "sales_ecom", cr: o.amount }], "web:" + o.id);
    payOut(s, "fees", fee, `Gateway fee, web order #${o.id}`, "webfee:" + o.id);
  }
  e.orders = e.orders.filter(x => x.release > s.day);
  if (!e.active) return;
  payOut(s, "fees", D.ECOM.hostingPerDay, "Webstore hosting", "ecom:host:" + s.day);
  if (e.adBudget > 0) payOut(s, "marketing", e.adBudget, "Pay-per-click ads", "ecom:ads:" + s.day);
  if (!e.catalog.length) return;
  const visitors = webTraffic(s);
  for (const pid of e.catalog) {
    const p = item(pid), price = e.prices[pid], conv = D.ECOM.baseConversion * clamp(Math.pow(p.ref * 1.1 / price, p.elast), 0.05, 3) * sellerFactor(s);
    e.acc += visitors / e.catalog.length * conv; const want = Math.floor(e.acc); e.acc -= want; if (want < 1) continue;
    const src = stockOf(s, pid), have = src.qty[pid], n = Math.min(want, have), lost = want - n;
    if (lost) { e.today.lost += lost; e.stats.lost += lost; }
    if (n < 1) continue;
    const cost = n >= have ? src.val[pid] : c(src.val[pid] / have * n), amount = c(n * price), ship = c(n * (D.ECOM.pickPackPerOrder + D.ECOM.parcelPerOrder));
    src.qty[pid] -= n; src.val[pid] = c(src.val[pid] - cost);
    const late = streamNext(e) < D.SRV.webLateChance ? 1 : 0, id = ++e.seq;
    post(s.ledger, s.day, `Web order #${id}: ${n} ${p.name}`, [{ acct: "receivables", dr: amount }, { acct: "escrow", cr: amount }], "web:" + id);
    post(s.ledger, s.day, `Shipped web order #${id}`, [{ acct: "cogs", dr: cost }, { acct: PRODUCT[pid] ? "inventory" : "inv_fg", cr: cost }], "web:" + id);
    payOut(s, "delivery", ship, `Pick, pack and parcel, web order #${id}`, "webship:" + id);
    e.orders.push({ id, pid, qty: n, amount, release: s.day + D.ECOM.parcelDays + late + D.ECOM.escrowReleaseDays, late: !!late });
    e.today.orders++; e.today.units += n; e.today.revenue = c(e.today.revenue + amount); e.stats.orders++; e.stats.units += n; e.stats.revenue = c(e.stats.revenue + amount); if (late) e.stats.late++;
  }
}

// ================= customer service =================
export const newSrv = () => ({ csi: D.SRV.csiStart, backlog: 0, tickets: 0, resolved: 0, resp: 0, loyal: D.SRV.csiStart, lostEma: 0, types: { general: 0, late: 0, stockout: 0 } });
export const ensureSrv = s => { const v = (s.srv = s.srv || newSrv()); if (v.resp == null) Object.assign(v, { resp: 0, loyal: v.csi, lostEma: 0, types: { general: v.tickets, late: 0, stockout: 0 } }); return v; };
// Customer measures. Response time: days a ticket waits (queue length over what staff clear per day). Loyalty: satisfaction averaged slowly, so one bad week does not erase it.
// Retention: the share of shoppers who come back, lowered by unmet demand (stock-outs) and by satisfaction below the neutral score.
export const retention = s => { const v = ensureSrv(s); return clamp(100 - 100 * v.lostEma - Math.max(0, D.SRV.neutralCsi - v.csi) * 0.6, 0, 100); };
// Customer satisfaction moves demand: above the neutral score shoppers come back and tell others, below it they stay away.
export const csiFactor = s => clamp(1 + D.SRV.demandPerPoint * ((s.srv ? s.srv.csi : D.SRV.neutralCsi) - D.SRV.neutralCsi), D.SRV.demandMin, D.SRV.demandMax);
export function srvDay(s) {
  const v = ensureSrv(s), t = s.today, sold = Object.values(t.units).reduce((a, b) => a + b, 0), lost = Object.values(t.lost).reduce((a, b) => a + b, 0);
  const web = s.ecom && s.ecom.today ? s.ecom.today : { orders: 0, lost: 0, late: 0 }, lateWeb = s.ecom ? s.ecom.orders.filter(o => o.late).length : 0;
  const gen = Math.round(sold * D.SRV.ticketRate / 4 + web.orders * D.SRV.ticketRate * 25), late = Math.round(lateWeb * D.SRV.lateDeliveryHit), out = Math.round((lost + web.lost) * D.SRV.stockoutHit), tickets = gen + late + out;
  v.types.general += gen; v.types.late += late; v.types.stockout += out;
  v.tickets += tickets; v.backlog += tickets; const done = Math.min(v.backlog, Math.floor(serviceCapacity(s))); v.backlog -= done; v.resolved += done; v.resp = c(v.resp + ((v.backlog > 0 ? v.backlog / Math.max(1, Math.floor(serviceCapacity(s))) : 0) - v.resp) * 0.3);
  const lostShare = (lost + web.lost) / Math.max(1, sold + lost + web.orders + web.lost), backlogShare = v.backlog / Math.max(40, sold * 0.05 + 40);
  const target = clamp(95 - 140 * lostShare - 12 * Math.min(1, backlogShare) - 4 * lateWeb + 6 * (retailBoost(s) - 1) * 10, 0, 100);
  v.csi = c(clamp(v.csi + (target - v.csi) * D.SRV.csiDrift, 0, 100)); v.loyal = c(v.loyal + (v.csi - v.loyal) * 0.05); v.lostEma = c(v.lostEma + (lostShare - v.lostEma) * 0.2);
}
