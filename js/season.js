// Yearly calendar. The game year is D.SEASON.year days long and repeats. Named periods (holidays and seasons) change how much of each product
// category shoppers want. The calendar is public, so the forecast knows it too. Games started before this existed (no `cal` flag) are untouched.
import * as D from "./data.js";
import { mailPost } from "./mail.js";
import { log } from "./engine.js";

export const dayOfYear = day => ((Math.max(1, Math.floor(day)) - 1) % D.SEASON.year) + 1;
export const periodsOn = day => D.SEASON.periods.filter(p => { const d = dayOfYear(day); return d >= p.from && d <= p.to; });
// Demand multiplier for a product category on a game day (1 when the calendar is off).
export function seasonMult(s, cat, day = s.day) {
  if (!s.cal) return 1;
  return periodsOn(day).reduce((a, p) => a * (p.mult[cat] != null ? p.mult[cat] : p.mult.all != null ? p.mult.all : 1), 1);
}
// The next periods that start within `days`, soonest first, with how many days away (0 = under way now).
export function upcoming(s, days = 28) {
  const out = [];
  for (const p of D.SEASON.periods) for (let k = 0; k <= days; k++) { const d = dayOfYear(s.day + k); if (d === p.from || (k === 0 && d > p.from && d <= p.to)) { out.push({ ...p, inDays: k === 0 && d !== p.from ? 0 : k, left: p.to - dayOfYear(s.day + Math.max(0, k)) + 1 }); break; } }
  return out.sort((a, b) => a.inDays - b.inDays);
}
export const effectText = p => Object.entries(p.mult).map(([k, v]) => `${k === "all" ? "everything" : k} ${v >= 1 ? "+" : ""}${Math.round((v - 1) * 100)}%`).join(", ");

// Daily: tell the player three days ahead, and log the start.
export function seasonDay(s) {
  if (!s.cal) return;
  for (const p of D.SEASON.periods) {
    if (dayOfYear(s.day + D.SEASON.warnDays) === p.from) mailPost(s, { from: "Management", subject: `${p.name} starts in ${D.SEASON.warnDays} days`, body: `${p.note} Expected demand: ${effectText(p)}. Check your stock and your orders now.`, goto: ["data", "forecast"], level: "info" });
    if (dayOfYear(s.day) === p.from) log(s, `${p.name} begins: ${effectText(p)}.`);
  }
}
