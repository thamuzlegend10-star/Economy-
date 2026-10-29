// Multiplayer rooms: six-digit codes, lobby, shared start settings, live scoreboard, host-verified results.
//
// Model: "competing shops". Every player runs their own shop with the SAME start settings and seed, for the
// same number of days. Players play at their own pace. When a player finishes, they send their final save to
// the host. The host checks it (valid format, balanced books, matching settings) and computes the official score.
//
// Trust: the transport is a public Realtime channel and clients run their own rules, so this is "host-checked",
// not fully server-authoritative. A determined cheater could still craft a self-consistent save. Real
// server-authoritative play needs a backend that runs the rules (see README, "Multiplayer limits").
import * as E from "./engine.js";
import { hasLocation } from "./locations.js";
import { getScenario, SHOCK_KINDS } from "./scenarios.js";

export const CODE_RE = /^\d{6}$/;
const JOIN_LIMIT = 5, JOIN_WINDOW_MS = 60000, GRACE_MS = 90000;

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

const rid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
export function genCode() {
  const a = new Uint32Array(1);
  (globalThis.crypto || { getRandomValues: x => { x[0] = Math.floor(Math.random() * 2 ** 32); } }).getRandomValues(a);
  return String(100000 + (a[0] % 900000));
}
export const escHtml = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Everything that arrives from the network is untrusted: it is rebuilt field by field before it is stored or shown.
const RATINGS = new Set(["S", "A", "B", "C", "D", "-"]);
const cleanRating = v => (typeof v === "string" && RATINGS.has(v) ? v : "-");
const cleanText = (v, n = 80) => (typeof v === "string" ? v.replace(/[<>]/g, "").slice(0, n) : "");
const cleanNum = v => (typeof v === "number" && Number.isFinite(v) ? Math.max(-1e9, Math.min(1e9, Math.round(v * 100) / 100)) : 0);
const cleanInt = (v, a, b) => { const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : a; return Math.max(a, Math.min(b, n)); };
const ID_RE = /^[\w-]{1,64}$/;
const isId = v => typeof v === "string" && ID_RE.test(v) && v !== "__proto__";
const own = (o, k) => !!o && typeof k === "string" && Object.hasOwn(o, k);
const cleanName = n => String(typeof n === "string" ? n : "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 16) || "Player";

const cleanRoster = r => {
  const out = Object.create(null);
  if (!r || typeof r !== "object") return out;
  for (const [id, v] of Object.entries(r)) {
    if (Object.keys(out).length >= 20) break;
    if (isId(id) && v && typeof v === "object") out[id] = { name: cleanName(v.name) };
  }
  return out;
};
const cleanResults = a => (Array.isArray(a) ? a.slice(0, 20) : []).filter(r => r && typeof r === "object").map((r, i) => ({
  id: isId(r.id) ? r.id : "", name: cleanName(r.name), finished: r.finished === true, score: cleanInt(r.score, 0, 100), rating: cleanRating(r.rating),
  netWorth: cleanNum(r.netWorth), day: cleanInt(r.day, 0, 120), note: cleanText(r.note, 80), rank: cleanInt(r.rank, 1, 20) || i + 1,
}));

export function createMultiplayer({ net, storage = null, settleMs = 1200, helloMs = 2500, hostMs = 2000, retryMs = 4000, now = () => Date.now(), onChange = () => {}, onStart = () => {}, onResume = () => {}, onResults = () => {}, onInject = () => {} }) {
  const store = {
    get: k => { try { return storage ? storage.getItem(k) : null; } catch { return null; } },
    set: (k, v) => { try { storage && storage.setItem(k, v); } catch { /* blocked */ } },
    del: k => { try { storage && storage.removeItem(k); } catch { /* blocked */ } },
  };
  const me = { id: store.get("economy-pid") || rid(), name: "Player" };
  store.set("economy-pid", me.id);

  let ch = null, code = null, status = "idle", error = "", joinedAt = 0, ready = false;
  let presence = {}, hostTimer = null, joinTimes = [];
  const seen = new Set();
  const room = { phase: "lobby", config: sanitizeConfig({}), roster: Object.create(null), progress: Object.create(null), results: null, leftAt: Object.create(null) };
  let pendingFinal = null, retryTimer = null, wasHost = false;

  // ----- helpers -----
  const meta = () => ({ name: me.name, ready, joinedAt });
  const present = () => Object.entries(presence).filter(([id, arr]) => isId(id) && Array.isArray(arr)).map(([id, arr]) => {
    const m = arr[arr.length - 1] || {};
    return { id, name: cleanName(m.name), ready: m.ready === true, joinedAt: typeof m.joinedAt === "number" && Number.isFinite(m.joinedAt) ? Math.max(0, Math.min(m.joinedAt, 4e15)) : Number.MAX_SAFE_INTEGER };
  });
  const hostId = () => { const p = present().sort((a, b) => (a.joinedAt - b.joinedAt) || (a.id < b.id ? -1 : 1)); return p.length ? p[0].id : null; };
  const isHost = () => hostId() === me.id;
  const emit = () => onChange(view());
  const send = (t, data = {}) => { if (ch) ch.send({ t, from: me.id, mid: rid(), ...data }); };

  function view() {
    const ids = new Set([...present().map(p => p.id), ...Object.keys(room.roster)]);
    const hid = hostId();
    const players = [...ids].map(id => {
      const p = present().find(x => x.id === id), pr = room.progress[id] || {};
      return { id, name: (p && p.name) || (room.roster[id] && room.roster[id].name) || "Player", ready: !!(p && p.ready), connected: !!p, isHost: id === hid, isMe: id === me.id,
        day: pr.day || 0, netWorth: pr.netWorth ?? null, revenue: pr.revenue ?? null, finished: !!pr.verdict, verdict: pr.verdict || null };
    }).sort((a, b) => (b.isHost - a.isHost) || a.name.localeCompare(b.name));
    return { status, error, code, me: { ...me }, isHost: hid === me.id, hostId: hid, phase: room.phase, config: { ...room.config }, players, results: room.results, transport: net.kind };
  }

  // ----- connection -----
  function rateLimited() {
    const t = now(); joinTimes = joinTimes.filter(x => t - x < JOIN_WINDOW_MS);
    if (joinTimes.length >= JOIN_LIMIT) return true;
    joinTimes.push(t); return false;
  }

  function open(c) {
    code = c; presence = {}; status = "connecting"; error = "";
    ch = net.join(c, me.id, meta(), {
      onPresence: p => { presence = (p && typeof p === "object") ? p : {}; trackGone(); const h = isHost(); if (h && room.phase === "lobby") broadcastState(); if (h && !wasHost && room.phase === "playing") send("resend"); wasHost = h; emit(); },
      onMessage: onMessage,
      onStatus: s => { if (s === "connected") { if (status !== "in-room") status = "connected"; } else if (s === "error") { status = "error"; error = "Connection problem. Check your network and retry."; } else if (s === "closed" && status === "in-room") { status = "closed"; error = "Disconnected from the room."; } emit(); },
    });
  }

  function close() {
    if (hostTimer) { clearInterval(hostTimer); hostTimer = null; }
    if (ch) { try { ch.leave(); } catch { /* already closed */ } }
    ch = null; code = null; presence = {}; ready = false; status = "idle";
    room.phase = "lobby"; room.roster = Object.create(null); room.progress = Object.create(null); room.results = null; room.leftAt = Object.create(null);
    pendingFinal = null; if (retryTimer) { clearInterval(retryTimer); retryTimer = null; } wasHost = false;
  }

  const wait = ms => new Promise(r => setTimeout(r, ms));

  async function create(name) {
    me.name = cleanName(name); joinedAt = now(); ready = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const c = genCode();
      open(c);
      await wait(settleMs);
      if (status === "error") { close(); return { error: "Could not reach the game network. Try again." }; }
      const others = present().filter(p => p.id !== me.id);
      if (others.length === 0) {
        status = "in-room"; room.config = sanitizeConfig({ ...room.config, seed: (Math.random() * 2 ** 31) | 0 });
        store.set("economy-session", JSON.stringify({ code: c, name: me.name }));
        startHostLoop(); emit(); return { ok: true, code: c };
      }
      close();                                   // code already in use: pick another
    }
    return { error: "Could not find a free room code. Try again." };
  }

  async function join(c, name) {
    c = String(c || "").trim();
    if (!CODE_RE.test(c)) return { error: "Room codes are 6 digits." };
    if (rateLimited()) return { error: "Too many attempts. Wait a minute and try again." };
    me.name = cleanName(name); joinedAt = now(); ready = false;
    open(c);
    await wait(settleMs);
    if (status === "error") { close(); return { error: "Could not reach the game network. Try again." }; }
    if (present().filter(p => p.id !== me.id).length === 0) { close(); return { error: "Room not found. Check the code." }; }
    send("hello");
    const t0 = now();
    while (now() - t0 < helloMs) {
      if (status === "in-room") break;
      if (error) break;
      await wait(25);
    }
    if (status !== "in-room") { const msg = error || "The host did not answer. Try again."; close(); return { error: msg }; }
    store.set("economy-session", JSON.stringify({ code: c, name: me.name }));
    startHostLoop(); emit(); return { ok: true, code: c };
  }

  function leave() { store.del("economy-session"); close(); emit(); }

  // ----- host state -----
  let lastSig = "";
  function broadcastState(force) {
    if (!isHost()) return;
    const roster = room.phase === "playing" ? room.roster : Object.fromEntries(present().map(p => [p.id, { name: p.name }]));
    const sig = JSON.stringify([room.phase, room.config, Object.keys(roster)]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    send("state", { phase: room.phase, config: room.config, roster });
  }

  function startHostLoop() {
    if (hostTimer) clearInterval(hostTimer);
    hostTimer = setInterval(() => { if (isHost() && room.phase === "playing") checkEnd(); }, hostMs);
    if (hostTimer && hostTimer.unref) hostTimer.unref();
  }

  function trackGone() {
    const ids = new Set(present().map(p => p.id)), t = now();
    for (const id of Object.keys(room.roster)) {
      if (ids.has(id)) delete room.leftAt[id]; else if (!room.leftAt[id]) room.leftAt[id] = t;
    }
  }

  // ----- messages -----
  function onMessage(m) {
    if (!m || typeof m !== "object" || typeof m.t !== "string" || typeof m.from !== "string" || m.from === me.id) return;
    if (m.mid) { if (seen.has(m.mid)) return; seen.add(m.mid); if (seen.size > 500) seen.delete(seen.values().next().value); }
    if (!isId(m.from)) return;
    const fromHost = m.from === hostId();
    switch (m.t) {
      case "hello":
        if (!isHost()) break;
        if (room.phase === "playing" && !own(room.roster, m.from)) { send("reject", { to: m.from, reason: "That match has already started." }); break; }
        if (room.phase === "finished") { send("reject", { to: m.from, reason: "That match is over." }); break; }
        broadcastState(true); break;
      case "reject":
        if (m.to === me.id && fromHost) { error = cleanText(m.reason, 120) || "Not allowed to join."; emit(); }
        break;
      case "state":
        if (!fromHost || isHost()) break;
        room.phase = m.phase === "playing" || m.phase === "finished" ? m.phase : "lobby";
        room.config = sanitizeConfig(m.config);
        if (m.roster && typeof m.roster === "object") room.roster = cleanRoster(m.roster);
        { const wasIn = status === "in-room"; status = "in-room";
          if (!wasIn && room.phase === "playing" && own(room.roster, me.id)) onResume(room.config); }   // mid-match reconnect
        emit(); break;
      case "start":
        if (!fromHost) break;
        room.phase = "playing"; room.config = sanitizeConfig(m.config); room.roster = cleanRoster(m.roster); room.progress = Object.create(null); room.results = null;
        onStart(room.config); emit(); break;
      case "progress":
        if (!own(room.roster, m.from)) break;
        room.progress[m.from] = { ...(room.progress[m.from] || {}), day: cleanInt(m.day, 0, 120), netWorth: num(m.netWorth), revenue: num(m.revenue) };
        emit(); break;
      case "final":
        if (isHost() && own(room.roster, m.from)) verify(m.from, m.save);
        break;
      case "resend":                                    // a new host asks everyone who has no verdict yet to send the final save again
        if (fromHost && pendingFinal && !myVerdict()) sendFinal();
        break;
      case "verdict": {
        if (!fromHost || !own(room.roster, m.id)) break;
        const v = m.ok === true ? { ok: true, score: cleanInt(m.score, 0, 100), rating: cleanRating(m.rating), netWorth: cleanNum(m.netWorth), bankrupt: m.bankrupt === true, goalsMet: cleanInt(m.goalsMet, 0, 10), goalsTotal: cleanInt(m.goalsTotal, 0, 10) } : { ok: false, reason: cleanText(m.reason, 80) || "Rejected" };
        room.progress[m.id] = { ...(room.progress[m.id] || {}), verdict: v, day: room.config.days, netWorth: v.ok ? v.netWorth : (room.progress[m.id] || {}).netWorth ?? null };
        if (m.id === me.id) stopRetry();
        emit(); break;
      }
      case "end":
        if (!fromHost) break;
        room.phase = "finished"; room.results = cleanResults(m.results); store.del("economy-session"); stopRetry();
        onResults(room.results); emit(); break;
      case "inject":                                    // facilitator (host) event: applied at the start of the next day; friendly play, not enforced
        if (!fromHost || room.phase !== "playing" || !SHOCK_KINDS.includes(m.kind)) break;
        onInject(m.kind); break;
      case "kick":
        if (fromHost && m.id === me.id) { leave(); error = "The host removed you from the room."; emit(); }
        break;
    }
  }
  const num = v => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

  // ----- final save delivery -----
  const myVerdict = () => !!(room.progress[me.id] && room.progress[me.id].verdict);
  function stopRetry() { if (retryTimer) { clearInterval(retryTimer); retryTimer = null; } pendingFinal = myVerdict() || room.phase === "finished" ? null : pendingFinal; }
  function sendFinal() {
    if (!ch || room.phase !== "playing" || !pendingFinal) return;
    if (isHost()) verify(me.id, pendingFinal); else send("final", { save: pendingFinal });
  }

  // ----- host: verify final saves, end the match -----
  function verifySave(raw, id) {
    try {
      if (typeof raw !== "string" || raw.length > 3e6) return { ok: false, reason: "Save missing or too large." };
      const v = E.validateSave(raw);
      if (!v.ok) return { ok: false, reason: cleanText(v.error, 80) };
      const s = v.state, c = room.config;
      if (s.mode !== "standard" || s.dayLimit !== c.days || s.difficulty !== c.difficulty || s.capital !== c.capital || s.loc !== c.location || (s.scenario || "") !== (c.scenario || "")) return { ok: false, reason: "Save does not match the room settings." };
      const bankrupt = !!s.ended && s.ended.reason === "bankrupt" && s.day <= c.days;
      if (!bankrupt && (!s.ended || s.day !== c.days)) return { ok: false, reason: "Save is not a finished match." };
      const rec = E.reconcile(s);
      if (!rec.ok) return { ok: false, reason: "Books do not reconcile: " + cleanText(rec.problems[0], 50) };
      const d = E.updateDerived(s), revenue = s.history.reduce((a, h) => a + h.revenue, 0) + s.archive.revenue;
      if (bankrupt) return { ok: true, score: 0, rating: "-", netWorth: d.netWorth, revenue, bankrupt: true };   // finished, but with nothing left to score
      const sc = E.score(s), goals = E.evaluateGoals(s);
      return { ok: true, score: sc.total, rating: sc.rating, netWorth: d.netWorth, revenue, goalsMet: goals.filter(x => x.ok).length, goalsTotal: goals.length };
    } catch { return { ok: false, reason: "Save could not be checked." }; }
  }
  function verify(id, raw) {
    if (!own(room.roster, id) || (room.progress[id] && room.progress[id].verdict && room.progress[id].verdict.ok)) return;
    const r = verifySave(raw, id);
    room.progress[id] = { ...(room.progress[id] || {}), day: room.config.days, netWorth: r.netWorth ?? null, verdict: r.ok ? { ok: true, score: r.score, rating: r.rating, netWorth: r.netWorth, bankrupt: !!r.bankrupt, goalsMet: r.goalsMet || 0, goalsTotal: r.goalsTotal || 0 } : { ok: false, reason: r.reason } };
    send("verdict", { id, ...r });
    if (id === me.id) stopRetry();
    emit(); checkEnd();
  }
  function checkEnd() {
    if (!isHost() || room.phase !== "playing") return;
    const t = now();
    for (const id of Object.keys(room.roster)) {
      const v = room.progress[id] && room.progress[id].verdict;
      if (v) continue;
      if (room.leftAt[id] && t - room.leftAt[id] > GRACE_MS) continue;
      return;                                    // someone still playing
    }
    endMatch();
  }
  function endMatch() {
    if (!isHost() || room.phase !== "playing") return { error: "Not playing." };
    const rows = Object.keys(room.roster).map(id => {
      const pr = room.progress[id] || {}, v = pr.verdict;
      return { id, name: room.roster[id].name || "Player", finished: !!(v && v.ok), score: v && v.ok ? v.score : 0, rating: v && v.ok ? v.rating : "-", netWorth: v && v.ok ? v.netWorth : (pr.netWorth ?? 0), day: pr.day || 0, note: v ? (v.ok ? (v.bankrupt ? "Bankrupt" : v.goalsTotal ? `Goals ${v.goalsMet}/${v.goalsTotal}` : "") : "Rejected: " + v.reason) : "Did not finish" };
    }).sort((a, b) => (b.finished - a.finished) || (b.score - a.score) || (b.netWorth - a.netWorth));
    rows.forEach((r, i) => { r.rank = i + 1; });
    rows.splice(20);                                                           // never more than 20 rows on the wire
    room.phase = "finished"; room.results = rows; store.del("economy-session");
    send("end", { results: rows }); onResults(rows); emit();
    return { ok: true };
  }

  // ----- public actions -----
  return {
    view, create, join, leave,
    setReady(v) { ready = !!v; if (ch) ch.track(meta()); emit(); },
    setName(n) { me.name = cleanName(n); if (ch) ch.track(meta()); emit(); },
    setConfig(partial) {
      if (!isHost() || room.phase !== "lobby") return { error: "Only the host can change settings before the match." };
      room.config = sanitizeConfig({ ...room.config, ...partial, seed: room.config.seed }); broadcastState(true); emit(); return { ok: true };
    },
    start() {
      if (!isHost()) return { error: "Only the host can start." };
      if (room.phase !== "lobby") return { error: "The match already started." };
      const ps = present();
      const notReady = ps.filter(p => p.id !== me.id && !p.ready);
      if (notReady.length) return { error: `Waiting for ${notReady.map(p => p.name).join(", ")} to get ready.` };
      room.config = sanitizeConfig({ ...room.config, seed: (Math.random() * 2 ** 31) | 0 });
      room.roster = Object.fromEntries(ps.map(p => [p.id, { name: p.name }]));
      room.phase = "playing"; room.progress = {}; room.results = null; room.leftAt = {};
      send("start", { config: room.config, roster: room.roster });
      lastSig = ""; onStart(room.config); emit(); return { ok: true };
    },
    endNow() { return endMatch(); },
    inject(kind) {
      if (!isHost()) return { error: "Only the host can send events." };
      if (room.phase !== "playing") return { error: "No match is running." };
      if (!SHOCK_KINDS.includes(kind)) return { error: "Unknown event." };
      send("inject", { kind }); onInject(kind); return { ok: true };
    },
    kick(id) { if (isHost() && id !== me.id) send("kick", { id }); },
    // Called by the game: cheap progress ping (day and net worth only).
    reportProgress(s) {
      if (!ch || room.phase !== "playing" || !s) return;
      const d = s.derived || E.updateDerived(s);
      const me_ = { day: s.day, netWorth: d.netWorth, revenue: s.history.reduce((a, h) => a + h.revenue, 0) };
      room.progress[me.id] = { ...(room.progress[me.id] || {}), ...me_ };
      send("progress", me_); emit();
    },
    // Remember the final save and keep sending it until the host's verdict for me arrives (or I leave).
    submitFinal(serialized) {
      if (typeof serialized !== "string") return;
      pendingFinal = serialized;
      sendFinal();
      if (!retryTimer) { retryTimer = setInterval(() => { if (!pendingFinal || myVerdict()) return stopRetry(); sendFinal(); }, retryMs); if (retryTimer.unref) retryTimer.unref(); }
    },
    savedSession() { try { return JSON.parse(store.get("economy-session")); } catch { return null; } },
    async rejoin() {
      const s = this.savedSession(); if (!s) return { error: "No room to rejoin." };
      return join(s.code, s.name);
    },
    isPlaying: () => room.phase === "playing" && !!ch,
  };
}
