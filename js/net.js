// Transports for multiplayer rooms. All share one tiny interface:
//   net.join(code, id, meta, { onPresence(state), onMessage(payload), onStatus(status) }) -> channel
//   channel.send(payload), channel.track(meta), channel.leave()
// presence state shape: { [playerId]: [meta, ...] }  (same as Supabase Realtime)
//
// - supabase: Supabase Realtime broadcast + presence. Works across devices. Uses only the public key.
// - local:    BroadcastChannel. Works between tabs of one browser (test mode / offline).
// - memory:   in-process bus used by the unit tests.

export function createSupabaseNet(sb) {
  return {
    kind: "supabase",
    join(code, id, meta, h) {
      const ch = sb.channel("economy-room-" + code, { config: { broadcast: { self: false }, presence: { key: id } } });
      ch.on("presence", { event: "sync" }, () => h.onPresence(ch.presenceState()))
        .on("broadcast", { event: "msg" }, ({ payload }) => h.onMessage(payload));
      ch.subscribe(async status => {
        if (status === "SUBSCRIBED") { try { await ch.track(meta); } catch { /* retried on next track */ } h.onStatus("connected"); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") h.onStatus("error");
        else if (status === "CLOSED") h.onStatus("closed");
      });
      return {
        send: payload => ch.send({ type: "broadcast", event: "msg", payload }),
        track: m => ch.track(m),
        leave: () => sb.removeChannel(ch),
      };
    },
  };
}

export function createLocalNet() {
  return {
    kind: "local",
    join(code, id, meta, h) {
      const bc = new BroadcastChannel("economy-room-" + code);
      const peers = new Map();                 // id -> { meta, seen }
      let mine = meta, alive = true;
      const state = () => {
        const out = {};
        for (const [pid, p] of peers) out[pid] = [p.meta];
        out[id] = [mine];
        return out;
      };
      const emit = () => alive && h.onPresence(state());
      const announce = hello => bc.postMessage({ k: "pres", id, meta: mine, hello: !!hello });
      bc.onmessage = e => {
        const m = e.data; if (!m || !alive) return;
        if (m.k === "pres") { peers.set(m.id, { meta: m.meta, seen: Date.now() }); if (m.hello) announce(false); emit(); }
        else if (m.k === "bye") { peers.delete(m.id); emit(); }
        else if (m.k === "msg") h.onMessage(m.payload);
      };
      const beat = setInterval(() => {
        announce(false);
        const now = Date.now(); let changed = false;
        for (const [pid, p] of peers) if (now - p.seen > 6000) { peers.delete(pid); changed = true; }
        if (changed) emit();
      }, 1500);
      setTimeout(() => { announce(true); h.onStatus("connected"); emit(); }, 0);
      return {
        send: payload => bc.postMessage({ k: "msg", payload }),
        track: m => { mine = m; announce(false); emit(); },
        leave: () => { alive = false; clearInterval(beat); bc.postMessage({ k: "bye", id }); bc.close(); },
      };
    },
  };
}

// In-process network for tests. Each createMemoryNet(bus) shares the same rooms.
export function createMemoryBus() { return { rooms: new Map() }; }
export function createMemoryNet(bus) {
  return {
    kind: "memory",
    join(code, id, meta, h) {
      if (!bus.rooms.has(code)) bus.rooms.set(code, new Map());
      const room = bus.rooms.get(code), me = { id, meta, h };
      room.set(id, me);
      const pres = () => { const o = {}; for (const [pid, p] of room) o[pid] = [p.meta]; return o; };
      const notify = () => { for (const p of [...room.values()]) p.h.onPresence(pres()); };
      queueMicrotask(() => { h.onStatus("connected"); notify(); });
      return {
        send: payload => { for (const [pid, p] of [...room]) if (pid !== id) queueMicrotask(() => p.h.onMessage(JSON.parse(JSON.stringify(payload)))); },
        track: m => { me.meta = m; queueMicrotask(notify); },
        leave: () => { room.delete(id); if (!room.size) bus.rooms.delete(code); queueMicrotask(notify); },
      };
    },
  };
}
