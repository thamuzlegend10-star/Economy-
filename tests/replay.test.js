// Verified replay: the final save must be reproducible from setup + command log.
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import { replayMatch, verifyAgainstReplay, gameOpts } from "../js/replay.js";

const cfg = (o = {}) => ({ days: 8, difficulty: "normal", capital: 1200, seed: 4242, location: "id-medan-central", scenario: "", ...o });
// Play a match like a browser does: uneven frame sizes, commands between frames, some commands that fail.
function play(config, { chunk = () => 0.016 * 3, tamper = null } = {}) {
  const s = E.newGame({ ...gameOpts(config), record: true });
  let n = 0;
  while (!s.ended && n++ < 4e6) {
    if (s.phase === "report") { E.nextDay(s); continue; }
    if (Math.round(s.clock * 20) % 400 === 0 && s.acc < 0.001) {
      const lines = D.PRODUCTS.filter(p => E.isUnlocked(s, p.id) && D.SUPPLIERS[1].cats.includes(p.cat) && E.unitsTotal(s, p.id) < 14).slice(0, 5).map(p => ({ pid: p.id, qty: 15 }));
      if (lines.length) E.placeOrder(s, { supplier: "metro", lines, pay: s.day % 2 ? "bank" : "terms", cmdId: "o" + s.steps });
      for (const p of D.PRODUCTS) E.setShelfTarget(s, p.id, 12);
      E.restock(s, "water", 5); E.placeOrder(s, { supplier: "nobody", lines: [] });          // a failing command must not be logged
      if (s.day === 2 && !s.staff.length) E.hire(s, s.candidates[0].id);
      if (s.day === 3) E.launchCampaign(s, "flyers", "c" + s.day);
    }
    E.tick(s, chunk());
  }
  if (tamper) tamper(s);
  return s;
}
const reload = s => E.validateSave(E.serialize(s)).state;

test("a recorded match replays to exactly the same final state", () => {
  const s = play(cfg()); assert.ok(s.ended);
  assert.ok(s.cmdlog.length > 10 && s.cmdlog.every(e => E.COMMANDS[e.c]));
  assert.ok(!s.cmdlog.some(e => e.c === "placeOrder" && e.a[0].supplier === "nobody"), "failed commands are not logged");
  const r = verifyAgainstReplay(reload(s), cfg()); assert.ok(r.ok, r.reason);
  assert.equal(r.state.rng, s.rng); assert.deepEqual(r.state.ledger.bal, s.ledger.bal);
});
test("the result does not depend on how the browser chops frames", () => {
  const a = play(cfg(), { chunk: () => 0.016 }), b = play(cfg(), { chunk: () => 0.4 });
  assert.equal(a.steps, b.steps); assert.equal(a.rng, b.rng);
  assert.deepEqual(a.ledger.bal, b.ledger.bal);
});
test("editing the final save is caught", () => {
  const s = play(cfg()); let checked = 0, rejected = 0;
  for (const f of [o => { o.ledger.bal.bank += 500; o.ledger.bal.capital -= 500; }, o => { o.rng += 1; }, o => { o.day += 0; o.history.pop(); }, o => { o.steps += 50; }]) {
    const x = JSON.parse(E.serialize(s)); f(x);
    const v = E.validateSave(x); if (!v.ok) { rejected++; continue; }      // already rejected by the save checks
    assert.equal(verifyAgainstReplay(v.state, cfg()).ok, false); checked++;
  }
  assert.ok(checked >= 3, `only ${checked} edits reached the replay check`);
});
test("editing, removing or adding commands is caught", () => {
  const s = play(cfg()); let checked = 0, rejected = 0;
  const variants = [
    o => { o.cmdlog.splice(3, 1); },
    o => { o.cmdlog[2].a = [{ ...o.cmdlog[2].a[0], qty: 999 }]; },
    o => { o.cmdlog.push({ n: o.steps, c: "deposit", a: [1, "x"] }); },
    o => { o.cmdlog[1].n = o.cmdlog[4].n + 5; },
    o => { o.cmdlog = null; },
    o => { o.logFull = true; },
  ];
  for (const f of variants) {
    const x = JSON.parse(E.serialize(s)); f(x);
    const v = E.validateSave(x); if (!v.ok) { rejected++; continue; }
    assert.equal(verifyAgainstReplay(v.state, cfg()).ok, false); checked++;
  }
  assert.ok(checked >= 4, `only ${checked} edits reached the replay check`);
});
test("a log played for different settings or seed does not verify", () => {
  const s = play(cfg());
  assert.equal(verifyAgainstReplay(reload(s), cfg({ seed: 1 })).ok, false);
  assert.equal(verifyAgainstReplay(reload(s), cfg({ capital: 2000 })).ok, false);
});
test("scenario and facilitator events are part of the replay", () => {
  const c = cfg({ scenario: "grand-opening", days: 10, difficulty: "easy", capital: 1500, location: "default" });
  const s = E.newGame({ ...gameOpts(c), record: true });
  while (!s.ended) { if (s.phase === "report") { E.nextDay(s); continue; } if (s.clock === 0 && s.day === 4) E.injectShock(s, { kind: "rain", cmdId: "r" }); E.tick(s, 0.5); }
  assert.ok(s.cmdlog.some(e => e.c === "injectShock"));
  const r = verifyAgainstReplay(reload(s), c); assert.ok(r.ok, r.reason);
});
test("a game that was not recorded cannot be verified, and oversized logs are rejected by the save check", () => {
  const s = E.newGame(gameOpts(cfg())); while (!s.ended) { if (s.phase === "report") E.nextDay(s); else E.tick(s, 0.5); }
  assert.equal(verifyAgainstReplay(reload(s), cfg()).ok, false);
  const x = JSON.parse(E.serialize(play(cfg()))); x.cmdlog = new Array(E.MAX_LOG + 1).fill({ n: 0, c: "hire", a: [1] });
  assert.equal(E.validateSave(x).ok, false);
  const y = JSON.parse(E.serialize(play(cfg()))); y.cmdlog[0].c = "constructor";
  assert.equal(E.validateSave(y).ok, false);
});
test("v9 saves migrate without a log", () => {
  const old = JSON.parse(E.serialize(E.newGame({ seed: 1 }))); old.v = 9; delete old.steps; delete old.acc; delete old.cmdlog; delete old.logFull;
  const m = E.validateSave(old); assert.ok(m.ok, m.error); assert.equal(m.state.cmdlog, null); assert.equal(m.state.steps, 0);
});

import { verifyFiles } from "../tools/verify-match.mjs";
test("command-line verifier: accepts a real match, rejects an edited one", () => {
  const c = cfg(), s = play(c);
  const ok = verifyFiles(JSON.stringify(c), E.serialize(s));
  assert.ok(ok.ok, ok.reason); assert.equal(ok.verified, "replay"); assert.equal(ok.score, E.score(s).total);
  const x = JSON.parse(E.serialize(s)); x.cmdlog.splice(2, 1);
  assert.equal(verifyFiles(JSON.stringify(c), JSON.stringify(x)).ok, false);
  assert.equal(verifyFiles(JSON.stringify(cfg({ days: 9 })), E.serialize(s)).ok, false);
});
