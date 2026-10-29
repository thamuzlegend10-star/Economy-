// Pure game engine: no DOM, no network. All rules live here so they can be tested in Node.
import * as D from "./data.js";
import * as LOC from "./locations.js";
import { newLedger, post, balance, totals, round2, OPEX, ACCOUNTS } from "./ledger.js";

const { DAY_LEN } = D;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PRODUCT = Object.fromEntries(D.PRODUCTS.map(p => [p.id, p]));
const SUPPLIER = Object.fromEntries(D.SUPPLIERS.map(p => [p.id, p]));
export const product = id => PRODUCT[id];
export const supplier = id => SUPPLIER[id];

// ---------- deterministic RNG (state lives in the save) ----------
export function rnd(s) {
  s.rng = (s.rng + 0x6D2B79F5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const round3 = n => Math.round(n * 1000) / 1000;
const rint = (s, a, b) => a + Math.floor(rnd(s) * (b - a + 1));
const pickOf = (s, arr) => arr[Math.floor(rnd(s) * arr.length)];

const fail = error => ({ ok: false, error });
const okr = (extra = {}) => ({ ok: true, ...extra });

// ---------- new game ----------
export function newGame(opts = {}) {
  const diff = D.DIFFICULTY[opts.difficulty] || D.DIFFICULTY.normal;
  const mode = opts.mode === "infinite" ? "infinite" : "standard";
  const capital = clamp(Math.round(Number(opts.capital) || diff.capital), 300, 20000);
  const dayLimit = mode === "standard" ? clamp(Math.round(Number(opts.dayLimit) || 30), 5, 120) : null;
  const s = {
    v: D.SAVE_VERSION, loc: LOC.hasLocation(opts.location) ? opts.location : "default", mode, difficulty: opts.difficulty in D.DIFFICULTY ? opts.difficulty : "normal", dayLimit, capital,
    rng: (Number.isFinite(opts.seed) ? opts.seed : Math.floor(Math.random() * 2 ** 31)) | 0,
    day: 1, clock: 0, phase: "open", ended: null,
    ledger: newLedger(),
    stock: {}, val: {}, prices: {}, shelfTarget: {},
    orders: [], doneOrders: [], tasks: [], taskSeq: 0, orderSeq: 0,
    staff: [], candidates: [], staffSeq: 0,
    upgrades: { shelves: 0, racks: 0, counter: 0, dock: 0, signage: 0 },
    campaigns: [], campSeq: 0, supIdx: { freshfarm: 1, metro: 1, quickship: 1 }, supRec: { freshfarm: { n: 0, late: 0 }, metro: { n: 0, late: 0 }, quickship: { n: 0, late: 0 } },
    budget: { revenue: 0, expenses: 0 }, noise: 1, rivals: [], shareLast: 1, stockoutRate: 0, invoices: [], invSeq: 0, branches: [], branchSeq: 0, forecastToday: null, autoDeposit: true,
    loans: [], loanSeq: 0, lastBailoutDay: -99, distressDays: 0,
    customers: [], custSeq: 0, spawnAcc: 0, autoT: 0,
    rep: 50, sat: 60,
    events: { active: [], todayText: [] },
    today: null, dayStart: null, history: [], archive: { days: 0, revenue: 0, profit: 0 }, lastReport: null,
    log: [], decisions: [], milestones: [],
    stats: { customers: 0, totalSales: 0, units: {}, tookLoan: false, bestDay: 0, unitsSold: 0, fcErr: 0, fcDays: 0, budgetDays: 0, budgetHit: 0 },
    cmdSeen: [], derived: null,
  };
  for (const p of D.PRODUCTS) { s.stock[p.id] = { wh: 0, shelf: 0 }; s.val[p.id] = 0; s.prices[p.id] = round2(p.ref * 1.12); s.shelfTarget[p.id] = 0; }
  // Opening balance: owner capital funds bank + till + a small starter stock.
  const till = 150;
  post(s.ledger, 1, "Owner capital", [{ acct: "cash", dr: till }, { acct: "bank", dr: capital - till }, { acct: "capital", cr: capital }], "open");
  const starter = { apple: 20, bread: 10, milk: 10, water: 20 };
  let starterVal = 0;
  for (const [id, n] of Object.entries(starter)) {
    const v = round2(PRODUCT[id].cost * n);
    s.stock[id].wh = n - 8 > 0 ? n - 8 : 0; s.stock[id].shelf = n - s.stock[id].wh; s.val[id] = v; starterVal += v;
  }
  post(s.ledger, 1, "Starter inventory (gift from owner)", [{ acct: "inventory", dr: round2(starterVal) }, { acct: "capital", cr: round2(starterVal) }], "open");
  s.startNetWorth = round2(capital + starterVal);
  refreshCandidates(s);
  s.rivals = makeRivals(s, s.rng);
  beginDay(s, true);
  logMsg(s, "info", "Welcome! Order stock from a supplier, restock your shelves, and open for customers.");
  updateDerived(s);
  return s;
}

// ---------- derived values / helpers ----------
export const unitsTotal = (s, pid) => s.stock[pid].wh + s.stock[pid].shelf;
export const shelfCap = s => D.BASE_SHELF_CAP + D.SHELF_PER_LVL * s.upgrades.shelves;
export const whCap = s => D.BASE_WH_CAP + D.WH_PER_LVL * s.upgrades.racks;
export const shelfUsed = s => Object.values(s.stock).reduce((a, x) => a + x.shelf, 0);
export const whUsed = s => Object.values(s.stock).reduce((a, x) => a + x.wh, 0);
export const pendingRestock = s => s.tasks.reduce((a, t) => a + (t.qty - t.done), 0);
export const incomingUnits = s => s.orders.reduce((a, o) => a + o.units, 0);
export const isUnlocked = (s, pid) => s.day >= PRODUCT[pid].unlockDay;
export const incomingOf = (s, pid) => s.orders.reduce((a, o) => a + (o.lines.find(l => l.pid === pid)?.qty || 0), 0);
export const avgCost = (s, pid) => { const n = unitsTotal(s, pid); return n > 0 ? s.val[pid] / n : 0; };
const bal = (s, a) => balance(s.ledger, a);

export function updateDerived(s) {
  const t = totals(s.ledger);
  const debt = round2(bal(s, "loan") + bal(s, "overdraft"));
  s.derived = {
    cash: bal(s, "cash"), bank: bal(s, "bank"), debt, loans: bal(s, "loan"), overdraft: bal(s, "overdraft"), payables: bal(s, "payables"),
    inventory: bal(s, "inventory"), equipment: bal(s, "equipment"), transit: bal(s, "transit"),
    assets: t.assets, netWorth: round2(t.assets - t.liabilities), balanced: t.balanced,
    liquid: round2(bal(s, "cash") + bal(s, "bank")),
  };
  return s.derived;
}

const inflation = s => 1 + 0.0015 * (s.day - 1);
const diffOf = s => D.DIFFICULTY[s.difficulty];
export function unitCost(s, sup, pid, qtyTotal = 0) {
  const ev = s.events.active.find(e => e.id === "market" && e.pid === pid);
  let c = PRODUCT[pid].cost * sup.mult * diffOf(s).cost * inflation(s) * (ev ? 1.25 : 1) * ((s.supIdx && s.supIdx[sup.id]) || 1);
  if (qtyTotal >= sup.bulkAt) c *= 1 - sup.bulkOff;
  return round2(Math.max(0.05, c));
}
export const locOf = s => LOC.getLocation(s.loc);
export const rent = s => round2(diffOf(s).rent * inflation(s) * locOf(s).rent);
export const utilities = s => round2((diffOf(s).utilities + 3 * Object.values(s.upgrades).reduce((a, b) => a + b, 0)) * inflation(s) * locOf(s).utilities);
// supplier terms in this location: remote sites pay more and wait longer; some suppliers do not serve every place
export const supplierAvailable = (s, sup) => !locOf(s).noSupplier.includes(sup.id);
export const supFee = (s, sup) => round2(sup.fee * locOf(s).logistics);
export const supLead = (s, sup) => round2(sup.lead * locOf(s).logistics);
export const wagesPerDay = s => round2(s.staff.reduce((a, x) => a + x.wage, 0));

function logMsg(s, kind, text) {
  s.log.push({ day: s.day, kind, text });
  if (s.log.length > 80) s.log.splice(0, s.log.length - 80);
}
function decide(s, text) { s.decisions.push(`Day ${s.day}: ${text}`); if (s.decisions.length > 60) s.decisions.shift(); }

// Money out: from bank, then till cash, then overdraft. Returns the split.
function payOut(s, expAcct, amount, memo, allowOverdraft = true) {
  amount = round2(amount);
  if (amount <= 0) return { bank: 0, cash: 0, over: 0 };
  let rest = amount;
  const split = { bank: 0, cash: 0, over: 0 };
  const take = (acct, key) => {
    const have = Math.max(0, bal(s, acct));
    const n = round2(Math.min(have, rest));
    if (n > 0) { post(s.ledger, s.day, memo, [{ acct: expAcct, dr: n }, { acct, cr: n }]); split[key] = n; rest = round2(rest - n); }
  };
  take("bank", "bank"); take("cash", "cash");
  if (rest > 0 && allowOverdraft) {
    post(s.ledger, s.day, memo + " (overdraft)", [{ acct: expAcct, dr: rest }, { acct: "overdraft", cr: rest }]);
    split.over = rest;
  }
  return split;
}

// ---------- day lifecycle ----------
function snapshotDayStart(s) { s.dayStart = { ...s.ledger.bal }; }
function beginDay(s, first = false) {
  s.clock = 0; s.phase = "open"; s.spawnAcc = 0;
  s.today = { customers: 0, served: 0, units: {}, lost: { stockout: 0, price: 0, patience: 0 }, lostBy: {}, waitSum: 0, waitN: 0, events: [], notes: [] };
  s.events.todayText = [];
  // age events
  s.events.active = s.events.active.map(e => ({ ...e, daysLeft: e.daysLeft - (first ? 0 : 1) })).filter(e => e.daysLeft > 0);
  if (!first) rollEvents(s);
  s.campaigns = s.campaigns.filter(c => c.start + c.days > s.day);
  if (!first) stepRivals(s);
  s.noise = round3(0.92 + 0.16 * rnd(s));                // hidden day-to-day variation: forecasts cannot see it
  if (!first) for (const sp of D.SUPPLIERS) { const cur = s.supIdx[sp.id]; s.supIdx[sp.id] = round3(clamp(cur + (rnd(s) - 0.5) * 2 * D.SUP_DRIFT.step + (1 - cur) * 0.08, D.SUP_DRIFT.min, D.SUP_DRIFT.max)); }
  { const mid = demandBase(s, s.day, s.rep), e = 0.10; s.forecastToday = { day: s.day, expected: Math.round(mid), low: Math.round(mid * (1 - e)), high: Math.round(mid * (1 + e)) }; }
  for (const e of s.events.active) { const def = D.EVENTS.find(x => x.id === e.id); s.events.todayText.push(e.text || def.text); }
  for (const t of s.events.todayText) logMsg(s, "event", t);
  const nowUnlocked = D.PRODUCTS.filter(p => p.unlockDay === s.day && s.day > 1);
  for (const p of nowUnlocked) logMsg(s, "info", `New product unlocked: ${p.name}.`);
  if (first) snapshotDayStart(s);
  s.today.openLiquid = s.derived ? s.derived.liquid : round2(bal(s, "cash") + bal(s, "bank"));
}

function rollEvents(s) {
  const f = diffOf(s).events;
  const add = (e) => { s.events.active.push(e); s.today.events.push(e.id); };
  if (rnd(s) < 0.08 * f) add({ id: "festival", daysLeft: 1 });
  else if (rnd(s) < 0.10 * f) add({ id: "rain", daysLeft: 1 });
  if (rnd(s) < 0.06 * f) { const sup = pickOf(s, D.SUPPLIERS); add({ id: "delay", daysLeft: 2, sup: sup.id, text: `${sup.name} has road trouble: new orders take 60% longer to arrive for 2 days.` }); }
  if (rnd(s) < 0.08 * f) { const p = pickOf(s, D.PRODUCTS.filter(x => x.unlockDay <= s.day)); add({ id: "market", daysLeft: 3, pid: p.id, text: `Wholesale price of ${p.name} is +25% for 3 days.` }); }
  if (rnd(s) < 0.05 * f) add({ id: "repair", daysLeft: 1, amount: rint(s, 30, 80), text: "A fridge broke. The repair bill is charged at closing." });
}
const eventDemand = s => s.events.active.reduce((m, e) => m * (D.EVENTS.find(x => x.id === e.id).demand || 1), 1);
const DOW = [1.0, 0.9, 0.9, 1.0, 1.1, 1.35, 1.2];

// Customers that will visit. `known` leaves out the hidden day-to-day noise and today's random events: that is what a
// forecast can honestly see. Campaign lift is only counted for days the campaign is actually running.
export function campaignLift(s, day = s.day) {
  let lift = 0;
  for (const c of s.campaigns) if (day >= c.start && day < c.start + c.days) lift += c.lift;
  return Math.min(0.6, lift);
}
// ---------- rivals ----------
// Rival shops are real entities: each has a price level, quality, stock availability and promotions that change daily.
// The player's share of the local market is attractiveness / (attractiveness + all rivals), so what you do changes it.
const RIVAL_NAMES = ["Corner Mart", "Daily Basket", "Fresh Stop", "Value Hub", "Prime Grocer", "Lucky Store", "Town Pantry", "Quick Cart"];
const RIVAL_KINDS = { discounter: { price: 0.97, quality: 0.9, label: "Discounter" }, balanced: { price: 1.12, quality: 1.0, label: "Balanced" }, premium: { price: 1.3, quality: 1.15, label: "Premium" } };
export const RIVAL_KIND = RIVAL_KINDS;
function makeRivals(s, seed) {
  const l = locOf(s); if (!(l.competition > 0)) return [];
  let st = seed | 0; const r = () => { st = (st + 0x6D2B79F5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };   // own stream: never advances the game rng
  const n = clamp(Math.round(l.competition * 4), 1, 4), total = 0.3 * l.competition / (1 - 0.3 * l.competition), out = [];
  const kinds = Object.keys(RIVAL_KINDS), names = [...RIVAL_NAMES];
  for (let i = 0; i < n; i++) {
    const kind = kinds[Math.floor(r() * kinds.length)], k = RIVAL_KINDS[kind];
    out.push({ id: i + 1, name: names.splice(Math.floor(r() * names.length), 1)[0], kind, base: round3(total / n), price: round3(k.price * (0.97 + 0.06 * r())), quality: k.quality, avail: 1, promo: 0 });
  }
  return out;
}
export const priceIndex = s => {
  const ps = D.PRODUCTS.filter(p => isUnlocked(s, p.id)); let a = 0, b = 0;
  for (const p of ps) { a += p.pop * s.prices[p.id] / p.ref; b += p.pop; }
  return b ? a / b : 1.12;
};
const rivalPull = (s, r) => {
  const l = locOf(s), price = r.price * (r.promo > 0 ? 0.9 : 1);
  return r.base * r.quality * r.avail * Math.pow(1.12 / price, 2 * l.priceSens);
};
function playerPull(s, rep) {
  const l = locOf(s), stockK = 1 - 0.5 * clamp(s.stockoutRate || 0, 0, 1);
  return Math.pow(clamp(rep / 50, 0.5, 1.6), 0.8) * Math.pow(1.12 / priceIndex(s), 2 * l.priceSens) * stockK;
}
export function marketShare(s, rep = s.rep) {
  if (!s.rivals || !s.rivals.length) return 1;
  const me = playerPull(s, rep), them = s.rivals.reduce((a, r) => a + rivalPull(s, r), 0);
  return clamp(me / (me + them), 0.1, 1);
}
// Each morning rivals react: undercut a cheaper player, drift back toward their usual price, run short promotions, sometimes run low on stock.
function stepRivals(s) {
  if (!s.rivals.length) return;
  const mine = priceIndex(s), l = locOf(s);
  for (const r of s.rivals) {
    const k = RIVAL_KINDS[r.kind], floor = k.price * 0.88, ceil = k.price * 1.12;
    if (r.promo > 0) r.promo--;
    if (mine < r.price - 0.08 && rnd(s) < 0.5) r.price = round3(Math.max(floor, r.price - 0.03));   // matches your lower prices
    else if (rnd(s) < 0.4) r.price = round3(clamp(r.price + (k.price - r.price) * 0.3, floor, ceil));
    if (r.promo === 0 && rnd(s) < 0.05 + 0.06 * l.competition) r.promo = 2;
    r.avail = round3(rnd(s) < 0.1 ? 0.7 : 1);
  }
}
function demandBase(s, day, rep) {
  const d = diffOf(s);
  const l = locOf(s);
  return 48 * d.demand * l.demand * marketShare(s, rep) * (0.6 + 0.9 * rep / 100) * (1 + campaignLift(s, day)) * DOW[day % 7] * (1 + Math.min(0.5, day * 0.004));
}
export function expectedCustomers(s) { return demandBase(s, s.day, s.rep) * eventDemand(s) * (s.noise || 1); }

// Planning signal for the next days. Honest about uncertainty: a band, not a promise.
export function forecast(s, days = 3) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = (s.phase === "report" ? s.day + 1 : s.day) + i;
    const mid = demandBase(s, day, s.rep);
    const err = 0.10 + 0.04 * i;                       // the further ahead, the wider the band
    out.push({ day, expected: Math.round(mid), low: Math.round(mid * (1 - err)), high: Math.round(mid * (1 + err)), campaign: campaignLift(s, day) > 0 });
  }
  return out;
}
export const itemsPerCustomer = s => (s.stats.customers >= 20 && s.stats.unitsSold > 0 ? s.stats.unitsSold / s.stats.customers : 1.5);
// Rough units of each product the shop can expect to sell on an average day at the forecast traffic.
export function unitDemand(s, day = s.day) {
  const avail = D.PRODUCTS.filter(p => PRODUCT[p.id].unlockDay <= day);
  const w = avail.map(p => prodWeight(s, p)), tot = w.reduce((a, b) => a + b, 0) || 1;
  const units = demandBase(s, day, s.rep) * itemsPerCustomer(s), out = {};
  avail.forEach((p, i) => { out[p.id] = Math.round(units * w[i] / tot * 10) / 10; });
  return out;
}

// ---------- site selection: estimates for a location BEFORE starting (same coefficients the simulation uses) ----------
// These are estimates with a range, not promises. Assumptions: day-1 reputation, no staff, about 1.5 items per customer.
export function siteEstimate(locId, difficulty = "normal") {
  const l = LOC.getLocation(locId), d = D.DIFFICULTY[difficulty] || D.DIFFICULTY.normal;
  const customers = 48 * d.demand * l.demand * (1 - 0.3 * l.competition) * (0.6 + 0.9 * 0.5);
  const prods = D.PRODUCTS.filter(p => p.unlockDay <= 1), w = prods.map(p => p.pop * l.cat[p.cat]), tw = w.reduce((a, b) => a + b, 0);
  const price = prods.reduce((a, p, i) => a + p.ref * 1.12 * w[i] / tw, 0), cost = prods.reduce((a, p, i) => a + p.cost * d.cost * 1.0 * w[i] / tw, 0);
  const buyRate = Math.min(1, Math.pow(1 / 1.12 * 1.15 * l.power, 2 * l.priceSens)) * 0.85;
  const perCustomer = 1.5 * buyRate * price, marginPer = 1.5 * buyRate * (price - cost);
  const fixed = round2(d.rent * l.rent + (d.utilities * l.utilities));
  const breakEven = marginPer > 0 ? Math.ceil(fixed / marginPer) : null;
  return { customers: [Math.round(customers * 0.75), Math.round(customers * 1.25)], revenue: [round2(customers * perCustomer * 0.75), round2(customers * perCustomer * 1.25)],
    fixedPerDay: fixed, breakEvenCustomers: breakEven, breakEvenRatio: breakEven ? round2(breakEven / Math.max(1, customers)) : null,
    assumptions: "Day-1 reputation, no staff, about 1.5 items per customer, shop prices 12% above fair. Real results vary with events, prices and service." };
}
// Corner-shop suitability 0-100 with its parts, so the score can be explained line by line.
export function siteSuitability(locId) {
  const l = LOC.getLocation(locId), c = clamp;
  const parts = [
    { name: "Customer demand", w: 35, v: c(l.demand * (1 - 0.3 * l.competition) / 1.6, 0, 1), why: `demand x${l.demand}, after rivals take ${Math.round(l.competition * 30)}%` },
    { name: "Running costs", w: 25, v: c(1 - (l.rent * 0.7 + l.wage * 0.3 - 0.4) / 2.4, 0, 1), why: `rent x${l.rent}, wages x${l.wage}` },
    { name: "Competition", w: 15, v: c(1 - l.competition, 0, 1), why: `rival pressure ${Math.round(l.competition * 100)}%` },
    { name: "Logistics", w: 10, v: c(1 - (l.logistics - 0.8) / 0.6, 0, 1), why: `delivery fee and time x${l.logistics}${l.noSupplier.length ? ", fewer suppliers" : ""}` },
    { name: "Purchasing power", w: 15, v: c(l.power / 1.6, 0, 1), why: `power x${l.power}, price sensitivity x${l.priceSens}` },
  ];
  return { total: Math.round(parts.reduce((a, p) => a + p.w * p.v, 0)), parts };
}

export function refreshCandidates(s) {
  s.candidates = [];
  const roles = Object.keys(D.ROLES);
  for (let i = 0; i < 6; i++) {
    const role = roles[i % roles.length], skill = rint(s, 1, 5);
    s.candidates.push({ id: ++s.staffSeq, name: pickOf(s, D.NAMES) + " " + String.fromCharCode(65 + rint(s, 0, 25)) + ".", role, skill,
      wage: round2(D.ROLES[role].base * (0.8 + 0.15 * skill) * locOf(s).wage) });
  }
}

// ---------- simulation tick ----------
export function tick(s, dtIn) {
  if (s.phase !== "open" || s.ended) return;
  let dt = Math.min(dtIn, 0.5);
  while (dt > 0) { const h = Math.min(dt, 0.25); step(s, h); dt -= h; if (s.phase !== "open") break; }
}

const cashierSpeeds = s => {
  const lanes = 1 + s.upgrades.counter;
  const sp = s.staff.filter(x => x.role === "cashier").map(x => 0.9 + 0.25 * x.skill).sort((a, b) => b - a).slice(0, lanes);
  while (sp.length < lanes && sp.length < 1) sp.push(1.0);   // the owner covers one lane
  return sp;
};
export const laneCount = s => cashierSpeeds(s).length;
const stockerRate = s => 1.2 + s.staff.filter(x => x.role === "stocker").reduce((a, x) => a + 0.6 * (0.7 + 0.15 * x.skill), 0);
const unloadRate = s => 8 * (1 + s.staff.filter(x => x.role === "warehouse").reduce((a, x) => a + 0.25 * (0.7 + 0.15 * x.skill), 0)) * (s.upgrades.dock ? 1.5 : 1);
const hasManager = s => s.staff.some(x => x.role === "manager");

function step(s, dt) {
  s.clock += dt;
  stepOrders(s, dt);
  stepTasks(s, dt);
  stepAuto(s, dt);
  stepCustomers(s, dt);
  if (s.clock >= DAY_LEN) closeDay(s);
}

function stepOrders(s, dt) {
  const bays = 1 + s.upgrades.dock;
  let unloading = s.orders.filter(o => o.status === "unloading").length;
  for (const o of s.orders) {
    if (o.status === "processing" || o.status === "en route" || o.status === "arriving") {
      o.t += dt;
      o.status = o.t < 0.25 * o.lead ? "processing" : o.t < 0.8 * o.lead ? "en route" : "arriving";
      if (o.t >= o.lead) o.status = "dock-wait";
    }
    if (o.status === "dock-wait" && unloading < bays) { o.status = "unloading"; o.u = o.units / unloadRate(s); unloading++; }
    else if (o.status === "unloading") {
      o.u -= dt;
      if (o.u <= 0) receiveOrder(s, o);
    }
  }
  s.orders = s.orders.filter(o => o.status !== "received");
}

function receiveOrder(s, o) {
  if (o.status === "received") return;           // exactly-once guard
  o.status = "received";
  const goods = round2(o.lines.reduce((a, l) => a + l.total, 0));
  post(s.ledger, s.day, `Received order #${o.id} from ${supplier(o.supplier).name}`, [{ acct: "inventory", dr: goods }, { acct: "transit", cr: goods }], "order:" + o.id);
  for (const l of o.lines) { s.stock[l.pid].wh += l.qty; s.val[l.pid] = round2(s.val[l.pid] + l.total); }
  s.doneOrders.push({ id: o.id, supplier: o.supplier, units: o.units, total: o.total, day: s.day });
  if (s.doneOrders.length > 20) s.doneOrders.shift();
  logMsg(s, "delivery", `Delivery #${o.id} arrived: ${o.units} units from ${supplier(o.supplier).name}.`);
}

function stepTasks(s, dt) {
  if (!s.tasks.length) return;
  const t = s.tasks[0];
  t.acc = (t.acc || 0) + stockerRate(s) * dt;
  while (t.acc >= 1 && t.done < t.qty) {
    const st = s.stock[t.pid];
    if (st.wh < 1) { logMsg(s, "warn", `Restock of ${PRODUCT[t.pid].name} stopped: warehouse is empty.`); t.qty = t.done; break; }
    if (shelfUsed(s) >= shelfCap(s)) { logMsg(s, "warn", "Restock stopped: shelves are full."); t.qty = t.done; break; }
    st.wh -= 1; st.shelf += 1; t.done += 1; t.acc -= 1;
  }
  if (t.done >= t.qty) s.tasks.shift();
}

function stepAuto(s, dt) {
  s.autoT += dt;
  if (s.autoT < 1) return;
  s.autoT = 0;
  for (const p of D.PRODUCTS) {
    const tgt = s.shelfTarget[p.id];
    if (!tgt || !isUnlocked(s, p.id)) continue;
    const queued = s.tasks.filter(t => t.pid === p.id).reduce((a, t) => a + t.qty - t.done, 0);
    if (s.stock[p.id].shelf + queued < tgt * 0.5 && s.stock[p.id].wh > 0) {
      const room = shelfCap(s) - shelfUsed(s) - pendingRestock(s);
      const qty = Math.min(tgt - s.stock[p.id].shelf - queued, s.stock[p.id].wh, room);
      if (qty > 0) s.tasks.push({ id: ++s.taskSeq, pid: p.id, qty, done: 0, acc: 0, auto: true });
    }
  }
}

// ----- customers -----
const SHOP_OPEN_FRAC = 0.94;
function stepCustomers(s, dt) {
  // arrivals
  if (s.clock < DAY_LEN * SHOP_OPEN_FRAC && s.customers.length < 40) {
    s.spawnAcc += dt * expectedCustomers(s) / (DAY_LEN * SHOP_OPEN_FRAC);
    while (s.spawnAcc >= 1) { s.spawnAcc -= 1; spawnCustomer(s); }
  }
  const lanes = cashierSpeeds(s);
  const taken = new Set(s.customers.filter(c => c.state === "pay").map(c => c.lane));   // lanes in use right now
  for (const c of s.customers) {
    c.t += dt;
    if (c.state === "enter" && c.t >= 2.5) { c.state = "browse"; c.t = 0; c.browse = 3 + c.want.length * 2.2; }
    else if (c.state === "browse" && c.t >= c.browse) finishBrowsing(s, c);
    else if (c.state === "queue") {
      c.wait += dt;
      if (c.wait > c.patience) abandon(s, c);
    } else if (c.state === "pay" && c.t >= c.payTime) { taken.delete(c.lane); checkout(s, c); }
    else if (c.state === "leave" && c.t >= 2.5) c.state = "gone";
  }
  // move queued customers to the lowest free lane, strictly first-in-first-out by the time they joined the queue
  const queue = s.customers.filter(c => c.state === "queue").sort((a, b) => ((a.queuedAt ?? 0) - (b.queuedAt ?? 0)) || (a.id - b.id));
  for (const c of queue) {
    let lane = -1;
    for (let i = 0; i < lanes.length; i++) if (!taken.has(i)) { lane = i; break; }
    if (lane < 0) break;                                   // every lane is busy: the rest keep waiting in order
    taken.add(lane);
    c.state = "pay"; c.t = 0; c.lane = lane; c.payTime = Math.max(1.2, (c.basket.length * 1.1 + 0.8) / lanes[lane]);
    s.today.waitSum += c.wait; s.today.waitN++;
  }
  s.customers = s.customers.filter(c => c.state !== "gone");
}

// How strongly shoppers here want a product: popularity x price response (purchasing power, price sensitivity) x local category taste.
function prodWeight(s, p) {
  const l = locOf(s);
  return p.pop * clamp(Math.pow(p.ref * l.power / s.prices[p.id], 1.2 * l.priceSens), 0.6, 1.6) * l.cat[p.cat];
}
function spawnCustomer(s) {
  const avail = D.PRODUCTS.filter(p => isUnlocked(s, p.id));
  const k = rnd(s) < 0.45 ? 1 : rnd(s) < 0.7 ? 2 : 3;
  const want = [];
  for (let i = 0; i < k; i++) {
    const w = avail.map(p => prodWeight(s, p));
    let r = rnd(s) * w.reduce((a, b) => a + b, 0), idx = 0;
    while (idx < w.length - 1 && (r -= w[idx]) > 0) idx++;
    if (!want.includes(avail[idx].id)) want.push(avail[idx].id);
  }
  s.customers.push({ id: ++s.custSeq, state: "enter", t: 0, want, basket: [], basketPrices: [], wait: 0, patience: 22 + rnd(s) * 18, look: Math.floor(rnd(s) * 1e6), lane: -1 });
  s.today.customers++; s.stats.customers++;
}

function mood(s, c, outcome) {
  const bonus = hasManager(s) ? 5 : 0;
  s.sat = clamp(s.sat * 0.97 + (outcome + bonus) * 0.03, 0, 100);
  s.rep = clamp(s.rep + (s.sat - s.rep) * 0.012, 0, 100);
}

function finishBrowsing(s, c) {
  if (!c.basketPrices) c.basketPrices = [];
  for (const pid of c.want) {
    const p = PRODUCT[pid], price = s.prices[pid];
    const l = locOf(s), buyProb = Math.min(1, Math.pow(p.ref * 1.15 * l.power / price, 2 * l.priceSens));
    if (rnd(s) > buyProb) { s.today.lost.price++; s.today.lostBy[pid] = (s.today.lostBy[pid] || 0) + 1; continue; }
    let take = pid;
    if (s.stock[take].shelf < 1) {
      s.today.lost.stockout++; s.stats.stockLost = (s.stats.stockLost || 0) + 1; s.today.lostBy[pid] = (s.today.lostBy[pid] || 0) + 1;
      c.hadStockout = true;
      const alt = D.PRODUCTS.filter(x => x.cat === p.cat && x.id !== pid && isUnlocked(s, x.id) && s.stock[x.id].shelf > 0);
      if (alt.length && rnd(s) < 0.5) take = pickOf(s, alt).id; else continue;
    }
    const qty = rnd(s) < 0.8 ? 1 : 2;
    for (let i = 0; i < qty && s.stock[take].shelf > 0; i++) { s.stock[take].shelf--; c.basket.push(take); c.basketPrices.push(s.prices[take]); }   // reserved on the customer, at today's price
  }
  if (!c.basket.length) { mood(s, c, c.hadStockout ? 30 : 45); c.state = "leave"; c.t = 0; return; }
  c.state = "queue"; c.t = 0; c.queuedAt = s.clock;
}

function abandon(s, c) {
  for (const pid of c.basket) s.stock[pid].shelf++;     // items go back on the shelf
  c.basket = []; c.basketPrices = []; c.state = "leave"; c.t = 0;
  s.today.lost.patience++;
  mood(s, c, 12);
}

function checkout(s, c) {
  // group by product to keep ledger entries compact
  const lines = {}, money = {};
  c.basket.forEach((pid, i) => { lines[pid] = (lines[pid] || 0) + 1; money[pid] = round2((money[pid] || 0) + (c.basketPrices && c.basketPrices[i] != null ? c.basketPrices[i] : s.prices[pid])); });
  let revenue = 0, cost = 0;
  for (const [pid, n] of Object.entries(lines)) {
    // units reserved in OTHER customers' baskets are still part of the inventory value, so they count in the average
    const others = s.customers.reduce((a, o) => o === c ? a : a + o.basket.filter(x => x === pid).length, 0);
    const remaining = unitsTotal(s, pid) + others;      // units still held anywhere except this basket
    const unitVal = remaining + n > 0 ? s.val[pid] / (remaining + n) : 0;
    const c1 = remaining === 0 ? s.val[pid] : round2(unitVal * n);   // the last unit anywhere takes whatever value is left
    s.val[pid] = round2(s.val[pid] - c1);
    cost = round2(cost + c1);
    revenue = round2(revenue + money[pid]);
    s.today.units[pid] = (s.today.units[pid] || 0) + n;
    s.stats.unitsSold = (s.stats.unitsSold || 0) + n;
    s.stats.units[pid] = (s.stats.units[pid] || 0) + n;
  }
  if (revenue > 0) {
    post(s.ledger, s.day, `Sale #${c.id}`, [{ acct: "cash", dr: revenue }, { acct: "sales", cr: revenue }], "sale:" + c.id);
    if (cost > 0) post(s.ledger, s.day, `COGS sale #${c.id}`, [{ acct: "cogs", dr: cost }, { acct: "inventory", cr: cost }], "sale:" + c.id);
  }
  s.stats.totalSales += revenue;
  s.today.served++;
  const waitPenalty = Math.min(40, c.wait * 1.5);
  mood(s, c, clamp(92 - waitPenalty - (c.hadStockout ? 12 : 0), 20, 100));
  c.basket = []; c.basketPrices = []; c.state = "leave"; c.t = 0;
}

// ---------- closing the day ----------
function closeDay(s) {
  // customers still inside leave; reserved items go back on the shelf
  for (const c of s.customers) { for (const pid of c.basket) s.stock[pid].shelf++; c.basket = []; c.basketPrices = []; if (c.state === "queue" || c.state === "pay") { s.today.lost.patience++; } }
  s.customers = [];
  s.phase = "closing";
  const day = s.day;
  const rep = { day, charges: [], notes: [] };
  const charge = (acct, label, amount) => {
    if (amount <= 0) return;
    const sp = payOut(s, acct, amount, label);
    rep.charges.push({ acct, label, amount: round2(amount), over: sp.over });
  };
  branchSales(s);
  // 1. sweep cash to bank (keeps the till float at $100)
  if (s.autoDeposit) { const sweep = round2(Math.max(0, bal(s, "cash") - 100)); if (sweep > 0) post(s.ledger, day, "Auto-deposit to bank", [{ acct: "bank", dr: sweep }, { acct: "cash", cr: sweep }]); }
  // 2. operating expenses (each charged exactly once, here)
  charge("rent", "Daily rent", rent(s));
  charge("utilities", "Utilities", utilities(s));
  charge("wages", "Staff wages", wagesPerDay(s));
  branchCosts(s, charge, rep);
  const rep_ev = s.events.active.find(e => e.id === "repair");
  if (rep_ev) charge("repairs", "Equipment repair", rep_ev.amount);
  // 3. loans: interest + scheduled principal
  for (const l of s.loans) {
    const interest = round2(l.remaining * l.dailyRate);
    charge("interest", `Interest: ${l.name}`, interest);
    const pay = round2(Math.min(l.remaining, l.installment));
    if (pay > 0) {
      let rest = pay;
      for (const [acct, key] of [["bank", "bank"], ["cash", "cash"]]) { const n = round2(Math.min(Math.max(0, bal(s, acct)), rest)); if (n > 0) { post(s.ledger, day, `Loan installment: ${l.name}`, [{ acct: "loan", dr: n }, { acct, cr: n }]); rest = round2(rest - n); } }
      if (rest > 0) { post(s.ledger, day, `Loan installment: ${l.name} (overdraft)`, [{ acct: "loan", dr: rest }, { acct: "overdraft", cr: rest }]); }
      l.remaining = round2(l.remaining - pay);
      rep.charges.push({ acct: "loan", label: `Loan installment: ${l.name}`, amount: pay, principal: true });
    }
  }
  for (const l of s.loans) l.daysLeft = Math.max(0, (l.daysLeft || 0) - 1);
  s.loans = s.loans.filter(l => l.remaining > 0.004);
  const lateNotes = [];
  // 3b. supplier invoices that fall due: pay from bank then cash; any unpaid part is overdue and attracts a late fee
  for (const iv of [...s.invoices]) {
    if (iv.due > day) continue;
    const owed = iv.amount, paid = settleInvoice(s, iv, owed, true);
    if (paid > 0) rep.charges.push({ acct: "payables", label: `Supplier invoice #${iv.id} (${SUPPLIER[iv.supplier].name})`, amount: paid, principal: true });
    if (s.invoices.includes(iv)) {
      iv.late = (iv.late || 0) + 1;
      charge("fees", `Late fee: invoice #${iv.id}`, round2(iv.amount * 0.02));
      lateNotes.push(`Supplier invoice #${iv.id} is ${iv.late} day${iv.late > 1 ? "s" : ""} overdue ($${iv.amount.toFixed(2)} unpaid). A 2% late fee was charged and you cannot buy on terms until it is paid.`);
    }
  }
  const od = bal(s, "overdraft");
  if (od > 0) charge("interest", "Overdraft interest", round2(od * D.OVERDRAFT_RATE));
  // 4. weekly tax on the last 7 days of profit
  if (day % 7 === 0) {
    const week = s.history.slice(-6).reduce((a, h) => a + h.net, 0) + netSoFar(s);
    if (week > 0) charge("tax", "Weekly tax (10% of 7-day profit)", round2(week * 0.10));
  }
  // 5. repay overdraft from any positive bank balance
  const od2 = bal(s, "overdraft"), b2 = Math.max(0, bal(s, "bank"));
  const rp = round2(Math.min(od2, b2));
  if (rp > 0) post(s.ledger, day, "Overdraft repaid from bank", [{ acct: "overdraft", dr: rp }, { acct: "bank", cr: rp }]);

  // 6. reconciliation: ledger inventory must equal tracked inventory value
  const trackedInv = round2(Object.values(s.val).reduce((a, b) => a + b, 0));
  rep.reconciled = Math.abs(trackedInv - bal(s, "inventory")) < 0.05 && totals(s.ledger).balanced;
  if (!rep.reconciled) logMsg(s, "warn", "Ledger reconciliation mismatch detected.");

  // 7. report
  Object.assign(rep, buildDayRecord(s));
  rep.notes.push(...lateNotes);
  // forecast accuracy: what the planning screen promised at opening against what actually happened
  const fc = s.forecastToday;
  if (fc && fc.day === day) {
    const err = Math.abs(rep.customers - fc.expected) / Math.max(1, fc.expected);
    rep.forecast = { expected: fc.expected, low: fc.low, high: fc.high, actual: rep.customers, accuracy: round2(Math.max(0, 1 - err)), inBand: rep.customers >= fc.low && rep.customers <= fc.high };
    s.stats.fcErr += Math.min(1, err); s.stats.fcDays++;
    const diff = rep.customers - fc.expected;
    if (Math.abs(diff) > 0.1 * fc.expected) rep.notes.push(`Traffic was ${Math.abs(Math.round(100 * diff / fc.expected))}% ${diff > 0 ? "above" : "below"} the forecast of ${fc.expected}. Forecasts cannot see random events or day-to-day variation.`);
  }
  // budget variance: only the lines the player set a budget for
  const b = s.budget;
  if (b && (b.revenue > 0 || b.expenses > 0)) {
    const v = { revenue: b.revenue, expenses: b.expenses, revVar: b.revenue > 0 ? round2(rep.revenue - b.revenue) : null, expVar: b.expenses > 0 ? round2(b.expenses - rep.expenses) : null };
    v.hit = (v.revVar == null || v.revVar >= 0) && (v.expVar == null || v.expVar >= 0);
    rep.budget = v; s.stats.budgetDays++; if (v.hit) s.stats.budgetHit++;
    if (v.revVar != null) rep.notes.push(`Revenue ${v.revVar >= 0 ? "beat" : "missed"} the budget by ${Math.abs(v.revVar).toFixed(2)}.`);
    if (v.expVar != null) rep.notes.push(`Expenses were ${v.expVar >= 0 ? "under" : "over"} budget by ${Math.abs(v.expVar).toFixed(2)}.`);
  }
  s.lastReport = rep;
  snapshotDayStart(s);                    // postings made during the report phase (loan fees, upgrades...) belong to the NEXT day's record
  s.history.push({ day, revenue: rep.revenue, net: rep.net, customers: rep.customers, liquid: rep.closeLiquid, netWorth: updateDerived(s).netWorth });
  if (s.history.length > 60) { const old = s.history.shift(); s.archive.days++; s.archive.revenue = round2(s.archive.revenue + old.revenue); s.archive.profit = round2(s.archive.profit + old.net); }
  s.stats.bestDay = Math.max(s.stats.bestDay, rep.net);
  // distress tracking
  const limit = creditLimit(s);
  s.distressDays = bal(s, "overdraft") > limit ? s.distressDays + 1 : 0;
  if (s.distressDays > 0) logMsg(s, "warn", `Financial distress: overdraft is above your $${limit} limit. Use Bank > Restructure debt.`);
  checkMilestones(s);
  s.phase = "report";
  // end conditions
  if (s.mode === "standard" && day >= s.dayLimit) endGame(s, "completed");
  else if (s.mode === "standard" && s.distressDays >= 3) endGame(s, "bankrupt");
}

function dayDeltaNat(s, acct) { return round2(s.ledger.bal[acct] - s.dayStart[acct]); }   // signed delta (dr +)
function sumExp(s) { return round2(OPEX.reduce((a, k) => a + dayDeltaNat(s, k), 0)); }
function netSoFar(s) { return round2(-dayDeltaNat(s, "sales") - dayDeltaNat(s, "cogs") - sumExp(s)); }

function buildDayRecord(s) {
  const revenue = round2(-dayDeltaNat(s, "sales")), cogs = dayDeltaNat(s, "cogs");
  const opex = {}; for (const k of OPEX) opex[k] = dayDeltaNat(s, k);
  const expenses = sumExp(s), net = round2(revenue - cogs - expenses);
  const prev = s.history[s.history.length - 1];
  const t = s.today, notes = [];
  s.stockoutRate = t.customers ? clamp(t.lost.stockout / Math.max(1, t.customers), 0, 1) : 0;
  if (!prev && s.loc !== "default") { const l = locOf(s); notes.push(`Location: ${l.name}. Customer volume x${l.demand}, rent x${l.rent}, wages x${l.wage}, rivals take about ${Math.round(l.competition * 30)}% of demand.`); }
  const share = round3(marketShare(s));
  if (s.rivals.length) {
    const dShare = Math.round((share - s.shareLast) * 100);
    if (Math.abs(dShare) >= 3) {
      const promo = s.rivals.find(r => r.promo > 0), cheap = s.rivals.find(r => r.price < priceIndex(s) - 0.05);
      const why = dShare < 0 ? (promo ? `${promo.name} ran a promotion` : cheap ? `${cheap.name} is cheaper than you` : "your price or reputation slipped") : "your price, stock or reputation improved against rivals";
      notes.push(`Your local market share ${dShare < 0 ? "fell" : "rose"} ${Math.abs(dShare)} points to ${Math.round(share * 100)}%: ${why}.`);
    }
    s.shareLast = share;
  }
  if (prev) notes.push(prev.customers > t.customers ? `Fewer customers than yesterday (${t.customers} vs ${prev.customers}).` : `More customers than yesterday (${t.customers} vs ${prev.customers}).`);
  if (t.lost.stockout) { const worst = Object.entries(t.lostBy).sort((a, b) => b[1] - a[1])[0]; notes.push(`${t.lost.stockout} sales were lost to empty shelves${worst ? ` (most often ${PRODUCT[worst[0]].name})` : ""}.`); }
  if (t.lost.price) notes.push(`${t.lost.price} items were skipped because the price felt too high.`);
  if (t.lost.patience) notes.push(`${t.lost.patience} customers left after waiting too long. More checkout lanes or cashiers help.`);
  const lift = campaignLift(s); if (lift > 0) notes.push(`Marketing campaigns lifted expected traffic by about ${Math.round(lift * 100)}% today.`);
  for (const id of t.events) notes.push(D.EVENTS.find(e => e.id === id).name + " affected today.");
  if (net < 0) notes.push("The day made a loss: expenses were higher than gross profit.");
  return { share, revenue, cogs, gross: round2(revenue - cogs), opex, expenses, net, customers: t.customers, served: t.served, lost: { ...t.lost },
    units: { ...t.units }, avgWait: t.waitN ? round2(t.waitSum / t.waitN) : 0, openLiquid: t.openLiquid,
    closeLiquid: round2(bal(s, "cash") + bal(s, "bank")), notes, sat: round2(s.sat), rep: round2(s.rep) };
}

export const creditLimit = s => Math.round(300 + 0.5 * Math.max(0, s.derived ? s.derived.netWorth : s.startNetWorth));

function checkMilestones(s) {
  updateDerived(s);
  for (const m of D.MILESTONES) if (!s.milestones.includes(m.id) && m.test(s)) { s.milestones.push(m.id); logMsg(s, "info", "Milestone: " + m.name); }
}

export function score(s) {
  const d = updateDerived(s);
  const growth = clamp(((d.netWorth - s.startNetWorth) / s.startNetWorth) / 5, 0, 1);
  const weeklyCost = (rent(s) + utilities(s) + wagesPerDay(s)) * 7;   // fixed costs for 7 days: cash health = how many weeks of runway you hold (1 week = full marks)
  const cash = clamp(d.liquid / Math.max(1, weeklyCost), 0, 1);
  const debt = d.assets > 0 ? clamp(1 - d.debt / d.assets, 0, 1) : 0;
  const sat = clamp(s.sat / 100, 0, 1);
  const totalCust = Math.max(1, s.stats.customers);
  const stockLoss = s.stats.stockLost || 0;
  const stock = clamp(1 - stockLoss / totalCust, 0, 1);
  const expansion = clamp(Object.values(s.upgrades).reduce((a, b) => a + b, 0) / 8, 0, 1);
  const parts = [
    { name: "Wealth growth", w: 35, v: growth }, { name: "Cash health", w: 15, v: cash }, { name: "Low debt", w: 15, v: debt },
    { name: "Customer satisfaction", w: 15, v: sat }, { name: "Stock management", w: 10, v: stock }, { name: "Expansion", w: 10, v: expansion },
  ];
  const total = Math.round(parts.reduce((a, p) => a + p.w * p.v, 0));
  const rating = total >= 85 ? "S" : total >= 70 ? "A" : total >= 55 ? "B" : total >= 40 ? "C" : "D";
  return { total, rating, parts };
}

function endGame(s, reason) {
  const d = updateDerived(s), sc = score(s);
  const t = totals(s.ledger);
  s.ended = { reason, day: s.day, startNetWorth: s.startNetWorth, endNetWorth: d.netWorth, cash: d.liquid, revenue: t.revenue, expenses: t.costs, profit: round2(t.revenue - t.costs),
    inventory: d.inventory, debt: d.debt, assets: d.assets, score: sc, decisions: s.decisions.slice(-12),
    planning: { forecastAccuracy: s.stats.fcDays ? round2(1 - s.stats.fcErr / s.stats.fcDays) : null, budgetDays: s.stats.budgetDays, budgetHit: s.stats.budgetHit,
      serviceRate: s.stats.customers ? round2(1 - (s.stats.stockLost || 0) / s.stats.customers) : null, customers: s.stats.customers, bestDay: s.stats.bestDay } };
}

// Start the next day after the player has read the report.
export function nextDay(s) {
  if (s.phase !== "report" || s.ended) return fail("Not at a day report.");
  s.day++;
  if ((s.day - 1) % 3 === 0) refreshCandidates(s);
  beginDay(s);
  updateDerived(s);
  return okr();
}

// Infinite mode may keep playing after a Standard final report ("continue").
export function continueAfterEnd(s) {
  if (!s.ended || s.ended.reason !== "completed") return fail("Cannot continue.");
  s.mode = "infinite"; s.dayLimit = null; s.ended = null;
  return nextDay(s);
}

// ---------- commands (all validated; money-moving ones accept a cmdId for idempotency) ----------
// A command id is remembered only AFTER the command succeeds, so a request that failed validation can be retried.
const seen = (s, id) => !!id && s.cmdSeen.includes(id);
const remember = (s, id) => { if (!id) return; s.cmdSeen.push(id); if (s.cmdSeen.length > 200) s.cmdSeen.shift(); };
const isInt = (n, a, b) => Number.isInteger(n) && n >= a && n <= b;
const isMoney = (n, max = 1e7) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= max;
const guard = s => (s.ended ? fail("The game has ended.") : null);

export function placeOrder(s, { supplier: sid, lines, pay = "bank", cmdId }) {
  const g = guard(s); if (g) return g;
  if (seen(s, cmdId)) return fail("Duplicate request ignored.");
  const sup = SUPPLIER[sid];
  if (!sup) return fail("Unknown supplier.");
  if (!supplierAvailable(s, sup)) return fail(`${sup.name} does not deliver to ${locOf(s).city}.`);
  if (!Array.isArray(lines) || !lines.length || lines.length > 12) return fail("Add at least one product.");
  if (pay !== "bank" && pay !== "cash" && pay !== "terms") return fail("Pay from bank, cash or on supplier terms.");
  if (pay === "terms" && !sup.terms) return fail(`${sup.name} does not offer payment terms.`);
  const clean = [], seenP = new Set();
  let units = 0;
  for (const l of lines) {
    if (!PRODUCT[l.pid]) return fail("Unknown product.");
    if (seenP.has(l.pid)) return fail("Duplicate product line.");
    seenP.add(l.pid);
    if (!isInt(l.qty, 1, 999)) return fail("Quantity must be a whole number from 1 to 999.");
    if (!isUnlocked(s, l.pid)) return fail(`${PRODUCT[l.pid].name} unlocks on day ${PRODUCT[l.pid].unlockDay}.`);
    if (!sup.cats.includes(PRODUCT[l.pid].cat)) return fail(`${sup.name} does not sell ${PRODUCT[l.pid].name}.`);
    units += l.qty; clean.push({ pid: l.pid, qty: l.qty });
  }
  if (units < sup.minUnits) return fail(`${sup.name} needs at least ${sup.minUnits} units per order.`);
  if (whUsed(s) + incomingUnits(s) + units > whCap(s)) return fail(`Warehouse is too small: ${whCap(s) - whUsed(s) - incomingUnits(s)} free slots left.`);
  const markup = pay === "terms" ? 1 + sup.terms.markup : 1;
  const priced = clean.map(l => { const unit = round2(unitCost(s, sup, l.pid, units) * markup); return { ...l, unit, total: round2(unit * l.qty) }; });
  const goods = round2(priced.reduce((a, l) => a + l.total, 0)), fee = supFee(s, sup), total = round2(goods + fee);
  if (pay === "terms") { const e = termsError(s, total); if (e) return fail(e); }
  else if (bal(s, pay) < total) return fail(`Not enough ${pay === "bank" ? "bank balance" : "cash"}: need $${total.toFixed(2)}, have $${bal(s, pay).toFixed(2)}. Move money or take a loan.`);
  const id = ++s.orderSeq;
  post(s.ledger, s.day, `Order #${id} to ${sup.name}${pay === "terms" ? " (on terms)" : ""}`, [{ acct: "transit", dr: goods }, { acct: "delivery", dr: fee }, { acct: pay === "terms" ? "payables" : pay, cr: total }], "order:" + id);
  if (pay === "terms") s.invoices.push({ id: ++s.invSeq, order: id, supplier: sid, amount: total, due: s.day + sup.terms.days, day: s.day, late: 0 });
  const delayEv = s.events.active.find(e => e.id === "delay" && e.sup === sid);
  let lead = supLead(s, sup) * (delayEv ? 1.6 : 1), delayed = !!delayEv;
  if (rnd(s) > clamp(sup.reliability + diffOf(s).reliability, 0.5, 0.995)) { lead *= 1.5; delayed = true; }
  const rec = s.supRec[sid]; rec.n++; if (delayed) rec.late++;
  s.orders.push({ id, supplier: sid, lines: priced, units, goods, fee, total, pay, lead: round2(lead), t: 0, status: "processing", delayed, day: s.day });
  decide(s, `Ordered ${units} units from ${sup.name} ($${total.toFixed(2)})`);
  remember(s, cmdId);
  return okr({ id, total, lead: round2(lead), delayed });
}

// ---------- branches ----------
// A branch is a second shop in another district. It is simulated once a day (not customer by customer): its own demand, rivals,
// reputation, staff, rent and stock. Goods move from your warehouse by a paid transfer. Prices, suppliers and the books are shared.
export const MAX_BRANCHES = 2, BRANCH_CAP = 300, BRANCH_MIN_DAY = 5, BRANCH_MIN_NW = 1200, BRANCH_PER_STAFF = 45;
const bLoc = b => LOC.getLocation(b.loc);
export const branchFee = locId => Math.round(300 + 400 * LOC.getLocation(locId).rent);
export const branchRent = (s, b) => round2(diffOf(s).rent * inflation(s) * bLoc(b).rent * 0.8);
export const branchUtilities = (s, b) => round2(diffOf(s).utilities * inflation(s) * bLoc(b).utilities);
export const branchWages = (s, b) => round2(b.staff * D.ROLES.cashier.base * 1.35 * bLoc(b).wage * inflation(s));
export const branchUnits = b => Object.values(b.stock).reduce((a, x) => a + x, 0);
export const branchValue = b => round2(Object.values(b.val).reduce((a, x) => a + x, 0));
export const transferFee = (s, b, qty) => round2((3 + 0.1 * qty) * bLoc(b).logistics);
const branchView = (s, b) => ({ ...s, loc: b.loc, rivals: b.rivals, stockoutRate: b.so });
const findBranch = (s, id) => s.branches.find(b => b.id === id);
// loose cash check: bank + till
const liquid = s => round2(Math.max(0, bal(s, "bank")) + Math.max(0, bal(s, "cash")));

function branchSales(s) {
  const day = s.day;
  for (const b of s.branches) {
    const v = branchView(s, b), l = bLoc(b);
    if (day > b.opened) stepRivals(v);
    const want = demandBase(v, day, b.rep) * eventDemand(v) * round3(0.92 + 0.16 * rnd(v));
    const cap = BRANCH_PER_STAFF * b.staff, customers = Math.round(Math.min(want, cap)), capLost = Math.max(0, Math.round(want - cap));
    const avail = D.PRODUCTS.filter(p => PRODUCT[p.id].unlockDay <= day), w = avail.map(p => prodWeight(v, p)), tw = w.reduce((a, x) => a + x, 0) || 1;
    const items = customers * itemsPerCustomer(s);
    let revenue = 0, cogs = 0, wantU = 0, lostU = 0, units = 0;
    avail.forEach((p, i) => {
      const buy = Math.min(1, Math.pow(p.ref * 1.15 * l.power / s.prices[p.id], 2 * l.priceSens));
      const dem = Math.round(items * w[i] / tw * buy), have = b.stock[p.id], sold = Math.min(dem, have);
      wantU += dem; lostU += dem - sold;
      if (sold > 0) {
        const c = sold === have ? b.val[p.id] : round2(b.val[p.id] / have * sold);
        revenue += round2(sold * s.prices[p.id]); cogs += c; units += sold;
        b.stock[p.id] -= sold; b.val[p.id] = round2(b.val[p.id] - c);
        s.stats.units[p.id] = (s.stats.units[p.id] || 0) + sold;
      }
    });
    revenue = round2(revenue); cogs = round2(cogs);
    if (revenue > 0) post(s.ledger, day, `Sales: ${b.name}`, [{ acct: "cash", dr: revenue }, { acct: "sales", cr: revenue }], `bsale:${b.id}:${day}`);
    if (cogs > 0) post(s.ledger, day, `COGS: ${b.name}`, [{ acct: "cogs", dr: cogs }, { acct: "inventory", cr: cogs }], `bsale:${b.id}:${day}`);
    s.stats.totalSales += revenue; s.stats.customers += customers; s.stats.unitsSold += units;
    b.so = wantU ? round3(lostU / wantU) : 0;
    const target = 88 - 45 * b.so - (customers + capLost ? 15 * capLost / (customers + capLost) : 0);
    b.rep = round2(clamp(b.rep + (target - b.rep) * 0.1, 0, 100));
    s.rng = v.rng;
    b.last = { day, customers, capLost, revenue, cogs, units, so: b.so, share: round3(marketShare(v, b.rep)), rent: 0, utilities: 0, wages: 0, net: 0 };
  }
}
function branchCosts(s, charge, rep) {
  rep.branches = [];
  for (const b of s.branches) {
    const r = branchRent(s, b), u = branchUtilities(s, b), w = branchWages(s, b);
    charge("rent", `Rent: ${b.name}`, r); charge("utilities", `Utilities: ${b.name}`, u); charge("wages", `Wages: ${b.name}`, w);
    Object.assign(b.last, { rent: r, utilities: u, wages: w, net: round2(b.last.revenue - b.last.cogs - r - u - w) });
    rep.branches.push({ id: b.id, name: b.name, ...b.last });
    if (b.last.capLost > 5) rep.notes.push(`${b.name} turned away about ${b.last.capLost} customers: add staff there.`);
    if (b.so > 0.25) rep.notes.push(`${b.name} ran short of stock (${Math.round(b.so * 100)}% of wanted items missed). Transfer more goods.`);
  }
}
export function openBranch(s, { loc, cmdId } = {}) {
  const g = guard(s); if (g) return g;
  if (seen(s, cmdId)) return fail("Duplicate request ignored.");
  if (!LOC.hasLocation(loc) || loc === "default") return fail("Unknown location.");
  if (s.day < BRANCH_MIN_DAY) return fail(`Branches open from day ${BRANCH_MIN_DAY}.`);
  if (s.branches.length >= MAX_BRANCHES) return fail(`You can run at most ${MAX_BRANCHES} branches.`);
  if (loc === s.loc || s.branches.some(b => b.loc === loc)) return fail("You already have a shop in that district.");
  if ((s.derived ? s.derived.netWorth : s.startNetWorth) < BRANCH_MIN_NW) return fail(`A branch needs a net worth of $${BRANCH_MIN_NW}.`);
  const fee = branchFee(loc);
  if (bal(s, "bank") < fee + 100) return fail(`Not enough bank balance: the fit-out costs $${fee} and you should keep $100 spare.`);
  const l = LOC.getLocation(loc), id = ++s.branchSeq;
  post(s.ledger, s.day, `Branch fit-out: ${l.name}`, [{ acct: "equipment", dr: fee }, { acct: "bank", cr: fee }], "branch:" + id);
  const b = { id, loc, name: `${l.district}, ${l.city}`, opened: s.day, stock: {}, val: {}, staff: 1, rep: 50, so: 0, fit: fee, rivals: makeRivals({ loc }, (s.rng ^ (id * 7919)) | 0), last: null };
  for (const p of D.PRODUCTS) { b.stock[p.id] = 0; b.val[p.id] = 0; }
  s.branches.push(b);
  decide(s, `Opened a branch in ${l.name} ($${fee})`);
  logMsg(s, "info", `New branch: ${b.name}. Transfer stock from your warehouse so it can sell.`);
  remember(s, cmdId); updateDerived(s);
  return okr({ id, fee });
}
export function transferStock(s, { branch, pid, qty, cmdId } = {}) {
  const g = guard(s); if (g) return g;
  if (seen(s, cmdId)) return fail("Duplicate request ignored.");
  const b = findBranch(s, branch); if (!b) return fail("Unknown branch.");
  if (!PRODUCT[pid]) return fail("Unknown product.");
  if (!isInt(qty, 1, 999)) return fail("Quantity must be a whole number from 1 to 999.");
  const st = s.stock[pid];
  if (st.wh < qty) return fail(`Only ${st.wh} ${PRODUCT[pid].name} in the warehouse (shelf goods cannot be transferred).`);
  if (branchUnits(b) + qty > BRANCH_CAP) return fail(`${b.name} holds at most ${BRANCH_CAP} units (${BRANCH_CAP - branchUnits(b)} free).`);
  const fee = transferFee(s, b, qty);
  if (liquid(s) < fee) return fail(`Not enough money for the $${fee.toFixed(2)} transfer fee.`);
  const total = unitsTotal(s, pid), v = qty === total ? s.val[pid] : round2(s.val[pid] / total * qty);
  st.wh -= qty; s.val[pid] = round2(s.val[pid] - v);
  b.stock[pid] += qty; b.val[pid] = round2(b.val[pid] + v);
  payOut(s, "delivery", fee, `Transfer to ${b.name}`, false);
  decide(s, `Moved ${qty} ${PRODUCT[pid].name} to ${b.name}`);
  remember(s, cmdId); updateDerived(s);
  return okr({ fee });
}
export function setBranchStaff(s, { branch, n, cmdId } = {}) {
  const g = guard(s); if (g) return g;
  if (seen(s, cmdId)) return fail("Duplicate request ignored.");
  const b = findBranch(s, branch); if (!b) return fail("Unknown branch.");
  if (!isInt(n, 1, 3)) return fail("A branch runs with 1 to 3 cashiers.");
  b.staff = n; remember(s, cmdId);
  return okr();
}
export function closeBranch(s, { branch, cmdId } = {}) {
  const g = guard(s); if (g) return g;
  if (seen(s, cmdId)) return fail("Duplicate request ignored.");
  const b = findBranch(s, branch); if (!b) return fail("Unknown branch.");
  let room = whCap(s) - whUsed(s) - incomingUnits(s), lost = 0;
  for (const p of D.PRODUCTS) {
    const n = b.stock[p.id]; if (!n) continue;
    const back = Math.min(n, Math.max(0, room)), v = b.val[p.id], vBack = back === n ? v : round2(v / n * back);
    s.stock[p.id].wh += back; s.val[p.id] = round2(s.val[p.id] + vBack); room -= back;
    lost = round2(lost + (v - vBack)); b.stock[p.id] = 0; b.val[p.id] = 0;
  }
  if (lost > 0) post(s.ledger, s.day, `Branch closing: stock written off (${b.name})`, [{ acct: "cogs", dr: lost }, { acct: "inventory", cr: lost }], "branch:" + b.id);
  if (b.fit > 0) post(s.ledger, s.day, `Branch closing: fit-out written off (${b.name})`, [{ acct: "fees", dr: b.fit }, { acct: "equipment", cr: b.fit }], "branch:" + b.id);
  s.branches = s.branches.filter(x => x !== b);
  decide(s, `Closed the branch in ${b.name}`);
  remember(s, cmdId); updateDerived(s);
  return okr({ writtenOff: lost });
}

// ---------- supplier payment terms ----------
// Buying on terms puts the invoice on the books as a liability and the goods arrive now; cash leaves on the due day.
export const creditLimit_ = s => Math.round(150 + 0.35 * Math.max(0, s.derived ? s.derived.netWorth : s.startNetWorth));
export const supplierCreditLimit = creditLimit_;
export const invoicesOwed = s => round2(s.invoices.reduce((a, x) => a + x.amount, 0));
export const overdueInvoices = s => s.invoices.filter(x => x.due < s.day || (x.late || 0) > 0);
function termsError(s, total) {
  if (overdueInvoices(s).length) return "You have an overdue supplier invoice. Pay it before buying on terms again.";
  const room = supplierCreditLimit(s) - invoicesOwed(s);
  if (total > room) return `Over your supplier credit limit: $${Math.max(0, room).toFixed(2)} of $${supplierCreditLimit(s)} left.`;
  return null;
}
export function termsCheck(s, total) { return termsError(s, total); }
export function payInvoice(s, id, cmdId) {
  const g = guard(s); if (g) return g;
  if (seen(s, cmdId)) return fail("Duplicate request ignored.");
  const iv = s.invoices.find(x => x.id === id);
  if (!iv) return fail("Invoice not found.");
  const amt = iv.amount;
  if (bal(s, "bank") + bal(s, "cash") < amt - 0.005) return fail(`Not enough money: need $${amt.toFixed(2)}, have $${(bal(s, "bank") + bal(s, "cash")).toFixed(2)}.`);
  settleInvoice(s, iv, amt, false);
  decide(s, `Paid supplier invoice #${iv.id} early or on time ($${amt.toFixed(2)})`);
  remember(s, cmdId);
  return okr({ paid: amt });
}
// pays up to `amt` from bank then cash (never overdraft); returns what was paid
function settleInvoice(s, iv, amt, partial) {
  let rest = round2(Math.min(amt, iv.amount)), paid = 0;
  for (const acct of ["bank", "cash"]) {
    const n = round2(Math.min(Math.max(0, bal(s, acct)), rest));
    if (n > 0) { post(s.ledger, s.day, `Paid supplier invoice #${iv.id}`, [{ acct: "payables", dr: n }, { acct, cr: n }], "inv:" + iv.id); rest = round2(rest - n); paid = round2(paid + n); }
  }
  iv.amount = round2(iv.amount - paid);
  if (iv.amount < 0.005) s.invoices = s.invoices.filter(x => x !== iv);
  return paid;
}
export function cancelOrder(s, id) {
  const g = guard(s); if (g) return g;
  const o = s.orders.find(x => x.id === id);
  if (!o) return fail("Order not found.");
  if (o.status !== "processing") return fail("Only orders still being processed can be cancelled.");
  post(s.ledger, s.day, `Order #${id} cancelled (goods refunded, delivery fee kept)`, [{ acct: o.pay === "terms" ? "payables" : o.pay, dr: o.goods }, { acct: "transit", cr: o.goods }], "order:" + id);
  if (o.pay === "terms") { const iv = s.invoices.find(x => x.order === id); if (iv) { iv.amount = round2(iv.amount - o.goods); if (iv.amount < 0.005) s.invoices = s.invoices.filter(x => x !== iv); } }
  s.orders = s.orders.filter(x => x !== o);
  return okr({ refunded: o.goods });
}

export function restock(s, pid, qty) {
  const g = guard(s); if (g) return g;
  if (!PRODUCT[pid]) return fail("Unknown product.");
  if (!isInt(qty, 1, 999)) return fail("Quantity must be a whole number.");
  const st = s.stock[pid], queued = s.tasks.filter(t => t.pid === pid).reduce((a, t) => a + t.qty - t.done, 0);
  if (qty + queued > st.wh) return fail(`Only ${st.wh - queued} available in the warehouse.`);
  const room = shelfCap(s) - shelfUsed(s) - pendingRestock(s);
  if (qty > room) return fail(`Shelves have room for only ${Math.max(0, room)} more units.`);
  s.tasks.push({ id: ++s.taskSeq, pid, qty, done: 0, acc: 0 });
  return okr();
}

export function setPrice(s, pid, price) {
  if (!PRODUCT[pid]) return fail("Unknown product.");
  if (typeof price !== "number" || !Number.isFinite(price)) return fail("Enter a price.");
  const p = PRODUCT[pid];
  if (price < 0.1 || price > p.ref * 4) return fail(`Price must be between $0.10 and $${(p.ref * 4).toFixed(2)}.`);
  s.prices[pid] = round2(price);
  return okr();
}
export function setShelfTarget(s, pid, n) {
  if (!PRODUCT[pid]) return fail("Unknown product.");
  if (!isInt(n, 0, 200)) return fail("Target must be 0 to 200.");
  s.shelfTarget[pid] = n; return okr();
}
export function launchCampaign(s, cid, cmdId) {
  const g = guard(s); if (g) return g;
  if (seen(s, cmdId)) return fail("Duplicate request ignored.");
  const def = D.CAMPAIGNS.find(c => c.id === cid);
  if (!def) return fail("Unknown campaign.");
  if (s.campaigns.length >= D.MAX_CAMPAIGNS) return fail(`At most ${D.MAX_CAMPAIGNS} campaigns at a time.`);
  if (s.campaigns.some(c => c.kind === cid)) return fail(`${def.name} is already booked. Wait until it ends.`);
  const from = bal(s, "bank") >= def.cost ? "bank" : bal(s, "cash") >= def.cost ? "cash" : null;
  if (!from) return fail(`Not enough funds: need $${def.cost}.`);
  const start = (s.phase === "report" ? s.day + 1 : s.day) + def.delay;
  post(s.ledger, s.day, `Campaign: ${def.name}`, [{ acct: "marketing", dr: def.cost }, { acct: from, cr: def.cost }]);
  s.campaigns.push({ id: ++s.campSeq, kind: cid, name: def.name, start, days: def.days, lift: def.lift });
  decide(s, `Booked ${def.name} campaign ($${def.cost})`);
  remember(s, cmdId);
  return okr({ start });
}

export function setBudget(s, { revenue = 0, expenses = 0 } = {}) {
  const ok = n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1e5;
  if (!ok(revenue) || !ok(expenses)) return fail("Budgets must be numbers from 0 to 100000. Use 0 for no budget.");
  s.budget = { revenue: round2(revenue), expenses: round2(expenses) };
  return okr();
}

export function setAutoDeposit(s, on) { s.autoDeposit = !!on; return okr(); }

export function hire(s, candId) {
  const g = guard(s); if (g) return g;
  const c = s.candidates.find(x => x.id === candId);
  if (!c) return fail("That candidate is no longer available.");
  if (s.staff.length >= D.MAX_STAFF) return fail(`Maximum team size is ${D.MAX_STAFF}.`);
  s.staff.push({ id: c.id, name: c.name, role: c.role, skill: c.skill, wage: c.wage });
  s.candidates = s.candidates.filter(x => x !== c);
  decide(s, `Hired ${c.name} as ${D.ROLES[c.role].name}`);
  return okr();
}
export function fire(s, staffId) {
  const g = guard(s); if (g) return g;
  const x = s.staff.find(q => q.id === staffId);
  if (!x) return fail("Staff member not found.");
  s.staff = s.staff.filter(q => q !== x);
  decide(s, `Let ${x.name} go`);
  return okr();
}

// ----- bank -----
export function deposit(s, amount, cmdId) {
  const g = guard(s); if (g) return g;
  if (seen(s, cmdId)) return fail("Duplicate request ignored.");
  amount = round2(amount);
  if (!isMoney(amount)) return fail("Enter an amount above zero.");
  if (amount > bal(s, "cash")) return fail("Not enough cash on hand.");
  post(s.ledger, s.day, "Deposit to bank", [{ acct: "bank", dr: amount }, { acct: "cash", cr: amount }]);
  remember(s, cmdId);
  return okr();
}
export function withdraw(s, amount, cmdId) {
  const g = guard(s); if (g) return g;
  if (seen(s, cmdId)) return fail("Duplicate request ignored.");
  amount = round2(amount);
  if (!isMoney(amount)) return fail("Enter an amount above zero.");
  if (amount > bal(s, "bank")) return fail("Not enough in the bank.");
  post(s.ledger, s.day, "Withdraw from bank", [{ acct: "cash", dr: amount }, { acct: "bank", cr: amount }]);
  remember(s, cmdId);
  return okr();
}
export function loanTerms(def) {
  const installment = round2(def.principal / def.days);
  let interest = 0, rem = def.principal;
  for (let i = 0; i < def.days; i++) { interest += rem * def.dailyRate; rem -= installment; }
  const fee = round2(def.principal * def.feePct);
  return { installment, interest: round2(interest), fee, totalCost: round2(interest + fee), net: round2(def.principal - fee) };
}
export function loanEligibility(s, def) {
  updateDerived(s);
  if (s.day < def.minDay) return `Unlocks on day ${def.minDay}`;
  if (s.derived.netWorth < def.minNetWorth) return `Needs net worth $${def.minNetWorth}`;
  if (s.loans.some(l => l.kind === def.id)) return "Already borrowed";
  if (s.loans.length >= 2) return "Maximum 2 active loans";
  return null;
}
export function takeLoan(s, loanId, cmdId) {
  const g = guard(s); if (g) return g;
  if (seen(s, cmdId)) return fail("Duplicate request ignored.");
  const def = D.LOANS.find(l => l.id === loanId);
  if (!def) return fail("Unknown loan.");
  const why = loanEligibility(s, def); if (why) return fail(why);
  const t = loanTerms(def);
  post(s.ledger, s.day, `Loan: ${def.name}`, [{ acct: "bank", dr: def.principal }, { acct: "loan", cr: def.principal }]);
  post(s.ledger, s.day, `Loan fee: ${def.name}`, [{ acct: "fees", dr: t.fee }, { acct: "bank", cr: t.fee }]);
  s.loans.push({ id: ++s.loanSeq, kind: def.id, name: def.name, remaining: def.principal, dailyRate: def.dailyRate, installment: t.installment, daysLeft: def.days });
  s.stats.tookLoan = true;
  decide(s, `Took ${def.name} ($${def.principal})`);
  remember(s, cmdId);
  return okr({ terms: t });
}
export function repayLoan(s, loanDbId, amount, cmdId) {
  const g = guard(s); if (g) return g;
  if (seen(s, cmdId)) return fail("Duplicate request ignored.");
  const l = s.loans.find(x => x.id === loanDbId);
  if (!l) return fail("Loan not found.");
  amount = round2(amount);
  if (!isMoney(amount)) return fail("Enter an amount above zero.");
  amount = Math.min(amount, l.remaining);
  if (amount > bal(s, "bank")) return fail("Not enough in the bank. Deposit cash first.");
  post(s.ledger, s.day, `Early repayment: ${l.name}`, [{ acct: "loan", dr: amount }, { acct: "bank", cr: amount }]);
  l.remaining = round2(l.remaining - amount);
  if (l.remaining < 0.005) s.loans = s.loans.filter(x => x !== l);
  remember(s, cmdId);
  return okr({ paid: amount });
}
// Distress option: turn overdraft into a long, expensive rescue loan. Costs reputation. Once per 10 days.
export function restructureDebt(s, cmdId) {
  const g = guard(s); if (g) return g;
  if (seen(s, cmdId)) return fail("Duplicate request ignored.");
  const od = bal(s, "overdraft");
  if (od <= 0) return fail("You have no overdraft to restructure.");
  if (s.day - s.lastBailoutDay < 10) return fail("You can restructure once every 10 days.");
  post(s.ledger, s.day, "Overdraft converted to rescue loan", [{ acct: "overdraft", dr: od }, { acct: "loan", cr: od }]);
  s.loans.push({ id: ++s.loanSeq, kind: "rescue", name: "Rescue loan", remaining: od, dailyRate: D.RESCUE_RATE, installment: round2(od / 40), daysLeft: 40 });
  s.lastBailoutDay = s.day; s.distressDays = 0; s.rep = Math.max(0, s.rep - 8);
  decide(s, `Restructured $${od.toFixed(2)} overdraft`);
  remember(s, cmdId);
  return okr({ amount: od });
}

export function buyUpgrade(s, id, cmdId) {
  const g = guard(s); if (g) return g;
  if (seen(s, cmdId)) return fail("Duplicate request ignored.");
  const u = D.UPGRADES.find(x => x.id === id);
  if (!u) return fail("Unknown upgrade.");
  const lvl = s.upgrades[id];
  if (lvl >= u.max) return fail("Already at maximum level.");
  const cost = u.costs[lvl];
  const from = bal(s, "bank") >= cost ? "bank" : bal(s, "cash") >= cost ? "cash" : null;
  if (!from) return fail(`Not enough funds: need $${cost}.`);
  post(s.ledger, s.day, `Upgrade: ${u.name} level ${lvl + 1}`, [{ acct: "equipment", dr: cost }, { acct: from, cr: cost }]);
  s.upgrades[id] = lvl + 1;
  decide(s, `Bought ${u.name} level ${lvl + 1}`);
  checkMilestones(s);
  remember(s, cmdId);
  return okr({ cost });
}

// ---------- reports & reconciliation ----------
export function reconcile(s) {
  const t = totals(s.ledger);
  const tracked = round2(Object.values(s.val).reduce((a, b) => a + b, 0) + s.branches.reduce((a, b) => a + branchValue(b), 0));
  const inLedger = bal(s, "inventory");
  const transit = round2(s.orders.reduce((a, o) => a + o.goods, 0));
  const loans = round2(s.loans.reduce((a, l) => a + l.remaining, 0));
  const problems = [];
  if (!t.balanced) problems.push("Ledger does not balance.");
  if (Math.abs(tracked - inLedger) > 0.05) problems.push(`Inventory ${tracked} vs ledger ${inLedger}.`);
  if (Math.abs(transit - bal(s, "transit")) > 0.05) problems.push(`Transit ${transit} vs ledger ${bal(s, "transit")}.`);
  if (Math.abs(invoicesOwed(s) - bal(s, "payables")) > 0.05) problems.push(`Invoices ${invoicesOwed(s)} vs ledger ${bal(s, "payables")}.`);
  if (Math.abs(loans - bal(s, "loan")) > 0.05) problems.push(`Loans ${loans} vs ledger ${bal(s, "loan")}.`);
  for (const [pid, st] of Object.entries(s.stock)) if (st.wh < 0 || st.shelf < 0) problems.push("Negative stock: " + pid);
  for (const b of s.branches) for (const pid of Object.keys(b.stock)) if (b.stock[pid] < 0 || b.val[pid] < -0.005) problems.push(`Negative branch stock: ${b.name} ${pid}`);
  return { ok: problems.length === 0, problems };
}

export function liveToday(s) {
  const revenue = round2(-dayDeltaNat(s, "sales")), cogs = dayDeltaNat(s, "cogs");
  return { revenue, cogs, gross: round2(revenue - cogs), customers: s.today.customers, served: s.today.served, lost: s.today.lost, units: s.today.units };
}

export function upcomingCharges(s) {
  const out = [{ label: "Rent", amount: rent(s) }, { label: "Utilities", amount: utilities(s) }];
  if (s.staff.length) out.push({ label: "Wages", amount: wagesPerDay(s) });
  for (const l of s.loans) { out.push({ label: `${l.name} interest`, amount: round2(l.remaining * l.dailyRate) }); out.push({ label: `${l.name} installment`, amount: Math.min(l.remaining, l.installment) }); }
  if (bal(s, "overdraft") > 0) out.push({ label: "Overdraft interest", amount: round2(bal(s, "overdraft") * D.OVERDRAFT_RATE) });
  if (s.day % 7 === 0) out.push({ label: "Weekly tax (if profitable)", amount: null });
  return out;
}

export function alerts(s) {
  const a = [];
  for (const p of D.PRODUCTS) {
    if (!isUnlocked(s, p.id)) continue;
    const st = s.stock[p.id];
    if (st.shelf + st.wh === 0 && incomingOf(s, p.id) === 0) a.push({ kind: "warn", text: `${p.name} is sold out everywhere.`, panel: "procure" });
    else if (st.shelf < 4 && st.wh > 0) a.push({ kind: "warn", text: `${p.name} is low on the shelf. Restock from the warehouse.`, panel: "store" });
    else if (st.shelf < 4 && st.wh === 0 && incomingOf(s, p.id) === 0) a.push({ kind: "warn", text: `${p.name} is nearly out. Order more.`, panel: "procure" });
  }
  const dem = unitDemand(s);
  for (const p of D.PRODUCTS) {
    if (!isUnlocked(s, p.id) || !dem[p.id]) continue;
    const have = unitsTotal(s, p.id) + incomingOf(s, p.id);
    if (have > 0 && have < dem[p.id] && !a.some(x => x.text.startsWith(p.name))) a.push({ kind: "info", text: `${p.name}: stock covers less than a day of expected demand (~${Math.round(dem[p.id])} units/day).`, panel: "procure" });
  }
  if (whUsed(s) + incomingUnits(s) > whCap(s) * 0.9) a.push({ kind: "info", text: "Warehouse is almost full.", panel: "upgrades" });
  const od = bal(s, "overdraft");
  if (od > 0) a.push({ kind: "bad", text: `Overdraft $${od.toFixed(2)}. It costs ${(D.OVERDRAFT_RATE * 100).toFixed(0)}% interest per day.`, panel: "bank" });
  return a.slice(0, 6);
}

// ---------- save / load ----------
// Customers are not saved. Items already in their baskets left the shelf but their cost is still in the inventory
// ledger, so the save puts them back on the shelf (in a copy: the live state is never touched).
export function serialize(s) {
  const stock = JSON.parse(JSON.stringify(s.stock));
  for (const c of s.customers || []) for (const pid of c.basket || []) if (stock[pid]) stock[pid].shelf++;
  return JSON.stringify({ ...s, stock, customers: [], derived: null });
}

const isNum = v => typeof v === "number" && Number.isFinite(v);
const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
const isArr = (v, max = 5000) => Array.isArray(v) && v.length <= max;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Returns a short description of the first malformed part of a save, or null. Everything the engine, the score and
// the multiplayer verifier read later is checked here, so a crafted save is rejected instead of throwing deep in the code.
const rivalsOk = a => isArr(a, 8) && a.every(r => isObj(r) && isNum(r.id) && typeof r.name === "string" && has(RIVAL_KINDS, r.kind) && [r.base, r.price, r.quality, r.avail].every(isNum) && r.price > 0.5 && r.price < 3 && r.avail >= 0 && r.avail <= 1 && Number.isInteger(r.promo) && r.promo >= 0 && r.promo <= 5);
function saveShapeError(o) {
  if (typeof o.loc !== "string" || !LOC.hasLocation(o.loc)) return "location";
  if (!isArr(o.campaigns, 10) || !o.campaigns.every(c => isObj(c) && D.CAMPAIGNS.some(d => d.id === c.kind) && Number.isInteger(c.start) && Number.isInteger(c.days) && c.days >= 1 && c.days <= 30 && isNum(c.lift) && c.lift >= 0 && c.lift <= 1) || !isNum(o.campSeq)) return "campaigns";
  if (!isObj(o.supIdx) || !isObj(o.supRec) || !D.SUPPLIERS.every(x => isNum(o.supIdx[x.id]) && o.supIdx[x.id] >= 0.5 && o.supIdx[x.id] <= 2 && isObj(o.supRec[x.id]) && isNum(o.supRec[x.id].n) && isNum(o.supRec[x.id].late))) return "supplier records";
  if (!isObj(o.budget) || !isNum(o.budget.revenue) || !isNum(o.budget.expenses) || !isNum(o.noise) || o.noise < 0.5 || o.noise > 1.5) return "budget";
  if (!["unitsSold", "fcErr", "fcDays", "budgetDays", "budgetHit"].every(k => isNum(o.stats?.[k]))) return "statistics";
  if (!rivalsOk(o.rivals) || !isNum(o.shareLast) || !isNum(o.stockoutRate)) return "rivals";
  if (!isArr(o.invoices, 100) || !o.invoices.every(v => isObj(v) && isNum(v.id) && Number.isInteger(v.order) && typeof v.supplier === "string" && has(SUPPLIER, v.supplier) && isNum(v.amount) && v.amount > 0 && v.amount < 1e6 && Number.isInteger(v.due) && Number.isInteger(v.late) && v.late >= 0) || !isNum(o.invSeq)) return "invoices";
  if (!isArr(o.branches, 2) || !isNum(o.branchSeq) || !o.branches.every(b => isObj(b) && isNum(b.id) && typeof b.name === "string" && LOC.hasLocation(b.loc) && Number.isInteger(b.opened) && Number.isInteger(b.staff) && b.staff >= 1 && b.staff <= 3 && isNum(b.rep) && b.rep >= 0 && b.rep <= 100 && isNum(b.so) && isNum(b.fit) && b.fit >= 0 &&
    isObj(b.stock) && isObj(b.val) && D.PRODUCTS.every(p => Number.isInteger(b.stock[p.id]) && b.stock[p.id] >= 0 && b.stock[p.id] <= 1000 && isNum(b.val[p.id]) && b.val[p.id] >= 0) && rivalsOk(b.rivals) && (b.last == null || (isObj(b.last) && ["day", "customers", "capLost", "revenue", "cogs", "units", "so", "share", "rent", "utilities", "wages", "net"].every(k => isNum(b.last[k])))))) return "branches";
  if (!isObj(o.stats) || !isNum(o.stats.customers) || !isNum(o.stats.totalSales) || !isNum(o.stats.bestDay) || !isObj(o.stats.units) || (o.stats.stockLost != null && !isNum(o.stats.stockLost))) return "statistics";
  if (!isArr(o.history, 200) || !o.history.every(h => isObj(h) && [h.revenue, h.net, h.customers, h.liquid, h.netWorth].every(isNum))) return "history";
  if (!isObj(o.archive) || !isNum(o.archive.days) || !isNum(o.archive.revenue) || !isNum(o.archive.profit)) return "archive";
  if (!isArr(o.staff, 50) || !o.staff.every(x => isObj(x) && isNum(x.id) && typeof x.role === "string" && has(D.ROLES, x.role) && Number.isInteger(x.skill) && x.skill >= 1 && x.skill <= 5 && isNum(x.wage) && x.wage >= 0 && x.wage <= 1e4)) return "staff";
  if (!isObj(o.upgrades) || !D.UPGRADES.every(u => Number.isInteger(o.upgrades[u.id]) && o.upgrades[u.id] >= 0 && o.upgrades[u.id] <= u.max)) return "upgrades";
  if (!isArr(o.loans, 10) || !o.loans.every(l => isObj(l) && isNum(l.id) && typeof l.kind === "string" && typeof l.name === "string" && isNum(l.remaining) && l.remaining >= 0 && isNum(l.dailyRate) && l.dailyRate >= 0 && l.dailyRate <= 1 && isNum(l.installment) && l.installment >= 0 && (l.daysLeft == null || isNum(l.daysLeft)))) return "loans";
  if (!isObj(o.prices) || !D.PRODUCTS.every(p => isNum(o.prices[p.id]) && o.prices[p.id] > 0 && o.prices[p.id] <= 1e4)) return "prices";
  if (!isObj(o.val) || !D.PRODUCTS.every(p => isNum(o.val[p.id]))) return "inventory values";
  if (!isObj(o.shelfTarget) || !D.PRODUCTS.every(p => Number.isInteger(o.shelfTarget[p.id]) && o.shelfTarget[p.id] >= 0)) return "shelf targets";
  if (!isObj(o.ledger) || !isObj(o.ledger.bal) || !Object.keys(ACCOUNTS).every(k => isNum(o.ledger.bal[k])) || !isArr(o.ledger.entries, 5000) || !isNum(o.ledger.seq)) return "ledger";
  if (!isArr(o.orders, 100) || !o.orders.every(x => isObj(x) && isNum(x.id) && isNum(x.goods) && x.goods >= 0 && Number.isInteger(x.units) && typeof x.status === "string" && isNum(x.t) && isNum(x.lead) && typeof x.supplier === "string" && has(SUPPLIER, x.supplier) && (x.pay === "bank" || x.pay === "cash" || x.pay === "terms") &&
    isArr(x.lines, 20) && x.lines.every(l => isObj(l) && typeof l.pid === "string" && has(PRODUCT, l.pid) && Number.isInteger(l.qty) && l.qty >= 0 && isNum(l.total)))) return "orders";
  if (!isArr(o.tasks, 100) || !o.tasks.every(t => isObj(t) && typeof t.pid === "string" && has(PRODUCT, t.pid) && Number.isInteger(t.qty) && Number.isInteger(t.done))) return "restock tasks";
  if (!isObj(o.events) || !isArr(o.events.active, 50) || !o.events.active.every(e => isObj(e) && D.EVENTS.some(x => x.id === e.id) && isNum(e.daysLeft)) || !isArr(o.events.todayText, 50)) return "events";
  for (const k of ["candidates", "log", "decisions", "milestones", "cmdSeen", "doneOrders"]) if (!isArr(o[k], 1000)) return k;
  if (!isNum(o.sat) || !isNum(o.rep) || !isNum(o.capital) || !(o.difficulty in D.DIFFICULTY)) return "settings";
  if (o.ended != null && (!isObj(o.ended) || typeof o.ended.reason !== "string")) return "end state";
  if (o.today != null && (!isObj(o.today) || !isObj(o.today.lost) || !isObj(o.today.units) || !isObj(o.today.lostBy) || !isArr(o.today.events, 100))) return "today";
  return null;
}

// v3 -> v4: the always-on marketing level is replaced by booked campaigns; suppliers and budgets get neutral defaults.
function migrateV3(o) {
  delete o.marketing;
  Object.assign(o, { v: 4, campaigns: [], campSeq: 0, supIdx: { freshfarm: 1, metro: 1, quickship: 1 }, supRec: { freshfarm: { n: 0, late: 0 }, metro: { n: 0, late: 0 }, quickship: { n: 0, late: 0 } }, budget: { revenue: 0, expenses: 0 }, noise: 1, forecastToday: null });
  if (isObj(o.stats)) Object.assign(o.stats, { unitsSold: Object.values(o.stats.units || {}).reduce((a, b) => a + (isNum(b) ? b : 0), 0), fcErr: 0, fcDays: 0, budgetDays: 0, budgetHit: 0 });
  if (isObj(o.today)) delete o.today.mktCost;
}

export function validateSave(raw) {
  let o;
  try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return { ok: false, error: "Save file is corrupted (not valid JSON)." }; }
  if (!o || typeof o !== "object") return { ok: false, error: "Save file is empty." };
  if (o.v === 3) migrateV3(o);
  if (o.v === 4) { o.v = 5; o.loc = "default"; }
  if (o.v === 5) { o.v = 6; o.shareLast = 1; o.stockoutRate = 0; o.rivals = LOC.hasLocation(o.loc) ? makeRivals(o, (Number(o.rng) | 0) ^ 0x5bd1e995) : []; }
  if (o.v === 6) { o.v = 7; o.invoices = []; o.invSeq = 0; if (isObj(o.ledger) && isObj(o.ledger.bal) && !has(o.ledger.bal, "payables")) o.ledger.bal.payables = 0; }
  if (o.v === 7) { o.v = 8; o.branches = []; o.branchSeq = 0; }
  if (o.v !== D.SAVE_VERSION) return { ok: false, error: `This save is from an older version (v${o.v ?? "?"}). Start a new game; old shop-prototype saves cannot be migrated.` };
  const need = ["mode", "day", "clock", "ledger", "stock", "val", "prices", "orders", "staff", "upgrades", "loans", "rng"];
  for (const k of need) if (!(k in o)) return { ok: false, error: `Save is missing "${k}".` };
  if (!["standard", "infinite"].includes(o.mode)) return { ok: false, error: "Unknown game mode in save." };
  if (!Number.isInteger(o.day) || o.day < 1 || !Number.isFinite(o.clock)) return { ok: false, error: "Save has invalid time data." };
  if (!isObj(o.stock)) return { ok: false, error: "Save has invalid stock." };
  for (const pr of D.PRODUCTS) { const st = o.stock[pr.id]; if (!st || !Number.isInteger(st.wh) || !Number.isInteger(st.shelf) || st.wh < 0 || st.shelf < 0) return { ok: false, error: "Save has invalid stock for " + pr.id + "." }; }
  try {
    const bad = saveShapeError(o);
    if (bad) return { ok: false, error: `Save has invalid ${bad}.` };
    if (!totals(o.ledger).balanced) return { ok: false, error: "Save failed the accounting check (ledger does not balance)." };
    o.customers = []; o.spawnAcc = 0;
    o.today = o.today || { customers: 0, served: 0, units: {}, lost: { stockout: 0, price: 0, patience: 0 }, lostBy: {}, waitSum: 0, waitN: 0, events: [], notes: [] };
    if (!o.dayStart) o.dayStart = { ...o.ledger.bal };
    updateDerived(o);
  } catch { return { ok: false, error: "Save has an invalid structure." }; }
  return { ok: true, state: o };
}
