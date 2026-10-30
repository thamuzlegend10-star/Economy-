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
