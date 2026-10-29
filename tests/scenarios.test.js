// Scenarios, goals, facilitator injections and the debrief export.
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import * as SCN from "../js/scenarios.js";
import { debriefText, debriefCsv } from "../js/debrief.js";

const clean = s => assert.deepEqual(E.reconcile(s), { ok: true, problems: [] });
const endDay = s => { while (s.phase === "open") E.tick(s, 0.25); if (!s.ended) E.nextDay(s); };
const play = s => { while (!s.ended) endDay(s); return s; };

test("every scenario has a valid setup, shocks inside the game, and goals the engine understands", () => {
  assert.ok(SCN.SCENARIOS.length >= 4);
  for (const sc of SCN.SCENARIOS) {
    const s = E.newGame({ seed: 3, scenario: sc.id });
    assert.equal(s.scenario, sc.id); assert.equal(s.mode, "standard"); assert.equal(s.dayLimit, sc.setup.days);
    assert.equal(s.capital, sc.setup.capital); assert.equal(s.difficulty, sc.setup.difficulty); assert.equal(s.loc, sc.setup.location);
    for (const k of sc.shocks) { assert.ok(k.day >= 1 && k.day <= sc.setup.days); assert.ok(SCN.SHOCK_KINDS.includes(k.kind)); }
    play(s); clean(s);
    assert.equal(s.ended.goals.length, sc.goals.length);
    for (const g of s.ended.goals) assert.ok(typeof g.ok === "boolean" && g.text && typeof g.value === "string");
  }
});
test("a scenario overrides the setup the caller passes and unknown ids are ignored", () => {
  const a = E.newGame({ seed: 1, scenario: "cash-squeeze", capital: 9999, difficulty: "easy", mode: "infinite", dayLimit: 99, location: "sg-central" });
  assert.equal(a.capital, 600); assert.equal(a.difficulty, "hard"); assert.equal(a.mode, "standard"); assert.equal(a.dayLimit, 14);
  const b = E.newGame({ seed: 1, scenario: "nope", capital: 700 });
  assert.equal(b.scenario, null); assert.equal(b.capital, 700);
});
test("scripted shocks fire on their day and no random events occur", () => {
  const s = E.newGame({ seed: 5, scenario: "supply-crunch" });
  const seen = {};
  while (!s.ended) { for (const e of s.events.active) (seen[s.day] ||= new Set()).add(e.id); endDay(s); }
  assert.ok(seen[3].has("delay") && seen[4].has("market") && seen[8].has("rain"));
  for (const [day, set] of Object.entries(seen)) for (const id of set) assert.ok(SCN.getScenario("supply-crunch").shocks.some(k => k.day <= day && (k.kind === id || (k.kind === "market" && id === "market") || (k.kind === "delay" && id === "delay"))), `unexpected ${id} on ${day}`);
});
test("price war shocks make rivals run promotions", () => {
  const s = E.newGame({ seed: 5, scenario: "price-war" });
  while (s.day < 3) endDay(s);
  assert.ok(s.rivals.length && s.rivals.every(r => r.promo > 0));
});
test("scenario runs are deterministic", () => {
  const run = () => { const s = play(E.newGame({ seed: 9, scenario: "grand-opening" })); return JSON.stringify([s.ended.score, s.ended.goals, s.ledger.bal]); };
  assert.equal(run(), run());
});
test("facilitator injection queues, applies next morning, is logged and validated", () => {
  const s = E.newGame({ seed: 2, mode: "standard", dayLimit: 8 });
  assert.equal(E.injectShock(s, { kind: "bogus" }).ok, false);
  assert.ok(E.injectShock(s, { kind: "rain", cmdId: "i1" }).ok);
  assert.equal(E.injectShock(s, { kind: "rain", cmdId: "i1" }).ok, false);
  assert.equal(s.pending.length, 1);
  endDay(s);
  assert.equal(s.pending.length, 0);
  assert.ok(s.events.active.some(e => e.id === "rain"));
  assert.ok(s.decisions.some(d => d.includes("Facilitator event")));
  for (let i = 0; i < 5; i++) E.injectShock(s, { kind: "festival" });
  assert.equal(E.injectShock(s, { kind: "festival" }).ok, false);
  clean(s);
});
test("goals: a clean idle game misses growth; thresholds are honest", () => {
  const s = E.newGame({ seed: 4, scenario: "grand-opening" }); play(s);
  const goals = E.evaluateGoals(s);
  assert.equal(goals.length, 3);
  assert.equal(goals.find(g => g.text.startsWith("Serve")).ok, s.stats.customers >= 300);
});
test("save round trip keeps scenario and queue; v8 migrates; crafted values rejected", () => {
  const s = E.newGame({ seed: 6, scenario: "price-war" }); E.injectShock(s, { kind: "rain" });
  const r = E.validateSave(JSON.stringify(s)); assert.ok(r.ok, r.error); assert.equal(r.state.scenario, "price-war"); assert.equal(r.state.pending.length, 1);
  const old = JSON.parse(JSON.stringify(E.newGame({ seed: 1 }))); old.v = 8; delete old.scenario; delete old.pending;
  const m = E.validateSave(old); assert.ok(m.ok, m.error); assert.equal(m.state.scenario, null);
  for (const f of [o => { o.scenario = "x"; }, o => { o.pending = [{ kind: "nuke" }]; }, o => { o.pending = new Array(9).fill({ kind: "rain" }); }]) {
    const bad = JSON.parse(JSON.stringify(s)); f(bad); assert.equal(E.validateSave(bad).ok, false);
  }
});
test("debrief text and csv include goals, events, results and the disclaimer", () => {
  const s = play(E.newGame({ seed: 8, scenario: "cash-squeeze" }));
  const t = debriefText(s);
  assert.ok(t.includes("Cash squeeze") && t.includes("Goals:") && t.includes("Scripted events:") && t.includes("Discussion:") && t.includes("simulation"));
  const c = debriefCsv(s).trim().split("\n");
  assert.equal(c.length, s.history.length + 1); assert.ok(c[0].startsWith("day,"));
  assert.ok(debriefText(E.newGame({ seed: 1 })).includes("# Economy debrief"));
});

// ---------- rooms ----------
import { sanitizeConfig, createMultiplayer } from "../js/multiplayer.js";
import { createMemoryBus, createMemoryNet } from "../js/net.js";
test("room config: a scenario fixes the setup; unknown scenario is dropped", () => {
  const c = sanitizeConfig({ days: 50, difficulty: "easy", capital: 5000, location: "sg-central", scenario: "cash-squeeze" });
  assert.deepEqual([c.days, c.difficulty, c.capital, c.location, c.scenario], [14, "hard", 600, "default", "cash-squeeze"]);
  assert.equal(sanitizeConfig({ scenario: "nope" }).scenario, "");
});

const tick = (ms = 15) => new Promise(r => setTimeout(r, ms));
const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
function peer(bus) {
  const log = { starts: [], injects: [], results: [] };
  const mp = createMultiplayer({ net: createMemoryNet(bus), storage: mem(), settleMs: 20, helloMs: 400, onStart: c => log.starts.push(c), onInject: k => log.injects.push(k), onResults: r => log.results.push(r) });
  return { mp, log };
}
test("room: scenario match, host injects for everyone, verdict carries goals, wrong scenario rejected", async () => {
  const bus = createMemoryBus(), a = peer(bus), b = peer(bus);
  const { code } = await a.mp.create("Host"); await b.mp.join(code, "Guest"); b.mp.setReady(true); await tick();
  assert.equal(a.mp.setConfig({ scenario: "grand-opening" }).ok, true); await tick();
  assert.equal(b.mp.view().config.scenario, "grand-opening");
  assert.match(a.mp.inject("rain").error, /No match/);
  assert.ok(a.mp.start().ok); await tick();
  assert.equal(b.log.starts[0].scenario, "grand-opening"); assert.equal(b.log.starts[0].days, 10);
  assert.equal(b.mp.inject("rain").error !== undefined, true, "guest cannot inject");
  assert.equal(a.mp.inject("bogus").error !== undefined, true);
  assert.ok(a.mp.inject("festival").ok); await tick();
  assert.deepEqual(a.log.injects, ["festival"]); assert.deepEqual(b.log.injects, ["festival"]);
  const cfg = a.log.starts[0];
  const mine = play(E.newGame({ seed: cfg.seed, scenario: cfg.scenario }));
  const wrong = play(E.newGame({ seed: cfg.seed, mode: "standard", difficulty: cfg.difficulty, capital: cfg.capital, dayLimit: cfg.days, location: cfg.location }));
  b.mp.submitFinal(E.serialize(wrong)); a.mp.submitFinal(E.serialize(mine)); await tick(80);
  const v = a.mp.view();
  const host = v.players.find(p => p.isMe), guest = v.players.find(p => !p.isMe);
  assert.ok(host.verdict.ok && host.verdict.goalsTotal === 3);
  assert.equal(guest.verdict.ok, false);
});
