// Blanket and future-dated purchase orders.
// A blanket order is one agreement with a supplier for a total quantity of one product, delivered in several shipments on a schedule. The unit price is
// fixed on the day you agree, using the volume discount for the WHOLE quantity, so it can be cheaper than buying the same units one order at a time, and it
// is safe from price drift. Each shipment is paid, shipped and delivered like a normal order on its own day (with its own shipping fee). A future-dated order
// is the same thing with one shipment that starts later.
// If cash or shop space is short on a shipment day, that shipment waits a day. After three waits in a row it is dropped and the agreement is ended.
// Only shop deliveries (not the warehouse), and only games that have the feature (s.blk) use it, so older saves play as before.
import { placeOrders, quoteMulti, discountFor, unitCost, SUPPLIER, PRODUCT, log } from "./engine.js";
import * as D from "./data.js";
import { round2 } from "./ledger.js";
import { mailPost } from "./mail.js";

const c = round2, err = error => ({ ok: false, error }), ok = (o = {}) => ({ ok: true, ...o });
export const BLK = { counts: [1, 2, 3, 4, 6], starts: [0, 3, 7, 14], gaps: [3, 7, 14], maxWaits: 3, maxOpen: 6, keep: 12 };
export const ensureBlk = s => (s.blk = s.blk || { seq: 0, list: [], saved: 0 });
const per = (total, count, i) => Math.floor(total / count) + (i < total % count ? 1 : 0);   // spreads any remainder over the first shipments

// What you would agree today: locked unit price, and the shipment schedule.
export function blanketQuote(s, { supplier, pid, total, count = 2, start = 0, gap = 7 } = {}) {
  const sp = SUPPLIER[supplier]; total = Math.round(Number(total)); count = Math.round(Number(count)); start = Math.round(Number(start)); gap = Math.round(Number(gap));
  if (!sp || !D.SUPPLIERS.includes(sp)) return err("Choose a shop supplier.");
  if (!PRODUCT[pid]) return err("Choose a product.");
  if (!Number.isFinite(total) || total < 1) return err("Choose the total quantity.");
  if (!BLK.counts.includes(count) || !BLK.starts.includes(start) || !BLK.gaps.includes(gap)) return err("Choose the shipments and dates from the lists.");
  if (total > D.MAX_QTY * count) return err(`The most you can agree is ${(D.MAX_QTY * count).toLocaleString("en-US")} with ${count} shipments.`);
  if (Math.floor(total / count) < 1) return err("Each shipment needs at least one unit.");
  const disc = discountFor(total), base = unitCost(s, sp, pid), unit = c(base * (1 - disc)), single = c(base * (1 - discountFor(Math.floor(total / count))));
  const sched = Array.from({ length: count }, (_, i) => ({ day: s.day + start + i * gap, qty: per(total, count, i) }));
  return { ok: true, supplier, pid, total, count, start, gap, discount: disc, unit, goodsTotal: c(unit * total), saving: c(Math.max(0, single - unit) * total), sched, base };
}

export function createBlanket(s, o) {
  if (s.ended) return err("The game is over.");
  const q = blanketQuote(s, o); if (!q.ok) return q;
  const k = ensureBlk(s); if (k.list.filter(b => b.state === "open").length >= BLK.maxOpen) return err(`You can have at most ${BLK.maxOpen} open blanket orders.`);
  const b = { id: ++k.seq, sup: q.supplier, pid: q.pid, total: q.total, count: q.count, sched: q.sched.map(x => ({ ...x, done: false })), unit: q.unit, disc: q.discount, made: s.day, waits: 0, state: "open", got: 0, spent: 0 };
  k.list.push(b); k.saved = c(k.saved + q.saving);
  log(s, `Blanket order #${b.id}: ${q.total.toLocaleString("en-US")} ${PRODUCT[q.pid].name} from ${SUPPLIER[q.supplier].name} in ${q.count} shipment${q.count > 1 ? "s" : ""} at $${q.unit.toFixed(2)} each.`);
  return ok({ blanket: b, quote: q });
}
export function cancelBlanket(s, id) {
  const b = ensureBlk(s).list.find(x => x.id === Number(id) && x.state === "open"); if (!b) return err("That order is not open.");
  b.state = "cancelled"; log(s, `Blanket order #${b.id} cancelled. Shipments already sent stay yours; the rest will not come.`); return ok();
}
export const openBlankets = s => (s.blk ? s.blk.list.filter(b => b.state === "open") : []);
export const nextShip = b => b.sched.find(x => !x.done);

// Each morning: send any shipment that is due.
export function blanketDay(s) {
  if (!s.blk) return;
  for (const b of s.blk.list) {
    if (b.state !== "open") continue;
    const sh = nextShip(b); if (!sh || sh.day > s.day) continue;
    const lines = [{ pid: b.pid, qty: sh.qty }], q = quoteMulti(s, b.sup, lines, "retail", "hired", { [b.pid]: b.unit });
    const r = q.error || !q.ok ? null : placeOrders(s, { supplier: b.sup, lines, dest: "retail", carrier: "hired", lock: { [b.pid]: b.unit } });
    if (r && r.ok) { sh.done = true; sh.sent = s.day; b.waits = 0; b.got += sh.qty; b.spent = c(b.spent + r.total); if (!nextShip(b)) { b.state = "done"; log(s, `Blanket order #${b.id} is complete.`); } continue; }
    b.waits++;
    const why = (q.errors && q.errors[0]) || q.error || (r && r.error) || "could not ship";
    if (b.waits >= BLK.maxWaits) { b.state = "dropped"; mailPost(s, { from: SUPPLIER[b.sup].name, subject: `Blanket order #${b.id} ended`, body: `A shipment of ${sh.qty.toLocaleString("en-US")} ${PRODUCT[b.pid].name} could not go out for ${BLK.maxWaits} days (${why}) so the rest of the agreement is cancelled.`, goto: ["retail", "procurement"], level: "bad" }); }
    else if (b.waits === 1) mailPost(s, { from: SUPPLIER[b.sup].name, subject: `Blanket order #${b.id} is waiting`, body: `A shipment of ${sh.qty.toLocaleString("en-US")} ${PRODUCT[b.pid].name} is due but ${why} It will try again tomorrow, up to ${BLK.maxWaits} days.`, goto: ["retail", "procurement"], level: "info" });
  }
  const k = s.blk, closed = k.list.filter(b => b.state !== "open"); if (closed.length > BLK.keep) { const drop = new Set(closed.slice(0, closed.length - BLK.keep).map(b => b.id)); k.list = k.list.filter(b => !drop.has(b.id)); }
}
