// Factory layer (spec modules PRD, MNT, PMN raw side): raw materials, machines, production runs, maintenance, depreciation,
// and two-stage raw purchasing (requisition -> approval -> purchase order) with payment terms.
// Pure functions on the game state `s`. State lives in s.fx. All money goes through the ledger.
import { mailPost } from "./mail.js";
import { eventMult, delayed as scnDelayed } from "./scenario.js";
import { priceLevel } from "./economy.js";
import { trackArrival, trackProduction } from "./bi.js";
import { planTrip, dispatch } from "./fleet.js";
import { post, balance, round2 } from "./ledger.js";
import { getLocation } from "./locations.js";
import * as D from "./data.js";
import { rnd, log, distanceKm } from "./engine.js";
import { hire, crew, factoryPayroll, recruitFee } from "./hr.js";

const c = round2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const err = error => ({ ok: false, error }), ok = (o = {}) => ({ ok: true, ...o });
export const RAWM = Object.fromEntries(D.RAW.map(r => [r.id, r]));
export const JUICE = Object.fromEntries(D.JUICES.map(j => [j.id, j]));
export const MACHINE = Object.fromEntries(D.MACHINES.map(m => [m.id, m]));
export const VENDOR = Object.fromEntries(D.RAW_VENDORS.map(v => [v.id, v]));
export const TERM = Object.fromEntries(D.TERMS.map(t => [t.id, t]));

export function newFactory() {
  const fx = { raw: { qty: {}, val: {} }, fg: { qty: {}, val: {} }, machines: [], mseq: 0, area: 0, prs: [], prSeq: 0, pos: [], poSeq: 0, payables: [], paySeq: 0, today: null };
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
// ---------- factory building ----------
export const factoryRentPerM2 = s => c(D.FACTORY.rentPerM2 * getLocation(s.location).rent);
export const factoryRent = s => c(factoryRentPerM2(s) * ensureFactory(s).area);
export const factoryUtilities = s => c(D.FACTORY.utilitiesPerM2 * ensureFactory(s).area);
export const machineSpace = s => ensureFactory(s).machines.reduce((a, m) => a + MACHINE[m.type].space, 0);
export const factorySpaceFree = s => ensureFactory(s).area - machineSpace(s);
export function rentFactory(s, extra) {
  if (s.ended) return err("The game is over."); const fx = ensureFactory(s); extra = Math.round(Number(extra));
  if (!Number.isFinite(extra) || extra < 1) return err("Choose how many m² to rent.");
  const add = fx.area ? extra : Math.max(extra, D.FACTORY.minArea), room = D.FACTORY.maxArea - fx.area;
  if (add > room) return err(room > 0 ? `You can add at most ${room} m² (factories are at most ${D.FACTORY.maxArea} m²).` : "The factory is at its size limit.");
  const first = !fx.area; fx.area += add;
  log(s, `${first ? "Rented a factory of" : "Rented"} ${add} m²${first ? "" : " more"}. Rent ${factoryRent(s).toFixed(2)} and utilities ${factoryUtilities(s).toFixed(2)} dollars a day.`);
  return ok({ area: fx.area, rent: factoryRent(s) });
}
export const machineBookValue = m => c(m.cost - m.deprec);

// ---------- machines ----------
export function quoteMachine(s, typeId) {
  const t = MACHINE[typeId]; if (!t) return err("Unknown machine type.");
  const total = c(t.price + t.setup), cash = balance(s.ledger, "cash"), hireFee = recruitFee(s, "factory", t.operators);
  const q = { type: typeId, price: t.price, setup: t.setup, total, perDay: t.perDay, daily: c(total / t.life), space: t.space, errors: [] };
  if (t.space > factorySpaceFree(s)) q.errors.push(`Not enough factory space: this machine needs ${t.space} m², ${Math.max(0, Math.floor(factorySpaceFree(s)))} m² free. Rent more factory space.`);
  if (total + hireFee > cash + 0.004) q.errors.push(`Not enough cash: need $${c(total + hireFee).toFixed(2)} (machine plus ${t.operators} operators to recruit), have $${c(cash).toFixed(2)}.`);
  q.ok = !q.errors.length; return q;
}
export function buyMachine(s, { type } = {}) {
  if (s.ended) return err("The game is over.");
  const q = quoteMachine(s, type); if (q.error) return err(q.error); if (!q.ok) return err(q.errors[0]);
  const t = MACHINE[type], fx = ensureFactory(s);
  const m = { id: ++fx.mseq, type, name: `${t.name} ${fx.mseq}`, health: D.MAINT.startHealth, status: "idle", ageDays: 0, cost: q.total, deprec: 0, job: null, downDays: 0, pmToday: false, emergency: 0 };
  fx.machines.push(m); hire(s, "factory", t.operators);
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

// ---------- production queue ----------
// A machine works its queue first, front to back. With an empty queue it repeats its daily run (the standing job).
export const QUEUE_MAX = 5;
export function workOf(m) {
  const b = m.queue && m.queue[0]; if (b) return { juice: b.juice, qty: Math.min(b.qty - b.done, MACHINE[m.type].perDay), batch: b };
  return m.job ? { juice: m.job.juice, qty: m.job.qty, batch: null } : null;
}
export function queueBatch(s, { machine, juice, qty } = {}) {
  if (s.ended) return err("The game is over."); const m = findMachine(s, machine); if (!m) return err("Unknown machine."); if (!JUICE[juice]) return err("Unknown juice.");
  qty = Math.round(Number(qty)); if (!Number.isFinite(qty) || qty < 100) return err("A batch is at least 100 bottles.");
  m.queue = m.queue || []; if (m.queue.length >= QUEUE_MAX) return err(`The queue holds ${QUEUE_MAX} batches.`);
  const id = (fx => (fx.bseq = (fx.bseq || 0) + 1))(ensureFactory(s)); m.queue.push({ id, juice, qty, done: 0, added: s.day, started: null }); return ok({ batch: m.queue[m.queue.length - 1] });
}
export function dropBatch(s, { machine, id } = {}) {
  const m = findMachine(s, machine); if (!m) return err("Unknown machine."); const i = (m.queue || []).findIndex(b => b.id === Number(id)); if (i < 0) return err("Unknown batch.");
  m.queue.splice(i, 1); return ok();
}
export const queuedBottles = (s, juice) => ensureFactory(s).machines.reduce((a, m) => a + (m.queue || []).filter(b => b.juice === juice).reduce((x, b) => x + (b.qty - b.done), 0), 0);
export const batchDaysLeft = (s, m) => { const per = MACHINE[m.type].perDay * machineEfficiency(m); return Math.ceil((m.queue || []).reduce((a, b) => a + (b.qty - b.done), 0) / Math.max(1, per)); };

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
export function quoteRaw(s, { vendor, lines, terms = "cod", carrier = "hired" } = {}) {
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
    const r = RAWM[l.rid], unit = Math.round(r.cost * v.price * tm.price * eventMult(s, "cost") * priceLevel(s) * 10000) / 10000, goods = c(unit * l.qty);
    return { rid: l.rid, qty: l.qty, unit, goods, ship: c(v.rate * km * l.qty * r.space * L.logistics) };
  });
  const goods = c(out.reduce((a, l) => a + l.goods, 0)); let ship = c(v.fee * L.logistics + out.reduce((a, l) => a + l.ship, 0)), total = c(goods + ship), plan = null, dd = days; const errs = [];
  if (carrier === "own") {
    plan = planTrip(s, { km, space: out.reduce((a, l) => a + l.qty * RAWM[l.rid].space, 0), prep: v.prep });
    if (!plan.ok) errs.push(plan.error); else { dd = plan.days; ship = plan.fuel; total = c(goods + ship); }
  }
  const q = { vendor, terms, carrier, plan, km, days: dd, eta: s.day + dd, lines: out, goods, ship, total, dueDays: tm.days, errors: errs, reliability: v.reliability };
  const cash = balance(s.ledger, "cash"), now = c(ship + (tm.days === 0 ? goods : 0));        // freight is always paid now; goods only on COD
  if (now > cash + 0.004) q.errors.push(`Not enough cash: need $${now.toFixed(2)} now, have $${c(cash).toFixed(2)}.`);
  q.ok = !q.errors.length; return q;
}
export function createPR(s, spec) {
  const q = quoteRaw(s, spec); if (q.error) return err(q.error);
  const fx = ensureFactory(s), pr = { id: ++fx.prSeq, day: s.day, status: "pending", spec: { vendor: spec.vendor, terms: spec.terms || "cod", carrier: spec.carrier || "hired", lines: q.lines.map(l => ({ rid: l.rid, qty: l.qty })) }, estimate: q.total };
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
  const fx = ensureFactory(s), tm = TERM[q.terms], own = q.carrier === "own", haul = own ? dispatch(s, q.plan, "raw pickup") : 0, late = (rnd(s) > VENDOR[q.vendor].reliability ? 1 : 0) + haul + (scnDelayed(s) ? 1 : 0);
  const po = { id: ++fx.poSeq, vendor: q.vendor, terms: q.terms, lines: q.lines.map(l => ({ ...l })), goods: q.goods, ship: q.ship, placed: s.day, eta: q.eta + late, delayed: late > 0, carrier: q.carrier, due: tm.days ? s.day + tm.days : null };
  fx.pos.push(po);
  const lines = [{ acct: "transit", dr: q.goods }]; if (!own) lines.push({ acct: "delivery", dr: q.ship });
  if (tm.days === 0) lines.push({ acct: "cash", cr: own ? q.goods : q.total });
  else { if (!own) lines.push({ acct: "cash", cr: q.ship }); lines.push({ acct: "payables", cr: q.goods }); fx.payables.push({ id: ++fx.paySeq, po: po.id, amount: q.goods, due: po.due }); }
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
    trackArrival(s, po.vendor, !!po.delayed); if (po.delayed) mailPost(s, { from: VENDOR[po.vendor].name, subject: `Raw order #${po.id} was late`, body: "Production may stall if you ran short of materials.", goto: ["factory", "raw"], level: "warn" });
    post(s.ledger, s.day, `Raw delivery #${po.id}`, [{ acct: "inv_raw", dr: po.goods }, { acct: "transit", cr: po.goods }], "rawpo:" + po.id);
    for (const l of po.lines) { fx.raw.qty[l.rid] += l.qty; fx.raw.val[l.rid] = c(fx.raw.val[l.rid] + l.goods); }
    log(s, `Raw delivery #${po.id} arrived.`);
  }
  fx.pos = fx.pos.filter(p => p.eta > s.day);
  for (const m of fx.machines) m.pmToday = false;
}

function ensureFactoryHr(s, amount) { s.hr.paidTotal = c(s.hr.paidTotal + amount); }
export function factoryDay(s) {
  const fx = ensureFactory(s), cw = crew(s); fx.today = { made: {}, cost: 0, idle: 0, broke: [] };
  for (const m of fx.machines) {
    const t = MACHINE[m.type]; m.ageDays++;
    // depreciation: straight line on price + setup, never below zero book value
    trackProduction(s, t.perDay, 0);
    const dep = c(Math.min(m.cost / t.life, m.cost - m.deprec));
    if (dep > 0) { post(s.ledger, s.day, `Depreciation ${m.name}`, [{ acct: "depreciation", dr: dep }, { acct: "acc_deprec", cr: dep }], "dep:" + m.id + ":" + s.day); m.deprec = c(m.deprec + dep); }
    // downtime from an earlier breakdown
    if (m.downDays > 0) { m.downDays--; m.status = m.downDays > 0 ? "broken" : "idle"; if (m.downDays === 0) m.health = 80; continue; }
    const w = workOf(m); if (!w) { m.status = "idle"; continue; }
    const j = JUICE[w.juice], serviceLoss = m.pmToday ? t.pmDays : 0;
    const base = w.batch ? t.perDay : Math.min(w.qty, t.perDay), cap = Math.floor(base * machineEfficiency(m) * cw.out * (1 - serviceLoss)), n = Math.min(cap, w.batch ? w.batch.qty - w.batch.done : Infinity, bottlesPossible(s, j.id));   // a batch uses full machine capacity, so its last bottles do not trail off
    if (n <= 0) { m.status = "idle"; fx.today.idle++; if (m.pmToday) m.health = D.MAINT.restoreTo; continue; }
    let cost = 0;
    for (const [rid, q] of Object.entries(j.bom)) {
      const use = q * n, have = fx.raw.qty[rid], v = use >= have - 1e-9 ? fx.raw.val[rid] : c(fx.raw.val[rid] / have * use);
      fx.raw.qty[rid] = c(have - use); fx.raw.val[rid] = c(fx.raw.val[rid] - v); cost = c(cost + v);
    }
    for (const rid of Object.keys(fx.raw.qty)) if (fx.raw.qty[rid] < 1e-6) { fx.raw.qty[rid] = 0; }
    post(s.ledger, s.day, `Production ${m.name}: ${n} ${j.name}`, [{ acct: "inv_fg", dr: cost }, { acct: "inv_raw", cr: cost }], "prod:" + m.id + ":" + s.day);
    trackProduction(s, 0, n); fx.fg.qty[j.id] += n; fx.fg.val[j.id] = c(fx.fg.val[j.id] + cost);
    fx.today.made[j.id] = (fx.today.made[j.id] || 0) + n; fx.today.cost = c(fx.today.cost + cost);
    m.status = "running";
    if (w.batch) { w.batch.done += n; w.batch.started = w.batch.started ?? s.day; if (w.batch.done >= w.batch.qty) { m.queue.shift(); log(s, `${m.name} finished a batch of ${w.batch.qty.toLocaleString("en-US")} ${j.name}.`); } }
    if (!m.pmToday) m.health = c(Math.max(0, m.health - t.wear * cw.wear));
    // breakdown risk when health is under the threshold
    if (m.health < D.MAINT.breakdownBelow && rnd(s) < D.MAINT.breakdownChance) {
      m.downDays = D.MAINT.downMin + (rnd(s) < 0.5 ? 0 : D.MAINT.downMax - D.MAINT.downMin); m.status = "broken"; m.emergency++;
      const fee = c(t.pmCost * D.MAINT.emergencyMult); pay(s, "maintenance", fee, `Emergency repair of ${m.name}`, "emerg:" + m.id + ":" + s.day);
      fx.today.broke.push(m.id); mailPost(s, { from: "Factory manager", subject: `${m.name} broke down`, body: `Emergency repair cost $${fee.toFixed(2)}. The machine is down ${m.downDays} day(s). Service machines before their health drops below ${D.MAINT.breakdownBelow}%.`, goto: ["factory", "machines"], level: "bad" }); log(s, `${m.name} broke down. Emergency repair $${fee.toFixed(2)}, down ${m.downDays} day${m.downDays > 1 ? "s" : ""}.`);
    }
  }
  // conversion costs: operator wages, factory rent and utilities. On a day that made goods they are added to the cost of those goods; otherwise they are expenses.
  const labour = factoryPayroll(s), rent = factoryRent(s), util = factoryUtilities(s), madeUnits = Object.values(fx.today.made).reduce((a, b) => a + b, 0);
  const rec = (acct, amt, what) => { if (amt > 0) pay(s, madeUnits > 0 ? "inv_fg" : acct, amt, madeUnits > 0 ? `${what} added to goods made (day ${s.day})` : `${what} (idle factory, day ${s.day})`, "conv:" + acct + ":" + s.day); };
  rec("cogs_labor", labour, "Factory wages"); rec("rent", rent, "Factory rent"); rec("utilities", util, "Factory utilities");
  if (labour > 0) ensureFactoryHr(s, labour);
  if (madeUnits > 0) {
    const conv = c(labour + rent + util); fx.today.conv = conv; let left = conv; const ids = Object.keys(fx.today.made);
    ids.forEach((id, i) => { const part = i === ids.length - 1 ? left : c(conv * fx.today.made[id] / madeUnits); left = c(left - part); fx.fg.val[id] = c(fx.fg.val[id] + part); });
  }
  // supplier invoices due today
  for (const p of fx.payables.filter(x => x.due <= s.day)) {
    pay(s, "payables", p.amount, `Paid supplier invoice (raw order #${p.po})`, "inv:" + p.id);
    // pay() debits the account argument; for payables that reduces the liability, as intended
  }
  fx.payables = fx.payables.filter(x => x.due > s.day);
}
