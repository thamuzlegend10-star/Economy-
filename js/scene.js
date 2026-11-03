// The scenes. They only DRAW what the engine already did: shoppers appear for real sales and real missed sales, trucks for real
// deliveries and transfers, shelves and racks show real stock. Six views: Store interior, Warehouse yard, City district, Factory floor, Truck yard, Bank.
import * as E from "./engine.js";
import { PRODUCTS, MACHINES, RAW, BANK } from "./data.js";
import { balance } from "./ledger.js";
import { getLocation } from "./locations.js";

const W = 640, H = 320, FONT = '"Pixelify Sans", ui-monospace, monospace';
const px = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
const BY = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
const IDX = Object.fromEntries(PRODUCTS.map((p, i) => [p.id, i]));
const SHELF_X = [70, 230, 390], SHELF_W = 130;                    // one shelf unit per product on the back wall
const LANES = [{ x: 560, y: 190 }, { x: 560, y: 250 }];             // self-checkout kiosks (the retail game has no staff)
const SKIN = ["#f1c9a0", "#d9a577", "#b8825a", "#8d5a3c"], SHIRT = ["#4aa8ff", "#8ee0a8", "#c79bff", "#ff8a8a", "#f2a93b"];
const txt = (ctx, s, x, y, size, color, align = "center", weight = 600) => { ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.fillText(s, x, y); };

// Cozy Town Lite sprite asset management
const SPRITES = { char: null, cafe: null, tiles: null };
function initSprites() {
  if (typeof Image === "undefined" || SPRITES.char) return;
  const load = src => { const img = new Image(); img.src = src; return img; };
  SPRITES.char = load("cozy-town-lite/characters/1x/player-1-walk.png");
  SPRITES.cafe = load("cozy-town-lite/buildings/1x/cafe.png");
  SPRITES.tiles = load("cozy-town-lite/tiles/1x/town-street-lite.png");
}
const DIR_ROWS = { idle: { down: 0, left: 1, right: 2, up: 3 }, walk: { down: 4, left: 5, right: 6, up: 7 } };
function drawChar(ctx, x, y, dir = "down", moving = false, t = 0, scale = 1.45) {
  const img = SPRITES.char;
  if (img && img.complete && img.naturalWidth) {
    const row = (moving ? DIR_ROWS.walk : DIR_ROWS.idle)[dir] ?? 0;
    const frame = Math.floor(t * (moving ? 8 : 4)) % 6;
    const sw = 16, sh = 24, dw = Math.round(sw * scale), dh = Math.round(sh * scale);
    ctx.drawImage(img, frame * sw, row * sh, sw, sh, Math.round(x - dw / 2), Math.round(y - dh), dw, dh);
    return true;
  }
  return false;
}
function drawTile(ctx, index, dx, dy, dw = 16, dh = 16) {
  const img = SPRITES.tiles;
  if (img && img.complete && img.naturalWidth) {
    const col = index % 8, row = Math.floor(index / 8);
    ctx.drawImage(img, col * 16, row * 16, 16, 16, Math.round(dx), Math.round(dy), Math.round(dw), Math.round(dh));
    return true;
  }
  return false;
}

export function createScene(canvas, { getState }) {
  initSprites();
  const ctx = canvas.getContext("2d");
  const st = {
    view: "store", t: 0, cursor: null, saleQty: {}, spawnT: 0, lostSeen: null,
    shoppers: [
      { x: 135, y: 196, state: "browse", t: 0, look: 0, shirt: 0, pid: "noodles", qty: 2, angry: false, lane: 0, dir: "up" },
      { x: 295, y: 204, state: "browse", t: 0.5, look: 1, shirt: 1, pid: "milk", qty: 1, angry: false, lane: 1, dir: "up" }
    ],
    pings: [], inbound: [], outbound: [], forklift: { x: 470, dir: -1 }
  };
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
  function spawn(pid, qty, angry = false) { st.shoppers.push({ x: -12, y: 250 + Math.random() * 30, state: "toShelf", t: 0, look: Math.floor(Math.random() * 4), shirt: Math.floor(Math.random() * 5), pid, qty, angry, lane: Math.random() < 0.5 ? 0 : 1, dir: "right" }); }
  const go = (c, tx, ty, v, dt) => { const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy); if (d < 2) return true; if (Math.abs(dx) > Math.abs(dy)) c.dir = dx > 0 ? "right" : "left"; else c.dir = dy > 0 ? "down" : "up"; c.x += dx / d * Math.min(d, v * dt); c.y += dy / d * Math.min(d, v * dt); return false; };

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
    const x = c.x, y = c.y, bag = c.state === "toPay" || c.state === "pay" || (c.state === "toDoor" && !c.angry);
    const moving = c.state === "toShelf" || c.state === "toPay" || c.state === "toDoor";
    const dir = c.dir || (c.state === "browse" ? "up" : c.state === "pay" ? "right" : "right");
    const drew = drawChar(ctx, x, y, dir, moving, st.t, 1.25);
    if (!drew) {
      const b = Math.sin(st.t * 10 + c.look) > 0 ? 1 : 0;
      px(ctx, x - 5, y - 6 + b, 4, 6, "#1a1f33"); px(ctx, x + 1, y - 6 + (1 - b), 4, 6, "#1a1f33");
      px(ctx, x - 6, y - 18, 12, 13, SHIRT[c.shirt]);
      px(ctx, x - 5, y - 27, 10, 9, SKIN[c.look]); px(ctx, x - 5, y - 28, 10, 3, ["#2a1d12", "#5a3416", "#111", "#9a5a1c"][c.look]);
    }
    if (bag) { px(ctx, x + 7, y - 10, 7, 7, BY[c.pid].color); px(ctx, x + 8, y - 9, 5, 2, "#ffd36b"); }
    if (c.angry) txt(ctx, "!", x, y - 36, 16, "#f0647a", "center", 700);
    else if (c.state === "browse") txt(ctx, "?", x, y - 34, 12, "#ffd36b", "center", 700);
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
    drawChar(ctx, 580, 218, "left", false, st.t, 1.5); // store staff at checkout
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
    px(ctx, 0, 0, W, H, "#22352f");
    let tilesOk = false;
    if (SPRITES.tiles && SPRITES.tiles.complete && SPRITES.tiles.naturalWidth) {
      tilesOk = true;
      for (let x = 0; x < W; x += 16) {
        drawTile(ctx, 6, x, 134); drawTile(ctx, 16, x, 150);
        const cross = x >= 300 && x < 348;
        drawTile(ctx, cross ? 5 : 4, x, 166); drawTile(ctx, cross ? 5 : 0, x, 182);
        drawTile(ctx, 15, x, 198); drawTile(ctx, 6, x, 214);
        if (x % 48 === 0) drawTile(ctx, 12 + (Math.floor(x / 48) % 3), x, 230);
      }
    }
    if (!tilesOk) {
      px(ctx, 0, 150, W, 36, "#3a3f4f"); for (let x = 0; x < W; x += 40) px(ctx, x + 8, 167, 22, 3, "#d9d3b8"); px(ctx, 300, 0, 28, 150, "#3a3f4f"); px(ctx, 120, 186, 28, 134, "#3a3f4f");
    }
    px(ctx, 6, 100, 74, 44, "#1b2540"); txt(ctx, "SUPPLIERS", 43, 122, 10, "#e9edf7");
    const door = { shop: { x: 440, y: 150 }, wh: { x: 210, y: 150 } };
    if (SPRITES.cafe && SPRITES.cafe.complete && SPRITES.cafe.naturalWidth) {
      ctx.drawImage(SPRITES.cafe, 0, 0, 80, 80, 390, 48, 100, 100);
      txt(ctx, `SHOP ${s.area} m²`, 440, 40, 11, "#f2a93b", "center", 700);
    } else {
      px(ctx, 380, 60, 120, 86, "#2c3a5e"); px(ctx, 380, 54, 120, 10, "#f2a93b"); px(ctx, 396, 84, 88, 40, "#0b1426"); txt(ctx, `SHOP ${s.area} m²`, 440, 44, 11, "#f2a93b", "center", 700);
    }
    if (s.wh.area) { px(ctx, 150, 50, 130, 96, "#33405f"); px(ctx, 150, 44, 130, 10, "#6fd3a0"); px(ctx, 160, 100, 36, 46, "#0b1426"); px(ctx, 204, 100, 36, 46, "#0b1426"); txt(ctx, `WAREHOUSE ${s.wh.area} m²`, 215, 34, 11, "#6fd3a0", "center", 700); }
    else { px(ctx, 150, 70, 130, 76, "#1c2b27"); txt(ctx, "empty lot", 215, 108, 11, "#9aa7c4"); }
    for (let i = 0; i < rivals; i++) { const x = 20 + i * 110, y = 214 + (i % 2) * 40; px(ctx, x + 150 - 30, y, 84, 52, "#3b3f4a"); px(ctx, x + 120, y - 6, 84, 8, "#f0647a"); txt(ctx, "RIVAL", x + 162, y + 28, 10, "#c8ccd8"); }
    const ped1 = ((st.t * 32 + 60) % (W + 80)) - 40; drawChar(ctx, ped1, 144, "right", true, st.t, 1.15);
    const ped2 = W + 40 - ((st.t * 26 + 180) % (W + 80)); drawChar(ctx, ped2, 218, "left", true, st.t, 1.15);
    const now = s.day + s.dayStep / Math.max(1, s.stepsPerDay);
    for (const o of s.orders) {
      const from = o.kind === "transfer" ? door.wh.x : 80, to = o.dest === "wh" ? door.wh.x : door.shop.x, k = Math.max(0, Math.min(1, (now - o.placed) / Math.max(0.5, o.eta - o.placed)));
      const x = from + (to - from) * k; truck(x - 22, 178, BY[o.pid].color, to >= from ? 1 : -1);
    }
    txt(ctx, `${L.name}`, 12, 12, 12, "#f2a93b", "left", 700); txt(ctx, `${s.orders.length} truck${s.orders.length === 1 ? "" : "s"} on the road`, W - 10, 12, 11, "#9aa7c4", "right");
  }


  const money = n => "$" + Math.round(n).toLocaleString("en-US");
  const bar = (x, y, w, h, v, color, back = "#10172b") => { px(ctx, x, y, w, h, back); px(ctx, x + 1, y + 1, Math.max(0, Math.round((w - 2) * Math.min(1, Math.max(0, v)))), h - 2, color); };
  const STATUS = { running: "#6fd3a0", idle: "#6b7390", broken: "#f0647a" };

  // Factory floor: one cell per real machine (colour = status, bar = health), raw material tanks on the left, finished bottles on the right.
  function drawFactory(s) {
    const fx = s.fx; px(ctx, 0, 0, W, H, "#1b2236"); px(ctx, 0, 0, W, 60, "#26324f"); for (let x = 0; x < W; x += 64) px(ctx, x + 8, 12, 48, 26, "#121a2c");
    txt(ctx, fx.area ? `FACTORY  ${fx.area} m²` : "NO FACTORY YET", 12, 12, 12, "#f2a93b", "left", 700);
    if (!fx.area) { px(ctx, 120, 90, 400, 150, "#171d30"); txt(ctx, "Empty lot", 320, 150, 16, "#9aa7c4"); txt(ctx, "Rent space in Factory, Machines", 320, 180, 11, "#9aa7c4"); return; }
    px(ctx, 0, 60, W, 260, "#2a2f3f"); for (let y = 70; y < H; y += 26) px(ctx, 0, y, W, 1, "#323849");
    RAW.slice(0, 6).forEach((r, i) => {                                      // raw material tanks, 3 per row
      const x = 10 + (i % 3) * 36, y = 74 + Math.floor(i / 3) * 90, q = fx.raw.qty[r.id] || 0, fill = Math.min(1, q / (r.id === "bottles" || r.id === "caps" ? 20000 : 5000));
      px(ctx, x, y, 30, 56, "#10172b"); px(ctx, x + 2, y + 2 + Math.round(52 * (1 - fill)), 26, Math.round(52 * fill), r.color || "#6aa9ff"); px(ctx, x, y + 56, 30, 3, "#6b7390");
      txt(ctx, r.id.replace(/Conc$/, "").toUpperCase().slice(0, 6), x + 15, y + 68, 6, q > 0 ? "#9aa7c4" : "#f0647a");
    });
    const ms = fx.machines.slice(0, 6);
    if (!ms.length) txt(ctx, "No machines bought yet", 330, 190, 14, "#9aa7c4");
    ms.forEach((m, i) => {
      const x = 126 + (i % 3) * 138, y = 84 + Math.floor(i / 3) * 112, col = STATUS[m.status] || STATUS.idle, t = MACHINES.find(z => z.id === m.type);
      px(ctx, x, y, 120, 84, "#10172b"); px(ctx, x + 4, y + 4, 112, 50, "#1d2742"); px(ctx, x + 4, y + 4, 112, 6, col);
      for (let k = 0; k < 7; k++) { const on = m.status === "running" ? (Math.floor(st.t * 6) + k) % 3 === 0 : false; px(ctx, x + 10 + k * 15, y + 36, 9, 10, on ? "#ffd36b" : "#2c3a5e"); }  // conveyor lights chase while running
      if (m.status === "broken" && Math.sin(st.t * 8) > 0) txt(ctx, "!", x + 60, y + 28, 22, "#f0647a", "center", 700);
      txt(ctx, m.name.toUpperCase(), x + 60, y + 62, 8, "#e9edf7"); bar(x + 8, y + 70, 104, 7, m.health / 100, m.health < 40 ? "#f0647a" : m.health < 70 ? "#f2a93b" : "#6fd3a0", "#05070d");
      if (m.status === "running") drawChar(ctx, x + 96, y + 50, "left", true, st.t, 1.15);
      else if (m.status === "broken") drawChar(ctx, x + 96, y + 50, "up", false, st.t, 1.15);
      if (m.status === "broken") for (let k = 0; k < 3; k++) { const a = ((st.t * 0.6 + k / 3) % 1); ctx.globalAlpha = 1 - a; px(ctx, x + 40 + k * 14 + Math.sin(st.t * 3 + k) * 4, y - 4 - a * 26, 8, 8, "#6b7390"); ctx.globalAlpha = 1; }
    });
    const made = fx.today ? Object.values(fx.today.made || {}).reduce((a, b) => a + b, 0) : 0, stock = Object.values(fx.fg.qty).reduce((a, b) => a + b, 0), crew = s.hr ? s.hr.staff.factory.n : 0;
    px(ctx, 548, 74, 80, 150, "#10172b"); txt(ctx, "BOTTLES", 588, 86, 9, "#9aa7c4");
    const rows = Math.min(10, Math.ceil(stock / 2000)); for (let r = 0; r < rows; r++) px(ctx, 558, 184 - r * 8, 60, 6, "#6fd3a0");
    txt(ctx, `${stock.toLocaleString("en-US")} in stock`, 588, 206, 8, "#e9edf7"); txt(ctx, `${made.toLocaleString("en-US")} made today`, 588, 216, 8, "#9aa7c4");
    txt(ctx, `${crew} operator${crew === 1 ? "" : "s"}`, 628, 12, 11, "#9aa7c4", "right");
  }

  // Truck yard: one bay per owned truck. Parked, driving out and back, or broken down, with health and the driver count.
  function drawYard(s) {
    const f = s.fleet, drivers = s.hr ? s.hr.staff.driver.n : 0, out = f.trucks.filter(k => k.status === "out").length;
    px(ctx, 0, 0, W, H, "#22352f"); px(ctx, 0, 0, W, 70, "#26324f"); px(ctx, 0, 70, W, 250, "#2a2f3f"); px(ctx, 0, 250, W, 40, "#3a3f4f"); for (let x = 0; x < W; x += 40) px(ctx, x + 8, 268, 22, 3, "#d9d3b8");
    px(ctx, 20, 14, 120, 46, "#171d30"); txt(ctx, "TRUCK YARD", 80, 38, 11, "#f2a93b", "center", 700);
    txt(ctx, `${f.trucks.length} truck${f.trucks.length === 1 ? "" : "s"} · ${drivers} driver${drivers === 1 ? "" : "s"} · ${out} on the road`, W - 10, 12, 11, "#9aa7c4", "right");
    if (!f.trucks.length) { txt(ctx, "No trucks yet", 320, 160, 16, "#9aa7c4"); txt(ctx, "Buy one in Shipping, My Fleet", 320, 186, 11, "#9aa7c4"); return; }
    f.trucks.slice(0, 8).forEach((k, i) => {
      const bx = 16 + (i % 4) * 154, by = 92 + Math.floor(i / 4) * 80, col = k.type === "van" ? "#6aa9ff" : "#f2a93b";
      px(ctx, bx, by, 146, 62, "#171d30"); for (let z = 0; z < 6; z++) px(ctx, bx + 4 + z * 24, by + 58, 14, 2, "#f2a93b");
      if (k.status === "out") { const p = (st.t * 0.25 + i * 0.37) % 1, x = -70 + (W + 140) * p; truck(x, 262, col, 1); txt(ctx, "empty bay", bx + 73, by + 28, 9, "#6b7390"); }
      else { truck(bx + 10, by + 50, col, 1); if (k.status === "down") { if (Math.sin(st.t * 6) > 0) txt(ctx, "!", bx + 40, by + 4, 18, "#f0647a", "center", 700); } }
      txt(ctx, `${k.name.toUpperCase()} · ${k.status === "down" ? "BROKEN" : k.status === "out" ? "ON ROAD" : "READY"}`, bx + 73, by + 8, 8, k.status === "down" ? "#f0647a" : "#e9edf7");
      if (k.status !== "out") drawChar(ctx, bx + 124, by + 48, "left", false, st.t, 1.15);
      bar(bx + 90, by + 40, 50, 6, k.health / 100, k.health < 30 ? "#f0647a" : k.health < 60 ? "#f2a93b" : "#6fd3a0", "#05070d");
    });
  }

  // Bank: the vault shows cash, the meters show how much credit, loans, overdraft and tax you owe.
  function drawBank(s) {
    const cash = balance(s.ledger, "cash"), od = balance(s.ledger, "overdraft"), b = s.bank, cr = b ? b.credit.bal : 0, loans = b ? b.loans.reduce((a, l) => a + l.balance, 0) : 0, tax = balance(s.ledger, "tax_payable");
    px(ctx, 0, 0, W, H, "#1b2236"); px(ctx, 0, 250, W, 70, "#3a3f4f");
    px(ctx, 40, 40, 250, 210, "#2c3a5e"); px(ctx, 30, 30, 270, 14, "#f2a93b"); for (let i = 0; i < 4; i++) px(ctx, 60 + i * 56, 56, 30, 150, "#e4dfd0"); px(ctx, 40, 206, 250, 10, "#9aa7c4"); px(ctx, 130, 216, 70, 34, "#10172b");
    txt(ctx, "BANK", 165, 20, 12, "#f2a93b", "center", 700);
    px(ctx, 330, 50, 140, 150, "#10172b"); px(ctx, 338, 58, 124, 134, "#232c47"); const open = cash > 0; px(ctx, 396, 112, 8, 8, open ? "#6fd3a0" : "#f0647a");
    txt(ctx, "VAULT", 400, 74, 10, "#9aa7c4"); txt(ctx, money(cash), 400, 150, cash > 99999 ? 14 : 18, cash >= 0 ? "#e9edf7" : "#f0647a", "center", 700);
    for (let i = 0; i < Math.min(6, Math.floor(Math.max(0, cash) / 10000)); i++) px(ctx, 346 + i * 18, 172, 14, 12, "#6fd3a0");
    const meters = [["Overdraft", od, BANK.overdraft.limit, "#f0647a"], ["Credit line", cr, BANK.credit.limit, "#f2a93b"], ["Loans", loans, Math.max(loans, 50000), "#6aa9ff"], ["Tax due", tax, Math.max(tax, 5000), "#c79bff"]];
    meters.forEach(([n, v, lim, col], i) => { const y = 56 + i * 46; txt(ctx, n.toUpperCase(), 490, y, 9, "#9aa7c4", "left"); bar(490, y + 8, 140, 10, lim ? v / lim : 0, col); txt(ctx, money(v), 630, y + 30, 10, v > 0 ? "#e9edf7" : "#6b7390", "right"); });
    txt(ctx, od > 0 ? "OVERDRAFT: repay now" : "ACCOUNT OK", 330, 222, 11, od > 0 ? "#f0647a" : "#6fd3a0", "left", 700);
    txt(ctx, `${b ? b.loans.length : 0} loan${b && b.loans.length === 1 ? "" : "s"} open`, 330, 238, 10, "#9aa7c4", "left");
  }

  const VIEWS = { store: drawStore, warehouse: drawWarehouse, city: drawCity, factory: drawFactory, yard: drawYard, bank: drawBank };
  function draw(s) {
    ctx.setTransform(canvas.width / W, 0, 0, canvas.width / W, 0, 0); ctx.imageSmoothingEnabled = false;
    (VIEWS[st.view] || drawStore)(s);
    if (s.ended) { px(ctx, 0, 0, W, H, "rgba(5,8,20,.6)"); txt(ctx, s.ended.reason === "bankrupt" ? "BANKRUPT" : "FINISHED", W / 2, H / 2, 22, "#f2a93b", "center", 700); }
  }
  let last = performance.now();
  function frame(now) { const dt = Math.min(0.1, (now - last) / 1000); last = now; const s = getState(); if (s) { update(dt, s); draw(s); } requestAnimationFrame(frame); }
  requestAnimationFrame(frame);
  return {
    reset() { st.shoppers = []; st.pings = []; st.inbound = []; st.outbound = []; st.cursor = null; st.saleQty = {}; st.lostSeen = null; },
    setView(v) { if (VIEWS[v]) st.view = v; },
    get view() { return st.view; },
  };
}
