// Human capital (spec module 9): five staff roles, wage level, training, morale and turnover. Own random stream.
import { post, balance, round2 } from "./ledger.js";
import * as D from "./data.js";
import { streamNext, seedFrom } from "./rng.js";
import { log } from "./engine.js";

const c = round2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const err = error => ({ ok: false, error }), ok = (o = {}) => ({ ok: true, ...o });
export const ROLE = Object.fromEntries(D.HR_ROLES.map(r => [r.id, r]));

export function newHr(seed = 0) {
  const staff = {}; for (const r of D.HR_ROLES) staff[r.id] = { n: 0, skill: D.HR.skillStart };
  return { rng: seedFrom(seed, 0x48a), staff, wageMult: D.HR.wageMult.def, training: D.HR.trainingBudget.def, morale: D.HR.morale.start, quits: 0, paidTotal: 0 };
}
export const ensureHr = s => (s.hr = s.hr || newHr(s.seed));
export const headcount = s => D.HR_ROLES.reduce((a, r) => a + ensureHr(s).staff[r.id].n, 0);
export const wageOf = (s, role) => c(ROLE[role].wage * ensureHr(s).wageMult * (0.9 + 0.1 * ensureHr(s).staff[role].skill));
export const factoryPayroll = s => c(ensureHr(s).staff.factory.n * wageOf(s, "factory"));
export const dailyPayroll = s => c(D.HR_ROLES.reduce((a, r) => a + ensureHr(s).staff[r.id].n * wageOf(s, r.id), 0));

export function hire(s, role, n = 1) {
  if (!ROLE[role]) return err("Unknown role."); n = Math.round(Number(n)); if (!Number.isFinite(n) || n < 1) return err("Hire at least one person.");
  const h = ensureHr(s), st = h.staff[role]; st.skill = c((st.skill * st.n + D.HR.skillStart * n) / (st.n + n)); st.n += n; return ok({ n: st.n });
}
export function fire(s, role, n = 1) {
  if (!ROLE[role]) return err("Unknown role."); const st = ensureHr(s).staff[role]; n = Math.round(Number(n)); if (!Number.isFinite(n) || n < 1) return err("Choose how many.");
  if (n > st.n) return err(`You only have ${st.n}.`); st.n -= n; ensureHr(s).morale = clamp(ensureHr(s).morale - 2 * n, 0, 100); return ok({ n: st.n });
}
export function setWageMult(s, v) { const w = D.HR.wageMult; ensureHr(s).wageMult = clamp(Math.round((Number(v) || w.def) * 100) / 100, w.min, w.max); return ok({ wageMult: s.hr.wageMult }); }
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
  const h = ensureHr(s), payroll = dailyPayroll(s);
  if (payroll > 0) {
    const rest = c(payroll - factoryPayroll(s));            // factory wages are paid by the factory (they become part of the goods made)
    if (rest > 0) payOut(s, "wages", rest, `Wages for day ${s.day}`);
    h.paidTotal = c(h.paidTotal + rest);
  }
  const people = headcount(s);
  if (h.training > 0 && people > 0) {
    payOut(s, "wages", h.training, `Training budget for day ${s.day}`);
    for (const r of D.HR_ROLES) { const st = h.staff[r.id]; if (st.n) st.skill = c(clamp(st.skill + h.training / (D.HR.trainingPerSkill * people) * 0.05, 0.5, 2)); }
  }
  // morale drifts toward a target set by pay and training; overwork (too few operators) hurts
  const cv = crew(s), target = clamp(55 + 60 * (h.wageMult - 1) + Math.min(15, h.training / 40) - (cv.coverage < 1 ? 15 * (1 - cv.coverage) : 0), 0, 100);
  h.morale = c(clamp(h.morale + (target - h.morale) * D.HR_EFFECTS.moraleDrift, 0, 100));
  // turnover: unhappy staff quit
  for (const r of D.HR_ROLES) { const st = h.staff[r.id], p = D.HR.turnoverBase * (1 + Math.max(0, 60 - h.morale) / 30); for (let i = st.n; i > 0; i--) if (streamNext(h) < p) { st.n--; h.quits++; log(s, `A ${ROLE[r.id].name.toLowerCase().replace(/s$/, "")} quit.`); } }
}
function payOut(s, acct, amount, memo) {
  amount = c(amount); if (amount <= 0) return;
  const cash = Math.max(0, balance(s.ledger, "cash")), paid = c(Math.min(cash, amount)), short = c(amount - paid);
  const lines = [{ acct, dr: amount }]; if (paid > 0) lines.push({ acct: "cash", cr: paid }); if (short > 0) lines.push({ acct: "overdraft", cr: short });
  post(s.ledger, s.day, memo, lines, "hr:" + s.day + ":" + acct);
}
