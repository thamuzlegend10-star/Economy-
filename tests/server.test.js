// The server function, tested in Node with a fake database (PostgREST-style) behind an injected fetch.
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import { gameOpts } from "../js/replay.js";
import { handle } from "../server/verify-match.js";

const env = { url: "http://db.test", key: "service-key-for-tests" };
function fakeDb() {
  const t = { match_rooms: [], match_results: [] }, calls = [];
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url), table = u.pathname.split("/").pop(), method = init.method || "GET";
    calls.push({ table, method, auth: init.headers.Authorization });
    const json = (status, data) => new Response(data == null ? "" : JSON.stringify(data), { status });
    if (method === "POST") {
      const row = JSON.parse(init.body), key = table === "match_rooms" ? ["code"] : ["code", "player_id"];
      const dup = t[table].some(r => key.every(k => r[k] === row[k]));
      if (dup) return json(201, (init.headers.Prefer || "").includes("representation") ? [] : null);
      t[table].push(row); return json(201, (init.headers.Prefer || "").includes("representation") ? [row] : null);
    }
    const filters = [...u.searchParams].filter(([k]) => k !== "select");
    const rows = t[table].filter(r => filters.every(([k, v]) => String(r[k]) === v.replace(/^eq\./, "")));
    return json(200, rows);
  };
  return { t, calls, fetchFn };
}
const post = (body) => new Request("http://x/verify-match", { method: "POST", body: JSON.stringify(body) });
const cfg = { days: 6, difficulty: "normal", capital: 1000, seed: 555, location: "default", scenario: "" };
function playSave(config = cfg, tamper) {
  const s = E.newGame({ ...gameOpts(config), record: true });
  while (!s.ended) {
    if (s.phase === "report") { E.nextDay(s); continue; }
    if (s.clock === 0) { const lines = D.PRODUCTS.filter(p => E.isUnlocked(s, p.id) && E.unitsTotal(s, p.id) < 14).slice(0, 4).map(p => ({ pid: p.id, qty: 15 })); if (lines.length) E.placeOrder(s, { supplier: "metro", lines, pay: "bank", cmdId: "o" + s.steps }); }
    E.tick(s, 0.5);
  }
  if (tamper) tamper(s);
  return E.serialize(s);
}
const j = async r => ({ status: r.status, ...(await r.json()) });

test("register, submit, and the result is stored with the service key only", async () => {
  const db = fakeDb();
  const reg = await j(await handle(post({ action: "register", code: "123456", config: cfg, hostSecret: "s".repeat(24) }), env, db.fetchFn));
  assert.equal(reg.ok, true); assert.equal(db.t.match_rooms[0].config.days, 6); assert.notEqual(db.t.match_rooms[0].host_hash, "s".repeat(24));
  const sub = await j(await handle(post({ action: "submit", code: "123456", playerId: "p1", name: "Ann<b>", save: playSave() }), env, db.fetchFn));
  assert.equal(sub.ok, true, JSON.stringify(sub)); assert.ok(sub.score >= 0);
  const row = db.t.match_results[0]; assert.equal(row.player_id, "p1"); assert.equal(row.name, "Annb"); assert.equal(row.score, sub.score);
  assert.ok(db.calls.every(c => c.auth === "Bearer service-key-for-tests"));
});
test("a second register with other settings or another secret is refused; the same one is idempotent", async () => {
  const db = fakeDb(), s = "k".repeat(20);
  await handle(post({ action: "register", code: "111111", config: cfg, hostSecret: s }), env, db.fetchFn);
  assert.equal((await j(await handle(post({ action: "register", code: "111111", config: cfg, hostSecret: s }), env, db.fetchFn))).ok, true);
  assert.equal((await j(await handle(post({ action: "register", code: "111111", config: { ...cfg, capital: 9000 }, hostSecret: s }), env, db.fetchFn))).status, 409);
  assert.equal((await j(await handle(post({ action: "register", code: "111111", config: cfg, hostSecret: "z".repeat(20) }), env, db.fetchFn))).status, 409);
  assert.equal((await j(await handle(post({ action: "register", code: "111111", config: cfg, hostSecret: "short" }), env, db.fetchFn))).status, 400);
});
test("tampered saves are rejected and nothing is stored", async () => {
  const db = fakeDb();
  await handle(post({ action: "register", code: "222222", config: cfg, hostSecret: "s".repeat(24) }), env, db.fetchFn);
  const bad = playSave(cfg, s => { s.ledger.bal.bank += 900; s.ledger.bal.capital -= 900; });
  const r = await j(await handle(post({ action: "submit", code: "222222", playerId: "p2", name: "Eve", save: bad }), env, db.fetchFn));
  assert.equal(r.ok, false); assert.equal(r.rejected, true); assert.equal(db.t.match_results.length, 0);
  const other = playSave({ ...cfg, capital: 3000 });          // a real game, but not under this room's settings
  assert.equal((await j(await handle(post({ action: "submit", code: "222222", playerId: "p3", name: "Eve", save: other }), env, db.fetchFn))).rejected, true);
});
test("the first valid result wins, repeats are ignored, unknown rooms and bad input fail safely", async () => {
  const db = fakeDb(), save = playSave();
  await handle(post({ action: "register", code: "333333", config: cfg, hostSecret: "s".repeat(24) }), env, db.fetchFn);
  await handle(post({ action: "submit", code: "333333", playerId: "p1", name: "A", save }), env, db.fetchFn);
  assert.equal((await j(await handle(post({ action: "submit", code: "333333", playerId: "p1", name: "B", save }), env, db.fetchFn))).already, true);
  assert.equal(db.t.match_results.length, 1); assert.equal(db.t.match_results[0].name, "A");
  assert.equal((await j(await handle(post({ action: "submit", code: "444444", playerId: "p1", name: "A", save }), env, db.fetchFn))).status, 404);
  for (const b of [{ action: "submit", code: "abc", playerId: "p", save }, { action: "submit", code: "333333", playerId: "bad id!", save }, { action: "submit", code: "333333", playerId: "p9" }, { action: "nope", code: "333333" }])
    assert.equal((await j(await handle(post(b), env, db.fetchFn))).ok, false);
  assert.equal((await handle(new Request("http://x", { method: "GET" }), env, db.fetchFn)).status, 405);
  assert.equal((await handle(new Request("http://x", { method: "OPTIONS" }), env, db.fetchFn)).status, 204);
  assert.equal((await handle(new Request("http://x", { method: "POST", body: "{" }), env, db.fetchFn)).status, 400);
  assert.equal((await handle(post({ action: "submit", code: "333333", playerId: "p1", save }), {}, db.fetchFn)).status, 500);
});
test("a room cannot collect more than 20 results", async () => {
  const db = fakeDb(), save = playSave();
  await handle(post({ action: "register", code: "555555", config: cfg, hostSecret: "s".repeat(24) }), env, db.fetchFn);
  for (let i = 0; i < 20; i++) db.t.match_results.push({ code: "555555", player_id: "x" + i });
  assert.equal((await j(await handle(post({ action: "submit", code: "555555", playerId: "new", name: "N", save }), env, db.fetchFn))).status, 429);
});
test("oversized bodies are refused", async () => {
  const db = fakeDb();
  assert.equal((await handle(new Request("http://x", { method: "POST", body: "a".repeat(1.7e6) }), env, db.fetchFn)).status, 413);
});
