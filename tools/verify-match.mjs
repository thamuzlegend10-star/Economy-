// Verify a finished match from the command line (or from a server function): replay its command log and print the official verdict.
// Usage: node tools/verify-match.mjs <config.json> <final-save.json>
// config.json: { "days": 15, "difficulty": "normal", "capital": 1000, "seed": 123, "location": "default", "scenario": "" }
import { readFileSync } from "node:fs";
import * as E from "../js/engine.js";
import { verifyFinalSave } from "../js/replay.js";
import { sanitizeConfig } from "../js/matchconfig.js";

export function verifyFiles(configRaw, saveRaw) {
  const cfgIn = JSON.parse(configRaw);
  const config = { ...sanitizeConfig(cfgIn), seed: Number.isInteger(cfgIn.seed) ? cfgIn.seed : 0 };
  const r = verifyFinalSave(saveRaw, config);
  if (!r.ok) return r;
  const { state, ...out } = r;
  return { ...out, verified: "replay", day: state.day, reason: state.ended && state.ended.reason, goals: E.evaluateGoals(state) };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.length < 4) { console.error("usage: node tools/verify-match.mjs <config.json> <final-save.json>"); process.exit(2); }
  const out = verifyFiles(readFileSync(process.argv[2], "utf8"), readFileSync(process.argv[3], "utf8"));
  console.log(JSON.stringify(out, null, 2)); process.exit(out.ok ? 0 : 1);
}
