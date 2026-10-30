// Verify a finished match from the command line (or from a server function): replay its command log and print the official verdict.
// Usage: node tools/verify-match.mjs <config.json> <final-save.json>
// config.json: { "days": 15, "difficulty": "normal", "capital": 1000, "seed": 123, "location": "default", "scenario": "" }
import { readFileSync } from "node:fs";
import * as E from "../js/engine.js";
import { verifyAgainstReplay } from "../js/replay.js";
import { sanitizeConfig } from "../js/multiplayer.js";

export function verifyFiles(configRaw, saveRaw) {
  const cfgIn = JSON.parse(configRaw);
  const config = { ...sanitizeConfig(cfgIn), seed: Number.isInteger(cfgIn.seed) ? cfgIn.seed : 0 };
  const v = E.validateSave(saveRaw);
  if (!v.ok) return { ok: false, reason: v.error };
  const s = v.state;
  if (s.mode !== "standard" || s.dayLimit !== config.days || s.difficulty !== config.difficulty || s.capital !== config.capital || s.loc !== config.location || (s.scenario || "") !== (config.scenario || "")) return { ok: false, reason: "Save does not match the match settings." };
  const r = verifyAgainstReplay(s, config);
  if (!r.ok) return { ok: false, reason: r.reason };
  const g = r.state, sc = E.score(g), rec = E.reconcile(g);
  if (!rec.ok) return { ok: false, reason: "Books do not reconcile." };
  return { ok: true, verified: "replay", score: sc.total, rating: sc.rating, netWorth: E.updateDerived(g).netWorth, day: g.day, reason: g.ended && g.ended.reason, goals: E.evaluateGoals(g) };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.length < 4) { console.error("usage: node tools/verify-match.mjs <config.json> <final-save.json>"); process.exit(2); }
  const out = verifyFiles(readFileSync(process.argv[2], "utf8"), readFileSync(process.argv[3], "utf8"));
  console.log(JSON.stringify(out, null, 2)); process.exit(out.ok ? 0 : 1);
}
