// Service jobs. Business clients post requests for quotation (RFQs). You quote a price; a client picks you with a chance that falls as your price
// rises and rises with your service reputation. A won job needs staff hours. Service staff give D.SVC.hoursPerStaff hours a day; the support desk keeps a
// share for tickets; the rest goes to jobs in the order you set, at most D.SVC.perJobPerDay hours per job per day. Paid on completion, less a cut for lateness.
import { post, balance, round2 } from "./ledger.js";
import { streamNext, seedFrom } from "./rng.js";
import * as D from "./data.js";
import { log } from "./engine.js";
import { mailPost } from "./mail.js";
import { ensureHr, serviceCapacity } from "./hr.js";
import { ensureSrv } from "./market.js";

const c = round2, clamp = (v, a, b) => Math.max(a, Math.min(b, v)), err = error => ({ ok: false, error }), ok = (o = {}) => ({ ok: true, ...o });
const TYPE = Object.fromEntries(D.SVC.types.map(t => [t.id, t]));
export const newSvc = seed => ({ rng: seedFrom(seed, 0x5e7c), seq: 0, rfqs: [], jobs: [], stats: { won: 0, lost: 0, done: 0, late: 0, cancelled: 0, revenue: 0, penalties: 0 } });
export const ensureSvc = s => (s.svcj = s.svcj || newSvc(s.seed));
export const typeOf = id => TYPE[id];

// Hours the service team can give to jobs today.
export function hoursToday(s) {
  const st = ensureHr(s).staff.service, morale = clamp(0.7 + 0.3 * ensureHr(s).morale / 100, 0.7, 1);
  return c(st.n * D.SVC.hoursPerStaff * clamp(st.skill, 0.5, 1.6) * morale * (1 - D.SVC.ticketShare));
}
export const marketPrice = r => c(TYPE[r.type].price * r.hours / TYPE[r.type].hours);
export function winChance(s, rfq, price) {
  const mult = price / marketPrice(rfq), rep = ensureSvc(s).stats.done;
  return c(clamp(0.9 - 1.6 * (mult - 0.85) + 0.003 * (ensureSrv(s).csi - 80) + 0.02 * Math.min(10, rep), 0.05, 0.95));
}

export function sendQuote(s, id, price) {
  const v = ensureSvc(s), r = v.rfqs.find(x => x.id === Number(id)); if (s.ended) return err("The game is over.");
  if (!r) return err("That request is gone."); if (r.quote != null) return err("You already sent a quote for this one.");
  if (hoursToday(s) <= 0) return err("You have no service staff to do the work. Hire service staff first.");
  price = c(Number(price)); const m = price / marketPrice(r);
  if (!Number.isFinite(price) || m < D.SVC.quoteMin || m > D.SVC.quoteMax) return err(`Quote between ${Math.round(D.SVC.quoteMin * 100)}% and ${Math.round(D.SVC.quoteMax * 100)}% of the market price.`);
  if (price > r.cap + 0.004) return err(`The client will not pay more than $${r.cap.toFixed(2)}.`);
  r.quote = price; r.quoted = s.day; return ok({ price, chance: winChance(s, r, price) });
}

// ---------- scheduling ----------
const order = v => v.jobs.slice().sort((a, b) => a.prio - b.prio);
export function allocate(s, hours = hoursToday(s)) {          // hours per job today, in priority order
  const v = ensureSvc(s), out = {}; let left = hours;
  for (const j of order(v)) { const h = Math.min(j.left, D.SVC.perJobPerDay, left); out[j.id] = c(h); left = c(left - h); }
  return out;
}
export function moveJob(s, id, dir) {
  const v = ensureSvc(s), o = order(v), i = o.findIndex(j => j.id === Number(id)), k = i + (dir < 0 ? -1 : 1);
  if (i < 0) return err("Unknown job."); if (k < 0 || k >= o.length) return ok();
  const t = o[i].prio; o[i].prio = o[k].prio; o[k].prio = t; return ok();
}
export function sortByDeadline(s) { const v = ensureSvc(s); order(v).sort((a, b) => a.deadline - b.deadline || a.id - b.id).forEach((j, i) => { j.prio = i + 1; }); return ok(); }
// Projected finish day for each job if nothing changes (capped at 90 days ahead).
export function project(s) {
  const v = ensureSvc(s), h = hoursToday(s), left = Object.fromEntries(v.jobs.map(j => [j.id, j.left])), fin = {};
  for (let d = 1; d <= 90 && Object.keys(fin).length < v.jobs.length; d++) { let free = h;
    for (const j of order(v)) { if (fin[j.id] != null) continue; const x = Math.min(left[j.id], D.SVC.perJobPerDay, free); left[j.id] = c(left[j.id] - x); free = c(free - x); if (left[j.id] <= 0.004) fin[j.id] = s.day + d - 1; } }
  return fin;
}

function finish(s, j, v) {
  const late = Math.max(0, s.day - j.deadline), cut = Math.min(D.SVC.lateCap, D.SVC.lateStep * late), pay = c(j.price * (1 - cut));
  post(s.ledger, s.day, `Service job #${j.id} (${TYPE[j.type].name}) for ${j.client}${late ? `, ${late} days late` : ""}`, [{ acct: "cash", dr: pay }, { acct: "sales_service", cr: pay }], `svc:${j.id}`);
  v.stats.done++; v.stats.revenue = c(v.stats.revenue + pay); if (late) { v.stats.late++; v.stats.penalties = c(v.stats.penalties + (j.price - pay)); }
  const sv = ensureSrv(s); sv.csi = c(clamp(sv.csi + (late ? -2 * Math.min(3, late) : 0.6), 0, 100));
  log(s, `Finished service job #${j.id} for ${j.client}: $${pay.toFixed(2)}${late ? ` (${late} days late)` : ""}.`);
}

export function svcDay(s) {
  const v = ensureSvc(s), o = v;
  // 1. work today's hours
  const alloc = allocate(s);
  for (const j of order(v)) { const h = alloc[j.id] || 0; j.left = c(j.left - h); }
  for (const j of order(v).filter(x => x.left <= 0.004)) { finish(s, j, v); v.jobs = v.jobs.filter(x => x.id !== j.id); }
  // 2. jobs far past their deadline are cancelled with a penalty
  for (const j of v.jobs.filter(x => s.day - x.deadline > D.SVC.cancelAfter)) {
    const pen = c(j.price * D.SVC.cancelPenalty), cash = Math.max(0, balance(s.ledger, "cash")), paid = c(Math.min(cash, pen)), short = c(pen - paid), lines = [{ acct: "penalties", dr: pen }];
    if (paid > 0) lines.push({ acct: "cash", cr: paid }); if (short > 0) lines.push({ acct: "overdraft", cr: short });
    post(s.ledger, s.day, `Service job #${j.id} cancelled by ${j.client}: late`, lines, `svc:pen:${j.id}`);
    v.stats.cancelled++; v.stats.penalties = c(v.stats.penalties + pen); v.jobs = v.jobs.filter(x => x.id !== j.id);
    const sv = ensureSrv(s); sv.csi = c(clamp(sv.csi - 4, 0, 100));
    mailPost(s, { from: "Service desk", subject: `${j.client} cancelled job #${j.id}`, body: `The job was ${s.day - j.deadline} days past its deadline. The client cancelled and charged a penalty of $${pen.toFixed(2)}. Reorder the queue or hire more service staff.`, goto: ["b2b", "services"], level: "bad" });
  }
  // 3. clients answer quotes sent before today; stale requests close
  for (const r of v.rfqs.filter(x => x.quote != null && x.quoted < s.day)) {
    const win = streamNext(o) < winChance(s, r, r.quote);
    if (win) { v.jobs.push({ id: r.id, type: r.type, client: r.client, hours: r.hours, left: r.hours, price: r.quote, deadline: r.deadline, won: s.day, prio: Math.max(0, ...v.jobs.map(j => j.prio)) + 1 }); v.stats.won++; log(s, `${r.client} accepted your quote for job #${r.id}: $${r.quote.toFixed(2)}, due day ${r.deadline}.`); }
    else { v.stats.lost++; log(s, `${r.client} chose someone else for request #${r.id}.`); }
    v.rfqs = v.rfqs.filter(x => x.id !== r.id);
  }
  v.rfqs = v.rfqs.filter(x => x.quote != null || x.expires > s.day);
  // 4. new request
  if (v.rfqs.filter(x => x.quote == null).length < D.SVC.maxOpen && streamNext(o) < D.SVC.rfqChance) {
    const t = D.SVC.types[Math.floor(streamNext(o) * D.SVC.types.length)], b = D.B2B.buyers[Math.floor(streamNext(o) * D.B2B.buyers.length)], hours = Math.max(2, Math.round(t.hours * (0.8 + 0.4 * streamNext(o)))),
      slack = D.SVC.deadlineSlack[0] + Math.floor(streamNext(o) * (D.SVC.deadlineSlack[1] - D.SVC.deadlineSlack[0] + 1)), capM = D.SVC.capMult[0] + streamNext(o) * (D.SVC.capMult[1] - D.SVC.capMult[0]), id = ++v.seq;
    const r = { id, type: t.id, client: b.name, hours, posted: s.day, expires: s.day + D.SVC.quoteDays, deadline: s.day + D.SVC.quoteDays + slack + Math.ceil(hours / D.SVC.perJobPerDay), quote: null };
    r.cap = c(marketPrice(r) * capM); v.rfqs.push(r);
  }
}
