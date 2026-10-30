// Pure retail engine: no DOM, no network. The simulation is the only place where money, stock and sales change.
// Time: the game runs in fixed steps of STEP seconds, so a run does not depend on the frame rate.
import { newLedger, post, balance, totals, round2 } from "./ledger.js";
import { getLocation, hasLocation } from "./locations.js";
import * as D from "./data.js";

export const STEP = 0.05;
export const FLUSH_STEPS = 20;                                    // sales are posted to the ledger once per simulated second
const c = round2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const err = error => ({ ok: false, error }), ok = (o = {}) => ({ ok: true, ...o });
export const PRODUCT = Object.fromEntries(D.PRODUCTS.map(p => [p.id, p]));
export const SUPPLIER = Object.fromEntries(D.SUPPLIERS.map(s => [s.id, s]));
const WEEK = [1, 0.9, 0.9, 1, 1.1, 1.35, 1.2];

export function rnd(s) {                                          // mulberry32 on s.rng
  s.rng = (s.rng + 0x6d2b79f5) | 0; let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------- setup ----------
export function cleanSetup(o = {}) {
  const n = (v, lim, def) => clamp(Math.round(Number(v)) || def, lim.min, lim.max);
  return {
    location: typeof o.location === "string" && hasLocation(o.location) && o.location !== "default" ? o.location : "id-medan-central",
    area: n(o.area, D.AREA, D.AREA.def), secPerDay: n(o.secPerDay, D.SECONDS_PER_DAY, D.SECONDS_PER_DAY.def),
    days: n(o.days, D.DAYS, D.DAYS.def), capital: n(o.capital, D.CAPITAL, D.CAPITAL.def),
    seed: Number.isFinite(o.seed) ? o.seed | 0 : Math.floor(Math.random() * 2147483648),
  };
}
export const rentPerM2 = loc => c(D.RENT_PER_M2 * getLocation(loc).rent);
export const dailyRent = (loc, area) => c(rentPerM2(loc) * area);
export const capacityOf = area => Math.floor(area * D.SPACE_PER_M2);

export function newGame(opts = {}) {
  const o = cleanSetup(opts);
  const s = { v: D.SAVE_VERSION, ...o, rng: o.seed | 0, day: 1, dayStep: 0, steps: 0, acc: 0, flushAcc: 0, stepsPerDay: Math.round(o.secPerDay / STEP), ended: null,
    ledger: newLedger(), qty: {}, val: {}, prices: {}, accum: {}, demand: {}, orders: [], orderSeq: 0, supIdx: {}, supStock: {}, overdraftDays: 0,
    today: null, history: [], stats: { prod: {}, units: 0, lost: 0, orders: 0 }, feed: [], feedSeq: 0, log: [] };
  for (const p of D.PRODUCTS) { s.qty[p.id] = 0; s.val[p.id] = 0; s.accum[p.id] = 0; s.prices[p.id] = priceFit(p, p.ref * 1.05); s.stats.prod[p.id] = { units: 0, rev: 0, cogs: 0, ship: 0, lost: 0 }; }
  for (const sp of D.SUPPLIERS) { s.supIdx[sp.id] = 1; s.supStock[sp.id] = { ...sp.stock }; }
  post(s.ledger, 1, "Owner capital", [{ acct: "cash", dr: o.capital }, { acct: "capital", cr: o.capital }], "open");
  let gift = 0;
  for (const p of D.PRODUCTS) { const v = c(p.cost * D.START_STOCK[p.id]); s.qty[p.id] = D.START_STOCK[p.id]; s.val[p.id] = v; gift = c(gift + v); }
  post(s.ledger, 1, "Opening stock (gift from owner)", [{ acct: "inventory", dr: gift }, { acct: "capital", cr: gift }], "open");
  s.startNetWorth = c(o.capital + gift);
  log(s, `Rented ${o.area} m² in ${getLocation(o.location).name} at $${rentPerM2(o.location).toFixed(2)} per m² per day.`);
  beginDay(s);
  return s;
}

const log = (s, text) => { s.log.push({ day: s.day, text }); if (s.log.length > 60) s.log.shift(); };
const priceFit = (p, v) => c(Math.round(v / p.step) * p.step);
export const priceBounds = p => ({ min: priceFit(p, p.ref * 0.5), max: priceFit(p, p.ref * 2.5) });

// ---------- derived numbers ----------
export const spaceUsed = s => D.PRODUCTS.reduce((a, p) => a + s.qty[p.id] * p.space, 0);
export const spaceIncoming = s => s.orders.reduce((a, o) => a + o.qty * PRODUCT[o.pid].space, 0);
export const spaceFree = s => capacityOf(s.area) - spaceUsed(s) - spaceIncoming(s);
export const inventoryUnits = s => D.PRODUCTS.reduce((a, p) => a + s.qty[p.id], 0);
export const timeLeft = s => (s.ended ? 0 : Math.max(0, (s.stepsPerDay - s.dayStep) * STEP));
export function dashboard(s) {
  const t = totals(s.ledger), cash = balance(s.ledger, "cash"), over = balance(s.ledger, "overdraft"), inv = balance(s.ledger, "inventory");
  const cap = capacityOf(s.area), used = spaceUsed(s);
  return { cash: c(cash), overdraft: c(over), revenue: t.revenue, expenses: t.costs, netProfit: c(t.revenue - t.costs), inventoryUnits: inventoryUnits(s), inventoryValue: c(inv),
    unitsSold: s.stats.units, pending: s.orders.length, pendingUnits: s.orders.reduce((a, o) => a + o.qty, 0), capacity: cap, used: Math.round(used), incoming: Math.round(spaceIncoming(s)),
    utilization: cap ? used / cap : 0, netWorth: c(cash - over + inv + balance(s.ledger, "transit")), balanced: t.balanced };
}

// ---------- demand ----------
function demandFor(s, p) {
  const L = getLocation(s.location), price = s.prices[p.id];
  const area = Math.pow(s.area / D.AREA.def, 0.3);
  const pf = clamp(Math.pow((p.ref * L.power) / price, p.elast * L.priceSens), 0.01, 2.5);
  return p.base * L.demand * L.cat[p.cat] * area * pf * (1 - 0.3 * L.competition) * WEEK[s.day % 7] * s.noise;
}
export const expectedDemand = (s, pid) => Math.round(demandFor(s, PRODUCT[pid]));

function beginDay(s) {
  s.dayStep = 0; s.flushAcc = 0;
  s.today = { day: s.day, rev: 0, cogs: 0, ship: 0, rent: 0, units: {}, lost: {}, arrivals: [] };
  for (const p of D.PRODUCTS) { s.today.units[p.id] = 0; s.today.lost[p.id] = 0; }
  s.noise = 0.9 + 0.2 * rnd(s);
  for (const sp of D.SUPPLIERS) {                                       // supplier prices drift, stock refills
    const i = s.supIdx[sp.id]; s.supIdx[sp.id] = Math.round(clamp(i + (rnd(s) - 0.5) * 0.05 + (1 - i) * 0.08, 0.9, 1.15) * 1000) / 1000;
    for (const p of D.PRODUCTS) s.supStock[sp.id][p.id] = Math.min(sp.stock[p.id], s.supStock[sp.id][p.id] + Math.ceil(sp.stock[p.id] * 0.25));
  }
  arrivals(s);
  for (const p of D.PRODUCTS) s.demand[p.id] = demandFor(s, p);
}

function arrivals(s) {
  const due = s.orders.filter(o => o.eta <= s.day);
  for (const o of due) {
    post(s.ledger, s.day, `Delivery #${o.id} from ${SUPPLIER[o.sup].name}`, [{ acct: "inventory", dr: o.goods }, { acct: "transit", cr: o.goods }], "order:" + o.id);
    s.qty[o.pid] += o.qty; s.val[o.pid] = c(s.val[o.pid] + o.goods);
    s.today.arrivals.push({ id: o.id, pid: o.pid, qty: o.qty });
    s.feed.push({ id: ++s.feedSeq, kind: "truck", pid: o.pid, qty: o.qty }); log(s, `Delivery #${o.id} arrived: ${o.qty.toLocaleString("en-US")} ${PRODUCT[o.pid].name}.`);
  }
  s.orders = s.orders.filter(o => o.eta > s.day);
  if (s.feed.length > 40) s.feed.splice(0, s.feed.length - 40);
}

// ---------- purchasing ----------
export function distanceKm(locId, sp) {
  const L = getLocation(locId); let best = Infinity;
  for (const h of sp.hubs) {
    if (h.local) { best = Math.min(best, 30); continue; }
    const R = 6371, r = Math.PI / 180, dLat = (h.lat - L.lat) * r, dLon = (h.lon - L.lon) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(L.lat * r) * Math.cos(h.lat * r) * Math.sin(dLon / 2) ** 2;
    best = Math.min(best, 2 * R * Math.asin(Math.sqrt(a)));
  }
  return Math.round(best);
}
export const discountFor = qty => { for (const [min, d] of D.BULK) if (qty >= min) return d; return 0; };
export const unitCost = (s, sp, pid) => c(PRODUCT[pid].cost * sp.price * s.supIdx[sp.id]);

export function quote(s, supId, pid, qty) {
  const sp = SUPPLIER[supId], p = PRODUCT[pid];
  if (!sp || !p) return err("Unknown supplier or product.");
  qty = Math.round(Number(qty));
  if (!Number.isFinite(qty) || qty < 1) return err("Enter a quantity of at least 1.");
  if (qty > D.MAX_QTY) return err(`The most you can order at once is ${D.MAX_QTY.toLocaleString("en-US")}.`);
  const km = distanceKm(s.location, sp), L = getLocation(s.location);
  const days = Math.max(1, Math.ceil(km / sp.speed + sp.prep));
  const disc = discountFor(qty), base = unitCost(s, sp, pid), unit = c(base * (1 - disc));
  const goods = c(unit * qty), ship = c((sp.fee + sp.rate * km * qty * p.space) * L.logistics), total = c(goods + ship);
  const q = { supplier: supId, pid, qty, km, days, eta: s.day + days, baseUnit: base, discount: disc, unit, goods, ship, total, space: qty * p.space,
    stock: s.supStock[supId][pid], reliability: sp.reliability, errors: [] };
  if (qty > q.stock) q.errors.push(`${sp.name} has only ${q.stock.toLocaleString("en-US")} ${p.name} in stock.`);
  const cash = balance(s.ledger, "cash");
  if (total > cash + 0.004) q.errors.push(`Not enough cash: need $${total.toFixed(2)}, have $${c(cash).toFixed(2)}.`);
  const free = spaceFree(s);
  if (q.space > free) q.errors.push(`Not enough storage: this needs ${Math.round(q.space).toLocaleString("en-US")} space, ${Math.max(0, Math.floor(free)).toLocaleString("en-US")} free (stock and shipments on the way count). Rent more space or order less.`);
  q.ok = !q.errors.length; return q;
}

// A purchase order can carry several products from one supplier. It is all-or-nothing: one quote, one payment, one shipping fee,
// and one shipment record per product (so each product's delivery shows on its own line).
export function quoteMulti(s, supId, lines) {
  const sp = SUPPLIER[supId];
  if (!sp) return err("Unknown supplier.");
  const seen = new Set(), items = [];
  for (const l of Array.isArray(lines) ? lines : []) {
    const qty = Math.round(Number(l && l.qty));
    if (!l || !PRODUCT[l.pid] || seen.has(l.pid) || !Number.isFinite(qty) || qty < 1) continue;
    seen.add(l.pid); items.push({ pid: l.pid, qty });
  }
  if (!items.length) return err("Choose a quantity for at least one product.");
  for (const l of items) if (l.qty > D.MAX_QTY) return err(`The most you can order of one product is ${D.MAX_QTY.toLocaleString("en-US")}.`);
  const km = distanceKm(s.location, sp), L = getLocation(s.location), days = Math.max(1, Math.ceil(km / sp.speed + sp.prep));
  const errors = [];
  const out = items.map(l => {
    const p = PRODUCT[l.pid], disc = discountFor(l.qty), baseUnit = unitCost(s, sp, l.pid), unit = c(baseUnit * (1 - disc)), goods = c(unit * l.qty);
    const ship = c(sp.rate * km * l.qty * p.space * L.logistics), stock = s.supStock[supId][l.pid];
    if (l.qty > stock) errors.push(`${sp.name} has only ${stock.toLocaleString("en-US")} ${p.name} in stock.`);
    return { pid: l.pid, qty: l.qty, discount: disc, baseUnit, unit, goods, ship, space: l.qty * p.space, stock };
  });
  const fee = c(sp.fee * L.logistics), goods = c(out.reduce((a, l) => a + l.goods, 0)), ship = c(fee + out.reduce((a, l) => a + l.ship, 0)), total = c(goods + ship);
  const space = out.reduce((a, l) => a + l.space, 0), cash = balance(s.ledger, "cash"), free = spaceFree(s);
  if (total > cash + 0.004) errors.push(`Not enough cash: need $${total.toFixed(2)}, have $${c(cash).toFixed(2)}.`);
  if (space > free) errors.push(`Not enough storage: this needs ${Math.round(space).toLocaleString("en-US")} space, ${Math.max(0, Math.floor(free)).toLocaleString("en-US")} free (stock and shipments on the way count). Rent more space or order less.`);
  return { supplier: supId, km, days, eta: s.day + days, lines: out, fee, goods, ship, total, space, reliability: sp.reliability, errors, ok: !errors.length };
}

export function placeOrders(s, { supplier, lines } = {}) {
  if (s.ended) return err("The game is over.");
  const q = quoteMulti(s, supplier, lines);
  if (q.error) return err(q.error);
  if (!q.ok) return err(q.errors[0]);
  const late = rnd(s) > SUPPLIER[supplier].reliability ? 1 : 0, made = [];
  q.lines.forEach((l, i) => {
    const o = { id: ++s.orderSeq, sup: supplier, pid: l.pid, qty: l.qty, unit: l.unit, goods: l.goods, ship: c(l.ship + (i === 0 ? q.fee : 0)), placed: s.day, eta: q.eta + late, delayed: late === 1, km: q.km };
    s.supStock[supplier][l.pid] -= l.qty; s.orders.push(o); s.stats.orders++; s.stats.prod[l.pid].ship = c(s.stats.prod[l.pid].ship + o.ship); made.push(o);
  });
  post(s.ledger, s.day, `Purchase order ${made.map(o => "#" + o.id).join(", ")} from ${SUPPLIER[supplier].name}`, [{ acct: "transit", dr: q.goods }, { acct: "delivery", dr: q.ship }, { acct: "cash", cr: q.total }], "order:" + made[0].id);
  s.today.ship = c(s.today.ship + q.ship);
  log(s, `Ordered ${made.map(o => `${o.qty.toLocaleString("en-US")} ${PRODUCT[o.pid].name}`).join(", ")} for $${q.total.toFixed(2)}. Arrives day ${q.eta + late}${late ? " (delayed a day)" : ""}.`);
  return ok({ orders: made, order: made[0], total: q.total, eta: q.eta + late });
}

export function placeOrder(s, { supplier, pid, qty } = {}) {
  if (s.ended) return err("The game is over.");
  const q = quote(s, supplier, pid, qty);
  if (q.error) return err(q.error);
  if (!q.ok) return err(q.errors[0]);
  const late = rnd(s) > SUPPLIER[supplier].reliability ? 1 : 0;
  const o = { id: ++s.orderSeq, sup: supplier, pid, qty: q.qty, unit: q.unit, goods: q.goods, ship: q.ship, placed: s.day, eta: q.eta + late, delayed: late === 1, km: q.km };
  post(s.ledger, s.day, `Order #${o.id}: ${o.qty} ${PRODUCT[pid].name} from ${SUPPLIER[supplier].name}`, [{ acct: "transit", dr: q.goods }, { acct: "delivery", dr: q.ship }, { acct: "cash", cr: q.total }], "order:" + o.id);
  s.supStock[supplier][pid] -= o.qty; s.orders.push(o); s.stats.orders++; s.today.ship = c(s.today.ship + q.ship); s.stats.prod[pid].ship = c(s.stats.prod[pid].ship + q.ship);
  log(s, `Ordered ${o.qty.toLocaleString("en-US")} ${PRODUCT[pid].name} for $${q.total.toFixed(2)}. Arrives day ${o.eta}${late ? " (delayed a day)" : ""}.`);
  return ok({ order: o, total: q.total });
}
export function orderStatus(s, o) {
  if (o.eta === s.day) return "Arriving today";
  return o.delayed ? "Delayed" : s.day === o.placed ? "Processing" : "In transit";
}

// ---------- prices ----------
export function setPrice(s, pid, price) {
  const p = PRODUCT[pid]; if (!p) return err("Unknown product.");
  const b = priceBounds(p); price = priceFit(p, clamp(Number(price) || p.ref, b.min, b.max));
  s.prices[pid] = price; for (const q of D.PRODUCTS) s.demand[q.id] = demandFor(s, q); return ok({ price });
}
export const adjustPrice = (s, pid, dir) => setPrice(s, pid, s.prices[pid] + dir * PRODUCT[pid].step);
export const margin = (s, pid) => { const q = s.qty[pid], avg = q ? s.val[pid] / q : PRODUCT[pid].cost; return { avgCost: c(avg), unit: c(s.prices[pid] - avg), pct: s.prices[pid] ? (s.prices[pid] - avg) / s.prices[pid] : 0 }; };

// ---------- renting more space ----------
export function spaceQuote(s, extra) {
  extra = Math.round(Number(extra));
  if (!Number.isFinite(extra) || extra < 1) return err("Choose how many m² to add.");
  const room = D.AREA.max - s.area;
  const q = { extra, newArea: s.area + extra, rate: rentPerM2(s.location), errors: [] };
  q.extraRent = dailyRent(s.location, extra); q.newRent = dailyRent(s.location, q.newArea); q.newCapacity = capacityOf(q.newArea); q.addedCapacity = capacityOf(q.newArea) - capacityOf(s.area);
  if (extra > room) q.errors.push(room > 0 ? `The most you can add is ${room} m² (shops are at most ${D.AREA.max} m²).` : `Your shop is already at the ${D.AREA.max} m² limit.`);
  q.ok = !q.errors.length; return q;
}
export function rentMoreSpace(s, extra) {
  if (s.ended) return err("The game is over.");
  const q = spaceQuote(s, extra);
  if (q.error) return err(q.error);
  if (!q.ok) return err(q.errors[0]);
  s.area = q.newArea;
  for (const p of D.PRODUCTS) s.demand[p.id] = demandFor(s, p);
  log(s, `Rented ${q.extra} m² more. The shop is now ${s.area} m². Rent is $${q.newRent.toFixed(2)} per day.`);
  return ok({ area: s.area, rent: q.newRent });
}

// ---------- simulation ----------
function flush(s) {
  if (!s.pend) return;
  let rev = 0, cost = 0;
  for (const p of D.PRODUCTS) { const f = s.pend[p.id]; if (f && f.units) { rev = c(rev + f.rev); cost = c(cost + f.cogs); } }
  if (rev > 0) post(s.ledger, s.day, "Sales", [{ acct: "cash", dr: rev }, { acct: "sales", cr: rev }], "sales:" + s.steps);
  if (cost > 0) post(s.ledger, s.day, "Cost of goods sold", [{ acct: "cogs", dr: cost }, { acct: "inventory", cr: cost }], "sales:" + s.steps);
  s.pend = null;
}

function stepOnce(s) {
  const n = s.stepsPerDay, w = Math.sin(Math.PI * (s.dayStep + 0.5) / n) * Math.PI / 2;
  s.pend = s.pend || {};
  for (const p of D.PRODUCTS) {
    s.accum[p.id] += s.demand[p.id] * w / n;
    let want = Math.floor(s.accum[p.id]); if (want < 1) continue;
    s.accum[p.id] -= want;
    const have = s.qty[p.id], q = Math.min(want, have), lost = want - q;
    if (lost) { s.today.lost[p.id] += lost; s.stats.prod[p.id].lost += lost; s.stats.lost += lost; }
    if (q < 1) continue;
    const cost = q === have ? s.val[p.id] : c(s.val[p.id] / have * q), rev = c(q * s.prices[p.id]);
    s.qty[p.id] -= q; s.val[p.id] = c(s.val[p.id] - cost);
    const f = (s.pend[p.id] = s.pend[p.id] || { units: 0, rev: 0, cogs: 0 }); f.units += q; f.rev = c(f.rev + rev); f.cogs = c(f.cogs + cost);
    s.today.units[p.id] += q; s.today.rev = c(s.today.rev + rev); s.today.cogs = c(s.today.cogs + cost);
    const sp = s.stats.prod[p.id]; sp.units += q; sp.rev = c(sp.rev + rev); sp.cogs = c(sp.cogs + cost); s.stats.units += q;
    s.feed.push({ id: ++s.feedSeq, kind: "sale", pid: p.id, qty: q });
  }
  if (s.feed.length > 40) s.feed.splice(0, s.feed.length - 40);
  s.dayStep++; s.steps++;
  if (++s.flushAcc >= FLUSH_STEPS) { s.flushAcc = 0; flush(s); }
  if (s.dayStep >= s.stepsPerDay) closeDay(s);
}

function closeDay(s) {
  flush(s);
  const day = s.day, before = balance(s.ledger, "cash");
  const rent = dailyRent(s.location, s.area);
  const pay = Math.max(0, Math.min(before, rent)), over = c(rent - pay);
  const lines = [{ acct: "rent", dr: rent }];
  if (pay > 0) lines.push({ acct: "cash", cr: pay }); if (over > 0) lines.push({ acct: "overdraft", cr: over });
  post(s.ledger, day, `Rent for day ${day}`, lines, "rent:" + day); s.today.rent = rent;
  const od = balance(s.ledger, "overdraft"), cashNow = balance(s.ledger, "cash"), repay = c(Math.min(od, Math.max(0, cashNow)));
  if (repay > 0) post(s.ledger, day, "Overdraft repaid from cash", [{ acct: "overdraft", dr: repay }, { acct: "cash", cr: repay }]);
  s.overdraftDays = balance(s.ledger, "overdraft") > 0 ? s.overdraftDays + 1 : 0;
  const net = c(s.today.rev - s.today.cogs - s.today.ship - rent);
  const rep = { day, revenue: s.today.rev, cogs: s.today.cogs, shipping: s.today.ship, rent, net, units: { ...s.today.units }, lost: { ...s.today.lost }, arrivals: s.today.arrivals, cash: c(balance(s.ledger, "cash")), inventoryValue: c(balance(s.ledger, "inventory")) };
  s.history.push(rep); if (s.history.length > 90) s.history.shift(); s.lastReport = rep;
  log(s, `Day ${day} closed: revenue $${rep.revenue.toFixed(0)}, net $${net.toFixed(0)}.`);
  if (s.overdraftDays >= 3) { s.ended = { reason: "bankrupt", day }; return; }
  if (day >= s.days) { s.ended = { reason: "completed", day }; return; }
  s.day++; beginDay(s);
}

export function tick(s, dt) {
  if (s.ended) return 0;
  s.acc += Math.max(0, dt); let n = 0;
  while (s.acc >= STEP - 1e-9 && !s.ended) { s.acc -= STEP; stepOnce(s); n++; }
  return n;
}
export function advanceSteps(s, n) { while (n-- > 0 && !s.ended) stepOnce(s); }

// ---------- integrity, report, save ----------
export function reconcile(s) {
  const t = totals(s.ledger), val = c(Object.values(s.val).reduce((a, v) => a + v, 0)), problems = [];
  if (!t.balanced) problems.push("Ledger is not balanced.");
  if (Math.abs(val - balance(s.ledger, "inventory")) > 0.05) problems.push("Inventory value differs from the ledger.");
  const tr = c(s.orders.reduce((a, o) => a + o.goods, 0)); if (Math.abs(tr - balance(s.ledger, "transit")) > 0.05) problems.push("Goods in transit differ from the ledger.");
  for (const p of D.PRODUCTS) if (s.qty[p.id] < 0) problems.push(`${p.name} stock is negative.`);
  if (spaceUsed(s) > capacityOf(s.area) + 0.5) problems.push("Storage is over capacity.");
  return { ok: !problems.length, problems };
}
export function finalReport(s) {
  const d = dashboard(s); let best = null;
  const rows = D.PRODUCTS.map(p => { const st = s.stats.prod[p.id]; return { id: p.id, name: p.name, units: st.units, revenue: st.rev, cogs: st.cogs, shipping: st.ship, profit: c(st.rev - st.cogs - st.ship), lost: st.lost, left: s.qty[p.id], leftValue: c(s.val[p.id]) }; });
  for (const r of rows) if (!best || r.profit > best.profit) best = r;
  const gain = s.startNetWorth ? (d.netWorth - s.startNetWorth) / s.startNetWorth : 0;
  const rating = s.ended && s.ended.reason === "bankrupt" ? "-" : gain >= 1 ? "S" : gain >= 0.5 ? "A" : gain >= 0.2 ? "B" : gain >= 0 ? "C" : "D";
  return { ...d, rows, best: best && best.units ? best : null, gain, rating, days: s.day, reason: s.ended ? s.ended.reason : null, rent: c(balance(s.ledger, "rent")), shipping: c(balance(s.ledger, "delivery")) };
}
export const serialize = s => JSON.stringify(s);
export function validateSave(raw) {
  let o; try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return err("Save file is not valid JSON."); }
  if (!o || typeof o !== "object") return err("Save file is empty.");
  if (o.v !== D.SAVE_VERSION) return { ok: false, old: true, error: "This save is from an older version of the game. The game changed completely, so old saves cannot be used. Start a new game." };
  for (const k of ["ledger", "qty", "val", "prices", "orders", "stats"]) if (!o[k] || typeof o[k] !== "object") return err("Save file is damaged.");
  if (!Number.isFinite(o.day) || !Number.isFinite(o.days) || !Number.isFinite(o.area)) return err("Save file is damaged.");
  for (const p of D.PRODUCTS) if (!Number.isFinite(o.qty[p.id]) || o.qty[p.id] < 0) return err("Save file is damaged.");
  const r = reconcile(o); if (!r.ok) return err("Save file does not reconcile: " + r.problems[0]);
  return ok({ state: o });
}

// ---------- site preview (used by the location picker; changes nothing) ----------
export function siteInfo(locId, area = D.AREA.def) {
  const L = getLocation(locId), a = Math.pow(area / D.AREA.def, 0.3); let units = 0, revenue = 0;
  for (const p of D.PRODUCTS) { const u = p.base * L.demand * L.cat[p.cat] * a * Math.pow((p.ref * L.power) / (p.ref * 1.05), p.elast * L.priceSens) * (1 - 0.3 * L.competition); units += u; revenue += u * p.ref * 1.05; }
  const rent = dailyRent(locId, area);
  return { rentM2: rentPerM2(locId), rent, units: Math.round(units), revenue: Math.round(revenue), competition: L.competition,
    suppliers: D.SUPPLIERS.map(sp => { const km = distanceKm(locId, sp); return { id: sp.id, name: sp.name, km, days: Math.max(1, Math.ceil(km / sp.speed + sp.prep)) }; }) };
}
export const siteLabel = id => getLocation(id).name;
