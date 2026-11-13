// Shelf life and stock takes for the shop's own stock.
// Shelf life: perishable products (those with a `shelf` in the data, today only milk) are tracked in age batches. The batches are rebuilt each night from the
// stock count: any rise is a new batch dated today, any fall is taken from the oldest batch first. So every way stock can arrive or leave stays correct.
// A batch past its shelf life is thrown away and booked as a loss at the average cost.
// Stock takes: a little stock goes missing every day (miscounts, damage, theft). It is not booked until someone counts. A count costs staff time, books
// what is missing, and for two weeks afterwards the loss runs at half the rate.
import { post, balance, round2 } from "./ledger.js";
import { streamNext, seedFrom } from "./rng.js";
import * as D from "./data.js";
import { log } from "./engine.js";
import { mailPost } from "./mail.js";

const c = round2, err = error => ({ ok: false, error }), ok = (o = {}) => ({ ok: true, ...o });
export const STOCK = { dailyLoss: 0.003, afterCount: 0.5, calmDays: 14, countFee: 60, countEvery: 3, soonDays: 3 };
export const newStk = seed => ({ rng: seedFrom(seed, 0x57c4), age: {}, gap: {}, last: 0, counts: 0, spoiled: 0, spoiledValue: 0, missing: 0, missingValue: 0 });
export const ensureStk = s => (s.stk = s.stk || newStk(s.seed));
export const perishables = () => D.PRODUCTS.filter(p => p.shelf > 0);
const avg = (s, pid) => (s.qty[pid] > 0 ? s.val[pid] / s.qty[pid] : 0);

function writeOff(s, pid, units, memo, ref) {
  units = Math.min(Math.floor(units), s.qty[pid]); if (units < 1) return 0;
  const value = units >= s.qty[pid] ? s.val[pid] : c(avg(s, pid) * units);
  s.qty[pid] -= units; s.val[pid] = c(s.val[pid] - value);
  if (value > 0) post(s.ledger, s.day, memo, [{ acct: "shrinkage", dr: value }, { acct: "inventory", cr: value }], ref);
  return value;
}

// Bring one product's batches in line with its stock count.
function syncBatches(s, p) {
  const k = ensureStk(s), list = k.age[p.id] || (k.age[p.id] = []), tracked = list.reduce((a, b) => a + b.q, 0), now = s.qty[p.id];
  if (now > tracked) list.push({ q: now - tracked, d: s.day });
  else if (now < tracked) { let drop = tracked - now; while (drop > 0 && list.length) { const b = list[0], t = Math.min(b.q, drop); b.q -= t; drop -= t; if (b.q <= 0) list.shift(); } }
}
export const batchesOf = (s, pid) => (ensureStk(s).age[pid] || []).map(b => ({ ...b, left: (D.PRODUCTS.find(p => p.id === pid).shelf || 0) - (s.day - b.d) }));

export function stockDay(s) {
  const k = ensureStk(s);
  for (const p of perishables()) {
    syncBatches(s, p);
    const list = k.age[p.id], dead = list.filter(b => s.day - b.d >= p.shelf), n = dead.reduce((a, b) => a + b.q, 0);
    if (n > 0) {
      k.age[p.id] = list.filter(b => s.day - b.d < p.shelf);
      const v = writeOff(s, p.id, n, `Spoiled: ${n} ${p.name} past shelf life`, `stk:spoil:${p.id}:${s.day}`);
      k.spoiled += n; k.spoiledValue = c(k.spoiledValue + v);
      log(s, `${n} ${p.name} went off and were thrown away ($${v.toFixed(2)}).`);
      if (v >= 20) mailPost(s, { from: "Store", subject: `${p.name} spoiled`, body: `${n} units passed their shelf life of ${p.shelf} days and were thrown away, a loss of $${v.toFixed(2)}. Order smaller batches, or lower the price while stock is ageing.`, goto: ["retail", "freshness"], level: "warn" });
    }
    syncBatches(s, p);
  }
  // Quiet loss: stock goes missing and nobody knows until a count.
  const calm = s.day - k.last < STOCK.calmDays && k.last > 0, rate = STOCK.dailyLoss * (calm ? STOCK.afterCount : 1), o = k;
  for (const p of D.PRODUCTS) { const q = s.qty[p.id]; k.gap[p.id] = Math.min(q, (k.gap[p.id] || 0) + q * rate * (0.5 + streamNext(o))); }
}

export const daysSinceCount = s => (ensureStk(s).last ? s.day - s.stk.last : null);
export const canCount = s => s.day - ensureStk(s).last >= STOCK.countEvery || ensureStk(s).last === 0;

// Count the shelves: book what is missing. Costs staff time.
export function stockTake(s) {
  const k = ensureStk(s);
  if (s.ended) return err("The game is over.");
  if (!canCount(s)) return err(`You counted ${s.day - k.last} day${s.day - k.last === 1 ? "" : "s"} ago. Count again in ${STOCK.countEvery - (s.day - k.last)} more.`);
  const fee = STOCK.countFee, cash = balance(s.ledger, "cash"); if (cash + 0.004 < fee) return err(`A count costs $${fee} in staff time and you have $${c(cash).toFixed(2)}.`);
  post(s.ledger, s.day, "Stock take: staff time", [{ acct: "wages", dr: fee }, { acct: "cash", cr: fee }], "stk:count:" + s.day);
  const found = []; let total = 0;
  for (const p of D.PRODUCTS) { const units = Math.floor(k.gap[p.id] || 0), v = writeOff(s, p.id, units, `Stock take: ${units} ${p.name} missing`, `stk:miss:${p.id}:${s.day}`); if (units > 0) { found.push({ pid: p.id, name: p.name, units, value: v }); total = c(total + v); k.missing += units; k.gap[p.id] = (k.gap[p.id] || 0) - units; } }
  k.missingValue = c(k.missingValue + total); k.last = s.day; k.counts++;
  for (const p of perishables()) syncBatches(s, p);
  log(s, found.length ? `Stock take found ${found.map(f => `${f.units} ${f.name}`).join(", ")} missing ($${total.toFixed(2)}).` : "Stock take: every count matched the books.");
  return ok({ fee, found, total });
}
