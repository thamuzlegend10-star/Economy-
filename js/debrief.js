// Debrief export for classes and workshops: plain text and CSV built from a finished (or running) game. Pure, no DOM.
import { getScenario, SHOCK_LABEL } from "./scenarios.js";
import { getLocation } from "./locations.js";

const m = n => (n < 0 ? "-$" : "$") + Math.abs(Number(n) || 0).toFixed(2);
const csvCell = v => { const t = String(v ?? ""); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };

export function debriefCsv(s) {
  const rows = [["day", "revenue", "net_profit", "customers", "cash_and_bank", "net_worth"]];
  for (const h of s.history) rows.push([h.day ?? "", h.revenue, h.net, h.customers, h.liquid, h.netWorth]);
  return rows.map(r => r.map(csvCell).join(",")).join("\n") + "\n";
}

export function debriefText(s, goals = null) {
  const scn = getScenario(s.scenario), end = s.ended;
  const g = goals || (end && end.goals) || [];
  const L = [];
  L.push(`# Economy debrief${scn ? `: ${scn.name}` : ""}`);
  L.push(`Day ${s.day}${s.dayLimit ? ` of ${s.dayLimit}` : ""} | difficulty ${s.difficulty} | site ${getLocation(s.loc).name} | branches ${s.branches.length}`);
  if (scn) L.push("", `Brief: ${scn.brief}`);
  if (end) L.push("", `Result: ${end.reason === "completed" ? "completed" : "bankrupt"} | score ${end.score.total}/100 (${end.score.rating}) | net worth ${m(end.endNetWorth)} from ${m(end.startNetWorth)}`);
  if (g.length) { L.push("", "Goals:"); for (const x of g) L.push(`- [${x.ok ? "met" : "missed"}] ${x.text} (${x.value})`); }
  if (scn) { L.push("", "Scripted events:"); for (const k of scn.shocks) L.push(`- day ${k.day}: ${SHOCK_LABEL[k.kind]}`); }
  L.push("", "Daily results:", "day | revenue | net | customers | net worth");
  for (const h of s.history) L.push(`${h.day ?? "?"} | ${m(h.revenue)} | ${m(h.net)} | ${h.customers} | ${m(h.netWorth)}`);
  if (s.decisions.length) { L.push("", "Decisions (latest):"); for (const d of s.decisions) L.push(`- ${d}`); }
  if (scn) L.push("", `Discussion: ${scn.lesson}`);
  L.push("", "Note: all numbers come from a simulation with estimated coefficients, not real data.");
  return L.join("\n") + "\n";
}
