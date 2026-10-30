// Multiplayer regression tests for the bugfixes-1 review (forged messages, malformed saves, lost final saves, bankruptcy).
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import { post } from "../js/ledger.js";
import { createMultiplayer, escHtml } from "../js/multiplayer.js";
import { createMemoryBus, createMemoryNet } from "../js/net.js";

const tick = (ms = 15) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await tick(10); } return false; };
const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
function mk(bus, extra = {}) {
  const log = { starts: [], results: [] };
  const mp = createMultiplayer({ net: createMemoryNet(bus), storage: mem(), settleMs: 20, helloMs: 400, hostMs: 20, retryMs: 40, onStart: c => log.starts.push(c), onResults: r => log.results.push(r), ...extra });
  return { mp, log };
}
// a net that silently drops the first `st.drop` "final" messages it sends
const lossy = (inner, st) => ({ kind: inner.kind, join(code, id, meta, h) { const ch = inner.join(code, id, meta, h); return { ...ch, send: p => { if (p && p.t === "final" && st.drop > 0) { st.drop--; return; } ch.send(p); } }; } });
// deliver a raw message to everyone in a room, as if a stranger on the public channel had sent it
const forge = (bus, code, payload) => { for (const p of [...bus.rooms.get(code).values()]) p.h.onMessage(JSON.parse(JSON.stringify(payload))); };

function playMatch(config, tamper) {
  const s = E.newGame({ mode: "standard", difficulty: config.difficulty, capital: config.capital, dayLimit: config.days, seed: config.seed, record: true });
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
// a shop that is ruined on purpose: a big overdraft and no trading
function bankruptSave(config) {
  const s = E.newGame({ mode: "standard", difficulty: config.difficulty, capital: config.capital, dayLimit: config.days, seed: config.seed, record: true });
  // ruin the shop with legal commands only (replay must be able to reproduce it): spend everything on upgrades and a full payroll, then trade nothing
  for (let i = 0; i < 20; i++) for (const u of D.UPGRADES) E.buyUpgrade(s, u.id, "u" + i + u.id);
  for (const c of [...s.candidates]) E.hire(s, c.id);
  let n = 0;
  while (!s.ended && n++ < 100000) { if (s.phase === "report") { E.nextDay(s); continue; } E.tick(s, 0.5); }
  return { raw: E.serialize(s), reason: s.ended && s.ended.reason, day: s.day };
}
async function startMatch(extraA = {}, extraB = {}, days = 5) {
  const bus = createMemoryBus(), a = mk(bus, extraA), b = mk(bus, extraB);
  const r = await a.mp.create("Alice"); await b.mp.join(r.code, "Bob");
  a.mp.setConfig({ days, difficulty: "normal", capital: 1000 }); b.mp.setReady(true); await tick();
  a.mp.start(); await tick();
  return { bus, a, b, code: r.code };
}

// ---------- 2. forged network messages ----------
const BAD = /[<>]/;
const everyString = (v, fn) => { if (typeof v === "string") fn(v); else if (v && typeof v === "object") for (const x of Object.values(v)) everyString(x, fn); };

test("2: a forged 'end' message is rebuilt field by field (types, ranges, markup, size)", async () => {
  const { bus, a, b, code } = await startMatch();
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: "p" + i, name: "<img src=x onerror=alert(1)>" + i, rank: "<b>1</b>", score: "<script>", rating: "<svg onload=1>", netWorth: { a: 1 }, note: "<script>alert(1)</script>".repeat(40), finished: "yes", day: {} }));
  rows.push({ id: "__proto__", name: "x", rank: 1, score: 1, rating: "S" });
  forge(bus, code, { t: "end", from: a.mp.view().hostId, mid: "m1", results: rows });
  await tick();
  const got = b.log.results[b.log.results.length - 1];
  assert.ok(got, "results were delivered");
  assert.ok(got.length <= 20, "roster capped at 20");
  for (const r of got) {
    assert.ok(["S", "A", "B", "C", "D", "-"].includes(r.rating), "rating " + r.rating);
    for (const k of ["score", "rank", "day"]) assert.ok(Number.isInteger(r[k]), k + " is an integer");
    assert.ok(r.score >= 0 && r.score <= 100 && r.rank >= 1 && r.rank <= 20);
    assert.equal(typeof r.name, "string"); assert.equal(typeof r.note, "string"); assert.ok(r.note.length <= 80);
    assert.equal(typeof r.finished, "boolean"); assert.ok(Number.isFinite(r.netWorth));
    everyString(r, s => assert.doesNotMatch(s, BAD));
  }
  assert.equal(({}).score, undefined, "no prototype pollution");
});

test("2: a forged 'verdict' cannot inject markup or touch a player who is not in the match", async () => {
  const { bus, a, b, code } = await startMatch();
  const hostId = a.mp.view().hostId, bobId = b.mp.view().me.id;
  forge(bus, code, { t: "verdict", from: hostId, mid: "v1", id: bobId, ok: true, score: "<b>99</b>", rating: "<img src=x onerror=1>", netWorth: "<i>", reason: "<script>" });
  forge(bus, code, { t: "verdict", from: hostId, mid: "v2", id: "__proto__", ok: true, score: 5, rating: "S", netWorth: 1 });
  forge(bus, code, { t: "verdict", from: hostId, mid: "v3", id: "stranger", ok: true, score: 5, rating: "S", netWorth: 1 });
  await tick();
  const p = b.mp.view().players.find(x => x.id === bobId);
  assert.ok(["S", "A", "B", "C", "D", "-"].includes(p.verdict.rating), "rating is whitelisted");
  assert.ok(Number.isInteger(p.verdict.score) && p.verdict.score >= 0 && p.verdict.score <= 100);
  everyString(p.verdict, s => assert.doesNotMatch(s, BAD));
  assert.equal(b.mp.view().players.some(x => x.id === "stranger"), false, "verdict for a non-member is ignored");
  assert.equal(({}).verdict, undefined);
});

test("2: forged 'state' rosters keep names only, capped at 20, with clean names", async () => {
  const { bus, a, b, code } = await startMatch();
  const roster = { "__proto__": { name: "x" }, constructor: { name: "y" } };
  for (let i = 0; i < 40; i++) roster["id" + i] = i % 2 ? { name: "<b>n" + i + "</b>", extra: "<script>" } : "oops";
  forge(bus, code, { t: "state", from: a.mp.view().hostId, mid: "s1", phase: "playing", config: a.mp.view().config, roster });
  await tick();
  const players = b.mp.view().players;
  assert.ok(players.length <= 22, `players ${players.length}`);   // 20 roster entries + the two real, connected players
  for (const p of players) everyString(p.name, s => assert.doesNotMatch(s, BAD));
  assert.equal(({}).name, undefined);
});

test("2: forged presence meta (object name, text joinedAt) cannot break the player list or take the host seat", async () => {
  const bus = createMemoryBus(), a = mk(bus);
  const r = await a.mp.create("Alice");
  const evil = createMemoryNet(bus).join(r.code, "000-evil", { name: { toString: () => "<b>x</b>" }, joinedAt: "abc", ready: "yes" }, { onPresence() {}, onMessage() {}, onStatus() {} });
  await tick(30);
  const v = a.mp.view();
  assert.equal(v.isHost, true, "the real host keeps the seat");
  const e = v.players.find(p => p.id === "000-evil");
  assert.ok(e); assert.equal(typeof e.name, "string"); assert.doesNotMatch(e.name, BAD); assert.equal(typeof e.ready, "boolean");
  evil.leave();
});

test("2: escHtml escapes markup, quotes and non-strings", () => {
  assert.equal(escHtml('<img src=x onerror="a">'), "&lt;img src=x onerror=&quot;a&quot;&gt;");
  assert.equal(escHtml("it's & ok"), "it&#39;s &amp; ok");
  assert.equal(escHtml(42), "42"); assert.equal(escHtml(null), ""); assert.equal(escHtml({}), "[object Object]");
});

// ---------- 3. a malformed save cannot stall the match ----------
for (const [name, tamper] of [["stats removed", s => { delete s.stats; }], ["history removed", s => { delete s.history; }], ["archive removed", s => { delete s.archive; }], ["a negative wage", s => { s.staff.push({ id: 1, name: "x", role: "cashier", skill: 3, wage: -9 }); }]]) {
  test(`3: a final save with ${name} gets a rejection verdict and the match still ends`, async () => {
    const { a, b } = await startMatch();
    const cfg = a.mp.view().config;
    a.mp.submitFinal(playMatch(cfg));
    b.mp.submitFinal(playMatch(cfg, tamper));
    assert.ok(await until(() => a.log.results.length > 0), "match ended on the host");
    const rows = a.log.results[0], bob = rows.find(r => r.name === "Bob");
    assert.equal(bob.finished, false); assert.match(bob.note, /^Rejected/);
    assert.equal(rows.find(r => r.name === "Alice").finished, true);
  });
}
test("3: garbage instead of a save is rejected without throwing", async () => {
  const { a, b } = await startMatch();
  a.mp.submitFinal(playMatch(a.mp.view().config));
  assert.doesNotThrow(() => b.mp.submitFinal("{{{ not json"));
  assert.ok(await until(() => a.log.results.length > 0));
});

// ---------- 8. lost final saves and bankruptcy ----------
test("8: retry delivers a dropped final and the match ends", async () => {
  const bus = createMemoryBus(), st = { drop: 3 };
  const a = mk(bus), b = mk(bus, { net: lossy(createMemoryNet(bus), st) });
  const r = await a.mp.create("Alice"); await b.mp.join(r.code, "Bob");
  a.mp.setConfig({ days: 5, difficulty: "normal", capital: 1000 }); b.mp.setReady(true); await tick(); a.mp.start(); await tick();
  const cfg = a.mp.view().config;
  a.mp.submitFinal(playMatch(cfg));
  b.mp.submitFinal(playMatch(cfg));
  assert.ok(await until(() => a.log.results.length > 0 && b.log.results.length > 0), "both sides got results after retries");
  assert.equal(st.drop, 0, "the first sends really were dropped");
  assert.equal(a.log.results[0].filter(x => x.finished).length, 2);
});
test("8: a player who finishes while the channel is not ready still gets verified later", async () => {
  const bus = createMemoryBus(), a = mk(bus), b = mk(bus);
  const r = await a.mp.create("Alice"); await b.mp.join(r.code, "Bob");
  a.mp.setConfig({ days: 5, difficulty: "normal", capital: 1000 }); b.mp.setReady(true); await tick(); a.mp.start(); await tick();
  const cfg = a.mp.view().config;
  a.mp.submitFinal(playMatch(cfg));
  const save = playMatch(cfg);
  b.mp.submitFinal(save); b.mp.submitFinal(save);                  // double submit is harmless
  assert.ok(await until(() => a.log.results.length > 0));
});
test("8: when the host leaves, the new host verifies its own pending final and closes the match after the grace period", async () => {
  let t = 1000; const clock = () => (t += 1);
  const bus = createMemoryBus(), a = mk(bus, { now: clock }), b = mk(bus, { now: clock });
  const r = await a.mp.create("Alice"); await b.mp.join(r.code, "Bob");
  a.mp.setConfig({ days: 5, difficulty: "normal", capital: 1000 }); b.mp.setReady(true); await tick(); a.mp.start(); await tick();
  const cfg = a.mp.view().config;
  a.mp.leave(); await tick(40);                                    // the host disappears
  assert.equal(b.mp.view().isHost, true, "Bob is host now");
  b.mp.submitFinal(playMatch(cfg));
  await tick(40); t += 120000; await tick(80);                      // Alice is gone for longer than the grace period
  assert.ok(await until(() => b.log.results.length > 0), "match closed");
  assert.equal(b.log.results[0].find(x => x.name === "Bob").finished, true);
});
test("8: a new host asks players without a verdict to send their save again", async () => {
  const bus = createMemoryBus(), st = { drop: 1 };
  const a = mk(bus), b = mk(bus), c = mk(bus, { net: lossy(createMemoryNet(bus), st), retryMs: 1e7 });   // C will not retry by timer
  const r = await a.mp.create("Alice"); await b.mp.join(r.code, "Bob"); await c.mp.join(r.code, "Cy");
  a.mp.setConfig({ days: 5, difficulty: "normal", capital: 1000 }); b.mp.setReady(true); c.mp.setReady(true); await tick(); a.mp.start(); await tick();
  const cfg = a.mp.view().config;
  c.mp.submitFinal(playMatch(cfg));                                // dropped: the host never sees it
  await tick(30);
  a.mp.leave(); await tick(60);                                    // Bob becomes host and must ask for it again
  assert.equal(b.mp.view().isHost, true);
  assert.ok(await until(() => { const p = b.mp.view().players.find(x => x.name === "Cy"); return p && p.verdict && p.verdict.ok; }), "Cy's save arrived after the request");
});

test("8: a bankrupt player gets a finished result with score 0 and a Bankrupt note", async () => {
  const { a, b } = await startMatch({}, {}, 14);
  const cfg = a.mp.view().config;
  const br = bankruptSave(cfg);
  assert.equal(br.reason, "bankrupt", "test setup: the shop went bankrupt");
  a.mp.submitFinal(playMatch(cfg));
  b.mp.submitFinal(br.raw);
  assert.ok(await until(() => a.log.results.length > 0));
  const bob = a.log.results[0].find(x => x.name === "Bob");
  assert.equal(bob.finished, true); assert.equal(bob.score, 0); assert.match(bob.note, /Bankrupt/);
  assert.doesNotMatch(bob.note, /Rejected|not a finished/);
  assert.equal(a.log.results[0][0].name, "Alice", "the player who finished ranks above the bankrupt one");
});
test("8: a bankruptcy save with the wrong settings is still rejected", async () => {
  const { a, b } = await startMatch({}, {}, 14);
  const cfg = a.mp.view().config;
  a.mp.submitFinal(playMatch(cfg));
  b.mp.submitFinal(bankruptSave({ ...cfg, capital: cfg.capital + 100 }).raw);
  assert.ok(await until(() => a.log.results.length > 0));
  assert.match(a.log.results[0].find(x => x.name === "Bob").note, /Rejected/);
});
