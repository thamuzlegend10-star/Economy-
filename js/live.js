// Live play for friends (no game server). One person hosts a room with a 6-digit code. Everyone runs their own shop on the SAME seed, scenario,
// settings and start time, so the market is identical. The host is the facilitator: they start the game and announce events. Everyone reports
// their score at the end of each day and sees the live leaderboard. Transport is pluggable (Supabase Realtime in the browser, an in-memory bus in tests).
//
// Honest limits: each player's shop is simulated on their own device, so the leaderboard is trust-based. Scores use the DEFAULT weights so changing
// the scoring weights cannot inflate them, and every incoming message is validated, but a determined cheater could still edit their own game.
import * as E from "./engine.js";
import * as D from "./data.js";

export const COUNTDOWN_MS = 5000, MAX_PLAYERS = 8;
export const newCode = (rand = Math.random) => String(Math.floor(100000 + rand() * 900000));
export const validCode = c => /^\d{6}$/.test(String(c));
const cleanName = n => String(n || "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 20);
const num = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
export const newId = (rand = Math.random) => Math.floor(rand() * 2 ** 31).toString(36) + Math.floor(rand() * 2 ** 31).toString(36);

// Settings the host chooses. Validated by the same rules as a normal new game; the seed is fixed for everyone.
export function cleanSettings(o = {}) {
  const base = E.cleanSetup({ ...o, seed: Number.isFinite(o.seed) ? o.seed : Math.floor(Math.random() * 2147483648) });
  return { location: base.location, area: base.area, secPerDay: base.secPerDay, days: Math.min(base.days || 60, 60), capital: base.capital, seed: base.seed, scenario: D.SCENARIOS.some(x => x.id === o.scenario) ? o.scenario : "free", mods: base.mods, difficulty: base.difficulty };
}
export function cleanScore(c) {
  if (!c || typeof c !== "object") return null;
  const name = cleanName(c.name), id = String(c.id || "").slice(0, 24);
  if (!id || !num(c.day, 0, 1000) || !num(c.score, 0, 100) || !num(c.netWorth, -1e9, 1e10) || !num(c.netProfit, -1e9, 1e10) || !num(c.cash, -1e9, 1e10)) return null;
  return { id, name: name || "Player", day: Math.round(c.day), score: Math.round(c.score * 10) / 10, netWorth: Math.round(c.netWorth), netProfit: Math.round(c.netProfit), cash: Math.round(c.cash), ended: !!c.ended };
}
export function cleanEvent(e) {
  if (!e || typeof e !== "object" || !["demand", "cost", "delay", "rival"].includes(e.kind)) return null;
  const mult = Number(e.mult), days = Math.round(Number(e.days));
  if (e.kind !== "delay" && !num(mult, 0.5, 2)) return null; if (!num(days, 1, 30)) return null;
  return { kind: e.kind, mult: e.kind === "delay" ? 1 : mult, days, title: String(e.title || "").slice(0, 60) };
}

export function createLive(transport, { now = Date.now, rand = Math.random, onChange = () => {}, onStart = () => {}, onEvent = () => {} } = {}) {
  const st = { role: null, code: null, id: newId(rand), name: "", phase: "idle", players: {}, scores: {}, settings: null, startAt: 0, error: null };
  let link = null, kicked = false;
  const change = () => onChange(st);
  const hostId = () => Object.values(st.players).find(p => p.host)?.id || null;
  const send = msg => { if (link) link.send({ ...msg, from: st.id }); };

  function onPresence(list) {
    const prev = st.players; st.players = {}; for (const p of list) if (p && p.id) st.players[String(p.id).slice(0, 24)] = { id: String(p.id).slice(0, 24), name: cleanName(p.name) || "Player", host: !!p.host };
    if (st.role === "host" && st.phase === "running") for (const id of Object.keys(st.players)) if (!prev[id] && id !== st.id) send({ t: "closed", to: id });   // late arrivals are turned away
    if (st.role === "guest" && st.phase === "lobby" && Object.keys(st.players).length > 1 && !hostId()) { st.error = "The host left the room."; }
    change();
  }
  function onMessage(m) {
    if (!m || typeof m !== "object" || typeof m.t !== "string") return;
    const fromHost = m.from && m.from === hostId();
    if (m.t === "start" && st.role === "guest" && fromHost && st.phase === "lobby") {
      if (!num(m.startAt, 0, 4e15)) return; st.settings = cleanSettings(m.settings); st.startAt = m.startAt; st.phase = "running"; change(); onStart(st.settings, st.startAt);
    } else if (m.t === "event" && st.role === "guest" && fromHost && st.phase === "running") {
      const ev = cleanEvent(m.ev); if (ev) onEvent(ev);
    } else if (m.t === "closed" && st.role === "guest" && (fromHost || !hostId()) && m.to === st.id && st.phase === "lobby") {
      st.error = "That game has already started."; st.phase = "idle"; kicked = true; leave(); change();
    } else if (m.t === "score") {
      const c = cleanScore(m.card); if (c && c.id === m.from && (st.players[c.id] || st.scores[c.id])) { st.scores[c.id] = c; change(); }
    }
  }
  async function enter(role, code, name) {
    if (!validCode(code)) throw new Error("A room code is six digits.");
    kicked = false; st.phase = "lobby"; st.role = role; st.code = String(code); st.name = cleanName(name) || "Player"; st.error = null; st.players = {}; st.scores = {};
    try { link = await transport.join(st.code, { id: st.id, name: st.name, host: role === "host" }, { onMessage, onPresence }); }
    catch (e) { st.role = null; st.phase = "idle"; link = null; throw new Error("Could not connect to the room. Check your internet and try again."); }
    if (kicked) { leave(); return st; }
    change(); return st;
  }
  const leave = () => { if (link) { try { link.leave(); } catch { /* already gone */ } } link = null; };
  return {
    state: st,
    host: (name, code = newCode(rand)) => enter("host", code, name),
    join: (name, code) => enter("guest", code, name),
    // Host only: freeze the settings, pick the start time a few seconds ahead so every device starts together, and tell everyone.
    start(settings) {
      if (st.role !== "host" || st.phase !== "lobby") return { ok: false, error: "Only the host can start a room that is waiting." };
      if (Object.keys(st.players).length > MAX_PLAYERS) return { ok: false, error: `A room holds up to ${MAX_PLAYERS} players.` };
      st.settings = cleanSettings(settings); st.startAt = now() + COUNTDOWN_MS; st.phase = "running";
      send({ t: "start", settings: st.settings, startAt: st.startAt }); change(); onStart(st.settings, st.startAt); return { ok: true, startAt: st.startAt };
    },
    announce(ev) { const e = cleanEvent(ev); if (st.role !== "host" || st.phase !== "running" || !e) return { ok: false, error: "Only the host can announce events during a running game." }; send({ t: "event", ev: e }); return { ok: true }; },
    reportScore(card) { const c = cleanScore({ ...card, id: st.id, name: st.name }); if (!c || st.phase !== "running") return; st.scores[st.id] = c; send({ t: "score", card: c }); if (c.ended) st.phase = "done"; change(); },
    leaderboard() {
      // Players who have left keep their last reported score on the board.
      const ids = [...new Set([...Object.keys(st.players), ...Object.keys(st.scores)])];
      const rows = ids.map(id => { const p = st.players[id], c = st.scores[id] || { id, name: p.name, day: 0, score: 0, netWorth: 0, netProfit: 0, cash: 0, ended: false }; return { ...c, name: p ? p.name : c.name, host: !!(p && p.host), left: !p, me: id === st.id }; });
      return rows.sort((a, b) => b.score - a.score || b.netWorth - a.netWorth).map((r, i) => ({ ...r, place: i + 1 }));
    },
    leave() { leave(); st.phase = "idle"; st.role = null; st.players = {}; change(); },
    get connected() { return !!link; },
  };
}

// ---------- transports ----------
// In-memory room for tests: every client sees every other client's broadcasts, and presence is the list of joined clients.
export function memoryBus() {
  const rooms = {};
  return { transport() { return { async join(code, meta, h) {
    const room = rooms[code] = rooms[code] || { members: [] }, me = { meta, h }; room.members.push(me);
    const sync = () => { const list = room.members.map(m => m.meta); for (const m of room.members) m.h.onPresence(list); };
    sync();
    return { send: msg => { for (const m of room.members) if (m !== me) m.h.onMessage(JSON.parse(JSON.stringify(msg))); }, leave: () => { room.members = room.members.filter(m => m !== me); sync(); } };
  } }; } };
}
// Supabase Realtime: a broadcast channel per room (no tables, nothing is stored) plus presence for the player list.
export const SUPABASE = { url: "https://pjlfvkouunnerwhgnyes.supabase.co", key: "sb_publishable_3HqxB3BAvObV-T_ph4xFfA_0qPtIdAa", lib: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm" };
export function supabaseTransport(cfg = SUPABASE) {
  return { async join(code, meta, h) {
    const { createClient } = await import(cfg.lib), sb = createClient(cfg.url, cfg.key, { realtime: { params: { eventsPerSecond: 10 } } });
    const ch = sb.channel("economy-room-" + code, { config: { broadcast: { self: false }, presence: { key: meta.id } } });
    ch.on("broadcast", { event: "m" }, ({ payload }) => h.onMessage(payload));
    ch.on("presence", { event: "sync" }, () => h.onPresence(Object.values(ch.presenceState()).flat().map(p => ({ id: p.id, name: p.name, host: p.host }))));
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("timeout")), 10000);
      ch.subscribe(async status => { if (status === "SUBSCRIBED") { clearTimeout(t); await ch.track(meta); res(); } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) { clearTimeout(t); rej(new Error(status)); } });
    });
    return { send: msg => ch.send({ type: "broadcast", event: "m", payload: msg }), leave: () => { try { ch.untrack(); sb.removeChannel(ch); } catch { /* already closed */ } } };
  } };
}
