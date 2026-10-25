// Pure game engine: no DOM, no network. All rules live here so they can be tested in Node.
import * as D from "./data.js";
import { newLedger, post, balance, totals, round2, OPEX } from "./ledger.js";

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
    v: D.SAVE_VERSION, mode, difficulty: opts.difficulty in D.DIFFICULTY ? opts.difficulty : "normal", dayLimit, capital,
    rng: (Number.isFinite(opts.seed) ? opts.seed : Math.floor(Math.random() * 2 ** 31)) | 0,
    day: 1, clock: 0, phase: "open", ended: null,
    ledger: newLedger(),
    stock: {}, val: {}, prices: {}, shelfTarget: {},
    orders: [], doneOrders: [], tasks: [], taskSeq: 0, orderSeq: 0,
    staff: [], candidates: [], staffSeq: 0,
    upgrades: { shelves: 0, racks: 0, counter: 0, dock: 0, signage: 0 },
    marketing: 0, autoDeposit: true,
    loans: [], loanSeq: 0, lastBailoutDay: -99, distressDays: 0,
    customers: [], custSeq: 0, spawnAcc: 0, autoT: 0,
    rep: 50, sat: 60,
    events: { active: [], todayText: [] },
    today: null, dayStart: null, history: [], archive: { days: 0, revenue: 0, profit: 0 }, lastReport: null,
    log: [], decisions: [], milestones: [],
    stats: { customers: 0, totalSales: 0, units: {}, tookLoan: false, bestDay: 0 },
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
    cash: bal(s, "cash"), bank: bal(s, "bank"), debt, loans: bal(s, "loan"), overdraft: bal(s, "overdraft"),
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
  let c = PRODUCT[pid].cost * sup.mult * diffOf(s).cost * inflation(s) * (ev ? 1.25 : 1);
  if (qtyTotal >= sup.bulkAt) c *= 1 - sup.bulkOff;
  return round2(Math.max(0.05, c));
}
export const rent = s => round2(diffOf(s).rent * inflation(s));
export const utilities = s => round2((diffOf(s).utilities + 3 * Object.values(s.upgrades).reduce((a, b) => a + b, 0)) * inflation(s));
export const MARKETING_COST = [0, 15, 35, 70];
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
  for (const e of s.events.active) { const def = D.EVENTS.find(x => x.id === e.id); s.events.todayText.push(e.text || def.text); }
  for (const t of s.events.todayText) logMsg(s, "event", t);
  const nowUnlocked = D.PRODUCTS.filter(p => p.unlockDay === s.day && s.day > 1);
  for (const p of nowUnlocked) logMsg(s, "info", `New product unlocked: ${p.name}.`);
  snapshotDayStart(s);
  s.today.openLiquid = s.derived ? s.derived.liquid : round2(bal(s, "cash") + bal(s, "bank"));
}

function rollEvents(s) {
  const f = diffOf(s).events;
  const add = (e) => { s.events.active.push(e); s.today.events.push(e.id); };
  if (rnd(s) < 0.08 * f) add({ id: "festival", daysLeft: 1 });
  else if (rnd(s) < 0.10 * f) add({ id: "rain", daysLeft: 1 });
  if (rnd(s) < 0.06 * f) { const sup = pickOf(s, D.SUPPLIERS); add({ id: "delay", daysLeft: 2, sup: sup.id, text: `${sup.name} has road trouble: deliveries take 60% longer for 2 days.` }); }
  if (rnd(s) < 0.08 * f) { const p = pickOf(s, D.PRODUCTS.filter(x => x.unlockDay <= s.day)); add({ id: "market", daysLeft: 3, pid: p.id, text: `Wholesale price of ${p.name} is +25% for 3 days.` }); }
  if (rnd(s) < 0.05 * f) add({ id: "repair", daysLeft: 1, amount: rint(s, 30, 80), text: "A fridge broke. The repair bill is charged at closing." });
}
const eventDemand = s => s.events.active.reduce((m, e) => m * (D.EVENTS.find(x => x.id === e.id).demand || 1), 1);
const DOW = [1.0, 0.9, 0.9, 1.0, 1.1, 1.35, 1.2];

export function expectedCustomers(s) {
  const d = diffOf(s);
  return 36 * d.demand * (0.6 + 0.9 * s.rep / 100) * (1 + 0.18 * s.marketing) * DOW[s.day % 7] * eventDemand(s) * (1 + Math.min(0.5, s.day * 0.004));
}

export function refreshCandidates(s) {
  s.candidates = [];
  const roles = Object.keys(D.ROLES);
  for (let i = 0; i < 6; i++) {
    const role = roles[i % roles.length], skill = rint(s, 1, 5);
    s.candidates.push({ id: ++s.staffSeq, name: pickOf(s, D.NAMES) + " " + String.fromCharCode(65 + rint(s, 0, 25)) + ".", role, skill,
      wage: round2(D.ROLES[role].base * (0.8 + 0.15 * skill)) });
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
  const sp = s.staff.filter(x => x.role === "cashier").map(x => 0.8 + 0.2 * x.skill).sort((a, b) => b - a).slice(0, lanes);
  while (sp.length < lanes && sp.length < 1) sp.push(0.7);   // the owner covers one lane
  return sp;
};
export const laneCount = s => cashierSpeeds(s).length;
const stockerRate = s => 0.5 + s.staff.filter(x => x.role === "stocker").reduce((a, x) => a + 0.6 * (0.7 + 0.15 * x.skill), 0);
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
  let busy = s.customers.filter(c => c.state === "pay").length;
  const queue = s.customers.filter(c => c.state === "queue");
  for (const c of s.customers) {
    c.t += dt;
    if (c.state === "enter" && c.t >= 2.5) { c.state = "browse"; c.t = 0; c.browse = 3 + c.want.length * 2.2; }
    else if (c.state === "browse" && c.t >= c.browse) finishBrowsing(s, c);
    else if (c.state === "queue") {
      c.wait += dt;
      if (c.wait > c.patience) abandon(s, c);
    } else if (c.state === "pay" && c.t >= c.payTime) checkout(s, c);
    else if (c.state === "leave" && c.t >= 2.5) c.state = "gone";
  }
  // move queued customers to free lanes (FIFO)
  for (const c of queue) {
    if (c.state !== "queue") continue;
    if (busy < lanes.length) { c.state = "pay"; c.t = 0; c.payTime = Math.max(1.2, (c.basket.length * 1.6 + 1) / lanes[busy]); c.lane = busy; busy++; s.today.waitSum += c.wait; s.today.waitN++; }
  }
  s.customers = s.customers.filter(c => c.state !== "gone");
}

function spawnCustomer(s) {
  const avail = D.PRODUCTS.filter(p => isUnlocked(s, p.id));
  const k = rnd(s) < 0.45 ? 1 : rnd(s) < 0.7 ? 2 : 3;
  const want = [];
  for (let i = 0; i < k; i++) {
    const w = avail.map(p => p.pop * clamp(Math.pow(p.ref / s.prices[p.id], 1.2), 0.6, 1.6));
    let r = rnd(s) * w.reduce((a, b) => a + b, 0), idx = 0;
    while (idx < w.length - 1 && (r -= w[idx]) > 0) idx++;
    if (!want.includes(avail[idx].id)) want.push(avail[idx].id);
  }
  s.customers.push({ id: ++s.custSeq, state: "enter", t: 0, want, basket: [], wait: 0, patience: 22 + rnd(s) * 18, look: Math.floor(rnd(s) * 1e6), lane: -1 });
  s.today.customers++; s.stats.customers++;
}

function mood(s, c, outcome) {
  const bonus = hasManager(s) ? 5 : 0;
  s.sat = clamp(s.sat * 0.97 + (outcome + bonus) * 0.03, 0, 100);
  s.rep = clamp(s.rep + (s.sat - s.rep) * 0.012, 0, 100);
}

function finishBrowsing(s, c) {
  for (const pid of c.want) {
    const p = PRODUCT[pid], price = s.prices[pid];
    const buyProb = Math.min(1, Math.pow(p.ref * 1.15 / price, 2));
    if (rnd(s) > buyProb) { s.today.lost.price++; s.today.lostBy[pid] = (s.today.lostBy[pid] || 0) + 1; continue; }
    let take = pid;
    if (s.stock[take].shelf < 1) {
      s.today.lost.stockout++; s.stats.stockLost = (s.stats.stockLost || 0) + 1; s.today.lostBy[pid] = (s.today.lostBy[pid] || 0) + 1;
      c.hadStockout = true;
      const alt = D.PRODUCTS.filter(x => x.cat === p.cat && x.id !== pid && isUnlocked(s, x.id) && s.stock[x.id].shelf > 0);
      if (alt.length && rnd(s) < 0.5) take = pickOf(s, alt).id; else continue;
    }
    const qty = rnd(s) < 0.8 ? 1 : 2;
    for (let i = 0; i < qty && s.stock[take].shelf > 0; i++) { s.stock[take].shelf--; c.basket.push(take); }   // reserved on the customer
  }
  if (!c.basket.length) { mood(s, c, c.hadStockout ? 30 : 45); c.state = "leave"; c.t = 0; return; }
  c.state = "queue"; c.t = 0;
}

function abandon(s, c) {
  for (const pid of c.basket) s.stock[pid].shelf++;     // items go back on the shelf
  c.basket = []; c.state = "leave"; c.t = 0;
  s.today.lost.patience++;
  mood(s, c, 12);
}

function checkout(s, c) {
  // group by product to keep ledger entries compact
  const lines = {};
  for (const pid of c.basket) lines[pid] = (lines[pid] || 0) + 1;
  let revenue = 0, cost = 0;
  for (const [pid, n] of Object.entries(lines)) {
    const total = unitsTotal(s, pid) + n;       // basket units already left the shelf count
    const unitVal = total > 0 ? s.val[pid] / total : 0;
    const remaining = unitsTotal(s, pid);       // units still in store (excluding this basket)
    const c1 = remaining === 0 ? s.val[pid] : round2(unitVal * n);
    s.val[pid] = round2(s.val[pid] - c1);
    cost = round2(cost + c1);
    revenue = round2(revenue + s.prices[pid] * n);
    s.today.units[pid] = (s.today.units[pid] || 0) + n;
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
  c.basket = []; c.state = "leave"; c.t = 0;
}

// ---------- closing the day ----------
function closeDay(s) {
  // customers still inside leave; reserved items go back on the shelf
  for (const c of s.customers) { for (const pid of c.basket) s.stock[pid].shelf++; c.basket = []; if (c.state === "queue" || c.state === "pay") { s.today.lost.patience++; } }
  s.customers = [];
  s.phase = "closing";
  const day = s.day;
  const rep = { day, charges: [], notes: [] };
  const charge = (acct, label, amount) => {
    if (amount <= 0) return;
    const sp = payOut(s, acct, amount, label);
    rep.charges.push({ acct, label, amount: round2(amount), over: sp.over });
  };
  // 1. sweep cash to bank (keeps the till float at $100)
  if (s.autoDeposit) { const sweep = round2(Math.max(0, bal(s, "cash") - 100)); if (sweep > 0) post(s.ledger, day, "Auto-deposit to bank", [{ acct: "bank", dr: sweep }, { acct: "cash", cr: sweep }]); }
  // 2. operating expenses (each charged exactly once, here)
  charge("rent", "Daily rent", rent(s));
  charge("utilities", "Utilities", utilities(s));
  charge("wages", "Staff wages", wagesPerDay(s));
  charge("marketing", "Marketing", MARKETING_COST[s.marketing]);
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
  s.loans = s.loans.filter(l => l.remaining > 0.004);
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
  s.lastReport = rep;
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
  if (prev) notes.push(prev.customers > t.customers ? `Fewer customers than yesterday (${t.customers} vs ${prev.customers}).` : `More customers than yesterday (${t.customers} vs ${prev.customers}).`);
  if (t.lost.stockout) { const worst = Object.entries(t.lostBy).sort((a, b) => b[1] - a[1])[0]; notes.push(`${t.lost.stockout} sales were lost to empty shelves${worst ? ` (most often ${PRODUCT[worst[0]].name})` : ""}.`); }
  if (t.lost.price) notes.push(`${t.lost.price} items were skipped because the price felt too high.`);
  if (t.lost.patience) notes.push(`${t.lost.patience} customers left after waiting too long. More checkout lanes or cashiers help.`);
  for (const id of t.events) notes.push(D.EVENTS.find(e => e.id === id).name + " affected today.");
  if (net < 0) notes.push("The day made a loss: expenses were higher than gross profit.");
  return { revenue, cogs, gross: round2(revenue - cogs), opex, expenses, net, customers: t.customers, served: t.served, lost: { ...t.lost },
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
  const growth = clamp(((d.netWorth - s.startNetWorth) / s.startNetWorth) / 2, 0, 1);
  const monthlyCost = (rent(s) + utilities(s) + wagesPerDay(s)) * 7;
  const cash = clamp(d.liquid / Math.max(1, monthlyCost), 0, 1);
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
    inventory: d.inventory, debt: d.debt, assets: d.assets, score: sc, decisions: s.decisions.slice(-12) };
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
const seen = (s, id) => {
  if (!id) return false;
  if (s.cmdSeen.includes(id)) return true;
  s.cmdSeen.push(id); if (s.cmdSeen.length > 200) s.cmdSeen.shift();
  return false;
};
const isInt = (n, a, b) => Number.isInteger(n) && n >= a && n <= b;
const isMoney = (n, max = 1e7) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= max;
const guard = s => (s.ended ? fail("The game has ended.") : null);

export function placeOrder(s, { supplier: sid, lines, pay = "bank", cmdId }) {
  const g = guard(s); if (g) return g;
  if (seen(s, cmdId)) return fail("Duplicate request ignored.");
  const sup = SUPPLIER[sid];
  if (!sup) return fail("Unknown supplier.");
  if (!Array.isArray(lines) || !lines.length || lines.length > 12) return fail("Add at least one product.");
  if (pay !== "bank" && pay !== "cash") return fail("Pay from bank or cash.");
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
  const priced = clean.map(l => { const unit = unitCost(s, sup, l.pid, units); return { ...l, unit, total: round2(unit * l.qty) }; });
  const goods = round2(priced.reduce((a, l) => a + l.total, 0)), fee = sup.fee, total = round2(goods + fee);
  if (bal(s, pay) < total) return fail(`Not enough ${pay === "bank" ? "bank balance" : "cash"}: need $${total.toFixed(2)}, have $${bal(s, pay).toFixed(2)}. Move money or take a loan.`);
  const id = ++s.orderSeq;
  post(s.ledger, s.day, `Order #${id} to ${sup.name}`, [{ acct: "transit", dr: goods }, { acct: "delivery", dr: fee }, { acct: pay, cr: total }], "order:" + id);
  const delayEv = s.events.active.find(e => e.id === "delay" && e.sup === sid);
  let lead = sup.lead * (delayEv ? 1.6 : 1), delayed = !!delayEv;
  if (rnd(s) > clamp(sup.reliability + diffOf(s).reliability, 0.5, 0.995)) { lead *= 1.5; delayed = true; }
  s.orders.push({ id, supplier: sid, lines: priced, units, goods, fee, total, pay, lead: round2(lead), t: 0, status: "processing", delayed, day: s.day });
  decide(s, `Ordered ${units} units from ${sup.name} ($${total.toFixed(2)})`);
  return okr({ id, total, lead: round2(lead), delayed });
}

export function cancelOrder(s, id) {
  const g = guard(s); if (g) return g;
  const o = s.orders.find(x => x.id === id);
  if (!o) return fail("Order not found.");
  if (o.status !== "processing") return fail("Only orders still being processed can be cancelled.");
  post(s.ledger, s.day, `Order #${id} cancelled (goods refunded, delivery fee kept)`, [{ acct: o.pay, dr: o.goods }, { acct: "transit", cr: o.goods }], "order:" + id);
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
export function setMarketing(s, lvl) { if (!isInt(lvl, 0, 3)) return fail("Level 0 to 3."); s.marketing = lvl; return okr(); }
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
  return okr();
}
export function withdraw(s, amount, cmdId) {
  const g = guard(s); if (g) return g;
  if (seen(s, cmdId)) return fail("Duplicate request ignored.");
  amount = round2(amount);
  if (!isMoney(amount)) return fail("Enter an amount above zero.");
  if (amount > bal(s, "bank")) return fail("Not enough in the bank.");
  post(s.ledger, s.day, "Withdraw from bank", [{ acct: "cash", dr: amount }, { acct: "bank", cr: amount }]);
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
  return okr({ cost });
}

// ---------- reports & reconciliation ----------
export function reconcile(s) {
  const t = totals(s.ledger);
  const tracked = round2(Object.values(s.val).reduce((a, b) => a + b, 0));
  const inLedger = bal(s, "inventory");
  const transit = round2(s.orders.reduce((a, o) => a + o.goods, 0));
  const loans = round2(s.loans.reduce((a, l) => a + l.remaining, 0));
  const problems = [];
  if (!t.balanced) problems.push("Ledger does not balance.");
  if (Math.abs(tracked - inLedger) > 0.05) problems.push(`Inventory ${tracked} vs ledger ${inLedger}.`);
  if (Math.abs(transit - bal(s, "transit")) > 0.05) problems.push(`Transit ${transit} vs ledger ${bal(s, "transit")}.`);
  if (Math.abs(loans - bal(s, "loan")) > 0.05) problems.push(`Loans ${loans} vs ledger ${bal(s, "loan")}.`);
  for (const [pid, st] of Object.entries(s.stock)) if (st.wh < 0 || st.shelf < 0) problems.push("Negative stock: " + pid);
  return { ok: problems.length === 0, problems };
}

export function liveToday(s) {
  const revenue = round2(-dayDeltaNat(s, "sales")), cogs = dayDeltaNat(s, "cogs");
  return { revenue, cogs, gross: round2(revenue - cogs), customers: s.today.customers, served: s.today.served, lost: s.today.lost, units: s.today.units };
}

export function upcomingCharges(s) {
  const out = [{ label: "Rent", amount: rent(s) }, { label: "Utilities", amount: utilities(s) }];
  if (s.staff.length) out.push({ label: "Wages", amount: wagesPerDay(s) });
  if (s.marketing) out.push({ label: "Marketing", amount: MARKETING_COST[s.marketing] });
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
  if (whUsed(s) + incomingUnits(s) > whCap(s) * 0.9) a.push({ kind: "info", text: "Warehouse is almost full.", panel: "upgrades" });
  const od = bal(s, "overdraft");
  if (od > 0) a.push({ kind: "bad", text: `Overdraft $${od.toFixed(2)}. It costs ${(D.OVERDRAFT_RATE * 100).toFixed(0)}% interest per day.`, panel: "bank" });
  return a.slice(0, 6);
}

// ---------- save / load ----------
export function serialize(s) {
  const copy = { ...s, customers: [], derived: null };
  return JSON.stringify(copy);
}
export function validateSave(raw) {
  let o;
  try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return { ok: false, error: "Save file is corrupted (not valid JSON)." }; }
  if (!o || typeof o !== "object") return { ok: false, error: "Save file is empty." };
  if (o.v !== D.SAVE_VERSION) return { ok: false, error: `This save is from an older version (v${o.v ?? "?"}). Start a new game; old shop-prototype saves cannot be migrated.` };
  const need = ["mode", "day", "clock", "ledger", "stock", "val", "prices", "orders", "staff", "upgrades", "loans", "rng"];
  for (const k of need) if (!(k in o)) return { ok: false, error: `Save is missing "${k}".` };
  if (!["standard", "infinite"].includes(o.mode)) return { ok: false, error: "Unknown game mode in save." };
  if (!Number.isInteger(o.day) || o.day < 1 || !Number.isFinite(o.clock)) return { ok: false, error: "Save has invalid time data." };
  for (const pr of D.PRODUCTS) { const st = o.stock[pr.id]; if (!st || !Number.isInteger(st.wh) || !Number.isInteger(st.shelf) || st.wh < 0 || st.shelf < 0) return { ok: false, error: "Save has invalid stock for " + pr.id + "." }; }
  if (!o.ledger.bal || !totals(o.ledger).balanced) return { ok: false, error: "Save failed the accounting check (ledger does not balance)." };
  o.customers = []; o.spawnAcc = 0;
  o.today = o.today || { customers: 0, served: 0, units: {}, lost: { stockout: 0, price: 0, patience: 0 }, lostBy: {}, waitSum: 0, waitN: 0, events: [], notes: [] };
  if (!o.dayStart) o.dayStart = { ...o.ledger.bal };
  updateDerived(o);
  return { ok: true, state: o };
}
