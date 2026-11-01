// Factory layer (spec modules PRD, MNT, PMN raw side): raw materials, machines, production runs, maintenance, depreciation,
// and two-stage raw purchasing (requisition -> approval -> purchase order) with payment terms.
// Pure functions on the game state `s`. State lives in s.fx. All money goes through the ledger.
import { post, balance, round2 } from "./ledger.js";
import { getLocation } from "./locations.js";
import * as D from "./data.js";
import { rnd, log, distanceKm } from "./engine.js";

const c = round2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const err = error => ({ ok: false, error }), ok = (o = {}) => ({ ok: true, ...o });
export const RAWM = Object.fromEntries(D.RAW.map(r => [r.id, r]));
export const JUICE = Object.fromEntries(D.JUICES.map(j => [j.id, j]));
export const MACHINE = Object.fromEntries(D.MACHINES.map(m => [m.id, m]));
export const VENDOR = Object.fromEntries(D.RAW_VENDORS.map(v => [v.id, v]));
export const TERM = Object.fromEntries(D.TERMS.map(t => [t.id, t]));

export function newFactory() {
  const fx = { raw: { qty: {}, val: {} }, fg: { qty: {}, val: {} }, machines: [], mseq: 0, prs: [], prSeq: 0, pos: [], poSeq: 0, payables: [], paySeq: 0, today: null };
  for (const r of D.RAW) { fx.raw.qty[r.id] = 0; fx.raw.val[r.id] = 0; }
  for (const j of D.JUICES) { fx.fg.qty[j.id] = 0; fx.fg.val[j.id] = 0; }
  return fx;
}
export const ensureFactory = s => (s.fx = s.fx || newFactory());

// ---------- derived numbers ----------
export const rawUnitsUsedSpace = s => D.RAW.reduce((a, r) => a + s.fx.raw.qty[r.id] * r.space, 0);
export const fgSpace = s => D.JUICES.reduce((a, j) => a + s.fx.fg.qty[j.id] * j.space, 0);
export const machineEfficiency = m => clamp(0.4 + 0.6 * (m.health / 100), 0.4, 1);
export const bomCost = (id, s) => {
  const j = JUICE[id]; let cost = 0;
  for (const [rid, q] of Object.entries(j.bom)) { const have = s.fx.raw.qty[rid]; cost += q * (have ? s.fx.raw.val[rid] / have : RAWM[rid].cost); }
  return c(cost);
};
// How many bottles the raw stock can make right now.
export function bottlesPossible(s, juiceId) {
  const j = JUICE[juiceId]; let m = Infinity;
  for (const [rid, q] of Object.entries(j.bom)) m = Math.min(m, Math.floor(s.fx.raw.qty[rid] / q + 1e-9));
  return Number.isFinite(m) ? m : 0;
}
export const machineBookValue = m => c(m.cost - m.deprec);

// ---------- machines ----------
export function quoteMachine(s, typeId) {
  const t = MACHINE[typeId]; if (!t) return err("Unknown machine type.");
  const total = c(t.price + t.setup), cash = balance(s.ledger, "cash");
  const q = { type: typeId, price: t.price, setup: t.setup, total, perDay: t.perDay, daily: c(total / t.life), errors: [] };
  if (total > cash + 0.004) q.errors.push(`Not enough cash: need $${total.toFixed(2)}, have $${c(cash).toFixed(2)}.`);
  q.ok = !q.errors.length; return q;
}
export function buyMachine(s, { type } = {}) {
  if (s.ended) return err("The game is over.");
  const q = quoteMachine(s, type); if (q.error) return err(q.error); if (!q.ok) return err(q.errors[0]);
  const t = MACHINE[type], fx = ensureFactory(s);
  const m = { id: ++fx.mseq, type, name: `${t.name} ${fx.mseq}`, health: D.MAINT.startHealth, status: "idle", ageDays: 0, cost: q.total, deprec: 0, job: null, downDays: 0, pmToday: false, emergency: 0 };
  fx.machines.push(m);
  post(s.ledger, s.day, `Bought ${m.name} (price and setup capitalised)`, [{ acct: "machinery", dr: q.total }, { acct: "cash", cr: q.total }], "machine:" + m.id);
  log(s, `Bought ${m.name} for $${q.total.toFixed(2)}.`);
  return ok({ machine: m });
}
const findMachine = (s, id) => ensureFactory(s).machines.find(m => m.id === id);
// Production run: every day this machine makes up to qty bottles of the juice, as long as raw materials and health allow.
export function setRun(s, { machine, juice, qty } = {}) {
  const m = findMachine(s, machine); if (!m) return err("Unknown machine.");
  if (!qty || qty <= 0) { m.job = null; return ok({ machine: m }); }
  if (!JUICE[juice]) return err("Unknown juice.");
  const t = MACHINE[m.type]; qty = clamp(Math.round(Number(qty)) || 0, 0, t.perDay);
  m.job = qty ? { juice, qty } : null; return ok({ machine: m });
}

// ---------- maintenance ----------
export function preventiveMaintenance(s, machineId) {
  if (s.ended) return err("The game is over.");
  const m = findMachine(s, machineId); if (!m) return err("Unknown machine.");
  if (m.downDays > 0) return err("This machine is already down.");
  if (m.pmToday) return err("Already serviced today.");
  const t = MACHINE[m.type], cost = t.pmCost, cash = balance(s.ledger, "cash");
  if (cost > cash + 0.004) return err(`Not enough cash: need $${cost.toFixed(2)}.`);
  m.health = D.MAINT.restoreTo; m.pmToday = true;
  post(s.ledger, s.day, `Preventive maintenance on ${m.name}`, [{ acct: "maintenance", dr: cost }, { acct: "cash", cr: cost }], "pm:" + m.id + ":" + s.day);
  log(s, `Serviced ${m.name} for $${cost.toFixed(2)}. Health restored. It stops for about ${Math.round(t.pmDays * 24)} hours today.`);
  return ok({ cost });
}
function pay(s, acct, amount, memo, ref) {                    // pay from cash; any shortfall goes to the overdraft (same rule as rent)
  amount = c(amount); if (amount <= 0) return;
  const cash = Math.max(0, balance(s.ledger, "cash")), paid = c(Math.min(cash, amount)), short = c(amount - paid);
  const lines = [{ acct, dr: amount }]; if (paid > 0) lines.push({ acct: "cash", cr: paid }); if (short > 0) lines.push({ acct: "overdraft", cr: short });
  post(s.ledger, s.day, memo, lines, ref);
}

// ---------- raw purchasing: PR -> approval -> PO ----------
export function quoteRaw(s, { vendor, lines, terms = "cod" } = {}) {
  const v = VENDOR[vendor], tm = TERM[terms]; if (!v) return err("Unknown vendor."); if (!tm) return err("Unknown payment terms.");
  const seen = new Set(), items = [];
  for (const l of Array.isArray(lines) ? lines : []) {
    const qty = Math.round(Number(l && l.qty));
    if (!l || !RAWM[l.rid] || seen.has(l.rid) || !Number.isFinite(qty) || qty < 1) continue;
    if (!v.sells.includes(l.rid)) return err(`${v.name} does not sell ${RAWM[l.rid].name}.`);
    seen.add(l.rid); items.push({ rid: l.rid, qty });
  }
  if (!items.length) return err("Choose a quantity for at least one material.");
  const km = distanceKm(s.location, v), L = getLocation(s.location), days = Math.max(1, Math.ceil(km / v.speed + v.prep));
  const out = items.map(l => {
    const r = RAWM[l.rid], unit = Math.round(r.cost * v.price * tm.price * 10000) / 10000, goods = c(unit * l.qty);
    return { rid: l.rid, qty: l.qty, unit, goods, ship: c(v.rate * km * l.qty * r.space * L.logistics) };
  });
  const goods = c(out.reduce((a, l) => a + l.goods, 0)), ship = c(v.fee * L.logistics + out.reduce((a, l) => a + l.ship, 0)), total = c(goods + ship);
  const q = { vendor, terms, km, days, eta: s.day + days, lines: out, goods, ship, total, dueDays: tm.days, errors: [], reliability: v.reliability };
  const cash = balance(s.ledger, "cash"), now = c(ship + (tm.days === 0 ? goods : 0));        // freight is always paid now; goods only on COD
  if (now > cash + 0.004) q.errors.push(`Not enough cash: need $${now.toFixed(2)} now, have $${c(cash).toFixed(2)}.`);
  q.ok = !q.errors.length; return q;
}
export function createPR(s, spec) {
  const q = quoteRaw(s, spec); if (q.error) return err(q.error);
  const fx = ensureFactory(s), pr = { id: ++fx.prSeq, day: s.day, status: "pending", spec: { vendor: spec.vendor, terms: spec.terms || "cod", lines: q.lines.map(l => ({ rid: l.rid, qty: l.qty })) }, estimate: q.total };
  fx.prs.push(pr); return ok({ pr });
}
export function approvePR(s, id) {
  const fx = ensureFactory(s), pr = fx.prs.find(p => p.id === id); if (!pr) return err("Unknown requisition.");
  if (pr.status !== "pending") return err("This requisition is already " + pr.status + ".");
  const r = placeRawOrder(s, pr.spec); if (!r.ok) return r;
  pr.status = "approved"; pr.po = r.po.id; return ok({ pr, po: r.po });
}
export function rejectPR(s, id) {
  const pr = ensureFactory(s).prs.find(p => p.id === id); if (!pr) return err("Unknown requisition.");
  if (pr.status !== "pending") return err("This requisition is already " + pr.status + "."); pr.status = "rejected"; return ok({ pr });
}
export function placeRawOrder(s, spec) {
  if (s.ended) return err("The game is over.");
  const q = quoteRaw(s, spec); if (q.error) return err(q.error); if (!q.ok) return err(q.errors[0]);
  const fx = ensureFactory(s), tm = TERM[q.terms], late = rnd(s) > VENDOR[q.vendor].reliability ? 1 : 0;
  const po = { id: ++fx.poSeq, vendor: q.vendor, terms: q.terms, lines: q.lines.map(l => ({ ...l })), goods: q.goods, ship: q.ship, placed: s.day, eta: q.eta + late, delayed: late === 1, due: tm.days ? s.day + tm.days : null };
  fx.pos.push(po);
  const lines = [{ acct: "transit", dr: q.goods }, { acct: "delivery", dr: q.ship }];
  if (tm.days === 0) lines.push({ acct: "cash", cr: q.total });
  else { lines.push({ acct: "cash", cr: q.ship }); lines.push({ acct: "payables", cr: q.goods }); fx.payables.push({ id: ++fx.paySeq, po: po.id, amount: q.goods, due: po.due }); }
  post(s.ledger, s.day, `Raw purchase order #${po.id} from ${VENDOR[q.vendor].name} (${tm.name})`, lines, "rawpo:" + po.id);
  s.today.ship = c(s.today.ship + q.ship);
  log(s, `Raw order #${po.id}: ${po.lines.map(l => `${l.qty.toLocaleString("en-US")} ${RAWM[l.rid].unit} ${RAWM[l.rid].name}`).join(", ")}. Arrives day ${po.eta}.`);
  return ok({ po, total: q.total, eta: po.eta });
}
export const rawIncoming = s => { const m = {}; for (const r of D.RAW) m[r.id] = 0; for (const po of ensureFactory(s).pos) for (const l of po.lines) m[l.rid] += l.qty; return m; };

// ---------- daily hooks (called from the engine's day start and day close) ----------
export function factoryArrivals(s) {
  const fx = ensureFactory(s), due = fx.pos.filter(p => p.eta <= s.day);
  for (const po of due) {
    post(s.ledger, s.day, `Raw delivery #${po.id}`, [{ acct: "inv_raw", dr: po.goods }, { acct: "transit", cr: po.goods }], "rawpo:" + po.id);
    for (const l of po.lines) { fx.raw.qty[l.rid] += l.qty; fx.raw.val[l.rid] = c(fx.raw.val[l.rid] + l.goods); }
    log(s, `Raw delivery #${po.id} arrived.`);
  }
  fx.pos = fx.pos.filter(p => p.eta > s.day);
  for (const m of fx.machines) m.pmToday = false;
}

export function factoryDay(s) {
  const fx = ensureFactory(s); fx.today = { made: {}, cost: 0, idle: 0, broke: [] };
  for (const m of fx.machines) {
    const t = MACHINE[m.type]; m.ageDays++;
    // depreciation: straight line on price + setup, never below zero book value
    const dep = c(Math.min(m.cost / t.life, m.cost - m.deprec));
    if (dep > 0) { post(s.ledger, s.day, `Depreciation ${m.name}`, [{ acct: "depreciation", dr: dep }, { acct: "acc_deprec", cr: dep }], "dep:" + m.id + ":" + s.day); m.deprec = c(m.deprec + dep); }
    // downtime from an earlier breakdown
    if (m.downDays > 0) { m.downDays--; m.status = m.downDays > 0 ? "broken" : "idle"; if (m.downDays === 0) m.health = 80; continue; }
    if (!m.job) { m.status = "idle"; continue; }
    const j = JUICE[m.job.juice], serviceLoss = m.pmToday ? t.pmDays : 0;
    const cap = Math.floor(Math.min(m.job.qty, t.perDay) * machineEfficiency(m) * (1 - serviceLoss)), n = Math.min(cap, bottlesPossible(s, j.id));
    if (n <= 0) { m.status = "idle"; fx.today.idle++; if (m.pmToday) m.health = D.MAINT.restoreTo; continue; }
    let cost = 0;
    for (const [rid, q] of Object.entries(j.bom)) {
      const use = q * n, have = fx.raw.qty[rid], v = use >= have - 1e-9 ? fx.raw.val[rid] : c(fx.raw.val[rid] / have * use);
      fx.raw.qty[rid] = c(have - use); fx.raw.val[rid] = c(fx.raw.val[rid] - v); cost = c(cost + v);
    }
    for (const rid of Object.keys(fx.raw.qty)) if (fx.raw.qty[rid] < 1e-6) { fx.raw.qty[rid] = 0; }
    post(s.ledger, s.day, `Production ${m.name}: ${n} ${j.name}`, [{ acct: "inv_fg", dr: cost }, { acct: "inv_raw", cr: cost }], "prod:" + m.id + ":" + s.day);
    fx.fg.qty[j.id] += n; fx.fg.val[j.id] = c(fx.fg.val[j.id] + cost);
    fx.today.made[j.id] = (fx.today.made[j.id] || 0) + n; fx.today.cost = c(fx.today.cost + cost);
    m.status = "running";
    if (!m.pmToday) m.health = c(Math.max(0, m.health - t.wear));
    // breakdown risk when health is under the threshold
    if (m.health < D.MAINT.breakdownBelow && rnd(s) < D.MAINT.breakdownChance) {
      m.downDays = D.MAINT.downMin + (rnd(s) < 0.5 ? 0 : D.MAINT.downMax - D.MAINT.downMin); m.status = "broken"; m.emergency++;
      const fee = c(t.pmCost * D.MAINT.emergencyMult); pay(s, "maintenance", fee, `Emergency repair of ${m.name}`, "emerg:" + m.id + ":" + s.day);
      fx.today.broke.push(m.id); log(s, `${m.name} broke down. Emergency repair $${fee.toFixed(2)}, down ${m.downDays} day${m.downDays > 1 ? "s" : ""}.`);
    }
  }
  // supplier invoices due today
  for (const p of fx.payables.filter(x => x.due <= s.day)) {
    pay(s, "payables", p.amount, `Paid supplier invoice (raw order #${p.po})`, "inv:" + p.id);
    // pay() debits the account argument; for payables that reduces the liability, as intended
  }
  fx.payables = fx.payables.filter(x => x.due > s.day);
}
