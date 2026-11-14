// Double-entry ledger. Every money movement goes through post().
export const ACCOUNTS = {
  cash:      { type:"asset",     name:"Cash on hand" },
  bank:      { type:"asset",     name:"Bank balance" },
  inventory: { type:"asset",     name:"Inventory" },
  equipment: { type:"asset",     name:"Equipment & upgrades" },
  transit:   { type:"asset",     name:"Goods in transit" },
  loan:      { type:"liability", name:"Bank loans" },
  overdraft: { type:"liability", name:"Overdraft" },
  payables:  { type:"liability", name:"Supplier invoices" },
  capital:   { type:"equity",    name:"Owner capital" },
  sales:     { type:"income",    name:"Sales revenue" },
  cogs:      { type:"expense",   name:"Cost of goods sold" },
  rent:      { type:"expense",   name:"Rent" },
  utilities: { type:"expense",   name:"Utilities" },
  wages:     { type:"expense",   name:"Wages" },
  interest:  { type:"expense",   name:"Interest" },
  tax:       { type:"expense",   name:"Tax" },
  marketing: { type:"expense",   name:"Marketing" },
  delivery:  { type:"expense",   name:"Delivery fees" },
  fees:      { type:"expense",   name:"Bank fees" },
  repairs:   { type:"expense",   name:"Repairs" },
  // Phase 3 chart of accounts: manufacturing, banking, B2B and e-commerce.
  receivables: { type:"asset",   name:"Receivables" },
  inv_raw:   { type:"asset",     name:"Raw material inventory" },
  inv_fg:    { type:"asset",     name:"Finished goods (factory)" },
  machinery: { type:"asset",     name:"Machinery" },
  acc_deprec: { type:"asset",    name:"Accumulated depreciation (contra)" },
  credit:    { type:"liability", name:"Revolving credit" },
  longdebt:  { type:"liability", name:"Long-term and equipment loans" },
  escrow:    { type:"liability", name:"Escrow (customer money held)" },
  retained:  { type:"equity",    name:"Retained earnings" },
  sales_b2b: { type:"income",    name:"B2B sales" },
  sales_ecom: { type:"income",   name:"E-commerce sales" },
  sales_service: { type:"income", name:"Service revenue" },
  depreciation: { type:"expense", name:"Depreciation" },
  maintenance: { type:"expense", name:"Machine maintenance" },
  penalties: { type:"expense",   name:"Contract penalties" },
  overflow:  { type:"expense",   name:"Storage overflow fees" },
  cogs_labor: { type:"expense",  name:"Production labour" },
  tax_payable: { type:"liability", name:"Income tax payable" },
  wages_payable: { type:"liability", name:"Accrued wages" },
  bad_debt:  { type:"expense",   name:"Bad debt written off" },
  shrinkage: { type:"expense",   name:"Spoilage and stock loss" },
  claims:    { type:"asset",     name:"Supplier claims (damaged goods)" },
};
const DEBIT_NORMAL = new Set(["asset", "expense"]);
export const OPEX = ["rent", "utilities", "wages", "interest", "tax", "marketing", "delivery", "fees", "repairs", "depreciation", "maintenance", "penalties", "overflow", "cogs_labor", "bad_debt", "shrinkage"];
export const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const MAX_ENTRIES = 1500, MAX_OLD = 14000;   // recent entries in full; older ones kept as one short text row each, so the whole game stays browsable
// Cash-flow buckets (direct method). The counter-account of every cash movement decides the bucket.
export const CF_BUCKETS = ["customers", "suppliers", "wages", "tax", "other", "investing", "financing"];
const CF_OF = { sales: "customers", sales_b2b: "customers", sales_ecom: "customers", sales_service: "customers", receivables: "customers",
  inventory: "suppliers", inv_raw: "suppliers", inv_fg: "suppliers", payables: "suppliers", transit: "suppliers", claims: "suppliers", cogs: "suppliers", escrow: "suppliers",
  wages: "wages", wages_payable: "wages", cogs_labor: "wages", tax: "tax", tax_payable: "tax",
  machinery: "investing", acc_deprec: "investing", capital: "financing", credit: "financing", longdebt: "financing" };
export const newCf = () => Object.fromEntries(CF_BUCKETS.map(k => [k, 0]));
// Departments: every income or expense line is tallied under the department that caused it, decided by the entry's reference.
export const DEPTS = [["shop", "Shop"], ["web", "Web store"], ["b2b", "B2B sales"], ["factory", "Factory"], ["marketing", "Marketing"], ["people", "People"], ["logistics", "Logistics"], ["finance", "Finance and tax"], ["general", "General (rent, overflow)"]];
const DEPT_OF = [[/^(sales|jsales|order|deliv|xfer|transfer|ovf)/, "shop"], [/^(web|ecom)/, "web"], [/^(b2b|ar:|pen:|svc)/, "b2b"], [/^(prod|machine|pm:|dep:|conv|rawpo|rawdel)/, "factory"], [/^mkt/, "marketing"], [/^(hr:|hire|sev)/, "people"], [/^(fuel|trepair|truck|tsvc|tdep|ship)/, "logistics"], [/^(lint|tax|loan|fee|credit|od)/, "finance"]];
export const deptOf = ref => { const r = String(ref || ""); for (const [re, d] of DEPT_OF) if (re.test(r)) return d; return "general"; };
export const newDp = () => Object.fromEntries(DEPTS.map(([k]) => [k, { rev: 0, cost: 0 }]));
const packLines = ls => ls.map(l => l.acct + (l.dr ? ":+" + l.dr : ":-" + l.cr)).join(",");
export const unpackLines = str => str.split(",").map(x => { const i = x.indexOf(":"), v = Number(x.slice(i + 1)); return v >= 0 ? { acct: x.slice(0, i), dr: v } : { acct: x.slice(0, i), cr: -v }; });

export function newLedger() {
  const bal = {};
  for (const k of Object.keys(ACCOUNTS)) bal[k] = 0;   // signed: debit +, credit -
  return { seq: 0, bal, entries: [], archived: 0, old: [], cf: newCf(), dp: newDp() };
}

// lines: [{ acct, dr?: n, cr?: n }]. Throws if unbalanced or invalid. Returns the entry.
export function post(ledger, day, memo, lines, ref = null) {
  let dr = 0, cr = 0;
  for (const l of lines) {
    if (!ACCOUNTS[l.acct]) throw new Error("Unknown account " + l.acct);
    const d = l.dr || 0, c = l.cr || 0;
    if (!Number.isFinite(d) || !Number.isFinite(c) || d < 0 || c < 0 || (d && c)) throw new Error("Bad ledger line");
    dr += d; cr += c;
  }
  dr = round2(dr); cr = round2(cr);
  if (dr !== cr || dr === 0) throw new Error(`Unbalanced entry (${dr} vs ${cr}): ${memo}`);
  for (const l of lines) ledger.bal[l.acct] = round2((ledger.bal[l.acct] || 0) + (l.dr || 0) - (l.cr || 0));
  const e = { id: ++ledger.seq, day, memo, lines: lines.map(l => ({ ...l })), ref };
  ledger.entries.push(e);
  const dp = ledger.dp || (ledger.dp = newDp()), dk = deptOf(ref), dd = dp[dk] || (dp[dk] = { rev: 0, cost: 0 });
  for (const l of lines) { const ty = ACCOUNTS[l.acct].type; if (ty === "income") dd.rev = round2(dd.rev + (l.cr || 0) - (l.dr || 0)); else if (ty === "expense") dd.cost = round2(dd.cost + (l.dr || 0) - (l.cr || 0)); }
  // cash flow: cash and overdraft together are the "cash position"; each other line's share of the movement goes to a bucket
  if (lines.some(l => l.acct === "cash" || l.acct === "overdraft")) { const cf = ledger.cf || (ledger.cf = newCf()); for (const l of lines) if (l.acct !== "cash" && l.acct !== "overdraft") { const k = CF_OF[l.acct] || "other"; cf[k] = round2(cf[k] - ((l.dr || 0) - (l.cr || 0))); } }
  if (ledger.entries.length > MAX_ENTRIES) {
    const old = ledger.old || (ledger.old = []);
    while (ledger.entries.length > MAX_ENTRIES) { const x = ledger.entries.shift(); old.push([x.id, x.day, x.memo, packLines(x.lines)]); }
    if (old.length > MAX_OLD) old.splice(0, old.length - MAX_OLD);
    ledger.archived = ledger.seq - MAX_ENTRIES - old.length;       // entries so old they are gone (their effect is still in every balance)
  }
  return e;
}

// Natural-sign balance (assets/expenses positive when debit; others positive when credit).
export function balance(ledger, acct) {
  const v = ledger.bal[acct] || 0;
  return (DEBIT_NORMAL.has(ACCOUNTS[acct].type) ? v : -v) + 0;   // +0 turns -0 into 0
}

export function totals(ledger) {
  const sum = type => Object.keys(ACCOUNTS).filter(k => ACCOUNTS[k].type === type).reduce((s, k) => s + balance(ledger, k), 0);
  const assets = sum("asset"), liabilities = sum("liability"), revenue = sum("income"), costs = sum("expense");
  const equity = sum("equity") + revenue - costs;
  return { assets: round2(assets), liabilities: round2(liabilities), equity: round2(equity), revenue: round2(revenue), costs: round2(costs),
           balanced: Math.abs(assets - liabilities - equity) < 0.011 };
}
