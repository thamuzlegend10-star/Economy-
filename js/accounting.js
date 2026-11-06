// Income tax and the books' views (spec: accounting). Tax is assessed on cumulative profit, accrued to a liability, then paid.
import { post, balance, totals, round2, ACCOUNTS, unpackLines, newCf, CF_BUCKETS } from "./ledger.js";
import * as D from "./data.js";
import { log } from "./engine.js";
import { mailPost } from "./mail.js";

const c = round2;
export const newTax = () => ({ seq: 0, items: [], assessed: 0, paid: 0, lastAssessed: 0 });
export const ensureTax = s => (s.tax = s.tax || newTax());
export const taxOwed = s => c(ensureTax(s).items.reduce((a, x) => a + x.amount, 0));
// Profit before tax so far: revenue minus every cost except tax itself.
export const profitBeforeTax = s => { const t = totals(s.ledger); return c(t.revenue - t.costs + balance(s.ledger, "tax")); };
// Deductions: extra allowances that lower taxable profit (not cash costs; the real costs are already expenses).
export function deductions(s) {
  const mach = c(D.TAX.machineAllow * Math.max(0, balance(s.ledger, "machinery"))), train = c(D.TAX.trainExtra * ((s.hr && s.hr.trainPaid) || 0));
  return { mach, train, total: c(mach + train) };
}
export const taxableProfit = s => c(Math.max(0, profitBeforeTax(s) - deductions(s).total));
export const taxDue = s => c(Math.max(0, D.TAX.rate * taxableProfit(s) - balance(s.ledger, "tax")));
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
export function journal(s, acct = "all", limit = 40, skip = 0) {
  const out = [], L = s.ledger; let seen = 0;
  const take = e => { if (acct !== "all" && !e.lines.some(l => l.acct === acct)) return false; if (seen++ < skip) return false; out.push(e); return out.length >= limit; };
  for (let i = L.entries.length - 1; i >= 0; i--) if (take(L.entries[i])) return out;
  const old = L.old || [];
  for (let i = old.length - 1; i >= 0; i--) { const r = old[i]; if (take({ id: r[0], day: r[1], memo: r[2], lines: unpackLines(r[3]) })) return out; }
  return out;
}
export const journalSize = (s, acct = "all") => { let n = 0; const has = ls => acct === "all" || ls.some(l => l.acct === acct); for (const e of s.ledger.entries) if (has(e.lines)) n++; for (const r of s.ledger.old || []) if (acct === "all" || r[3].split(",").some(x => x.startsWith(acct + ":"))) n++; return n; };
// Statement of cash flows, direct method: cash received from customers, paid to suppliers, wages, tax and the rest; then investing and financing.
export function cashFlow(s) {
  const cf = { ...newCf(), ...(s.ledger.cf || {}) }, operating = c(cf.customers + cf.suppliers + cf.wages + cf.tax + cf.other);
  return { ...cf, operating, net: c(operating + cf.investing + cf.financing), keys: CF_BUCKETS };
}
// Money owed to you, by how late it is.
export function agingReceivables(s) {
  const rows = (s.b2b.ar || []).map(x => ({ ...x, late: Math.max(0, s.day - x.due) })), sum = f => c(rows.filter(f).reduce((a, x) => a + x.amount, 0));
  return { rows, current: sum(x => x.late === 0), total: c(rows.reduce((a, x) => a + x.amount, 0)), web: c((s.ecom.orders || []).reduce((a, o) => a + o.amount, 0)) };
}
