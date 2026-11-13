// Data export: CSV files for Excel, R, Tableau or anything else that reads CSV. Pure functions: they read the game and return text.
import { ACCOUNTS } from "./ledger.js";
import * as D from "./data.js";
import { trialBalance } from "./accounting.js";

// A cell that starts with = + - @ can run as a formula in a spreadsheet, so it gets a leading apostrophe. Numbers are written as plain numbers.
const cell = v => {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let t = String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};
export const toCsv = (head, rows) => "﻿" + [head, ...rows].map(r => r.map(cell).join(",")).join("\r\n") + "\r\n";

export const KINDS = [
  { id: "daily", name: "Daily results", note: "One row per closed day: sales, costs, cash and units per product." },
  { id: "journal", name: "Ledger journal", note: "Every recent entry, one row per account line. Older entries are folded away in the save." },
  { id: "trial", name: "Trial balance", note: "Debit and credit by account, today." },
  { id: "b2b", name: "B2B tenders and deliveries", note: "Tender history with result and price." },
];

export function exportCsv(s, kind) {
  const day = s.day;
  if (kind === "daily") {
    const pids = D.PRODUCTS.map(p => p.id);
    return { name: `economy-daily-day${day}.csv`, text: toCsv(["day", "revenue", "cogs", "shipping", "rent", "net", "cash", "inventory_value", ...pids.map(p => "units_" + p), ...pids.map(p => "lost_" + p)],
      s.history.map(h => [h.day, h.revenue, h.cogs, h.shipping, h.rent, h.net, h.cash, h.inventoryValue, ...pids.map(p => (h.units || {})[p] || 0), ...pids.map(p => (h.lost || {})[p] || 0)])) };
  }
  if (kind === "journal") {
    const rows = []; for (const e of s.ledger.entries) for (const l of e.lines) rows.push([e.id, e.day, e.memo, l.acct, ACCOUNTS[l.acct].name, l.dr || 0, l.cr || 0, e.ref || ""]);
    return { name: `economy-journal-day${day}.csv`, text: toCsv(["entry", "day", "memo", "account", "account_name", "debit", "credit", "ref"], rows) };
  }
  if (kind === "trial") {
    const tb = trialBalance(s);
    return { name: `economy-trial-balance-day${day}.csv`, text: toCsv(["account", "name", "type", "debit", "credit"], tb.rows.map(r => [r.acct, r.name, r.type, r.dr, r.cr])) };
  }
  if (kind === "b2b") {
    const b = (s.b2b && s.b2b.history) || [];
    return { name: `economy-b2b-day${day}.csv`, text: toCsv(["day", "tender", "buyer", "product", "quantity", "result", "price", "revenue"], b.map(h => [h.day, h.id, h.buyer, h.pid, h.qty, h.result, h.price != null ? h.price : h.bid != null ? h.bid : "", h.revenue || ""])) };
  }
  return null;
}
