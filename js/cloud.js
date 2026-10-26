// Optional cloud save through Supabase. Uses only the public publishable key from config.js.
// Row Level Security (see supabase/schema.sql) limits every player to their own row.
export function createCloud() {
  let sb = null, user = null;
  const key = window.SUPABASE_ANON_KEY;
  const configured = !!(key && !String(key).startsWith("PASTE_") && window.SUPABASE_URL);
  if (configured && window.supabase) { try { sb = window.supabase.createClient(window.SUPABASE_URL, key); } catch { sb = null; } }

  return {
    available: () => !!sb,
    client: () => sb,
    reason: () => (!configured ? "Add the publishable key to config.js." : !window.supabase ? "Supabase library did not load (offline?)." : ""),
    user: () => user,
    async restore() {
      if (!sb) return null;
      try { const { data } = await sb.auth.getSession(); user = data.session ? data.session.user : null; } catch { user = null; }
      return user;
    },
    async signIn(email, password) {
      if (!sb) return { error: "Cloud save is not configured." };
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };
      user = data.user; return { user };
    },
    async signUp(email, password) {
      if (!sb) return { error: "Cloud save is not configured." };
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) return { error: error.message };
      if (!data.session) return { notice: "Check your email to confirm, then sign in." };
      user = data.user; return { user };
    },
    async signOut() { if (sb) await sb.auth.signOut(); user = null; },
    async save(stateJson) {
      if (!sb || !user) return { error: "Not signed in." };
      try {
        const { error } = await sb.from("game_saves").upsert({ user_id: user.id, data: JSON.parse(stateJson), updated_at: new Date().toISOString() }, { onConflict: "user_id" });
        return error ? { error: error.message } : { ok: true };
      } catch (e) { return { error: e.message || String(e) }; }
    },
    async load() {
      if (!sb || !user) return { error: "Not signed in." };
      try {
        const { data, error } = await sb.from("game_saves").select("data,updated_at").eq("user_id", user.id).maybeSingle();
        if (error) return { error: error.message };
        return { data: data ? data.data : null, at: data ? data.updated_at : null };
      } catch (e) { return { error: e.message || String(e) }; }
    },
  };
}
