import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import { createMultiplayer, genCode, sanitizeConfig, CODE_RE } from "../js/multiplayer.js";
import { createMemoryBus, createMemoryNet } from "../js/net.js";

const tick = (ms = 15) => new Promise(r => setTimeout(r, ms));
const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
function mk(bus, extra = {}) {
  const log = { starts: [], results: [], resumes: [] };
  const mp = createMultiplayer({ net: createMemoryNet(bus), storage: mem(), settleMs: 20, helloMs: 400, onStart: c => log.starts.push(c), onResults: r => log.results.push(r), onResume: c => log.resumes.push(c), ...extra });
  return { mp, log };
}
// Play a full standard match with a simple bot and return the serialized save.
function playMatch(config, tamper) {
  const s = E.newGame({ mode: "standard", difficulty: config.difficulty, capital: config.capital, dayLimit: config.days, seed: config.seed });
  let n = 0;
  while (!s.ended && n++ < 400000) {
    if (s.phase === "report") { E.nextDay(s); continue; }
    if (s.clock === 0) {
      const lines = D.PRODUCTS.filter(p => E.isUnlocked(s, p.id) && D.SUPPLIERS[1].cats.includes(p.cat) && E.unitsTotal(s, p.id) < 12).slice(0, 6).map(p => ({ pid: p.id, qty: 15 }));
      if (lines.length) E.placeOrder(s, { supplier: "metro", lines, pay: "bank" });
      for (const p of D.PRODUCTS) E.setShelfTarget(s, p.id, 12);
    }
    E.tick(s, 0.5);
  }
  if (tamper) tamper(s);
  return E.serialize(s);
}

test("room codes are six digits and configs are clamped", () => {
  for (let i = 0; i < 200; i++) assert.match(genCode(), CODE_RE);
  assert.deepEqual(sanitizeConfig({ days: 999, difficulty: "x", capital: 1 }), { days: 60, difficulty: "normal", capital: 300, seed: 0, location: "default" });
  assert.equal(sanitizeConfig({ location: "id-medan-central" }).location, "id-medan-central");
  assert.equal(sanitizeConfig({ location: "<script>" }).location, "default");
});

test("create, join, ready, start: everyone gets the same settings", async () => {
  const bus = createMemoryBus(), a = mk(bus), b = mk(bus);
  const r = await a.mp.create("Alice"); assert.ok(r.ok); assert.match(r.code, CODE_RE);
  assert.equal(a.mp.view().isHost, true);
  assert.ok((await b.mp.join(r.code, "Bob")).ok);
  await tick();
  assert.equal(a.mp.view().players.length, 2);
  assert.equal(a.mp.setConfig({ days: 7, difficulty: "hard", capital: 800 }).ok, true);
  await tick();
  assert.equal(b.mp.view().config.days, 7);
  assert.equal(b.mp.setConfig({ days: 30 }).error !== undefined, true, "non-host cannot change settings");
  assert.match(a.mp.start().error, /get ready/);
  b.mp.setReady(true); await tick();
  assert.ok(a.mp.start().ok); await tick();
  assert.equal(a.log.starts.length, 1); assert.equal(b.log.starts.length, 1);
  assert.deepEqual(a.log.starts[0], b.log.starts[0]);
  assert.equal(b.log.starts[0].days, 7);
});

test("unknown room, bad code and join rate limit", async () => {
  const bus = createMemoryBus(), a = mk(bus);
  assert.match((await a.mp.join("12ab", "X")).error, /6 digits/);
  assert.match((await a.mp.join("123456", "X")).error, /not found/i);
  for (let i = 0; i < 6; i++) await a.mp.join("654321", "X");
  assert.match((await a.mp.join("654321", "X")).error, /Too many/);
});

test("late joiners are rejected after start, but a known player can rejoin and resume", async () => {
  const bus = createMemoryBus(), store = mem();
  const a = mk(bus), b = mk(bus, { storage: store }), c = mk(bus);
  const { code } = await a.mp.create("A"); await b.mp.join(code, "B"); b.mp.setReady(true); await tick();
  a.mp.start(); await tick();
  assert.match((await c.mp.join(code, "Late")).error, /already started/);
  // B's page reloads: a fresh instance with the same stored player id and session
  const b2 = mk(bus, { storage: store });
  assert.equal(b2.mp.savedSession().code, code);
  assert.ok((await b2.mp.rejoin()).ok);
  assert.equal(b2.log.resumes.length, 1);
  assert.equal(b2.mp.view().phase, "playing");
});

test("host verifies final saves, rejects tampered ones, and ranks results", async () => {
  const bus = createMemoryBus(), a = mk(bus), b = mk(bus);
  const { code } = await a.mp.create("A"); await b.mp.join(code, "B");
  a.mp.setConfig({ days: 5, difficulty: "normal", capital: 1000 }); b.mp.setReady(true); await tick();
  a.mp.start(); await tick();
  const cfg = a.log.starts[0];
  const good = playMatch(cfg);
  const cheat = playMatch(cfg, s => { s.ledger.bal.cash += 99999; });          // unbalanced books
  a.mp.submitFinal(good); b.mp.submitFinal(cheat); await tick(40);
  const va = a.mp.view(), vb = b.mp.view();
  assert.equal(va.phase, "finished"); assert.equal(vb.phase, "finished");
  assert.equal(va.results.length, 2);
  assert.equal(va.results[0].name, "A"); assert.equal(va.results[0].rank, 1); assert.equal(va.results[0].finished, true);
  assert.equal(va.results[1].finished, false); assert.match(va.results[1].note, /Rejected/);
  assert.deepEqual(a.log.results[0], b.log.results[0]);
});

test("a save for different settings is rejected", async () => {
  const bus = createMemoryBus(), a = mk(bus), b = mk(bus);
  const { code } = await a.mp.create("A"); await b.mp.join(code, "B");
  a.mp.setConfig({ days: 5 }); b.mp.setReady(true); await tick(); a.mp.start(); await tick();
  const wrong = playMatch({ ...a.log.starts[0], capital: 5000 });
  b.mp.submitFinal(wrong); await tick(30);
  assert.match(a.mp.view().players.find(p => p.name === "B").verdict.reason, /settings/);
});

test("progress pings update the scoreboard and host leaving promotes someone else", async () => {
  const bus = createMemoryBus(), a = mk(bus), b = mk(bus);
  const { code } = await a.mp.create("A"); await b.mp.join(code, "B"); b.mp.setReady(true); await tick(); a.mp.start(); await tick();
  const s = E.newGame({ mode: "standard", difficulty: "normal", dayLimit: 5, seed: 1 }); s.day = 3;
  b.mp.reportProgress(s); await tick();
  const row = a.mp.view().players.find(p => p.name === "B"); assert.equal(row.day, 3); assert.ok(row.netWorth > 0);
  a.mp.leave(); await tick(40);
  assert.equal(b.mp.view().isHost, true);
});
