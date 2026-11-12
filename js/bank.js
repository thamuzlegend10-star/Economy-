// Commercial banking (module 1): overdraft interest, a 30-day revolving credit line and fixed-term loans. Interest compounds daily.
import { post, balance, round2 } from "./ledger.js";
import * as D from "./data.js";
import { mailPost } from "./mail.js";
import { log } from "./engine.js";

const c4 = v => Math.round(v * 1e6) / 1e6, c = round2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const err = error => ({ ok: false, error }), ok = (o = {}) => ({ ok: true, ...o });
export const newBank = () => ({ credit: { bal: 0, since: 0 }, loans: [], lseq: 0, interestPaid: 0, hist: [], hrLate: 0, rating: "AAA" });
// Credit rating (MonsoonSIM style, AAA to DDD): driven by how many of the last 30 days had an overdraft or a payday paid from overdraft. It only ever raises prices, so a clean record costs nothing extra.
export const RATINGS = [["AAA", 95, 1], ["AA", 85, 1], ["A", 75, 1], ["BBB", 60, 1.1], ["BB", 45, 1.2], ["B", 30, 1.35], ["CCC", 15, 1.5], ["DDD", -Infinity, 1.75]];
export function creditScore(s) {
  const b = ensureBank(s); return clamp(100 - 10 * (b.hist || []).reduce((a, x) => a + x, 0) - (balance(s.ledger, "overdraft") > 0 ? 5 : 0), 0, 100);
}
export const creditRating = s => { const sc = creditScore(s); return RATINGS.find(r => sc >= r[1]); };
export const rateFactor = s => creditRating(s)[2];
export const ensureBank = s => (s.bank = s.bank || newBank());
function payOut(s, acct, amount, memo, ref) {
  amount = c(amount); if (amount <= 0) return;
  const cash = Math.max(0, balance(s.ledger, "cash")), paid = c(Math.min(cash, amount)), short = c(amount - paid);
  const lines = [{ acct, dr: amount }]; if (paid > 0) lines.push({ acct: "cash", cr: paid }); if (short > 0) lines.push({ acct: "overdraft", cr: short });
  post(s.ledger, s.day, memo, lines, ref);
}
export const creditRoom = s => c(D.BANK.credit.limit - ensureBank(s).credit.bal);
export function drawCredit(s, amount) {
  if (s.ended) return err("The game is over."); amount = Math.round(Number(amount));
  if (!Number.isFinite(amount) || amount < 1) return err("Enter an amount."); if (amount > creditRoom(s)) return err(`The credit line has $${creditRoom(s).toLocaleString("en-US")} left.`);
  const b = ensureBank(s); if (b.credit.bal <= 0) b.credit.since = s.day;
  post(s.ledger, s.day, "Drew on the credit line", [{ acct: "cash", dr: amount }, { acct: "credit", cr: amount }], "credit:" + s.day); b.credit.bal = c(b.credit.bal + amount);
  log(s, `Drew $${amount.toLocaleString("en-US")} on the credit line. Due in ${D.BANK.credit.termDays} days.`); return ok({ balance: b.credit.bal });
}
export function repayCredit(s, amount) {
  const b = ensureBank(s); amount = c(Math.min(Number(amount) || 0, b.credit.bal)); if (amount <= 0) return err("Nothing to repay.");
  if (amount > balance(s.ledger, "cash") + 0.004) return err("Not enough cash.");
  post(s.ledger, s.day, "Repaid the credit line", [{ acct: "credit", dr: amount }, { acct: "cash", cr: amount }], "credit:" + s.day); b.credit.bal = c(b.credit.bal - amount); return ok({ balance: b.credit.bal });
}
export const loanCap = (s, kind) => {
  const owed = c(ensureBank(s).loans.filter(l => l.kind === kind).reduce((a, l) => a + l.balance, 0));
  return kind === "equipment" ? c(Math.max(0, D.BANK.equipment.maxShareOfPrice * balance(s.ledger, "machinery") - owed)) : c(Math.max(0, 150000 - owed));
};
export function takeLoan(s, { kind = "equipment", amount, termDays } = {}) {
  if (s.ended) return err("The game is over."); amount = Math.round(Number(amount)); termDays = Math.round(Number(termDays));
  if (!["equipment", "long"].includes(kind)) return err("Unknown loan type."); if (!Number.isFinite(amount) || amount < 1) return err("Enter an amount.");
  if (kind === "equipment" && !D.BANK.equipment.termsDays.includes(termDays)) return err(`Choose a term of ${D.BANK.equipment.termsDays.join(", ")} days.`);
  if (kind === "long") { if (amount < D.BANK.longTerm.minAmount) return err(`Long-term loans start at $${D.BANK.longTerm.minAmount.toLocaleString("en-US")}.`); termDays = 365; }
  if (amount > loanCap(s, kind)) return err(`The bank will lend you up to $${loanCap(s, kind).toLocaleString("en-US")} of this kind.`);
  const b = ensureBank(s), rate = c4((kind === "equipment" ? D.BANK.equipment.rate : D.BANK.longTerm.rate) * rateFactor(s));
  const l = { id: ++b.lseq, kind, principal: amount, balance: amount, rate, left: termDays, daily: c(amount / termDays), started: s.day }; b.loans.push(l);
  post(s.ledger, s.day, `Took ${kind === "equipment" ? "an equipment" : "a long-term"} loan #${l.id}`, [{ acct: "cash", dr: amount }, { acct: "longdebt", cr: amount }], "loan:" + l.id);
  log(s, `Took a $${amount.toLocaleString("en-US")} loan for ${termDays} days.`); return ok({ loan: l });
}
export function bankDay(s) {
  const b = ensureBank(s);
  const od = balance(s.ledger, "overdraft");
  const lateNow = od > 0 || (s.hr && s.hr.late > (b.hrLate || 0)) ? 1 : 0; b.hrLate = s.hr ? s.hr.late || 0 : 0; b.hist = [...(b.hist || []), lateNow].slice(-30);
  const rt = creditRating(s)[0]; if (b.rating && rt !== b.rating) mailPost(s, { from: "Bank", subject: `Your credit rating is now ${rt}`, body: `It was ${b.rating}. The rating follows how many of the last 30 days had an overdraft or a payday paid from overdraft. Below A, the bank raises its interest rates.`, goto: ["finance", "bank"], level: RATINGS.findIndex(r => r[0] === rt) > RATINGS.findIndex(r => r[0] === b.rating) ? "warn" : "info" }); b.rating = rt;
  const rf = rateFactor(s);                                                        // overdraft interest compounds into the overdraft itself
  if (od > 0 && s.overdraftDays === 0) mailPost(s, { from: "Bank", subject: "Your account is overdrawn", body: `You owe the bank $${od.toFixed(2)}. Three days in a row ends the game. Repay it from sales or draw on the credit line.`, goto: ["finance", "bank"], level: "bad" });
  if (od > 0) { const i = c(od * D.BANK.overdraft.rate * rf); if (i > 0) { post(s.ledger, s.day, "Overdraft interest", [{ acct: "interest", dr: i }, { acct: "overdraft", cr: i }], "odint:" + s.day); b.interestPaid = c(b.interestPaid + i); } }
  if (b.credit.bal > 0) {
    const i = c(b.credit.bal * D.BANK.credit.rate * rf); if (i > 0) { post(s.ledger, s.day, "Credit line interest", [{ acct: "interest", dr: i }, { acct: "credit", cr: i }], "crint:" + s.day); b.credit.bal = c(b.credit.bal + i); b.interestPaid = c(b.interestPaid + i); }
    if (s.day - b.credit.since >= D.BANK.credit.termDays) {                       // the 30 days are up: repay from cash, the rest becomes overdraft
      const pay = c(Math.min(b.credit.bal, Math.max(0, balance(s.ledger, "cash")))), rest = c(b.credit.bal - pay), lines = [{ acct: "credit", dr: b.credit.bal }];
      if (pay > 0) lines.push({ acct: "cash", cr: pay }); if (rest > 0) lines.push({ acct: "overdraft", cr: rest });
      post(s.ledger, s.day, "Credit line due", lines, "crdue:" + s.day); log(s, `The credit line fell due. Repaid $${pay.toFixed(2)}${rest > 0 ? `, $${rest.toFixed(2)} moved to the overdraft` : ""}.`); b.credit.bal = 0;
    }
  }
  for (const l of b.loans) {
    const i = c(l.balance * l.rate); payOut(s, "interest", i, `Interest on loan #${l.id}`, "lint:" + l.id + ":" + s.day); b.interestPaid = c(b.interestPaid + i);
    const p = l.left <= 1 ? l.balance : c(Math.min(l.daily, l.balance)), cash = Math.max(0, balance(s.ledger, "cash")), paid = c(Math.min(cash, p)), short = c(p - paid), lines = [{ acct: "longdebt", dr: p }];
    if (paid > 0) lines.push({ acct: "cash", cr: paid }); if (short > 0) lines.push({ acct: "overdraft", cr: short });
    post(s.ledger, s.day, `Repayment on loan #${l.id}`, lines, "lrep:" + l.id + ":" + s.day); l.balance = c(l.balance - p); l.left--;
  }
  b.loans = b.loans.filter(l => l.balance > 0.004);
}
