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
};
const DEBIT_NORMAL = new Set(["asset", "expense"]);
export const OPEX = ["rent", "utilities", "wages", "interest", "tax", "marketing", "delivery", "fees", "repairs"];
export const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const MAX_ENTRIES = 1500;

export function newLedger() {
  const bal = {};
  for (const k of Object.keys(ACCOUNTS)) bal[k] = 0;   // signed: debit +, credit -
  return { seq: 0, bal, entries: [], archived: 0 };
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
  for (const l of lines) ledger.bal[l.acct] = round2(ledger.bal[l.acct] + (l.dr || 0) - (l.cr || 0));
  const e = { id: ++ledger.seq, day, memo, lines: lines.map(l => ({ ...l })), ref };
  ledger.entries.push(e);
  if (ledger.entries.length > MAX_ENTRIES) { ledger.entries.splice(0, ledger.entries.length - MAX_ENTRIES); ledger.archived = ledger.seq - MAX_ENTRIES; }
  return e;
}

// Natural-sign balance (assets/expenses positive when debit; others positive when credit).
export function balance(ledger, acct) {
  const v = ledger.bal[acct];
  return (DEBIT_NORMAL.has(ACCOUNTS[acct].type) ? v : -v) + 0;   // +0 turns -0 into 0
}

export function totals(ledger) {
  const b = a => balance(ledger, a);
  const assets = b("cash") + b("bank") + b("inventory") + b("equipment") + b("transit");
  const liabilities = b("loan") + b("overdraft") + b("payables");
  const revenue = b("sales");
  const costs = b("cogs") + OPEX.reduce((s, a) => s + b(a), 0);
  const equity = b("capital") + revenue - costs;
  return { assets: round2(assets), liabilities: round2(liabilities), equity: round2(equity), revenue: round2(revenue), costs: round2(costs),
           balanced: Math.abs(assets - liabilities - equity) < 0.011 };
}
