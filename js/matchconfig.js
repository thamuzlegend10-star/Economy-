// Match settings: one definition shared by the browser, tests and the server function.
import { hasLocation } from "./locations.js";
import { getScenario } from "./scenarios.js";

export function sanitizeConfig(c = {}) {
  const days = Math.max(5, Math.min(60, Math.round(Number(c.days) || 15)));
  const difficulty = ["easy", "normal", "hard"].includes(c.difficulty) ? c.difficulty : "normal";
  const capital = Math.max(300, Math.min(20000, Math.round(Number(c.capital) || 1000)));
  const seed = Number.isInteger(c.seed) ? c.seed : 0;
  const location = typeof c.location === "string" && hasLocation(c.location) ? c.location : "default";
  const scn = typeof c.scenario === "string" ? getScenario(c.scenario) : null;
  if (scn) return { days: scn.setup.days, difficulty: scn.setup.difficulty, capital: scn.setup.capital, seed, location: scn.setup.location, scenario: scn.id };   // a scenario fixes the setup for everyone
  return { days, difficulty, capital, seed, location, scenario: "" };
}
