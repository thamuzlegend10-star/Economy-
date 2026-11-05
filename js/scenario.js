// Facilitator and scenario mode, played locally. A scenario is a script of dated events that change the market for a while. The facilitator
// (the person running the session) can also inject an event at any time. Every event is announced in Mail and changes real numbers:
//   rival: rival shop prices are multiplied (shoppers compare)   demand: shopper demand in the shop is multiplied    cost: supplier and vendor prices are multiplied    delay: supplier deliveries arrive one day late
import * as D from "./data.js";
import { streamNext, seedFrom } from "./rng.js";
import { mailPost } from "./mail.js";
import { log } from "./engine.js";
import { totals, balance, round2 } from "./ledger.js";

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
    if (streamNext(sc) >= p.chance) continue;
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
export function resultCard(s, score, name = "") {
  const t = totals(s.ledger);
  return { game: "economy-result", v: 1, name: String(name || "").slice(0, 30), scenario: ensureScn(s).id, seed: s.seed, day: s.day, days: s.days, ended: s.ended ? s.ended.reason : null, score: round2(score), netWorth: round2(t.assets - t.liabilities), netProfit: round2(t.revenue - t.costs), revenue: round2(t.revenue), cash: round2(balance(s.ledger, "cash")) };
}
export function parseResult(text) {
  let o; try { o = JSON.parse(text); } catch { return null; }
  if (!o || o.game !== "economy-result" || !Number.isFinite(o.score) || !Number.isFinite(o.netWorth)) return null;
  return { name: String(o.name || "Team").slice(0, 30), scenario: String(o.scenario || "free"), seed: o.seed, day: o.day, days: o.days, ended: o.ended, score: o.score, netWorth: o.netWorth, netProfit: o.netProfit, revenue: o.revenue, cash: o.cash };
}
export const rank = list => [...list].sort((a, b) => b.score - a.score || b.netWorth - a.netWorth).map((r, i) => ({ ...r, place: i + 1 }));
