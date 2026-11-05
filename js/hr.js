// Human capital (spec module 9): five staff roles, wage level, training, morale and turnover. Own random stream.
import { post, balance, round2 } from "./ledger.js";
import * as D from "./data.js";
import { streamNext, seedFrom } from "./rng.js";
import { log } from "./engine.js";
import { mailPost } from "./mail.js";

const c = round2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const err = error => ({ ok: false, error }), ok = (o = {}) => ({ ok: true, ...o });
export const ROLE = Object.fromEntries(D.HR_ROLES.map(r => [r.id, r]));

// Named people. The headcount is what the economy uses; the roster gives each of those heads a name and a start day, kept in step with it.
const FIRST = ["Ayu", "Budi", "Citra", "Dewi", "Eko", "Fajar", "Gita", "Hadi", "Indra", "Joko", "Kiki", "Lestari", "Mawar", "Nanda", "Putra", "Rani", "Sari", "Tono", "Umar", "Vina", "Wati", "Yusuf", "Zahra", "Agus", "Bayu", "Dian", "Fitri", "Galih", "Hana", "Irfan"];
const LAST = ["Santoso", "Wijaya", "Pratama", "Lubis", "Siregar", "Nasution", "Hutapea", "Simanjuntak", "Harahap", "Kusuma", "Saputra", "Hidayat", "Purnama", "Rahman", "Tan", "Lim"];
const hash = (a, b, c) => { let x = (a * 374761393 + b * 668265263 + c * 2246822519) | 0; x = Math.imul(x ^ (x >>> 13), 1274126177); return (x ^ (x >>> 16)) >>> 0; };
export function syncCrew(s, role) {
  const h = ensureHr(s); h.seq = h.seq || 0; const st = h.staff[role]; st.crew = st.crew || [];
  while (st.crew.length < st.n) { const k = ++h.seq, x = hash(s.seed | 0, k, 7); st.crew.push({ id: k, name: `${FIRST[x % FIRST.length]} ${LAST[(x >>> 8) % LAST.length]}`, since: s.day, skill: c(clamp(st.skill + ((x >>> 16) % 21 - 10) / 100, 0.5, 2)) }); }
  if (st.crew.length > st.n) st.crew.length = Math.max(0, st.n);
  return st.crew;
}
export function newHr(seed = 0) {
  const staff = {}; for (const r of D.HR_ROLES) staff[r.id] = { n: 0, skill: D.HR.skillStart };
  return { rng: seedFrom(seed, 0x48a), staff, wageMult: D.HR.wageMult.def, training: D.HR.trainingBudget.def, morale: D.HR.morale.start, quits: 0, paidTotal: 0, temps: [], recruitPaid: 0, severancePaid: 0, hires: 0, pay: "weekly", accrued: 0, lastPay: 0, late: 0 };
}
export const ensureHr = s => { s.hr = s.hr || newHr(s.seed); if (!s.hr.temps) s.hr.temps = []; return s.hr; };
export const headcount = s => D.HR_ROLES.reduce((a, r) => a + ensureHr(s).staff[r.id].n, 0);
export const wageOf = (s, role) => c(ROLE[role].wage * ensureHr(s).wageMult * (0.9 + 0.1 * ensureHr(s).staff[role].skill));
export const tempN = (s, role) => (ensureHr(s).temps || []).filter(t => t.role === role).reduce((a, t) => a + t.n, 0);
export const permN = (s, role) => ensureHr(s).staff[role].n - tempN(s, role);
const rolePay = (s, role) => c(wageOf(s, role) * (ensureHr(s).staff[role].n + tempN(s, role) * D.HR.tempPremium));   // agency staff cost a premium
export const factoryPayroll = s => rolePay(s, "factory");
export const dailyPayroll = s => c(D.HR_ROLES.reduce((a, r) => a + rolePay(s, r.id), 0));
export const needOf = (s, role) => role === "retail" ? retailNeed(s) : role === "factory" ? operatorsNeeded(s) : role === "driver" ? (s.fleet ? s.fleet.trucks.length : 0) : D.HR.needPer[role] || 0;

// Recruitment costs days of wages per hire. A temp (agency) contract costs a premium on the wage, never quits, needs no severance and ends by itself.
export const recruitFee = (s, role, n = 1) => c(wageOf(s, role) * D.HR.recruitDays * n);
export function hire(s, role, n = 1, contract = "perm", days = 14) {
  if (!ROLE[role]) return err("Unknown role."); n = Math.round(Number(n)); if (!Number.isFinite(n) || n < 1) return err("Hire at least one person.");
  const h = ensureHr(s), st = h.staff[role], fee = recruitFee(s, role, n);
  if (fee > balance(s.ledger, "cash") + 0.004) return err(`Not enough cash for the recruitment fee: $${fee.toFixed(2)}.`);
  if (contract === "temp") { days = Math.round(Number(days)); if (!D.HR.tempDays.includes(days)) return err("Choose a contract length."); h.temps.push({ role, n, until: s.day + days }); }
  st.skill = c((st.skill * st.n + D.HR.skillStart * n) / (st.n + n)); st.n += n; h.hires += n; syncCrew(s, role);
  if (fee > 0) { post(s.ledger, s.day, `Recruitment of ${n} ${ROLE[role].name.toLowerCase()}`, [{ acct: "wages", dr: fee }, { acct: "cash", cr: fee }], "hire:" + s.day + ":" + role + ":" + h.hires); h.recruitPaid = c(h.recruitPaid + fee); }
  return ok({ n: st.n, fee });
}
export function fire(s, role, n = 1) {
  if (!ROLE[role]) return err("Unknown role."); const st = ensureHr(s).staff[role]; n = Math.round(Number(n)); if (!Number.isFinite(n) || n < 1) return err("Choose how many.");
  if (n > permN(s, role)) return err(permN(s, role) ? `You can let go of only ${permN(s, role)} permanent staff. Temps leave when their contract ends.` : "Only temps are left here. They leave when their contract ends.");
  const fee = c(wageOf(s, role) * D.HR.severanceDays * n); if (fee > balance(s.ledger, "cash") + 0.004) return err(`Not enough cash for severance pay: $${fee.toFixed(2)}.`);
  st.n -= n; syncCrew(s, role); ensureHr(s).morale = clamp(ensureHr(s).morale - 2 * n, 0, 100);
  post(s.ledger, s.day, `Severance for ${n} ${ROLE[role].name.toLowerCase()}`, [{ acct: "wages", dr: fee }, { acct: "cash", cr: fee }], "sev:" + s.day + ":" + role + ":" + st.n); ensureHr(s).severancePaid = c(ensureHr(s).severancePaid + fee); return ok({ n: st.n, fee });
}
export function setWageMult(s, v) { const w = D.HR.wageMult; ensureHr(s).wageMult = clamp(Math.round((Number(v) || w.def) * 100) / 100, w.min, w.max); return ok({ wageMult: s.hr.wageMult }); }
export const payday = s => D.PAYDAYS.find(x => x.id === ensureHr(s).pay) || D.PAYDAYS[1];
export function setPayday(s, v) { const p = D.PAYDAYS.find(x => x.id === v); if (!p) return err("Unknown payday."); ensureHr(s).pay = p.id; return ok({ pay: p.id }); }
export function setTraining(s, v) { const t = D.HR.trainingBudget; ensureHr(s).training = clamp(Math.round(Number(v) || 0), t.min, t.max); return ok({ training: s.hr.training }); }

// ---------- effects (all are neutral until people are hired) ----------
export const retailNeed = s => Math.max(1, Math.round(s.area / 60));
export function retailBoost(s) {            // up to +10% shoppers served when the shop is fully staffed with skilled, happy people
  const h = ensureHr(s), st = h.staff.retail; if (!st.n) return 1;
  return 1 + D.HR_EFFECTS.retailBoost * Math.min(1, st.n / retailNeed(s)) * clamp(st.skill, D.HR_EFFECTS.skillMin, D.HR_EFFECTS.skillMax) * (0.5 + h.morale / 200);
}
export const operatorsNeeded = s => (s.fx ? s.fx.machines.reduce((a, m) => a + D.MACHINES.find(t => t.id === m.type).operators, 0) : 0);
export function crew(s) {                  // factory output and wear factors
  const need = operatorsNeeded(s); if (!need) return { out: 1, wear: 1, coverage: 1 };
  const h = ensureHr(s), st = h.staff.factory, coverage = Math.min(1, st.n / need);
  return { coverage, out: (0.5 + 0.5 * coverage) * (0.9 + 0.1 * clamp(st.skill, 0.5, 1.6)) * (1 - D.HR_EFFECTS.moraleOutput + D.HR_EFFECTS.moraleOutput * h.morale / 100), wear: clamp(1.2 - 0.2 * st.skill, 0.6, 1.3) };
}
export const transferDiscount = s => D.HR_EFFECTS.transferCut * Math.min(1, ensureHr(s).staff.warehouse.n / 2) * (0.5 + ensureHr(s).morale / 200);
export const salesEdge = s => D.HR_EFFECTS.salesEdge * Math.min(1, ensureHr(s).staff.sales.n / 2) * clamp(ensureHr(s).staff.sales.skill, D.HR_EFFECTS.skillMin, D.HR_EFFECTS.skillMax);
export const serviceCapacity = s => ensureHr(s).staff.service.n * D.SRV.perStaffPerDay * clamp(ensureHr(s).staff.service.skill, 0.5, 1.6);

export function hrDay(s) {
  const h = ensureHr(s);
  for (const t of h.temps.filter(x => x.until <= s.day)) { h.staff[t.role].n = Math.max(0, h.staff[t.role].n - t.n); log(s, `${t.n} temporary ${ROLE[t.role].name.toLowerCase()} finished their contract.`); }
  h.temps = h.temps.filter(x => x.until > s.day); for (const r of D.HR_ROLES) syncCrew(s, r.id);
  const payroll = dailyPayroll(s);
  if (payroll > 0) {
    const rest = c(payroll - factoryPayroll(s));            // factory wages are paid by the factory (they become part of the goods made)
    if (rest > 0) { post(s.ledger, s.day, `Wages earned, day ${s.day}`, [{ acct: "wages", dr: rest }, { acct: "wages_payable", cr: rest }], "hr:acc:" + s.day); h.accrued = c(h.accrued + rest); }
  }
  const pd = payday(s);
  if (h.accrued > 0 && (pd.days === 1 || s.day % pd.days === 0)) {
    const owed = h.accrued, cash = Math.max(0, balance(s.ledger, "cash")), paid = c(Math.min(cash, owed)), short = c(owed - paid), lines = [{ acct: "wages_payable", dr: owed }];
    if (paid > 0) lines.push({ acct: "cash", cr: paid }); if (short > 0) lines.push({ acct: "overdraft", cr: short });
    post(s.ledger, s.day, `Payday: wages for ${pd.id === "daily" ? "day " + s.day : "the period"}`, lines, "hr:pay:" + s.day);
    h.paidTotal = c(h.paidTotal + owed); h.accrued = 0; h.lastPay = s.day;
    if (short > 0) { h.late++; h.morale = c(clamp(h.morale - 4, 0, 100)); mailPost(s, { from: "HR", subject: "Payday paid from overdraft", body: `Cash was short by ${short.toFixed(2)} on payday. Staff noticed. Keep cash for wages.`, goto: ["hr", ""], level: "warn" }); }
  }
  const people = headcount(s);
  if (h.training > 0 && people > 0) {
    payOut(s, "wages", h.training, `Training budget for day ${s.day}`);
    for (const r of D.HR_ROLES) { const st = h.staff[r.id]; if (st.n) st.skill = c(clamp(st.skill + h.training / (D.HR.trainingPerSkill * people) * 0.05, 0.5, 2)); }
  }
  // morale drifts toward a target set by pay and training; overwork (too few operators) hurts
  const cv = crew(s), target = clamp(55 + 60 * (h.wageMult - 1) + Math.min(15, h.training / 40) - pd.morale - (cv.coverage < 1 ? 15 * (1 - cv.coverage) : 0), 0, 100);
  h.morale = c(clamp(h.morale + (target - h.morale) * D.HR_EFFECTS.moraleDrift, 0, 100));
  // turnover: unhappy staff quit
  for (const r of D.HR_ROLES) { const st = h.staff[r.id], p = D.HR.turnoverBase * (1 + Math.max(0, 60 - h.morale) / 30); for (let i = permN(s, r.id); i > 0; i--) if (streamNext(h) < p) { const cr = syncCrew(s, r.id), who = cr.length ? cr.splice(hash(s.day, st.n, cr.length) % cr.length, 1)[0] : null; st.n--; h.quits++; mailPost(s, { from: "HR", subject: `${who ? who.name : "A " + ROLE[r.id].name.toLowerCase().replace(/s$/, "")} resigned`, body: `${who ? who.name + " (" + ROLE[r.id].name.toLowerCase().replace(/s$/, "") + ", since day " + who.since + ") left. " : ""}Morale is ${Math.round(h.morale)}%. Raise wages or training to keep people.`, goto: ["hr", ""], level: "warn" }); log(s, `A ${ROLE[r.id].name.toLowerCase().replace(/s$/, "")} quit.`); } }
}
function payOut(s, acct, amount, memo) {
  amount = c(amount); if (amount <= 0) return;
  const cash = Math.max(0, balance(s.ledger, "cash")), paid = c(Math.min(cash, amount)), short = c(amount - paid);
  const lines = [{ acct, dr: amount }]; if (paid > 0) lines.push({ acct: "cash", cr: paid }); if (short > 0) lines.push({ acct: "overdraft", cr: short });
  post(s.ledger, s.day, memo, lines, "hr:" + s.day + ":" + acct);
}
