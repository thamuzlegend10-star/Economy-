// Facilitator and scenario mode, played locally. A scenario is a script of dated events that change the market for a while. The facilitator
// (the person running the session) can also inject an event at any time. Every event is announced in Mail and changes real numbers:
//   rival: rival shop prices are multiplied (shoppers compare)   demand: shopper demand in the shop is multiplied    cost: supplier and vendor prices are multiplied    delay: supplier deliveries arrive one day late
import * as D from "./data.js";
import { streamNext, seedFrom } from "./rng.js";
import { mailPost } from "./mail.js";
import { log } from "./engine.js";
import { totals, balance, round2 } from "./ledger.js";
import { deptPL } from "./bi.js";
import { cashFlow } from "./accounting.js";
import { ensureSrv, retention } from "./market.js";

export const newScn = (id = "free", seed = 0) => ({ id, events: [], seq: 0, rng: seedFrom(seed, 0x5c3), last: {} });
export const ensureScn = s => (s.scn = s.scn || newScn());
export const SCENARIO = Object.fromEntries(D.SCENARIOS.map(x => [x.id, x]));
const activeAt = (s, kind) => ensureScn(s).events.filter(e => e.kind === kind && e.from <= s.day && e.until >= s.day);
export const eventMult = (s, kind) => activeAt(s, kind).reduce((a, e) => a * e.mult, 1);
export const delayed = s => activeAt(s, "delay").length > 0;

function start(s, ev, how) {
  const sc = ensureScn(s), e = { id: ++sc.seq, kind: ev.kind, mult: ev.mult || 1, from: s.day, until: s.day + ev.days - 1, title: ev.title, how, key: ev.key || null };
  if (e.key) { sc.last = sc.last || {}; sc.last[e.key] = e.until; }
  sc.events.push(e); if (sc.events.length > 40) sc.events.shift();
  const txt = e.kind === "rival" ? `Rival shops ${e.mult >= 1 ? "raise" : "cut"} their prices by ${Math.round(Math.abs(e.mult - 1) * 100)}%` : e.kind === "demand" ? `Shopper demand ${e.mult >= 1 ? "up" : "down"} ${Math.round(Math.abs(e.mult - 1) * 100)}%` : e.kind === "cost" ? `Supplier prices ${e.mult >= 1 ? "up" : "down"} ${Math.round(Math.abs(e.mult - 1) * 100)}%` : "Supplier deliveries arrive one day late";
  mailPost(s, { from: how === "facilitator" ? "Facilitator" : "Market news", subject: e.title, body: `${ev.body || e.title} ${txt} for ${ev.days} days (until day ${e.until}).`, level: "warn" });
  log(s, `Event: ${e.title}.`); return e;
}
const between = (sc, [lo, hi]) => lo + (hi - lo) * streamNext(sc);
// Each day every possible event of the scenario rolls its own chance. The rolls come from the game seed only, never from what the player does.
export function scenarioDay(s) {
  const sc = ensureScn(s), def = SCENARIO[sc.id]; sc.last = sc.last || {}; if (!Number.isFinite(sc.rng)) sc.rng = seedFrom(s.seed, 0x5c3);
  if (def) for (const p of def.pool || []) {
    if (s.day < (p.minDay || 1) || sc.events.some(e => e.key === p.key && e.until >= s.day)) continue;
    const last = sc.last[p.key];
    if (last != null && s.day - last <= (p.cooldown || 0)) continue;
    if (p.after) { const la = sc.last[p.after]; if (la == null || s.day <= la || s.day - la > p.within || (last != null && last >= la)) continue; }
    if (streamNext(sc) >= p.chance * D.diff(s).events) continue;
    start(s, { key: p.key, kind: p.kind, mult: Math.round(between(sc, p.mult) * 100) / 100, days: Math.floor(between(sc, [p.days[0], p.days[1] + 0.999])), title: p.title, body: p.body }, "scenario");
  }
  const ended = sc.events.filter(e => e.until === s.day - 1);
  for (const e of ended) mailPost(s, { from: e.how === "facilitator" ? "Facilitator" : "Market news", subject: `Over: ${e.title}`, body: "The market is back to normal.", level: "info" });
}
// Facilitator action: a custom event starting today.
export function inject(s, { kind, mult, days, title } = {}) {
  if (s.ended) return { ok: false, error: "The game is over." };
  if (!["demand", "cost", "delay", "rival"].includes(kind)) return { ok: false, error: "Choose an event type." };
  mult = Number(mult); days = Math.round(Number(days)); if (kind !== "delay" && !(mult >= 0.5 && mult <= 2)) return { ok: false, error: "Strength must be between ×0.5 and ×2." };
  if (!(days >= 1 && days <= 30)) return { ok: false, error: "Length must be 1 to 30 days." };
  return { ok: true, event: start(s, { kind, mult: kind === "delay" ? 1 : mult, days, title: (title || "").trim().slice(0, 60) || ({ demand: "Demand shock", cost: "Price shock", delay: "Supply delays" })[kind], body: "The facilitator announces a change in the market." }, "facilitator") };
}
export function stopEvent(s, id) { const e = ensureScn(s).events.find(x => x.id === Number(id)); if (!e) return { ok: false, error: "Unknown event." }; e.until = s.day - 1; return { ok: true }; }
export const activeEvents = s => ensureScn(s).events.filter(e => e.from <= s.day && e.until >= s.day);

// A result card a team can hand to the facilitator; the facilitator loads several and ranks them.
export function resultCard(s, score, name = "", sb = null) {
  const t = totals(s.ledger), cf = cashFlow(s), v = ensureSrv(s);
  return { game: "economy-result", v: 2, name: String(name || "").slice(0, 30), scenario: ensureScn(s).id, difficulty: D.DIFFICULTY[s.difficulty] ? s.difficulty : "normal", dev: !!s.dev, seed: s.seed, day: s.day, days: s.days, ended: s.ended ? s.ended.reason : null, score: round2(score), netWorth: round2(t.assets - t.liabilities), netProfit: round2(t.revenue - t.costs), revenue: round2(t.revenue), cash: round2(balance(s.ledger, "cash")),
    kpis: sb ? sb.rows.map(r => ({ id: r.id, name: r.name, unit: r.unit, value: round2(r.value), score: round2(r.score) })) : [],
    depts: deptPL(s).map(d => ({ id: d.id, name: d.name, rev: d.rev, cost: d.cost, net: d.net })),
    cash_flow: { operating: cf.operating, investing: cf.investing, financing: cf.financing },
    customers: { csi: round2(v.csi), retention: round2(retention(s)), response: round2(v.resp), complaints: { ...v.types } } };
}
const fin = v => (Number.isFinite(v) ? v : 0), short = (x, n = 40) => String(x == null ? "" : x).slice(0, n);
export function parseResult(text) {
  let o; try { o = JSON.parse(text); } catch { return null; }
  if (!o || o.game !== "economy-result" || !Number.isFinite(o.score) || !Number.isFinite(o.netWorth)) return null;
  const arr = (a, m) => (Array.isArray(a) ? a.slice(0, 40).map(m) : []);
  return { dev: !!o.dev, name: short((o.dev ? "[dev] " : "") + (o.name || "Team"), 30), scenario: short(o.scenario || "free", 20), difficulty: D.DIFFICULTY[o.difficulty] ? o.difficulty : "normal", seed: o.seed, day: o.day, days: o.days, ended: o.ended, score: o.score, netWorth: o.netWorth, netProfit: o.netProfit, revenue: o.revenue, cash: o.cash,
    kpis: arr(o.kpis, k => ({ id: short(k.id, 20), name: short(k.name), unit: short(k.unit, 8), value: fin(k.value), score: fin(k.score) })),
    depts: arr(o.depts, d => ({ id: short(d.id, 20), name: short(d.name), rev: fin(d.rev), cost: fin(d.cost), net: fin(d.net) })),
    cash_flow: o.cash_flow ? { operating: fin(o.cash_flow.operating), investing: fin(o.cash_flow.investing), financing: fin(o.cash_flow.financing) } : null,
    customers: o.customers ? { csi: fin(o.customers.csi), retention: fin(o.customers.retention), response: fin(o.customers.response) } : null };
}
export const rank = list => list.map((r, idx) => ({ ...r, idx })).sort((a, b) => b.score - a.score || b.netWorth - a.netWorth).map((r, i) => ({ ...r, place: i + 1 }));

// Learning analytics for the facilitator: what the whole class did, which measures were weak, who is at risk.
export function analytics(list) {
  const n = list.length; if (!n) return null;
  const sc = list.map(r => r.score).sort((a, b) => a - b), mean = x => x.reduce((a, b) => a + b, 0) / x.length, med = sc.length % 2 ? sc[(sc.length - 1) >> 1] : (sc[sc.length / 2 - 1] + sc[sc.length / 2]) / 2;
  const kp = {}; for (const r of list) for (const k of r.kpis || []) (kp[k.id] = kp[k.id] || { id: k.id, name: k.name, scores: [] }).scores.push(k.score);
  const kpis = Object.values(kp).map(k => ({ id: k.id, name: k.name, mean: round2(mean(k.scores)), min: Math.min(...k.scores), max: Math.max(...k.scores), n: k.scores.length })).sort((a, b) => a.mean - b.mean);
  const dp = {}; for (const r of list) for (const d of r.depts || []) { const x = (dp[d.id] = dp[d.id] || { id: d.id, name: d.name, loss: 0, n: 0 }); x.n++; if (d.net < 0 && d.rev > 0) x.loss++; }
  const lossy = Object.values(dp).filter(d => d.n >= Math.min(2, n) && d.loss / d.n >= 0.5).map(d => d.name);
  const bankrupt = list.filter(r => r.ended === "bankrupt").length, loss = list.filter(r => r.netProfit < 0).length, lowCsi = list.filter(r => r.customers && r.customers.csi < 60).length;
  const hints = [];
  if (kpis.length) hints.push(`Weakest measure across the class: ${kpis[0].name} (average score ${kpis[0].mean.toFixed(0)}). Spend class time here.`);
  if (bankrupt) hints.push(`${bankrupt} of ${n} went bankrupt. Look at cash planning and overdraft use.`);
  if (loss > n / 2) hints.push(`${loss} of ${n} made a loss overall.`);
  if (lowCsi) hints.push(`${lowCsi} of ${n} let customer satisfaction fall under 60 (stock-outs, slow service).`);
  if (lossy.length) hints.push(`Most teams lose money in: ${lossy.join(", ")}.`);
  if (sc[sc.length - 1] - sc[0] > 30) hints.push("Large gap between best and worst: compare their decisions side by side.");
  return { n, mean: round2(mean(sc)), median: round2(med), best: sc[sc.length - 1], worst: sc[0], bankrupt, loss, kpis, hints };
}
// A one-team end report as a standalone page (opens in any browser, prints to PDF).
const esc = x => String(x == null ? "" : x).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const $$ = v => (v < 0 ? "-$" : "$") + Math.abs(Math.round(v)).toLocaleString("en-US");
export function reportHtml(r) {
  const rows = (a, f) => (a || []).map(f).join(""), done = r.ended === "bankrupt" ? "Ended: bankrupt" : r.ended === "completed" ? "Completed" : "In progress";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.name)} - end report</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#1b1f24}h1{margin:0}h2{margin:24px 0 6px;font-size:16px;border-bottom:1px solid #ccd;padding-bottom:4px}table{width:100%;border-collapse:collapse}td,th{padding:4px 6px;text-align:right;border-bottom:1px solid #eef}td:first-child,th:first-child{text-align:left}.big{font-size:40px;font-weight:700}.neg{color:#b3261e}small{color:#667}</style>
<h1>${esc(r.name)}</h1><small>${esc(r.scenario)} · ${esc(r.difficulty || "normal")} · day ${r.day}${r.days ? " of " + r.days : ""} · ${done}</small>
<p class="big">${r.score.toFixed(1)}<small> / 100</small></p>
<h2>Results</h2><table><tr><td>Net worth</td><td>${$$(r.netWorth)}</td></tr><tr><td>Net profit</td><td class="${r.netProfit < 0 ? "neg" : ""}">${$$(fin(r.netProfit))}</td></tr><tr><td>Revenue</td><td>${$$(fin(r.revenue))}</td></tr><tr><td>Cash</td><td>${$$(fin(r.cash))}</td></tr></table>
${r.kpis && r.kpis.length ? `<h2>Scorecard</h2><table><tr><th>Measure</th><th>Value</th><th>Score</th></tr>${rows(r.kpis, k => `<tr><td>${esc(k.name)}</td><td>${k.value.toFixed(1)} ${esc(k.unit)}</td><td>${k.score.toFixed(0)}</td></tr>`)}</table>` : ""}
${r.depts && r.depts.length ? `<h2>Profit and loss by department</h2><table><tr><th>Department</th><th>Revenue</th><th>Cost</th><th>Result</th></tr>${rows(r.depts, d => `<tr><td>${esc(d.name)}</td><td>${d.rev ? $$(d.rev) : ""}</td><td>${d.cost ? $$(d.cost) : ""}</td><td class="${d.net < 0 ? "neg" : ""}">${$$(d.net)}</td></tr>`)}</table>` : ""}
${r.cash_flow ? `<h2>Cash flow</h2><table><tr><td>Operating</td><td>${$$(r.cash_flow.operating)}</td></tr><tr><td>Investing</td><td>${$$(r.cash_flow.investing)}</td></tr><tr><td>Financing</td><td>${$$(r.cash_flow.financing)}</td></tr></table>` : ""}
${r.customers ? `<h2>Customers</h2><table><tr><td>Satisfaction</td><td>${r.customers.csi.toFixed(0)} / 100</td></tr><tr><td>Retention</td><td>${r.customers.retention.toFixed(0)}%</td></tr><tr><td>Response time</td><td>${r.customers.response < 0.05 ? "same day" : r.customers.response.toFixed(1) + " days"}</td></tr></table>` : ""}
<p><small>Scores come from the team's own device. Nothing was checked by a server.</small></p></html>`;
}
