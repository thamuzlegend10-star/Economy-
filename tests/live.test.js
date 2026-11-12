import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../js/live.js";
import * as E from "../js/engine.js";
import * as Kp from "../js/kpi.js";

const mk = (bus, name, hooks = {}) => { let seed = [...name].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 2147483646 + 1; const rand = () => (seed = (seed * 16807 + 1) % 2147483647) / 2147483647; const g = { starts: [], events: [] };
  g.live = L.createLive(bus.transport(), { rand, now: () => 1000, onStart: (st, at) => g.starts.push([st, at]), onEvent: e => g.events.push(e), ...hooks }); g.name = name; return g; };
const card = (day, score, nw = 1000) => ({ day, score, netWorth: nw, netProfit: nw - 40000, cash: 5000 });

test("room codes are six digits and validated", () => { assert.match(L.newCode(), /^\d{6}$/); assert.ok(L.validCode("123456")); assert.ok(!L.validCode("12345")); assert.ok(!L.validCode("abcdef")); });

test("lobby: host and guests see each other", async () => {
  const bus = L.memoryBus(), h = mk(bus, "Host"), a = mk(bus, "Ann"), code = "111111";
  await h.live.host("Host", code); await a.live.join("Ann", code);
  assert.deepEqual(Object.values(h.live.state.players).map(p => p.name).sort(), ["Ann", "Host"]);
  assert.equal(Object.values(a.live.state.players).filter(p => p.host).length, 1);
  await assert.rejects(() => a.live.join("Ann", "12"), /six digits/);
});

test("start reaches every guest with the same settings and start time; only the host can start", async () => {
  const bus = L.memoryBus(), h = mk(bus, "Host"), a = mk(bus, "Ann"), b = mk(bus, "Bob"), code = "222222";
  await h.live.host("Host", code); await a.live.join("Ann", code); await b.live.join("Bob", code);
  assert.equal(a.live.start({}).ok, false);
  const r = h.live.start({ days: 20, secPerDay: 15, capital: 80000, scenario: "free", seed: 42 });
  assert.ok(r.ok); assert.equal(r.startAt, 1000 + L.COUNTDOWN_MS);
  for (const g of [h, a, b]) { assert.equal(g.starts.length, 1); assert.equal(g.starts[0][1], 6000); assert.equal(g.starts[0][0].seed, 42); assert.equal(g.starts[0][0].days, 20); }
  assert.equal(h.live.start({}).ok, false);   // cannot start twice
});

test("same settings give identical shops on every device", async () => {
  const s1 = E.newGame(L.cleanSettings({ seed: 9, days: 10 })), s2 = E.newGame(L.cleanSettings({ seed: 9, days: 10 }));
  for (let i = 0; i < 3000; i++) { E.tick(s1, 0.1); E.tick(s2, 0.1); }
  assert.equal(E.serialize(s1), E.serialize(s2));
});

test("events: host announces, guests receive; guests cannot announce; forged events are ignored", async () => {
  const bus = L.memoryBus(), h = mk(bus, "Host"), a = mk(bus, "Ann"), code = "333333";
  await h.live.host("Host", code); await a.live.join("Ann", code); h.live.start({ seed: 1 });
  assert.ok(h.live.announce({ kind: "demand", mult: 1.3, days: 5, title: "Heatwave" }).ok);
  assert.equal(a.events.length, 1); assert.equal(a.events[0].title, "Heatwave");
  assert.equal(a.live.announce({ kind: "demand", mult: 1.3, days: 5 }).ok, false);
  assert.equal(h.live.announce({ kind: "demand", mult: 9, days: 5 }).ok, false);
  assert.equal(h.live.announce({ kind: "nope", mult: 1, days: 5 }).ok, false);
  // a guest forging an event through the raw bus is ignored by other guests
  const c = mk(bus, "Cy"); await c.live.join("Cy", code);
});

test("a guest cannot forge start or events (host-only authority)", async () => {
  const bus = L.memoryBus(), h = mk(bus, "Host"), a = mk(bus, "Ann"), b = mk(bus, "Bob"), code = "444444", raw = [];
  await h.live.host("Host", code); await a.live.join("Ann", code);
  const t = bus.transport(), forger = await t.join(code, { id: "evil", name: "Evil", host: false }, { onMessage() {}, onPresence() {} });
  forger.send({ t: "start", from: "evil", settings: { days: 5 }, startAt: 5 }); forger.send({ t: "start", from: h.live.state.id.slice(1), settings: {}, startAt: 5 });
  assert.equal(a.starts.length, 0); assert.equal(a.live.state.phase, "lobby");
  h.live.start({ seed: 3 }); forger.send({ t: "event", from: "evil", ev: { kind: "demand", mult: 2, days: 30 } });
  assert.equal(a.events.length, 0);
});

test("late joiners are turned away", async () => {
  const bus = L.memoryBus(), h = mk(bus, "Host"), code = "555555"; await h.live.host("Host", code); h.live.start({ seed: 2 });
  const late = mk(bus, "Late"); await late.live.join("Late", code);
  assert.match(late.live.state.error || "", /already started/); assert.equal(late.live.state.phase, "idle");
});

test("leaderboard ranks by score, validates cards, ignores spoofed ids", async () => {
  const bus = L.memoryBus(), h = mk(bus, "Host"), a = mk(bus, "Ann"), b = mk(bus, "Bob"), code = "666666";
  await h.live.host("Host", code); await a.live.join("Ann", code); await b.live.join("Bob", code); h.live.start({ seed: 5 });
  h.live.reportScore(card(3, 40)); a.live.reportScore(card(3, 70)); b.live.reportScore(card(3, 55));
  const lb = h.live.leaderboard(); assert.deepEqual(lb.map(r => r.name), ["Ann", "Bob", "Host"]); assert.deepEqual(lb.map(r => r.place), [1, 2, 3]); assert.ok(lb.find(r => r.me).name === "Host");
  b.live.reportScore({ day: 4, score: 500, netWorth: 1, netProfit: 1, cash: 1 });   // out-of-range
  b.live.reportScore({ day: 4, score: NaN, netWorth: 1, netProfit: 1, cash: 1 });
  assert.equal(h.live.leaderboard().find(r => r.name === "Bob").score, 55);
  const t = bus.transport(), spoof = await t.join(code, { id: "zz", name: "Zed", host: false }, { onMessage() {}, onPresence() {} });
  spoof.send({ t: "score", from: "zz", card: { ...card(1, 99), id: a.live.state.id } }); // claims Ann's id
  assert.equal(h.live.leaderboard().find(r => r.name === "Ann").score, 70);
});

test("a player with no card yet still shows on the board; ending marks done", async () => {
  const bus = L.memoryBus(), h = mk(bus, "Host"), a = mk(bus, "Ann"), code = "777777";
  await h.live.host("Host", code); await a.live.join("Ann", code); h.live.start({ seed: 5 });
  assert.equal(h.live.leaderboard().length, 2); assert.equal(h.live.leaderboard().find(r => r.name === "Ann").day, 0);
  a.live.reportScore({ ...card(10, 60), ended: true }); assert.equal(a.live.state.phase, "done");
});

test("leaving removes the player from the room", async () => {
  const bus = L.memoryBus(), h = mk(bus, "Host"), a = mk(bus, "Ann"), code = "888888"; await h.live.host("Host", code); await a.live.join("Ann", code);
  a.live.leave(); assert.equal(Object.keys(h.live.state.players).length, 1); assert.equal(a.live.connected, false);
});

test("a failing transport gives a friendly error and leaves no half room", async () => {
  const bad = { join: async () => { throw new Error("offline"); } }, l = L.createLive(bad);
  await assert.rejects(() => l.join("Ann", "123456"), /Could not connect/); assert.equal(l.state.role, null); assert.equal(l.state.phase, "idle");
});

test("names and settings are cleaned", () => {
  assert.equal(L.cleanScore({ ...card(1, 5), id: "a", name: "<b>Hi</b>" }).name, "bHib");
  const s = L.cleanSettings({ days: 9999, secPerDay: -5, capital: 1, scenario: "bogus" }); assert.ok(s.days <= 60); assert.equal(s.scenario, "free"); assert.ok(Number.isFinite(s.seed));
});

test("default score ignores edited weights", () => {
  const s = E.newGame(E.cleanSetup({ seed: 3 })); for (let i = 0; i < 400; i++) E.tick(s, 0.1);
  const base = Kp.defaultScore(s); const w = Kp.ensureKpi(s).weights; for (const k of Object.keys(w)) w[k] = k === Object.keys(w)[0] ? 100 : 0;
  assert.equal(Kp.defaultScore(s), base); assert.ok(base >= 0 && base <= 100);
});

import * as SC from "../js/screens.js";
test("facilitator screen: live board, guest has no announce form", () => {
  const s = E.newGame(E.cleanSetup({ seed: 3 })), board = [{ place: 1, name: "Ann", day: 3, score: 61.2, netWorth: 41000, ended: false, me: true, host: false }, { place: 2, name: "Host", day: 3, score: 50, netWorth: 39000, ended: false, me: false, host: true }];
  const g = SC.facilitatorScreen(s, {}, [], { code: "123456", role: "guest", board }), h = SC.facilitatorScreen(s, {}, [], { code: "123456", role: "host", board }), solo = SC.facilitatorScreen(s, {}, []);
  assert.match(g, /Live room 123456/); assert.match(g, /Ann/); assert.ok(!g.includes('data-act="evGo"')); assert.ok(h.includes('data-act="evGo"')); assert.ok(solo.includes('data-act="evGo"') && !solo.includes("Live room"));
  assert.ok(!h.includes("data-resexport"));
});

test("a player who left keeps their last score on the board", async () => {
  const bus = L.memoryBus(), h = mk(bus, "Host"), a = mk(bus, "Ann"), code = "999999";
  await h.live.host("Host", code); await a.live.join("Ann", code); h.live.start({ seed: 5 }); a.live.reportScore({ ...card(9, 66), ended: true }); a.live.leave();
  const row = h.live.leaderboard().find(r => r.name === "Ann"); assert.equal(row.score, 66); assert.ok(row.left);
});

test("checkpoints: automatic stop every N days waits for the host; manual hold and go reach guests; guests and forgeries cannot", async () => {
  const bus = L.memoryBus(), h = mk(bus, "Host"), a = mk(bus, "Ann"), code = "444444";
  await h.live.host("Host", code); await a.live.join("Ann", code);
  assert.equal(h.live.hold().ok, false);   // not running yet
  h.live.start({ seed: 3, checkpoint: 10 });
  assert.equal(a.live.state.settings.checkpoint, 10); assert.equal(L.cleanSettings({ checkpoint: 7 }).checkpoint, 0);
  assert.equal(a.live.stopped(9), false); assert.equal(a.live.stopped(10), true); assert.equal(a.live.stopped(0), false);
  assert.equal(a.live.release(10).ok, false);   // a guest cannot release
  assert.equal(a.live.stopped(10), true);
  assert.ok(h.live.release(10).ok);
  assert.equal(a.live.stopped(10), false); assert.equal(a.live.stopped(20), true);
  assert.ok(h.live.release(30).ok);   // host ahead: guests skip checkpoints they have not reached yet
  assert.equal(a.live.stopped(20), false); assert.equal(a.live.stopped(30), false);
  assert.ok(h.live.hold("Review").ok); assert.equal(a.live.state.held, true); assert.equal(a.live.state.holdTitle, "Review"); assert.equal(a.live.stopped(3), true);
  assert.equal(a.live.hold().ok, false);
  assert.ok(h.live.release(3).ok); assert.equal(a.live.state.held, false); assert.equal(a.live.stopped(3), false);
});
