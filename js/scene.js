// The shop scene. It only DRAWS what the engine already did: a customer appears for each sale in s.feed, a truck for each delivery.
import * as E from "./engine.js";
import { PRODUCTS } from "./data.js";

const W = 640, H = 320, FONT = '"Pixelify Sans", ui-monospace, monospace';
const px = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
const BY = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));

export function createScene(canvas, { getState, isRunning }) {
  const ctx = canvas.getContext("2d");
  const st = { custs: [], trucks: [], cursor: null, t: 0, saleQty: {}, spawnT: 0 };
  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth || W;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(w * dpr * H / W);
  }
  size(); window.addEventListener("resize", size);

  function intake(s) {
    if (st.cursor === null || st.cursor > s.feedSeq) st.cursor = s.feedSeq;     // new or loaded game: do not replay old events
    for (const f of s.feed) {
      if (f.id <= st.cursor) continue; st.cursor = f.id;
      if (f.kind === "sale") st.saleQty[f.pid] = (st.saleQty[f.pid] || 0) + f.qty;
      else if (f.kind === "truck" && st.trucks.length < 4) st.trucks.push({ x: -80, pid: f.pid, qty: f.qty, phase: "in", t: 0 });
    }
  }
  function update(dt, s) {
    st.t += dt; intake(s);
    st.spawnT += dt;
    if (st.spawnT > 0.35) {                                                      // one visitor per product with sales since the last look
      st.spawnT = 0;
      for (const [pid, q] of Object.entries(st.saleQty)) { if (st.custs.length < 10) st.custs.push({ x: W + 20, y: 238 + Math.random() * 28, pid, qty: q, phase: "in", t: 0, look: Math.floor(Math.random() * 4) }); }
      st.saleQty = {};
    }
    for (const c of st.custs) {
      if (c.phase === "in") { c.x -= 70 * dt; if (c.x <= 372) { c.phase = "buy"; c.t = 0; } }
      else if (c.phase === "buy") { c.t += dt; if (c.t > 0.9) c.phase = "out"; }
      else c.x += 80 * dt;
    }
    st.custs = st.custs.filter(c => c.x < W + 30);
    for (const t of st.trucks) {
      if (t.phase === "in") { t.x += 120 * dt; if (t.x >= 450) { t.phase = "stop"; t.t = 0; } }
      else if (t.phase === "stop") { t.t += dt; if (t.t > 1.4) t.phase = "out"; } else t.x += 120 * dt;
    }
    st.trucks = st.trucks.filter(t => t.x < W + 100);
  }
  const person = (c, k, y, look) => { px(ctx, c - 4, y - 22, 8, 8, "#f1c9a0"); px(ctx, c - 5, y - 24, 10, 3, ["#3a2a1a", "#7a4b1e", "#222", "#b5651d"][look]); px(ctx, c - 5, y - 14, 10, 12, ["#4aa8ff", "#8ee0a8", "#c79bff", "#ff8a8a"][look]); px(ctx, c - 5, y - 2, 4, 4, "#222"); px(ctx, c + 1, y - 2, 4, 4, "#222"); };
  function draw(s) {
    ctx.setTransform(canvas.width / W, 0, 0, canvas.width / W, 0, 0); ctx.imageSmoothingEnabled = false;
    const g = ctx.createLinearGradient(0, 0, 0, 200); g.addColorStop(0, "#0e1a38"); g.addColorStop(1, "#27355f"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 200);
    for (let i = 0; i < 24; i++) px(ctx, (i * 97) % W, (i * 53) % 90, 2, 2, "rgba(255,255,255,.5)");
    px(ctx, 0, 200, W, 120, "#1b2236"); px(ctx, 0, 278, W, 42, "#2a2f3f"); for (let x = 0; x < W; x += 48) px(ctx, x + 8, 298, 26, 3, "#6b7390");
    // shop
    px(ctx, 40, 90, 340, 150, "#2c3a5e"); px(ctx, 40, 84, 340, 12, "#f2a93b"); for (let x = 40; x < 380; x += 34) px(ctx, x, 96, 17, 10, "#c9822a");
    px(ctx, 56, 64, 190, 24, "#0b1020"); px(ctx, 58, 66, 186, 20, "#18223a");
    ctx.font = `700 14px ${FONT}`; ctx.fillStyle = "#f2a93b"; ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText(`SHOP  ${s.area} m²`, 66, 77);
    px(ctx, 58, 118, 220, 100, "#0b1426"); px(ctx, 296, 130, 52, 110, "#101a30"); px(ctx, 300, 134, 44, 106, "#1a2848");
    const cap = Math.max(1, E.capacityOf(s.area));
    PRODUCTS.forEach((p, i) => {                                                  // shelves show real stock as a share of the space
      const x = 68 + i * 70, y = 130, share = Math.min(1, (s.qty[p.id] * p.space) / cap * 3), h = Math.round(76 * share);
      px(ctx, x, y, 54, 78, "#05070d"); px(ctx, x + 2, y + 78 - h, 50, h, p.color); px(ctx, x, y + 80, 54, 4, "#6b7390");
      ctx.font = `600 9px ${FONT}`; ctx.fillStyle = s.qty[p.id] ? "#e9edf7" : "#f0647a"; ctx.textAlign = "center"; ctx.fillText(s.qty[p.id] ? p.name.split(" ")[0] : "EMPTY", x + 27, y + 96);
    });
    // loading bay
    px(ctx, 380, 150, 70, 90, "#232c47"); px(ctx, 386, 160, 58, 80, "#0b1426");
    // pending shipments
    ctx.font = `600 11px ${FONT}`; ctx.textAlign = "right"; ctx.fillStyle = "#9aa7c4"; ctx.fillText(s.orders.length ? `${s.orders.length} truck${s.orders.length > 1 ? "s" : ""} on the way` : "No deliveries pending", W - 10, 14);
    for (const t of st.trucks) {
      const y = 262; px(ctx, t.x, y - 26, 62, 26, "#f6efe3"); px(ctx, t.x + 62, y - 18, 20, 18, "#ffb84d"); px(ctx, t.x + 8, y, 10, 8, "#111"); px(ctx, t.x + 56, y, 10, 8, "#111");
      px(ctx, t.x + 6, y - 20, 14, 14, BY[t.pid].color);
      if (t.phase === "stop") { ctx.font = `700 11px ${FONT}`; ctx.fillStyle = "#6fd3a0"; ctx.textAlign = "center"; ctx.fillText(`+${t.qty.toLocaleString("en-US")}`, t.x + 31, y - 34); }
    }
    for (const c of st.custs) {
      person(c.x, 0, c.y, c.look);
      if (c.phase === "buy") { ctx.font = `700 11px ${FONT}`; ctx.fillStyle = BY[c.pid].color; ctx.textAlign = "center"; ctx.fillText(`+${c.qty}`, c.x, c.y - 32); }
    }
    if (s.ended) { px(ctx, 0, 0, W, H, "rgba(5,8,20,.6)"); ctx.font = `700 22px ${FONT}`; ctx.fillStyle = "#f2a93b"; ctx.textAlign = "center"; ctx.fillText(s.ended.reason === "bankrupt" ? "BANKRUPT" : "FINISHED", W / 2, H / 2); }
  }
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const s = getState(); if (s) { update(dt, s); draw(s); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { reset() { st.custs = []; st.trucks = []; st.cursor = null; st.saleQty = {}; } };
}
