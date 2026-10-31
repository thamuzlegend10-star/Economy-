// The scenes. They only DRAW what the engine already did: shoppers appear for real sales and real missed sales, trucks for real
// deliveries and transfers, shelves and racks show real stock. Three views: Store interior, Warehouse yard, City district.
import * as E from "./engine.js";
import { PRODUCTS } from "./data.js";
import { getLocation } from "./locations.js";

const W = 640, H = 320, FONT = '"Pixelify Sans", ui-monospace, monospace';
const px = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
const BY = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
const IDX = Object.fromEntries(PRODUCTS.map((p, i) => [p.id, i]));
const SHELF_X = [70, 230, 390], SHELF_W = 130;                    // one shelf unit per product on the back wall
const LANES = [{ x: 560, y: 190 }, { x: 560, y: 250 }];             // self-checkout kiosks (the retail game has no staff)
const SKIN = ["#f1c9a0", "#d9a577", "#b8825a", "#8d5a3c"], SHIRT = ["#4aa8ff", "#8ee0a8", "#c79bff", "#ff8a8a", "#f2a93b"];
const txt = (ctx, s, x, y, size, color, align = "center", weight = 600) => { ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.fillText(s, x, y); };

export function createScene(canvas, { getState }) {
  const ctx = canvas.getContext("2d");
  const st = { view: "store", t: 0, cursor: null, saleQty: {}, spawnT: 0, lostSeen: null, shoppers: [], pings: [], inbound: [], outbound: [], forklift: { x: 470, dir: -1 } };
  function size() { const dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth || W; canvas.width = Math.round(w * dpr); canvas.height = Math.round(w * dpr * H / W); }
  size(); window.addEventListener("resize", size);

  function intake(s) {
    if (st.cursor === null || st.cursor > s.feedSeq) { st.cursor = s.feedSeq; st.lostSeen = Object.fromEntries(PRODUCTS.map(p => [p.id, s.stats.prod[p.id].lost])); }
    for (const f of s.feed) {
      if (f.id <= st.cursor) continue; st.cursor = f.id;
      if (f.kind === "sale") st.saleQty[f.pid] = (st.saleQty[f.pid] || 0) + f.qty;
      else if (f.kind === "truck" && st.inbound.length < 4) st.inbound.push({ x: W + 80, pid: f.pid, qty: f.qty, phase: "in", t: 0, to: f.to });
      else if (f.kind === "out" && st.outbound.length < 3) st.outbound.push({ x: 300, pid: f.pid, qty: f.qty, t: 0 });
    }
    for (const p of PRODUCTS) {                                          // a missed sale (empty shelf) sends an angry shopper
      const lost = s.stats.prod[p.id].lost, seen = st.lostSeen[p.id] || 0;
      if (lost > seen) { if (st.shoppers.filter(c => c.angry).length < 3) spawn(p.id, 0, true); st.lostSeen[p.id] = lost; }
    }
  }
  function spawn(pid, qty, angry = false) { st.shoppers.push({ x: -12, y: 250 + Math.random() * 30, state: "toShelf", t: 0, look: Math.floor(Math.random() * 4), shirt: Math.floor(Math.random() * 5), pid, qty, angry, lane: Math.random() < 0.5 ? 0 : 1 }); }
  const go = (c, tx, ty, v, dt) => { const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy); if (d < 2) return true; c.x += dx / d * Math.min(d, v * dt); c.y += dy / d * Math.min(d, v * dt); return false; };

  function update(dt, s) {
    st.t += dt; intake(s); st.spawnT += dt;
    if (st.spawnT > 0.35) { st.spawnT = 0; for (const [pid, q] of Object.entries(st.saleQty)) if (st.shoppers.length < 14) spawn(pid, q); st.saleQty = {}; }
    for (const c of st.shoppers) {
      const sx = SHELF_X[IDX[c.pid]] + SHELF_W / 2, lane = LANES[c.lane];
      if (c.state === "toShelf") { if (go(c, sx, 168 + (c.lane * 14), 90, dt)) { c.state = "browse"; c.t = 0; } }
      else if (c.state === "browse") { c.t += dt; if (c.t > (c.angry ? 1.1 : 0.9)) { c.state = c.angry ? "toDoor" : "toPay"; c.t = 0; } }
      else if (c.state === "toPay") { if (go(c, lane.x - 30, lane.y + 24, 90, dt)) { c.state = "pay"; c.t = 0; } }
      else if (c.state === "pay") { c.t += dt; if (c.t > 0.7) { st.pings.push({ x: lane.x, y: lane.y - 10, t: 0, qty: c.qty, color: BY[c.pid].color }); c.state = "toDoor"; } }
      else if (c.state === "toDoor") { if (go(c, -20, 255, 100, dt)) c.state = "gone"; }
    }
    st.shoppers = st.shoppers.filter(c => c.state !== "gone");
    for (const p of st.pings) p.t += dt; st.pings = st.pings.filter(p => p.t < 1.2);
    for (const t of st.inbound) { if (t.phase === "in") { t.x -= 110 * dt; if (t.x <= 470) { t.phase = "stop"; t.t = 0; } } else if (t.phase === "stop") { t.t += dt; if (t.t > 1.6) t.phase = "out"; } else t.x += 110 * dt; }
    st.inbound = st.inbound.filter(t => t.x < W + 120);
    for (const t of st.outbound) { t.t += dt; t.x += 100 * dt; }
    st.outbound = st.outbound.filter(t => t.x < W + 100);
    if (st.inbound.some(t => t.phase === "stop")) { const f = st.forklift; f.x += f.dir * 90 * dt; if (f.x < 300) f.dir = 1; if (f.x > 470) f.dir = -1; } else st.forklift.x = 470;
  }

  const person = (c) => {
    const x = c.x, y = c.y, b = Math.sin(st.t * 10 + c.look) > 0 ? 1 : 0, bag = c.state === "toPay" || c.state === "pay" || (c.state === "toDoor" && !c.angry);
    px(ctx, x - 5, y - 6 + b, 4, 6, "#1a1f33"); px(ctx, x + 1, y - 6 + (1 - b), 4, 6, "#1a1f33");          // legs
    px(ctx, x - 6, y - 18, 12, 13, SHIRT[c.shirt]);                                                              // body
    px(ctx, x - 5, y - 27, 10, 9, SKIN[c.look]); px(ctx, x - 5, y - 28, 10, 3, ["#2a1d12", "#5a3416", "#111", "#9a5a1c"][c.look]);
    if (bag) { px(ctx, x + 6, y - 14, 8, 9, "#f2a93b"); px(ctx, x + 7, y - 12, 6, 2, "#c9822a"); }              // basket with goods
    if (c.angry) txt(ctx, "!", x, y - 40, 16, "#f0647a", "center", 700);
    else if (c.state === "browse") txt(ctx, "?", x, y - 38, 12, "#ffd36b", "center", 700);
  };
  const truck = (x, y, color, dir = 1) => {
    const f = dir; px(ctx, x, y - 28, 64, 28, "#f6efe3"); px(ctx, f > 0 ? x + 64 : x - 20, y - 20, 20, 20, "#ffb84d"); px(ctx, x + 8, y, 12, 8, "#111"); px(ctx, x + 48, y, 12, 8, "#111"); px(ctx, x + 6, y - 22, 16, 16, color);
  };

  function drawStore(s) {
    px(ctx, 0, 0, W, 130, "#26324f"); for (let x = 0; x < W; x += 80) px(ctx, x + 10, 14, 54, 30, "#1b2540");              // back wall with signs
    px(ctx, 0, 130, W, 190, "#33405f"); for (let y = 140; y < H; y += 30) for (let x = (y / 30 % 2) * 30; x < W; x += 60) px(ctx, x, y, 30, 30, "#38476a");   // tile floor
    px(ctx, 0, 126, W, 6, "#f2a93b");
    const cap = Math.max(1, E.capacityOf(s.area));
    PRODUCTS.forEach((p, i) => {                                           // shelf units: filled rows show real stock
      const x = SHELF_X[i], share = Math.min(1, (s.qty[p.id] * p.space) / cap * 3), cells = Math.round(share * 40);
      px(ctx, x - 4, 40, SHELF_W + 8, 92, "#10172b");
      for (let r = 0; r < 4; r++) { px(ctx, x, 46 + r * 21, SHELF_W, 3, "#6b7390"); for (let k = 0; k < 10; k++) { const n = (3 - r) * 10 + k; if (n < cells) px(ctx, x + 3 + k * 12.4, 28 + r * 21 + 14, 10, 14, p.color); } }
      txt(ctx, s.qty[p.id] ? p.name.split(" ")[0].toUpperCase() : "EMPTY", x + SHELF_W / 2, 28, 11, s.qty[p.id] ? "#e9edf7" : "#f0647a");
    });
    for (const L of LANES) { px(ctx, L.x - 20, L.y, 70, 36, "#10172b"); px(ctx, L.x - 16, L.y + 4, 62, 8, "#6fd3a0"); px(ctx, L.x + 10, L.y - 22, 22, 22, "#1a2848"); px(ctx, L.x + 14, L.y - 18, 14, 10, "#6fd3a0"); }
    txt(ctx, "SELF CHECKOUT", 590, 160, 10, "#9aa7c4");
    px(ctx, 0, 220, 26, 70, "#101a30"); px(ctx, 4, 224, 18, 62, Math.sin(st.t * 3) > 0 ? "#0e3a2a" : "#12503a");  // automatic door
    txt(ctx, "ENTRANCE", 14, 304, 9, "#9aa7c4");
    for (const c of [...st.shoppers].sort((a, b) => a.y - b.y)) person(c);
    for (const p of st.pings) { const a = 1 - p.t / 1.2; ctx.globalAlpha = a; txt(ctx, `+${p.qty}`, p.x, p.y - p.t * 24, 13, p.color, "center", 700); txt(ctx, "$", p.x + 22, p.y - 4 - p.t * 24, 13, "#ffd36b", "center", 700); ctx.globalAlpha = 1; }
    txt(ctx, `SHOP  ${s.area} m²`, 12, 12, 12, "#f2a93b", "left", 700);
  }

  function drawWarehouse(s) {
    px(ctx, 0, 0, W, 190, "#1b2742"); px(ctx, 0, 190, W, 130, "#2a2f3f"); px(ctx, 0, 262, W, 58, "#232736"); for (let x = 0; x < W; x += 56) px(ctx, x + 10, 290, 30, 3, "#6b7390");
    const w = s.wh; txt(ctx, w.area ? `WAREHOUSE  ${w.area} m²` : "NO WAREHOUSE YET", 12, 12, 12, "#f2a93b", "left", 700);
    if (!w.area) { px(ctx, 120, 70, 300, 130, "#171d30"); for (let x = 120; x < 420; x += 20) px(ctx, x, 196, 10, 4, "#f2a93b"); txt(ctx, "Empty lot", 270, 120, 16, "#9aa7c4"); txt(ctx, "Rent one in Warehouse", 270, 146, 11, "#9aa7c4"); return; }
    const cap = Math.max(1, E.whCapacity(s)), used = E.whUsed(s), util = used / cap;
    px(ctx, 30, 50, 420, 150, "#2c3a5e"); px(ctx, 30, 44, 420, 10, "#f2a93b"); px(ctx, 36, 62, 408, 132, "#0b1426");
    PRODUCTS.forEach((p, i) => {                                           // one rack per product: 6 columns x 5 rows of pallet slots
      const x = 46 + i * 134, units = w.qty[p.id], fill = Math.min(30, Math.ceil(Math.min(1, units * p.space / (cap / 3)) * 30 - 1e-9));
      px(ctx, x, 70, 120, 112, "#05070d");
      for (let r = 0; r < 5; r++) { px(ctx, x, 70 + (r + 1) * 22 - 2, 120, 3, "#6b7390"); for (let k = 0; k < 6; k++) { const n = (4 - r) * 6 + k; if (n < fill) px(ctx, x + 4 + k * 19, 70 + r * 22 + 6, 16, 14, p.color); } }
      txt(ctx, p.name.split(" ")[0].toUpperCase(), x + 60, 190, 9, units ? "#e9edf7" : "#f0647a");
    });
    for (let i = 0; i < 2; i++) { px(ctx, 450, 90 + i * 60, 60, 48, "#232c47"); px(ctx, 456, 98 + i * 60, 48, 40, "#0b1426"); txt(ctx, "DOCK " + (i + 1), 480, 86 + i * 60, 8, "#9aa7c4"); }
    const f = st.forklift, bx = f.x; px(ctx, bx, 128, 22, 14, "#ffb84d"); px(ctx, bx - 8, 120, 6, 24, "#6b7390"); px(ctx, bx + 4, 122, 10, 7, "#6fd3a0");
    for (const t of st.inbound) if (t.to === "wh" || t.to === undefined) { truck(t.x, 262, BY[t.pid].color, -1); if (t.phase === "stop") txt(ctx, `+${t.qty.toLocaleString("en-US")}`, t.x + 32, 222, 11, "#6fd3a0", "center", 700); }
    for (const t of st.outbound) { truck(t.x, 262, BY[t.pid].color, 1); txt(ctx, "to shop", t.x + 32, 222, 9, "#9aa7c4"); }
    px(ctx, 520, 60, 100, 14, "#10172b"); px(ctx, 522, 62, Math.round(96 * Math.min(1, util)), 10, util > 0.9 ? "#f0647a" : util > 0.7 ? "#f2a93b" : "#6fd3a0");
    txt(ctx, `${Math.round(util * 100)}% full`, 570, 84, 10, "#e9edf7"); txt(ctx, `${s.orders.length} on the way`, 570, 100, 10, "#9aa7c4");
  }

  function drawCity(s) {
    const L = getLocation(s.location), rivals = Math.round((L.competition || 0) * 4);
    px(ctx, 0, 0, W, H, "#22352f"); px(ctx, 0, 150, W, 36, "#3a3f4f"); for (let x = 0; x < W; x += 40) px(ctx, x + 8, 167, 22, 3, "#d9d3b8"); px(ctx, 300, 0, 28, 150, "#3a3f4f"); px(ctx, 120, 186, 28, 134, "#3a3f4f");
    px(ctx, 6, 100, 74, 44, "#1b2540"); txt(ctx, "SUPPLIERS", 43, 122, 10, "#e9edf7");
    const door = { shop: { x: 440, y: 150 }, wh: { x: 210, y: 150 } };
    px(ctx, 380, 60, 120, 86, "#2c3a5e"); px(ctx, 380, 54, 120, 10, "#f2a93b"); px(ctx, 396, 84, 88, 40, "#0b1426"); txt(ctx, `SHOP ${s.area} m²`, 440, 44, 11, "#f2a93b", "center", 700);
    if (s.wh.area) { px(ctx, 150, 50, 130, 96, "#33405f"); px(ctx, 150, 44, 130, 10, "#6fd3a0"); px(ctx, 160, 100, 36, 46, "#0b1426"); px(ctx, 204, 100, 36, 46, "#0b1426"); txt(ctx, `WAREHOUSE ${s.wh.area} m²`, 215, 34, 11, "#6fd3a0", "center", 700); }
    else { px(ctx, 150, 70, 130, 76, "#1c2b27"); txt(ctx, "empty lot", 215, 108, 11, "#9aa7c4"); }
    for (let i = 0; i < rivals; i++) { const x = 20 + i * 110, y = 214 + (i % 2) * 40; px(ctx, x + 150 - 30, y, 84, 52, "#3b3f4a"); px(ctx, x + 120, y - 6, 84, 8, "#f0647a"); txt(ctx, "RIVAL", x + 162, y + 28, 10, "#c8ccd8"); }
    const now = s.day + s.dayStep / Math.max(1, s.stepsPerDay);
    for (const o of s.orders) {
      const from = o.kind === "transfer" ? door.wh.x : 80, to = o.dest === "wh" ? door.wh.x : door.shop.x, k = Math.max(0, Math.min(1, (now - o.placed) / Math.max(0.5, o.eta - o.placed)));
      const x = from + (to - from) * k; truck(x - 22, 178, BY[o.pid].color, to >= from ? 1 : -1);
    }
    txt(ctx, `${L.name}`, 12, 12, 12, "#f2a93b", "left", 700); txt(ctx, `${s.orders.length} truck${s.orders.length === 1 ? "" : "s"} on the road`, W - 10, 12, 11, "#9aa7c4", "right");
  }

  function draw(s) {
    ctx.setTransform(canvas.width / W, 0, 0, canvas.width / W, 0, 0); ctx.imageSmoothingEnabled = false;
    (st.view === "warehouse" ? drawWarehouse : st.view === "city" ? drawCity : drawStore)(s);
    if (s.ended) { px(ctx, 0, 0, W, H, "rgba(5,8,20,.6)"); txt(ctx, s.ended.reason === "bankrupt" ? "BANKRUPT" : "FINISHED", W / 2, H / 2, 22, "#f2a93b", "center", 700); }
  }
  let last = performance.now();
  function frame(now) { const dt = Math.min(0.1, (now - last) / 1000); last = now; const s = getState(); if (s) { update(dt, s); draw(s); } requestAnimationFrame(frame); }
  requestAnimationFrame(frame);
  return {
    reset() { st.shoppers = []; st.pings = []; st.inbound = []; st.outbound = []; st.cursor = null; st.saleQty = {}; st.lostSeen = null; },
    setView(v) { if (["store", "warehouse", "city"].includes(v)) st.view = v; },
    get view() { return st.view; },
  };
}
