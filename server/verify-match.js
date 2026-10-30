// Server side of verified matches. Runs as a Supabase Edge Function (see deno-entry.js) but is plain JS with injected
// fetch and environment, so it is tested in Node. It never trusts the client: it replays the player's command log itself.
//   POST { action:"register", code, config, hostSecret }  -> the host fixes the room's settings (first write wins)
//   POST { action:"submit", code, playerId, name, save }   -> replay + store the official result (first valid result wins)
// Results are read by anyone through the table's read-only policy; only this function (service role) can write them.
import { sanitizeConfig } from "../js/matchconfig.js";
import { verifyFinalSave } from "../js/replay.js";

const CODE_RE = /^\d{6}$/, ID_RE = /^[\w-]{1,64}$/, MAX_BODY = 1.6e6, MAX_PER_ROOM = 20;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const cleanName = n => String(typeof n === "string" ? n : "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 16) || "Player";
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function handle(req, env, fetchFn = fetch) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply(405, { ok: false, error: "POST only." });
  let raw;
  try { raw = await req.text(); } catch { return reply(400, { ok: false, error: "Unreadable request." }); }
  if (raw.length > MAX_BODY) return reply(413, { ok: false, error: "Request too large." });
  let body;
  try { body = JSON.parse(raw); } catch { return reply(400, { ok: false, error: "Not JSON." }); }
  if (!body || typeof body !== "object" || !CODE_RE.test(String(body.code))) return reply(400, { ok: false, error: "Bad room code." });
  if (!env || !env.url || !env.key) return reply(500, { ok: false, error: "Server is not configured." });

  const rest = async (path, init = {}) => {
    const res = await fetchFn(`${env.url}/rest/v1/${path}`, { ...init, headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, "Content-Type": "application/json", ...(init.headers || {}) } });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* keep null */ }
    return { ok: res.ok, status: res.status, data };
  };
  const code = String(body.code);

  if (body.action === "register") {
    const secret = typeof body.hostSecret === "string" ? body.hostSecret : "";
    if (secret.length < 16 || secret.length > 128) return reply(400, { ok: false, error: "Bad host secret." });
    const c = body.config && typeof body.config === "object" ? body.config : {};
    const config = { ...sanitizeConfig(c), seed: Number.isInteger(c.seed) ? c.seed : 0 };
    const hash = await sha256(secret);
    const ins = await rest("match_rooms?on_conflict=code", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ code, config, host_hash: hash }) });
    if (!ins.ok) return reply(502, { ok: false, error: "Could not save the room." });
    if (Array.isArray(ins.data) && ins.data.length) return reply(200, { ok: true, registered: true });
    const cur = await rest(`match_rooms?code=eq.${code}&select=config,host_hash`);
    const row = cur.ok && Array.isArray(cur.data) ? cur.data[0] : null;
    if (row && row.host_hash === hash && JSON.stringify(row.config) === JSON.stringify(config)) return reply(200, { ok: true, registered: true });
    return reply(409, { ok: false, error: "That room is already registered." });
  }

  if (body.action === "submit") {
    const playerId = String(body.playerId || "");
    if (!ID_RE.test(playerId) || playerId === "__proto__") return reply(400, { ok: false, error: "Bad player id." });
    if (typeof body.save !== "string") return reply(400, { ok: false, error: "Missing save." });
    const room = await rest(`match_rooms?code=eq.${code}&select=config`);
    const config = room.ok && Array.isArray(room.data) && room.data[0] ? room.data[0].config : null;
    if (!config) return reply(404, { ok: false, error: "Unknown room: the host has not registered it." });
    const seen = await rest(`match_results?code=eq.${code}&select=player_id`);
    const rows = seen.ok && Array.isArray(seen.data) ? seen.data : [];
    if (rows.some(r => r.player_id === playerId)) return reply(200, { ok: true, already: true });
    if (rows.length >= MAX_PER_ROOM) return reply(429, { ok: false, error: "Room is full of results." });
    const v = verifyFinalSave(body.save, config);
    if (!v.ok) return reply(200, { ok: false, rejected: true, reason: v.reason });
    const row = { code, player_id: playerId, name: cleanName(body.name), score: v.score, rating: v.rating, net_worth: v.netWorth, goals_met: v.goalsMet, goals_total: v.goalsTotal, bankrupt: !!v.bankrupt };
    const ins = await rest("match_results?on_conflict=code,player_id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(row) });
    if (!ins.ok) return reply(502, { ok: false, error: "Could not store the result." });
    return reply(200, { ok: true, score: v.score, rating: v.rating, netWorth: v.netWorth, bankrupt: !!v.bankrupt });
  }
  return reply(400, { ok: false, error: "Unknown action." });
}
