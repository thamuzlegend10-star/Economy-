// Verified replay: rebuild a finished match from its setup and command log, and compare it with the save that was claimed.
// Pure (no DOM, no network), so it runs the same in a browser, a worker, Node, or a server function.
import * as E from "./engine.js";

const MAX_STEPS = 60 * 120 / E.STEP + 2000;      // longest legal match: 60 days
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const gameOpts = c => ({ mode: "standard", difficulty: c.difficulty, capital: c.capital, dayLimit: c.days, seed: c.seed, location: c.location, scenario: c.scenario || "" });

// Replays the log of `claimed` (a validated save) under `config`. Returns { ok, state } with the REPLAYED state, or { ok:false, reason }.
export function replayMatch(claimed, config) {
  if (!Array.isArray(claimed.cmdlog)) return { ok: false, reason: "No command log: this match was not recorded." };
  if (claimed.logFull) return { ok: false, reason: "Command log was too long to verify." };
  if (!Number.isInteger(claimed.steps) || claimed.steps > MAX_STEPS) return { ok: false, reason: "Impossible number of simulation steps." };
  const s = E.newGame(gameOpts(config));
  let last = 0;
  for (const e of claimed.cmdlog) {
    if (e.n < last || e.n > claimed.steps) return { ok: false, reason: "Command log is out of order." };
    last = e.n;
    E.advanceTo(s, e.n);
    if (s.steps !== e.n) return { ok: false, reason: `Command "${e.c}" happened at a moment the game never reached.` };
    if (s.ended) return { ok: false, reason: "Command after the game ended." };
    const fn = E.COMMANDS[e.c];
    const r = fn(s, ...e.a);
    if (!r || !r.ok) return { ok: false, reason: `Command "${e.c}" is not valid in the replayed game.` };
  }
  E.advanceTo(s, claimed.steps);
  return { ok: true, state: s };
}

// Full check: the replay must end in exactly the state the player claims (same random stream, same books, same day).
export function verifyAgainstReplay(claimed, config) {
  const r = replayMatch(claimed, config);
  if (!r.ok) return r;
  const s = r.state;
  if (s.rng !== claimed.rng || s.steps !== claimed.steps || s.day !== claimed.day || !same(s.ledger.bal, claimed.ledger.bal) || (s.ended && s.ended.reason) !== (claimed.ended && claimed.ended.reason) || s.history.length !== claimed.history.length)
    return { ok: false, reason: "Save does not match its own command log (edited or from a different game)." };
  return { ok: true, state: s };
}

// The single official check for a finished match, used by the host's browser, the command line and the server function.
// Returns { ok:false, reason } or { ok:true, score, rating, netWorth, revenue, bankrupt?, goalsMet, goalsTotal, state }.
export function verifyFinalSave(raw, c) {
  try {
    if (typeof raw !== "string" || raw.length > 3e6) return { ok: false, reason: "Save missing or too large." };
    const v = E.validateSave(raw);
    if (!v.ok) return { ok: false, reason: String(v.error).slice(0, 80) };
    const s = v.state;
    if (s.mode !== "standard" || s.dayLimit !== c.days || s.difficulty !== c.difficulty || s.capital !== c.capital || s.loc !== c.location || (s.scenario || "") !== (c.scenario || "")) return { ok: false, reason: "Save does not match the room settings." };
    const bankrupt = !!s.ended && s.ended.reason === "bankrupt" && s.day <= c.days;
    if (!bankrupt && (!s.ended || s.day !== c.days)) return { ok: false, reason: "Save is not a finished match." };
    // Re-play the command log from the shared seed and require the exact same final state. The score comes from the REPLAYED game.
    const rp = verifyAgainstReplay(s, c);
    if (!rp.ok) return { ok: false, reason: String(rp.reason).slice(0, 80) };
    const g = rp.state, rec = E.reconcile(g);
    if (!rec.ok) return { ok: false, reason: "Books do not reconcile: " + String(rec.problems[0]).slice(0, 50) };
    const d = E.updateDerived(g), revenue = g.history.reduce((a, h) => a + h.revenue, 0) + g.archive.revenue;
    if (bankrupt) return { ok: true, score: 0, rating: "-", netWorth: d.netWorth, revenue, bankrupt: true, goalsMet: 0, goalsTotal: 0, state: g };
    const sc = E.score(g), goals = E.evaluateGoals(g);
    return { ok: true, score: sc.total, rating: sc.rating, netWorth: d.netWorth, revenue, goalsMet: goals.filter(x => x.ok).length, goalsTotal: goals.length, state: g };
  } catch { return { ok: false, reason: "Save could not be checked." }; }
}
