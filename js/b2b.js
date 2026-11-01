// Wholesale and B2B tenders (spec module 5). Institutional buyers post tenders; the player bids against rival suppliers.
// Winner: price, reputation and fulfilment record. Delivery comes from the warehouse (retail goods) or the factory (juices).
// Late or missing delivery costs money and reputation. Uses its own random stream.
import { post, balance, round2 } from "./ledger.js";
import * as D from "./data.js";
import { streamNext, seedFrom } from "./rng.js";
import { log, PRODUCT } from "./engine.js";
import { JUICE } from "./factory.js";
import { salesEdge } from "./hr.js";

const c = round2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const err = error => ({ ok: false, error }), ok = (o = {}) => ({ ok: true, ...o });
const BUYER = Object.fromEntries(D.B2B.buyers.map(b => [b.id, b]));
const RIVAL = Object.fromEntries(D.B2B.rivals.map(r => [r.id, r]));
export const itemInfo = pid => PRODUCT[pid] || JUICE[pid] || null;
const refPrice = pid => itemInfo(pid).ref;

export function newB2B(seed = 0) {
  return { rng: seedFrom(seed, 0xb2b), seq: 0, open: [], active: [], history: [], rep: 50, ontime: 0, late: 0, won: 0, lost: 0 };
}
export const ensureB2B = s => (s.b2b = s.b2b || newB2B(s.seed));
const rr = (b, lo, hi) => lo + (hi - lo) * streamNext(b);
const ri = (b, lo, hi) => Math.floor(rr(b, lo, hi + 1));
const wf = () => D.B2B.weights;
export const reliabilityOf = b => { const n = b.ontime + b.late; return n ? b.ontime / n : 1; };

// Stock the player could deliver right now for an item.
export function available(s, pid) {
  if (PRODUCT[pid]) return s.wh.qty[pid] || 0;
  if (JUICE[pid]) return (s.fx && s.fx.fg.qty[pid]) || 0;
  return 0;
}

// ---------- daily: resolve closed tenders, apply late penalties, open new ones ----------
export function b2bDay(s) {
  const b = ensureB2B(s);
  for (const t of b.open.filter(x => x.closes <= s.day)) resolve(s, b, t);
  b.open = b.open.filter(x => x.closes > s.day);
  for (const k of b.active) if (k.status === "active" && s.day > k.due) late(s, b, k);
  b.active = b.active.filter(k => k.status === "active");
  const [lo, hi] = D.B2B.tendersPerDay, n = ri(b, lo, hi);
  for (let i = 0; i < n; i++) open(s, b);
  const [flo, fhi] = D.B2B.fixedDeals.perDay; for (let i = ri(b, flo, fhi); i > 0; i--) openFixed(s, b);
  if (b.history.length > 60) b.history.splice(0, b.history.length - 60);
}
function mkTender(s, b, kind) {
  const buyer = D.B2B.buyers[ri(b, 0, D.B2B.buyers.length - 1)], pid = buyer.want[ri(b, 0, buyer.want.length - 1)];
  const qty = Math.round(rr(b, buyer.qty[0], buyer.qty[1]) / 100) * 100;
  return { id: ++b.seq, kind, buyer: buyer.id, pid, qty, ceiling: c(refPrice(pid) * buyer.ceiling), due: s.day + ri(b, buyer.dueDays[0], buyer.dueDays[1]), penalty: buyer.penalty, posted: s.day, bid: null };
}
function open(s, b) {
  const t = mkTender(s, b, "tender"); t.closes = s.day + D.B2B.openDays; b.open.push(t);
}
function openFixed(s, b) {
  const t = mkTender(s, b, "fixed"); t.price = c(refPrice(t.pid) * (1 - D.B2B.fixedDeals.discount)); t.qty = Math.round(t.qty * 0.6 / 100) * 100; t.due = s.day + 3; t.closes = s.day + 2; b.open.push(t);
}

// ---------- bidding ----------
export function placeBid(s, { tender, price } = {}) {
  if (s.ended) return err("The game is over.");
  const b = ensureB2B(s), t = b.open.find(x => x.id === tender); if (!t) return err("This tender is closed.");
  if (t.kind !== "tender") return err("Fixed deals are accepted, not bid on.");
  price = c(Number(price)); if (!Number.isFinite(price) || price <= 0) return err("Enter a price per unit.");
  if (price > t.ceiling) return err(`The buyer's ceiling is $${t.ceiling.toFixed(2)} per unit.`);
  t.bid = price; return ok({ tender: t });
}
export function withdrawBid(s, tender) { const t = ensureB2B(s).open.find(x => x.id === tender); if (!t) return err("This tender is closed."); t.bid = null; return ok(); }
export function acceptDeal(s, tender) {
  if (s.ended) return err("The game is over.");
  const b = ensureB2B(s), t = b.open.find(x => x.id === tender); if (!t) return err("This deal is gone.");
  if (t.kind !== "fixed") return err("This one is a tender: place a bid.");
  b.open = b.open.filter(x => x !== t); award(s, b, t, t.price, "Fixed deal"); return ok();
}
const playerScore = (s, b, t, price) => salesEdge(s) + wf().price * (1 - price / t.ceiling) + wf().reputation * (b.rep / 100) + wf().reliability * reliabilityOf(b);
function resolve(s, b, t) {
  if (t.kind === "fixed") { b.history.push({ ...t, result: "expired", day: s.day }); return; }
  let best = { who: null, score: -Infinity, price: 0 };
  for (const r of D.B2B.rivals) {
    const p = c(t.ceiling * r.aggression * (0.96 + 0.08 * streamNext(b))), sc = wf().price * (1 - p / t.ceiling) + wf().reputation * (0.4 + 0.5 * streamNext(b)) + wf().reliability * r.reliability;
    if (sc > best.score) best = { who: r.id, score: sc, price: p };
  }
  if (t.bid != null && playerScore(s, b, t, t.bid) >= best.score) { award(s, b, t, t.bid, "Tender"); b.won++; }
  else { b.history.push({ ...t, result: t.bid == null ? "no bid" : "lost", winner: best.who, winPrice: best.price, day: s.day }); if (t.bid != null) b.lost++; }
}
function award(s, b, t, price, how) {
  const k = { id: t.id, buyer: t.buyer, pid: t.pid, qty: t.qty, price, due: t.due, penalty: t.penalty, status: "active", awarded: s.day, lateDays: 0, fined: 0 };
  b.active.push(k); log(s, `${how} won: ${BUYER[t.buyer].name} wants ${t.qty.toLocaleString("en-US")} ${itemInfo(t.pid).name} at $${price.toFixed(2)} by day ${t.due}.`);
}

// ---------- delivery ----------
export function quoteDelivery(s, id) {
  const k = ensureB2B(s).active.find(x => x.id === id); if (!k) return err("Unknown contract.");
  const have = available(s, k.pid), value = c(k.qty * k.price), errors = [];
  if (have < k.qty) errors.push(`Not enough stock: need ${k.qty.toLocaleString("en-US")}, have ${have.toLocaleString("en-US")} ${PRODUCT[k.pid] ? "in the warehouse" : "at the factory"}.`);
  return { id, qty: k.qty, value, errors, ok: !errors.length };
}
export function deliver(s, id) {
  if (s.ended) return err("The game is over.");
  const b = ensureB2B(s), q = quoteDelivery(s, id); if (q.error) return err(q.error); if (!q.ok) return err(q.errors[0]);
  const k = b.active.find(x => x.id === id), retail = !!PRODUCT[k.pid], src = retail ? s.wh : s.fx.fg, have = src.qty[k.pid];
  const cost = k.qty >= have ? src.val[k.pid] : c(src.val[k.pid] / have * k.qty);
  src.qty[k.pid] -= k.qty; src.val[k.pid] = c(src.val[k.pid] - cost);
  post(s.ledger, s.day, `B2B delivery #${k.id} to ${BUYER[k.buyer].name}`, [{ acct: "cash", dr: q.value }, { acct: "sales_b2b", cr: q.value }], "b2b:" + k.id);
  post(s.ledger, s.day, `Cost of B2B delivery #${k.id}`, [{ acct: "cogs", dr: cost }, { acct: retail ? "inventory" : "inv_fg", cr: cost }], "b2b:" + k.id);
  const onTime = s.day <= k.due;
  if (onTime) { b.ontime++; b.rep = clamp(b.rep + D.B2B.reputationGain, 0, 100); } else { b.late++; }
  k.status = "done"; b.history.push({ ...k, result: onTime ? "on time" : "late", revenue: q.value, day: s.day }); b.active = b.active.filter(x => x !== k);
  log(s, `Delivered #${k.id}: ${k.qty.toLocaleString("en-US")} ${itemInfo(k.pid).name} for $${q.value.toFixed(2)}${onTime ? "" : " (late)"}.`);
  return ok({ revenue: q.value, cogs: cost });
}
function late(s, b, k) {
  k.lateDays++; const value = c(k.qty * k.price);
  if (k.lateDays > 5) {                                        // breach: contract cancelled, full penalty, big reputation hit
    const fee = c(value * k.penalty); payPenalty(s, fee, `Contract #${k.id} breached`);
    k.status = "breached"; b.late++; b.rep = clamp(b.rep - D.B2B.reputationLoss * 2, 0, 100); b.history.push({ ...k, result: "breached", penaltyPaid: fee, day: s.day });
    log(s, `Contract #${k.id} breached. Penalty $${fee.toFixed(2)}.`); return;
  }
  const fee = c(value * D.B2B.latePenaltyPerDay); payPenalty(s, fee, `Late contract #${k.id} (day ${k.lateDays})`); k.fined = c(k.fined + fee);
  b.rep = clamp(b.rep - D.B2B.reputationLoss / 2, 0, 100);
}
function payPenalty(s, amount, memo) {
  amount = c(amount); if (amount <= 0) return;
  const cash = Math.max(0, balance(s.ledger, "cash")), paid = c(Math.min(cash, amount)), short = c(amount - paid);
  const lines = [{ acct: "penalties", dr: amount }]; if (paid > 0) lines.push({ acct: "cash", cr: paid }); if (short > 0) lines.push({ acct: "overdraft", cr: short });
  post(s.ledger, s.day, memo, lines, "pen:" + s.day);
}
