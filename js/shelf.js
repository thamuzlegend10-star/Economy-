// Shelf and back room.
// The shop has a display area (part of its space) and a back room (the rest). Customers only buy what is ON the shelf. Stock in the back room has to be moved to
// the shelf, by staff on a schedule you choose (each run costs a little labour) or by you with Restock now. A small shelf with few runs a day runs empty while
// the back room is full, and those sales are lost. You also choose how the display area is shared between the products.
// Only games started with this feature have it (s.shelfOn); older saves sell straight from stock as before.
import { post, round2 } from "./ledger.js";
import * as D from "./data.js";
import { capacityOf, PRODUCT } from "./engine.js";

const c = round2, err = error => ({ ok: false, error }), ok = (o = {}) => ({ ok: true, ...o });
export const SHELF = {
  share: 0.14, runCost: 6, freqs: [1, 2, 4, 8],
  presets: [{ id: "balanced", name: "Balanced", mix: { noodles: 0.5, milk: 0.35, earbuds: 0.15 } }, { id: "food", name: "Food first", mix: { noodles: 0.65, milk: 0.25, earbuds: 0.1 } }, { id: "drinks", name: "Drinks first", mix: { noodles: 0.35, milk: 0.5, earbuds: 0.15 } }, { id: "tech", name: "Electronics first", mix: { noodles: 0.4, milk: 0.3, earbuds: 0.3 } }],
};
export const ensureShelf = s => { if (!s.shelf) { s.shelf = {}; for (const p of D.PRODUCTS) s.shelf[p.id] = 0; } if (!s.shelfCfg) s.shelfCfg = { preset: "balanced", freq: 2, missed: {}, runs: 0, labour: 0 }; return s; };
const mixOf = s => (SHELF.presets.find(x => x.id === ensureShelf(s).shelfCfg.preset) || SHELF.presets[0]).mix;
// How many units of a product the display area holds.
export const shelfCap = (s, pid) => Math.floor(capacityOf(s.area) * SHELF.share * (mixOf(s)[pid] || 0) / PRODUCT[pid].space);
// What customers can buy right now.
export const onShelf = (s, pid) => (s.shelfOn ? Math.min(s.qty[pid], (s.shelf && s.shelf[pid]) || 0) : s.qty[pid]);
export const backRoom = (s, pid) => s.qty[pid] - onShelf(s, pid);

// Move back room stock to the shelf. `paid` runs (the staff schedule) cost labour when something actually moves.
export function restock(s, paid = false) {
  if (!s.shelfOn) return err("This game sells straight from stock."); ensureShelf(s); let moved = 0;
  for (const p of D.PRODUCTS) { const now = onShelf(s, p.id), target = Math.min(s.qty[p.id], shelfCap(s, p.id)); if (target > now) moved += target - now; s.shelf[p.id] = target; }
  const k = s.shelfCfg; if (paid && moved > 0) { post(s.ledger, s.day, "Staff restock the shelves", [{ acct: "maintenance", dr: SHELF.runCost }, { acct: "cash", cr: SHELF.runCost }], "hr:shelf:" + s.steps); k.runs++; k.labour = c(k.labour + SHELF.runCost); }
  return ok({ moved });
}
// Called every step: the staff schedule. The first run is at the start of the day.
export function shelfStep(s) {
  if (!s.shelfOn) return; const k = ensureShelf(s).shelfCfg, n = s.stepsPerDay, every = Math.max(1, Math.floor(n / k.freq));
  if (s.dayStep % every === 0 && s.dayStep < n) restock(s, true);
}
export const noteMissed = (s, pid, n) => { if (!s.shelfOn || n <= 0) return; const k = ensureShelf(s).shelfCfg; k.missed[pid] = (k.missed[pid] || 0) + n; };
export function setShelf(s, { preset, freq } = {}) {
  if (!s.shelfOn) return err("This game sells straight from stock."); const k = ensureShelf(s).shelfCfg;
  if (preset !== undefined) { if (!SHELF.presets.some(x => x.id === preset)) return err("Choose a layout."); k.preset = preset; }
  if (freq !== undefined) { if (!SHELF.freqs.includes(Number(freq))) return err("Choose how often staff restock."); k.freq = Number(freq); }
  for (const p of D.PRODUCTS) s.shelf[p.id] = Math.min(s.shelf[p.id], shelfCap(s, p.id));   // a smaller display area takes stock off the shelf at once
  return ok();
}
