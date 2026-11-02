// Income tax and the books' views (spec: accounting). Tax is assessed on cumulative profit, accrued to a liability, then paid.
import { post, balance, totals, round2, ACCOUNTS } from "./ledger.js";
import * as D from "./data.js";
import { log } from "./engine.js";
import { mailPost } from "./mail.js";

const c = round2;
export const newTax = () => ({ seq: 0, items: [], assessed: 0, paid: 0, lastAssessed: 0 });
export const ensureTax = s => (s.tax = s.tax || newTax());
export const taxOwed = s => c(ensureTax(s).items.reduce((a, x) => a + x.amount, 0));
// Profit before tax so far: revenue minus every cost except tax itself.
export const profitBeforeTax = s => { const t = totals(s.ledger); return c(t.revenue - t.costs + balance(s.ledger, "tax")); };
export const taxDue = s => c(Math.max(0, D.TAX.rate * profitBeforeTax(s) - balance(s.ledger, "tax")));
export function taxDay(s) {
  const tx = ensureTax(s);
  if (s.day % D.TAX.periodDays === 0) {
    const due = taxDue(s);
    if (due > 0) {
      post(s.ledger, s.day, `Income tax assessed (${Math.round(D.TAX.rate * 100)}% of profit)`, [{ acct: "tax", dr: due }, { acct: "tax_payable", cr: due }], "tax:" + s.day);
      tx.items.push({ id: ++tx.seq, amount: due, assessed: s.day, due: s.day + D.TAX.dueDays }); tx.assessed = c(tx.assessed + due);
      mailPost(s, { from: "Tax office", subject: "Income tax assessed", body: `Tax of $${due.toFixed(2)} on your profit is due on day ${s.day + D.TAX.dueDays}.`, goto: ["finance", "ledger"] });
      log(s, `Income tax of $${due.toFixed(2)} assessed. Due day ${s.day + D.TAX.dueDays}.`);
    }
  }
  for (const x of tx.items.filter(v => v.due <= s.day)) {            // pay what cash allows; any shortfall goes to the overdraft like other bills
    const cash = Math.max(0, balance(s.ledger, "cash")), pay = c(Math.min(cash, x.amount)), short = c(x.amount - pay), lines = [{ acct: "tax_payable", dr: x.amount }];
    if (pay > 0) lines.push({ acct: "cash", cr: pay }); if (short > 0) lines.push({ acct: "overdraft", cr: short });
    post(s.ledger, s.day, `Income tax paid (assessed day ${x.assessed})`, lines, "taxpay:" + x.id); tx.paid = c(tx.paid + x.amount);
  }
  tx.items = tx.items.filter(v => v.due > s.day);
}
// Trial balance: every account with its debit or credit balance. Debits always equal credits.
export function trialBalance(s) {
  const rows = Object.keys(ACCOUNTS).map(k => ({ acct: k, name: ACCOUNTS[k].name, type: ACCOUNTS[k].type, dr: Math.max(0, s.ledger.bal[k] || 0), cr: Math.max(0, -(s.ledger.bal[k] || 0)) })).filter(r => r.dr > 0.004 || r.cr > 0.004);
  const dr = c(rows.reduce((a, r) => a + r.dr, 0)), cr = c(rows.reduce((a, r) => a + r.cr, 0));
  return { rows, dr, cr, balanced: Math.abs(dr - cr) < 0.011 };
}
// General ledger: the journal lines touching one account (or all), newest first. Only the latest entries are kept in the save.
export function journal(s, acct = "all", limit = 40) {
  const out = [];
  for (let i = s.ledger.entries.length - 1; i >= 0 && out.length < limit; i--) { const e = s.ledger.entries[i]; if (acct === "all" || e.lines.some(l => l.acct === acct)) out.push(e); }
  return out;
}
// Money owed to you, by how late it is.
export function agingReceivables(s) {
  const rows = (s.b2b.ar || []).map(x => ({ ...x, late: Math.max(0, s.day - x.due) })), sum = f => c(rows.filter(f).reduce((a, x) => a + x.amount, 0));
  return { rows, current: sum(x => x.late === 0), total: c(rows.reduce((a, x) => a + x.amount, 0)), web: c((s.ecom.orders || []).reduce((a, o) => a + o.amount, 0)) };
}
