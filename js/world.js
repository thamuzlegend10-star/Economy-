// Canvas renderer. Reads engine state only; never changes it (except via onOpen callbacks).
import * as D from "./data.js";
import * as E from "./engine.js";
import { lerp, clamp, ease, mix, shade, rr, text, shadow, chip, bubble, drawProduct, circle, ellipse, box, person, lookFor, truck, car, forklift, tree, catColor } from "./art.js";

const W = 960, H = 540;                 // canvas size
const WW = 1200, WH = 700;              // district world size
// Truck route from the supplier gate to the warehouse dock.
const ROUTE = [[200, 262], [200, 336], [575, 336], [575, 262]];
const SHOP_DOOR = [330, 424], WH_DOOR = [520, 262];
export const SCENES = ["district", "shop", "warehouse", "bank", "office"];

function along(path, f) {
  const lens = []; let total = 0;
  for (let i = 1; i < path.length; i++) { const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); lens.push(l); total += l; }
  let d = clamp(f, 0, 1) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) { const k = lens[i] ? d / lens[i] : 0; return { x: lerp(path[i][0], path[i + 1][0], k), y: lerp(path[i][1], path[i + 1][1], k), seg: i }; }
    d -= lens[i];
  }
}

export function createWorld(canvas, { getState, onOpen, onScene }) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  let scene = "district", clock = 0, last = performance.now();
  let cam = { x: 0, y: 0, z: 0.77 };
  let hotspots = [], hover = null, drag = null, mouse = { x: -1, y: -1 };
  const leaving = new Map();             // orderId -> time the truck started leaving
  const seenOrders = new Map();          // orderId -> last known order (to animate departure after receipt)
  const flashes = [];                    // {kind, t}
  let reduced = false;

  const minZ = () => Math.max(W / WW, H / WH) * 0.98;
  const fit = () => { cam.z = Math.min(W / WW, H / WH); cam.x = (W - WW * cam.z) / 2; cam.y = (H - WH * cam.z) / 2; };
  fit();
  const clampCam = () => {
    cam.z = clamp(cam.z, Math.min(W / WW, H / WH) * 0.98, 2.2);
    const vw = WW * cam.z, vh = WH * cam.z;
    cam.x = vw <= W ? (W - vw) / 2 : clamp(cam.x, W - vw, 0);
    cam.y = vh <= H ? (H - vh) / 2 : clamp(cam.y, H - vh, 0);
  };

  // ----- input -----
  const toLocal = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  const toWorld = p => ({ x: (p.x - cam.x) / cam.z, y: (p.y - cam.y) / cam.z });
  const hit = p => {
    const q = scene === "district" ? toWorld(p) : p;
    for (let i = hotspots.length - 1; i >= 0; i--) { const h = hotspots[i]; if (q.x >= h.x && q.x <= h.x + h.w && q.y >= h.y && q.y <= h.y + h.h) return h; }
    return null;
  };
  canvas.addEventListener("pointermove", e => {
    const p = toLocal(e); mouse = p;
    if (drag) { cam.x += p.x - drag.x; cam.y += p.y - drag.y; drag.moved += Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y); drag.x = p.x; drag.y = p.y; clampCam(); }
    hover = hit(p); canvas.style.cursor = hover ? "pointer" : scene === "district" ? "grab" : "default";
  });
  canvas.addEventListener("pointerdown", e => { if (scene === "district") { canvas.setPointerCapture(e.pointerId); drag = { ...toLocal(e), moved: 0 }; } });
  canvas.addEventListener("pointerup", e => {
    const wasDrag = drag && drag.moved > 6; drag = null;
    if (wasDrag) return;
    const h = hit(toLocal(e));
    if (h) activate(h);
  });
  canvas.addEventListener("pointerleave", () => { hover = null; mouse = { x: -1, y: -1 }; });
  canvas.addEventListener("wheel", e => {
    if (scene !== "district") return;
    e.preventDefault();
    const p = toLocal(e), before = toWorld(p);
    cam.z *= e.deltaY < 0 ? 1.12 : 1 / 1.12; clampCam();
    cam.x = p.x - before.x * cam.z; cam.y = p.y - before.y * cam.z; clampCam();
  }, { passive: false });

  function activate(h) {
    if (h.scene) setScene(h.scene);
    else if (h.panel) onOpen(h.panel);
  }
  function setScene(name) { if (!SCENES.includes(name)) return; scene = name; hover = null; hotspots = []; if (name === "district") fit(); onScene && onScene(name); }

  // ----- frame -----
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!reduced) clock += dt; else clock += dt * 0.0001;
    const s = getState();
    if (!s) return;
    trackOrders(s);
    hotspots = [];
    ctx.clearRect(0, 0, W, H);
    ({ district: drawDistrict, shop: drawShop, warehouse: drawWarehouse, bank: drawBank, office: drawOffice })[scene](s);
    drawTooltip();
    for (let i = flashes.length - 1; i >= 0; i--) { flashes[i].t -= dt; if (flashes[i].t <= 0) flashes.splice(i, 1); }
  }
  function trackOrders(s) {
    const ids = new Set(s.orders.map(o => o.id));
    for (const o of s.orders) seenOrders.set(o.id, { ...o });
    for (const [id, o] of seenOrders) if (!ids.has(id)) { if (o.status !== "processing" && !leaving.has(id) && s.doneOrders.some(d => d.id === id)) leaving.set(id, clock); seenOrders.delete(id); }
    for (const [id, t0] of leaving) if (clock - t0 > 4) leaving.delete(id);
  }
  function hs(x, y, w, h, label, target, outline = true) {
    const o = { x, y, w, h, label, ...target };
    hotspots.push(o);
    const q = scene === "district" ? toWorld(mouse) : mouse;
    if (outline && q.x >= x && q.x <= x + w && q.y >= y && q.y <= y + h) { ctx.save(); ctx.strokeStyle = "#ffd36b"; ctx.lineWidth = 3 / (scene === "district" ? cam.z : 1); ctx.setLineDash([8, 5]); ctx.strokeRect(x, y, w, h); ctx.restore(); }
  }
  function drawTooltip() {
    if (!hover || mouse.x < 0) return;
    chip(ctx, clamp(mouse.x, 70, W - 70), mouse.y - 16, hover.label, { size: 13 });
  }
  const todFrac = s => s.clock / D.DAY_LEN;
  const night = s => { const t = todFrac(s); return t < 0.6 ? 0 : t < 0.8 ? (t - 0.6) / 0.2 : t < 0.93 ? 1 : (1 - t) / 0.07; };
  const hourText = s => { const mins = Math.floor(D.OPEN_HOUR * 60 + todFrac(s) * (D.CLOSE_HOUR - D.OPEN_HOUR) * 60); return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`; };

  // =====================================================================
  // DISTRICT
  // =====================================================================
  function drawDistrict(s) {
    const n = night(s), t = todFrac(s);
    ctx.save(); ctx.translate(cam.x, cam.y); ctx.scale(cam.z, cam.z);
    // ground
    const g = ctx.createLinearGradient(0, 0, 0, WH); g.addColorStop(0, mix("#3b8a5a", "#1f4a38", n)); g.addColorStop(1, mix("#2f7a4e", "#183a2d", n));
    ctx.fillStyle = g; ctx.fillRect(0, 0, WW, WH);
    ctx.fillStyle = "rgba(255,255,255,.04)"; for (let x = 0; x < WW; x += 60) for (let y = (x / 60 % 2) * 30; y < WH; y += 60) ctx.fillRect(x, y, 30, 30);
    // sidewalks + road
    ctx.fillStyle = "#b8b6ad"; ctx.fillRect(0, 268, WW, 36); ctx.fillRect(0, 368, WW, 36);
    ctx.fillStyle = "#3a3f55"; ctx.fillRect(0, 304, WW, 64);
    ctx.fillStyle = "#e8e0b0"; for (let x = 10; x < WW; x += 70) ctx.fillRect(x, 334, 38, 4);
    ctx.fillStyle = "rgba(255,255,255,.4)"; for (let x = 520; x < 620; x += 14) ctx.fillRect(x, 306, 8, 60);   // crossing
    // plaza between shop and bank
    rr(ctx, 540, 420, 140, 200, 14, mix("#c9c3b2", "#4a4a58", n));
    circle(ctx, 610, 520, 34, "#6aa9d8"); circle(ctx, 610, 520, 22, "#8fc4ec"); circle(ctx, 610, 520, 5, "#e8f4ff");
    tree(ctx, 560, 470, 0.9); tree(ctx, 665, 600, 1); tree(ctx, 45, 400, 1); tree(ctx, 1130, 600, 1.1); tree(ctx, 1150, 420, 0.9); tree(ctx, 40, 640, 1.1);

    drawDepot(s, n); drawWarehouseBuilding(s, n); drawOfficeBuilding(s, n); drawShopBuilding(s, n); drawBankBuilding(s, n);

    // ambient traffic
    const cars = [["#e5383b", 0, 40], ["#4a90e2", 1, 55], ["#f2c230", 0, 35]];
    cars.forEach(([c, lane, sp], i) => {
      const x = ((clock * sp * (lane ? -1 : 1) + i * 420) % (WW + 200) + (WW + 200)) % (WW + 200) - 100;
      car(ctx, x, lane ? 322 : 358, c, lane ? -1 : 1);
    });

    // trucks
    for (const o of s.orders) drawOrderTruck(o);
    for (const [id, t0] of leaving) { const f = (clock - t0) / 4; const p = along([...ROUTE].reverse(), f); truck(ctx, p.x, p.y + 8, { dir: p.seg === 1 ? 1 : -1, moving: true, t: clock, label: "DELIVERY", scale: 0.55, lights: n > 0.4 }); }

    // workers on the road: stockers shuttle goods from the warehouse to the shop while restock tasks run
    if (s.tasks.length) {
      const workers = Math.max(1, Math.min(3, s.staff.filter(x => x.role === "stocker").length));
      const path = [[WH_DOOR[0], 268], [WH_DOOR[0], 386], [SHOP_DOOR[0], 386], [SHOP_DOOR[0], SHOP_DOOR[1] - 6]];
      for (let i = 0; i < workers; i++) {
        const f = ((clock * 0.12 + i / workers) % 1), out = f < 0.5, p = along(path, out ? f * 2 : (1 - f) * 2);
        person(ctx, p.x, p.y + 20, lookFor(77 + i), { role: "stocker", walk: clock * 9, carry: out, scale: 0.55, flip: !out && p.seg === 1 ? false : false });
      }
    }
    // customers walking to the shop
    for (const c of s.customers) {
      if (c.state === "enter") { const k = ease(c.t / 2.5); person(ctx, lerp(-20, SHOP_DOOR[0], k), 388 + 22 - k * 0, lookFor(c.look), { walk: clock * 9 + c.id, scale: 0.5 }); }
      else if (c.state === "leave") { const k = ease(c.t / 2.5); person(ctx, lerp(SHOP_DOOR[0], 220, k), 410, lookFor(c.look), { walk: clock * 9 + c.id, scale: 0.5, flip: true }); }
    }
    // overlay for night
    if (n > 0) { ctx.fillStyle = `rgba(6,10,40,${0.45 * n})`; ctx.fillRect(0, 0, WW, WH); }
    ctx.restore();
    // HUD bits (screen space)
    chip(ctx, 62, 28, hourText(s) + (n > 0.5 ? "  night" : t < 0.25 ? "  morning" : t < 0.6 ? "  day" : "  evening"), { size: 13 });
    chip(ctx, W - 100, 28, "Drag to pan · wheel to zoom", { size: 11, bg: "rgba(10,14,36,.6)" });
  }

  function drawOrderTruck(o) {
    const lead = o.lead, st = o.status;
    const drive = (f, rev) => along(rev ? [...ROUTE].reverse() : ROUTE, f);
    let p, moving = false, open = false, cargo = Math.min(8, Math.ceil(o.units / 6));
    if (st === "processing") { p = { x: 190, y: 262, seg: 0 }; open = true; }                      // loading at depot
    else if (st === "en route" || st === "arriving") { const f = clamp((o.t - 0.25 * lead) / (0.55 * lead), 0, 1); p = drive(f); moving = f < 1; }
    else { p = { x: ROUTE[3][0], y: ROUTE[3][1], seg: 2 }; open = st === "unloading"; }
    const dir = p.seg === 1 ? 1 : p.seg === 0 ? 1 : p.seg === 2 ? -1 : -1;
    truck(ctx, p.x, p.y + 8, { dir: st === "processing" ? -1 : dir, moving, t: clock, label: o.supplier === "quickship" ? "QUICKSHIP" : "DELIVERY", scale: 0.55, open, cargo });
    if (st !== "en route" || true) chip(ctx, p.x, p.y - 56, `#${o.id} ${st === "dock-wait" ? "waiting for dock" : st}`, { size: 11 });
  }

  function building(x, y, w, h, roof, wall, nightK) {
    shadow(ctx, x + w / 2, y + h + 6, w / 2 + 10, 10, 0.3);
    rr(ctx, x, y, w, 34, [8, 8, 0, 0], roof);                           // roof strip (depth)
    rr(ctx, x, y + 26, w, h - 26, [0, 0, 4, 4], wall);
    ctx.fillStyle = "rgba(0,0,0,.12)"; ctx.fillRect(x, y + 26, w, 8);
  }
  function windowRow(x, y, n, w, h, gap, nightK, lit = true) {
    for (let i = 0; i < n; i++) {
      const lx = x + i * (w + gap);
      rr(ctx, lx, y, w, h, 4, nightK > 0.3 && lit ? "#ffe9a8" : "#a9d6f5", "#1a1d3f");
      ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(lx + 3, y + 3, w / 2 - 3, h - 6);
    }
  }
  function drawDepot(s, n) {
    building(60, 70, 280, 192, "#6d7488", "#9aa2b8", n);
    for (let i = 0; i < 3; i++) { rr(ctx, 82 + i * 82, 150, 62, 100, 3, "#555d74"); ctx.fillStyle = "#3f465c"; for (let k = 0; k < 6; k++) ctx.fillRect(82 + i * 82, 156 + k * 15, 62, 3); }
    text(ctx, "SUPPLIER DEPOT", 200, 98, { size: 15, color: "#fff" });
    chip(ctx, 200, 132, `${s.orders.length} order${s.orders.length === 1 ? "" : "s"} on the way`, { size: 11 });
    box(ctx, 72, 238, 22, 20); box(ctx, 96, 238, 22, 20, "#b9824a"); box(ctx, 84, 218, 22, 20);
    hs(60, 70, 280, 192, "Supplier depot: place orders", { panel: "procure" });
  }
  function drawWarehouseBuilding(s, n) {
    const fill = E.whUsed(s) / E.whCap(s);
    building(420, 70, 300 + s.upgrades.racks * 14, 192, "#8a6a4a", "#c9a36e", n);
    const bays = 2 + s.upgrades.dock;
    for (let i = 0; i < bays; i++) { const bx = 450 + i * (230 / bays + 8); rr(ctx, bx, 150, 210 / bays + 10, 100, 3, "#5b4630"); ctx.fillStyle = "#3d2f20"; for (let k = 0; k < 6; k++) ctx.fillRect(bx, 156 + k * 15, 210 / bays + 10, 3); }
    text(ctx, "WAREHOUSE", 570, 98, { size: 15, color: "#fff" });
    rr(ctx, 460, 112, 220, 12, 6, "rgba(0,0,0,.35)"); rr(ctx, 460, 112, 220 * clamp(fill, 0, 1), 12, 6, fill > 0.85 ? "#ff6b6b" : "#5eead4");
    text(ctx, `${E.whUsed(s)}/${E.whCap(s)} stored`, 570, 140, { size: 11, color: "#fff" });
    if (s.upgrades.racks) rr(ctx, 720, 140, 14 * s.upgrades.racks + 6, 112, 3, "#a78457");
    hs(420, 70, 300, 192, "Warehouse: inventory and receiving", { scene: "warehouse" });
  }
  function drawOfficeBuilding(s, n) {
    building(820, 90, 260, 172, "#44527a", "#7d8fc0", n);
    windowRow(840, 132, 4, 42, 52, 12, n); windowRow(840, 196, 4, 42, 40, 12, n);
    text(ctx, "OFFICE", 950, 118, { size: 15, color: "#fff" });
    rr(ctx, 935, 208, 30, 54, 3, "#2b2f5e");
    hs(820, 90, 260, 172, "Office: staff, reports, upgrades", { scene: "office" });
  }
  function drawShopBuilding(s, n) {
    building(130, 424, 380, 190, "#c0504d", "#f1e3c8", n);
    for (let i = 0; i < 13; i++) rr(ctx, 130 + i * 29.2, 424, 29.2, 40, [0, 0, 12, 12], i % 2 ? "#f6efe3" : "#e5383b");
    const sg = s.upgrades.signage;
    rr(ctx, 205, 466, 250, 40, 8, sg >= 1 ? "#14213d" : "#3a2a1a", sg >= 2 ? "#ffb84d" : "#6b4220");
    if (sg >= 1 && n > 0) { ctx.fillStyle = "rgba(255,200,90,.25)"; ctx.fillRect(195, 460, 270, 56); }
    text(ctx, "CORNER SHOP", 330, 494, { size: 20, color: sg >= 1 ? "#ffd36b" : "#f6efe3", weight: 800 });
    windowRow(150, 520, 2, 70, 64, 10, n); windowRow(380, 520, 2, 56, 64, 10, n);
    // shelves visible through windows
    ctx.fillStyle = "rgba(60,40,20,.5)"; ctx.fillRect(154, 556, 62, 4); ctx.fillRect(228, 556, 62, 4);
    rr(ctx, 304, 522, 52, 92, [6, 6, 0, 0], "#5b3a1e"); circle(ctx, 346, 570, 3, "#ffd36b");
    const q = s.customers.filter(c => ["queue", "pay"].includes(c.state)).length, inside = s.customers.filter(c => ["browse", "queue", "pay"].includes(c.state)).length;
    chip(ctx, 330, 412, `${inside} inside · ${q} at checkout`, { size: 11 });
    hs(130, 424, 380, 190, "Shop: open the store floor", { scene: "shop" });
  }
  function drawBankBuilding(s, n) {
    building(700, 424, 330, 190, "#4a5a6a", "#e8e4d8", n);
    ctx.fillStyle = "#d6d0be"; ctx.beginPath(); ctx.moveTo(690, 452); ctx.lineTo(865, 410); ctx.lineTo(1040, 452); ctx.closePath(); ctx.fill();
    for (let i = 0; i < 5; i++) rr(ctx, 725 + i * 62, 458, 16, 150, 3, "#f6f2e6", "#b9b39c");
    rr(ctx, 790, 428, 150, 26, 6, "#1d2f55"); text(ctx, "CITY BANK", 865, 447, { size: 15, color: "#ffd36b", weight: 800 });
    rr(ctx, 840, 530, 50, 84, [6, 6, 0, 0], "#2b2f5e"); windowRow(745, 505, 1, 50, 50, 0, n); windowRow(930, 505, 1, 50, 50, 0, n);
    rr(ctx, 1000, 540, 26, 50, 4, "#3b6fd4"); text(ctx, "ATM", 1013, 560, { size: 9 });
    hs(700, 424, 330, 190, "Bank: deposits, loans, history", { scene: "bank" });
  }

  // =====================================================================
  // SHOP INTERIOR
  // =====================================================================
  const SLOT_W = 140, FLOOR_Y = 360;
  function slotPos(i) { return { x: 70 + (i % 6) * SLOT_W, plank: Math.floor(i / 6) }; }
  function drawShop(s) {
    const n = night(s);
    // wall + floor
    let g = ctx.createLinearGradient(0, 0, 0, FLOOR_Y); g.addColorStop(0, "#3b3f78"); g.addColorStop(1, "#2a2d5c");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, FLOOR_Y);
    ctx.fillStyle = "rgba(255,255,255,.035)"; for (let y = 60; y < FLOOR_Y; y += 28) for (let x = (y / 28 % 2) * 30; x < W; x += 60) ctx.fillRect(x, y, 56, 24);
    g = ctx.createLinearGradient(0, FLOOR_Y, 0, H); g.addColorStop(0, "#6a4a30"); g.addColorStop(1, "#46301f"); ctx.fillStyle = g; ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
    ctx.strokeStyle = "rgba(0,0,0,.22)"; for (let x = 0; x < W; x += 80) { ctx.beginPath(); ctx.moveTo(x, FLOOR_Y); ctx.lineTo(x - 36, H); ctx.stroke(); }
    rr(ctx, 0, FLOOR_Y - 6, W, 8, 0, "#2a1a10");
    // awning strip
    for (let i = 0; i < 12; i++) rr(ctx, i * 80, 0, 80, 36, [0, 0, 16, 16], i % 2 ? "#f6efe3" : "#e5383b");
    // lamp glow
    const glow = ctx.createRadialGradient(480, 80, 5, 480, 200, 420); glow.addColorStop(0, `rgba(255,214,140,${0.22 + n * 0.3})`); glow.addColorStop(1, "rgba(255,214,140,0)"); ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    // shelves: first 2 planks hold products; extra upgrade rows show bulk stock
    const planks = 2 + s.upgrades.shelves, shown = D.PRODUCTS;
    const plankY = i => 70 + i * 62;
    for (let i = 0; i < planks; i++) { rr(ctx, 46, plankY(i) + 50, 868, 10, 4, "#8d5a2b"); rr(ctx, 46, plankY(i) + 60, 868, 5, 0, "rgba(0,0,0,.3)"); }
    rr(ctx, 40, 62, 8, planks * 62 + 6, 3, "#6b4220"); rr(ctx, 912, 62, 8, planks * 62 + 6, 3, "#6b4220");
    const fillAll = E.shelfUsed(s) / E.shelfCap(s);
    for (let i = 2; i < planks; i++) { const cnt = Math.round(24 * clamp(fillAll * 1.5, 0, 1)); for (let k = 0; k < cnt; k++) box(ctx, 62 + k * 35, plankY(i) + 24, 28, 26, ["#c9945a", "#d9a05b", "#b9824a"][k % 3]); }
    shown.forEach((p, i) => {
      const { x, plank } = slotPos(i), y = plankY(plank), unlocked = E.isUnlocked(s, p.id), st = s.stock[p.id];
      if (!unlocked) { rr(ctx, x, y + 6, SLOT_W - 12, 42, 6, "rgba(0,0,0,.28)"); text(ctx, `${p.name} unlocks day ${p.unlockDay}`, x + (SLOT_W - 12) / 2, y + 32, { size: 10, color: "#a9b3cf", weight: 600 }); return; }
      const cap = 16, show = Math.min(st.shelf, cap);
      for (let k = 0; k < show; k++) drawProduct(ctx, p.id, x + 14 + (k % 8) * 15, y + 38 - Math.floor(k / 8) * 20, 0.75);
      const low = st.shelf === 0 ? "#ff6b6b" : st.shelf < 4 ? "#ffb84d" : "#5eead4";
      rr(ctx, x, y + 52 - 0, SLOT_W - 12, 0.1, 0, null);
      text(ctx, `${p.name}  ${st.shelf}`, x + (SLOT_W - 12) / 2, y + 10, { size: 11, color: low });
      text(ctx, `$${s.prices[p.id].toFixed(2)}`, x + (SLOT_W - 12) / 2, y + 62 + 12, { size: 10, color: "#f6efe3", weight: 600 });
      if (st.shelf === 0) text(ctx, "EMPTY", x + (SLOT_W - 12) / 2, y + 36, { size: 13, color: "#ff6b6b", weight: 800 });
    });
    hs(40, 60, 880, planks * 62, "Store management: prices and shelves", { panel: "store" });

    // back-room door (restock source)
    rr(ctx, 872, 214, 70, 132, [8, 8, 0, 0], "#2b2f5e", "#6b4220"); text(ctx, "BACK ROOM", 907, 236, { size: 9, color: "#a9b3cf" });
    hs(870, 212, 74, 134, "Warehouse back room", { scene: "warehouse" });

    // door
    rr(ctx, 16, 240, 70, 120, [8, 8, 0, 0], "#5b3a1e"); circle(ctx, 74, 306, 3, "#ffd36b"); text(ctx, "ENTRANCE", 51, 262, { size: 9, color: "#e8d9b8" });

    // checkout lanes
    const lanes = E.laneCount(s), laneX = i => 560 + i * 110;
    const cashiers = s.staff.filter(x => x.role === "cashier");
    for (let i = 0; i < 1 + s.upgrades.counter; i++) {
      const x = laneX(i);
      const worker = cashiers[i] ? { role: "cashier", look: lookFor(cashiers[i].id * 31) } : i === 0 ? { role: "owner", look: lookFor(5) } : null;
      if (worker) person(ctx, x + 40, 300, worker.look, { role: worker.role, scale: 0.95 });
      rr(ctx, x, 290, 90, 70, [8, 8, 0, 0], "#9a6431"); rr(ctx, x, 290, 90, 10, [8, 8, 0, 0], "#c68a4c");
      rr(ctx, x + 8, 262, 36, 28, 5, "#2a2d5c"); rr(ctx, x + 12, 266, 28, 10, 2, "#5eead4");
      rr(ctx, x + 56, 276, 26, 14, 3, "#2b2f5e");
    }
    hs(550, 250, 110 * (1 + s.upgrades.counter), 112, "Checkout (cash goes to the till)", { panel: "bank" });

    // stockers
    const tasks = s.tasks[0], stockers = s.staff.filter(x => x.role === "stocker");
    const nStock = tasks ? Math.max(1, stockers.length) : stockers.length;
    for (let i = 0; i < nStock; i++) {
      const look = lookFor(stockers[i] ? stockers[i].id * 17 : 3);
      if (tasks) {
        const idx = D.PRODUCTS.findIndex(p => p.id === tasks.pid), tx = slotPos(idx).x + 55;
        const f = (clock * 0.22 + i * 0.37) % 1, out = f < 0.5, k = out ? f * 2 : (1 - f) * 2;
        const pos = lerp(890, tx, ease(k));
        const atShelf = k > 0.97;
        person(ctx, pos, FLOOR_Y + 90 - i * 18, look, { role: "stocker", walk: clock * 9, carry: out, flip: !out, moving: !atShelf, scale: 1 });
      } else person(ctx, 800 + i * 40, FLOOR_Y + 70, look, { role: "stocker", moving: false });
    }
    if (s.staff.some(x => x.role === "manager")) person(ctx, 480, FLOOR_Y + 20, lookFor(900), { role: "manager", moving: false, scale: 0.95 });

    // customers
    const queue = s.customers.filter(c => c.state === "queue");
    for (const c of s.customers) {
      const look = lookFor(c.look), wantIdx = c.want.length ? D.PRODUCTS.findIndex(p => p.id === c.want[Math.floor(clock / 2.5 + c.id) % c.want.length]) : 0;
      const shelfX = slotPos(Math.max(0, wantIdx)).x + 55, yy = FLOOR_Y + 70 + (c.id % 4) * 22;
      let x, y = yy, flip = false, moving = true, label = null, pid = null;
      if (c.state === "enter") { const k = ease(c.t / 2.5); x = lerp(50, shelfX, k); y = lerp(FLOOR_Y + 40, yy, k); moving = k < 0.98; }
      else if (c.state === "browse") { x = shelfX; moving = false; label = null; pid = null; if ((c.t % 2.2) < 1.2) { label = D.PRODUCTS[wantIdx]?.name || ""; pid = D.PRODUCTS[wantIdx]?.id; } }
      else if (c.state === "queue") { const qi = queue.indexOf(c); x = 540 - qi * 40; y = FLOOR_Y + 60; moving = false; if (qi === 0 && c.wait > 10) label = "Hurry up?"; }
      else if (c.state === "pay") { x = laneX(c.lane) + 40; y = 378; moving = false; label = null; }
      else { const k = ease(c.t / 2.5); x = lerp(laneX(Math.max(0, c.lane)) + 20, 50, k); y = lerp(FLOOR_Y + 40, FLOOR_Y + 60, k); flip = true; }
      person(ctx, x, y, look, { walk: clock * 9 + c.id, moving, flip, carry: false });
      if (c.basket.length && c.state !== "gone" && !["browse"].includes(c.state)) box(ctx, x - 10, y - 58, 20, 16);
      if (label) bubble(ctx, x, y - 100, label, pid);
    }
    // night tint through window? minor: sign
    if (s.upgrades.signage) text(ctx, "OPEN", 480, 24, { size: 14, color: "#ffd36b", weight: 800 });
    chip(ctx, 62, 62 + planks * 62 + 18, hourText(s), { size: 12 });
    const wait = s.customers.filter(c => c.state === "queue").length;
    chip(ctx, 62 + 150, 62 + planks * 62 + 18, `Queue ${wait}  ·  lanes ${lanes}`, { size: 12 });
    drawFlashes();
  }

  // =====================================================================
  // WAREHOUSE INTERIOR
  // =====================================================================
  function drawWarehouse(s) {
    let g = ctx.createLinearGradient(0, 0, 0, 340); g.addColorStop(0, "#464b63"); g.addColorStop(1, "#33374d");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 340);
    ctx.fillStyle = "rgba(255,255,255,.04)"; for (let x = 0; x < W; x += 40) ctx.fillRect(x, 0, 2, 340);
    g = ctx.createLinearGradient(0, 340, 0, H); g.addColorStop(0, "#7a7d88"); g.addColorStop(1, "#5a5d68"); ctx.fillStyle = g; ctx.fillRect(0, 340, W, H - 340);
    ctx.fillStyle = "#f2c230"; for (let x = 0; x < W; x += 60) ctx.fillRect(x, 470, 36, 6);       // floor markings
    ctx.fillStyle = "#f2c230"; ctx.fillRect(0, 338, W, 4);
    // ceiling lights
    for (let i = 0; i < 5; i++) { rr(ctx, 80 + i * 190, 10, 90, 8, 4, "#fff6c8"); const gl = ctx.createRadialGradient(125 + i * 190, 20, 3, 125 + i * 190, 120, 180); gl.addColorStop(0, "rgba(255,246,200,.25)"); gl.addColorStop(1, "rgba(255,246,200,0)"); ctx.fillStyle = gl; ctx.fillRect(i * 190 - 40, 0, 330, 300); }

    // racks: bays grow with upgrades
    const bays = 4 + 2 * s.upgrades.racks, bw = Math.min(110, 700 / bays), levels = 3;
    const cats = Object.keys(D.CATEGORIES);
    const catUnits = Object.fromEntries(cats.map(c => [c, D.PRODUCTS.filter(p => p.cat === c).reduce((a, p) => a + s.stock[p.id].wh, 0)]));
    const totalSlots = bays * levels * 6, stored = E.whUsed(s), filled = Math.round(totalSlots * clamp(stored / E.whCap(s), 0, 1));
    const seq = []; for (const c of cats) { const share = stored ? catUnits[c] / stored : 0; for (let i = 0; i < Math.round(share * filled); i++) seq.push(c); }
    let idx = 0;
    for (let b = 0; b < bays; b++) {
      const bx = 30 + b * (bw + 6);
      rr(ctx, bx, 70, 6, 258, 2, "#e8782e"); rr(ctx, bx + bw, 70, 6, 258, 2, "#e8782e");
      for (let l = 0; l < levels; l++) {
        const ly = 70 + (l + 1) * 84 - 12;
        rr(ctx, bx, ly + 8, bw + 6, 8, 2, "#3b6fd4");
        for (let k = 0; k < 6; k++) { const cat = seq[idx++]; if (!cat) continue; box(ctx, bx + 4 + (k % 3) * (bw / 3.1), ly - 22 - Math.floor(k / 3) * 26 + 18, bw / 3.4, 24, shade(catColor(cat), 0.9)); }
      }
    }
    hs(24, 64, bays * (bw + 6) + 8, 270, "Racks: inventory by location", { panel: "inventory" });

    // dock on the right
    const docks = 1 + s.upgrades.dock;
    for (let d = 0; d < docks; d++) { const dx = 810 - d * 0, dy = 120 + d * 130; rr(ctx, dx, dy, 130, 120, [6, 6, 0, 0], "#2a2d3c", "#f2c230"); text(ctx, `DOCK ${d + 1}`, dx + 65, dy - 6, { size: 11, color: "#f2c230" }); ctx.fillStyle = "#3b3f55"; for (let k = 0; k < 7; k++) ctx.fillRect(dx, dy + 6 + k * 16, 130, 3); }
    const unl = s.orders.filter(o => o.status === "unloading");
    unl.forEach((o, i) => {
      const dy = 120 + i * 130, prog = 1 - clamp(o.u / (o.units / (8 * (1 + (s.upgrades.dock ? 0.5 : 0)))), 0, 1);
      truck(ctx, 960 - 20, dy + 114, { dir: -1, label: o.supplier === "quickship" ? "QUICKSHIP" : "DELIVERY", open: true, cargo: Math.max(0, Math.ceil((1 - prog) * 8)), scale: 0.75 });
      const wk = s.staff.filter(x => x.role === "warehouse");
      const nW = Math.max(1, wk.length);
      for (let w = 0; w < nW; w++) {
        const f = (clock * 0.28 + w * 0.5) % 1, out = f < 0.5, k = out ? f * 2 : (1 - f) * 2;
        person(ctx, lerp(790, 520, ease(k)), 400 + w * 30 + i * 4, lookFor(wk[w] ? wk[w].id * 13 : 9), { role: wk[w] ? "warehouse" : "owner", walk: clock * 9, carry: !out, flip: !out, scale: 0.95 });
      }
    });
    if (unl.length) forklift(ctx, 640 + Math.sin(clock * 0.9) * 90, 465, { dir: Math.cos(clock * 0.9) > 0 ? 1 : -1, load: Math.sin(clock * 0.9) > 0 });
    else forklift(ctx, 700, 470, { dir: -1 });
    for (const o of s.orders.filter(o => o.status === "dock-wait")) chip(ctx, 880, 108, `#${o.id} waiting for a free dock`, { size: 11, bg: "rgba(255,107,107,.85)" });
    hs(805, 100, 150, 260, "Loading dock: order stock", { panel: "procure" });

    // office corner + capacity board
    rr(ctx, 30, 360, 250, 120, 8, "#2a2d3c"); rr(ctx, 40, 370, 230, 90, 6, "#1a1d2c");
    text(ctx, "WAREHOUSE", 155, 392, { size: 12, color: "#a9b3cf" });
    text(ctx, `${stored} / ${E.whCap(s)} units`, 155, 420, { size: 20, color: "#5eead4", weight: 800 });
    rr(ctx, 56, 436, 198, 12, 6, "rgba(255,255,255,.12)"); rr(ctx, 56, 436, 198 * clamp(stored / E.whCap(s), 0, 1), 12, 6, stored / E.whCap(s) > 0.85 ? "#ff6b6b" : "#5eead4");
    text(ctx, `+${E.incomingUnits(s)} incoming`, 155, 472, { size: 11, color: "#a9b3cf", weight: 600 });
    hs(30, 360, 250, 120, "Inventory report", { panel: "inventory" });
    // legend
    cats.forEach((c, i) => { rr(ctx, 300 + i * 100, 372, 12, 12, 3, catColor(c)); text(ctx, D.CATEGORIES[c].name, 318 + i * 100, 383, { size: 10, align: "left", weight: 600 }); });
    chip(ctx, 62, 524, hourText(s), { size: 12 });
    drawFlashes();
  }

  // =====================================================================
  // BANK INTERIOR
  // =====================================================================
  function drawBank(s) {
    let g = ctx.createLinearGradient(0, 0, 0, 330); g.addColorStop(0, "#e8e4d8"); g.addColorStop(1, "#d6d0be"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 330);
    for (let i = 0; i < 6; i++) rr(ctx, 40 + i * 160, 40, 18, 290, 3, "#f6f2e6", "#b9b39c");
    g = ctx.createLinearGradient(0, 330, 0, H); g.addColorStop(0, "#3d5a4a"); g.addColorStop(1, "#2a4034"); ctx.fillStyle = g; ctx.fillRect(0, 330, W, H - 330);
    ctx.fillStyle = "rgba(255,255,255,.06)"; for (let x = 0; x < W; x += 80) for (let y = 330; y < H; y += 60) ctx.fillRect(x + ((y / 60) % 2) * 40, y, 40, 30);
    rr(ctx, 330, 12, 300, 34, 8, "#1d2f55"); text(ctx, "CITY BANK", 480, 36, { size: 18, color: "#ffd36b", weight: 800 });
    // vault
    rr(ctx, 790, 70, 140, 160, 10, "#4b5260", "#2a2d3c"); circle(ctx, 860, 150, 44, "#6b7385"); circle(ctx, 860, 150, 30, "#4b5260"); ctx.strokeStyle = "#d6d9e0"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(860, 120); ctx.lineTo(860, 180); ctx.moveTo(830, 150); ctx.lineTo(890, 150); ctx.stroke();
    text(ctx, "VAULT", 860, 252, { size: 11, color: "#4b5260" });
    hs(780, 60, 160, 200, "Vault: financial reports", { panel: "finance" });
    // teller counter with glass
    rr(ctx, 260, 150, 480, 120, 8, "#7a5632"); rr(ctx, 260, 150, 480, 14, 8, "#a8793f");
    for (let i = 0; i < 2; i++) { const tx = 340 + i * 220; person(ctx, tx, 190, lookFor(11 + i), { role: "manager", moving: false, scale: 0.88, flip: i === 1 }); rr(ctx, tx - 56, 100, 112, 80, 6, "rgba(190,230,255,.22)", "rgba(255,255,255,.5)"); rr(ctx, tx - 20, 168, 40, 16, 3, "#2a2d5c"); }
    text(ctx, "TELLER", 340, 262, { size: 11, color: "#f6efe3" }); text(ctx, "TELLER", 560, 262, { size: 11, color: "#f6efe3" });
    hs(260, 90, 480, 180, "Teller: deposit and withdraw", { panel: "bank" });
    // loan officer desk
    rr(ctx, 40, 150, 180, 100, 8, "#6b4220"); rr(ctx, 40, 150, 180, 12, 8, "#9a6431"); person(ctx, 130, 176, lookFor(31), { role: "manager", sit: true, moving: false, scale: 0.88 });
    rr(ctx, 70, 120, 56, 36, 4, "#1a1d3f", "#5eead4"); text(ctx, "LOANS", 98, 143, { size: 10, color: "#5eead4" });
    text(ctx, "LOAN OFFICER", 130, 270, { size: 11 });
    hs(30, 100, 200, 170, "Loan officer: borrow and repay", { panel: "bank" });
    // ATM
    rr(ctx, 700, 280, 54, 84, 6, "#3b6fd4"); rr(ctx, 708, 288, 38, 26, 3, "#1a1d3f"); rr(ctx, 710, 322, 34, 24, 3, "#2a4d99"); text(ctx, "ATM", 727, 378, { size: 10 });
    hs(696, 276, 62, 100, "ATM: quick deposit", { panel: "bank" });
    // queue + seating
    for (let i = 0; i < 3; i++) rr(ctx, 60 + i * 120, 400, 100, 36, 8, "#5b3a1e");
    const waiters = (s.day + Math.floor(clock / 6)) % 4;
    for (let i = 0; i < waiters; i++) person(ctx, 430 - i * 44, 420, lookFor(200 + i + s.day), { moving: false, scale: 0.9 });
    const k = (clock % 8) / 8; if (k < 0.5) person(ctx, lerp(300, 340, ease(k * 2)), 290 + 40, lookFor(77), { walk: clock * 9, moving: k < 0.45, scale: 0.9 });
    chip(ctx, 480, 504, `Cash ${fmtMoney(s.derived.cash)}   Bank ${fmtMoney(s.derived.bank)}   Debt ${fmtMoney(s.derived.debt)}`, { size: 13 });
    drawFlashes();
  }

  // =====================================================================
  // OFFICE INTERIOR
  // =====================================================================
  function drawOffice(s) {
    let g = ctx.createLinearGradient(0, 0, 0, 340); g.addColorStop(0, "#d9dfef"); g.addColorStop(1, "#bcc5de"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 340);
    g = ctx.createLinearGradient(0, 340, 0, H); g.addColorStop(0, "#5d6a8f"); g.addColorStop(1, "#444f72"); ctx.fillStyle = g; ctx.fillRect(0, 340, W, H - 340);
    // window
    rr(ctx, 40, 50, 200, 150, 8, "#a9d6f5", "#44527a"); ctx.fillStyle = "#44527a"; ctx.fillRect(138, 50, 4, 150); ctx.fillStyle = "#6a7da8"; ctx.fillRect(48, 150, 40, 50); ctx.fillRect(100, 120, 30, 80); ctx.fillRect(160, 140, 60, 60);
    // KPI board with net-worth chart
    rr(ctx, 300, 40, 380, 190, 10, "#f6f2e6", "#44527a");
    text(ctx, "NET WORTH", 330, 66, { size: 12, color: "#44527a", align: "left" }); text(ctx, fmtMoney(s.derived.netWorth), 650, 66, { size: 16, color: "#2f9e6e", align: "right", weight: 800 });
    const hist = s.history.map(h => h.netWorth).concat([s.derived.netWorth]);
    const lo = Math.min(...hist, s.startNetWorth) * 0.95, hi = Math.max(...hist, s.startNetWorth) * 1.05 || 1;
    ctx.strokeStyle = "#2f9e6e"; ctx.lineWidth = 3; ctx.beginPath();
    hist.forEach((v, i) => { const x = 320 + (hist.length === 1 ? 0 : i / (hist.length - 1)) * 340, y = 210 - ((v - lo) / (hi - lo || 1)) * 120; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,.15)"; ctx.lineWidth = 1; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(320, 90 + i * 40); ctx.lineTo(660, 90 + i * 40); ctx.stroke(); }
    text(ctx, `Day ${s.day}`, 490, 222, { size: 10, color: "#44527a", weight: 600 });
    hs(300, 40, 380, 190, "Financial reports", { panel: "finance" });
    // planning board
    rr(ctx, 730, 50, 200, 150, 8, "#3b6f55", "#6b4220"); text(ctx, "UPGRADE PLAN", 830, 76, { size: 12, color: "#f6efe3" });
    D.UPGRADES.forEach((u, i) => { rr(ctx, 746, 88 + i * 20, 168, 14, 4, "rgba(255,255,255,.12)"); rr(ctx, 746, 88 + i * 20, 168 * s.upgrades[u.id] / u.max, 14, 4, "#ffd36b"); text(ctx, `${u.name} ${s.upgrades[u.id]}/${u.max}`, 752, 99 + i * 20, { size: 9, align: "left", color: "#1a1a2e", weight: 700 }); });
    hs(730, 50, 200, 150, "Upgrades", { panel: "upgrades" });
    // desks: one per hire, owner desk first
    const people = [{ role: "owner", name: "You", id: 5 }, ...s.staff.map(x => ({ role: x.role, name: x.name, id: x.id }))];
    people.slice(0, 9).forEach((p, i) => {
      const col = i % 5, row = Math.floor(i / 5), x = 100 + col * 170, y = 330 + row * 110;
      rr(ctx, x - 60, y + 24, 120, 56, 6, "#8d6a44"); rr(ctx, x - 60, y + 24, 120, 8, 6, "#b08a5c");
      rr(ctx, x - 24, y - 6, 48, 34, 4, "#1a1d3f", "#5eead4"); ctx.fillStyle = "rgba(94,234,212,.5)"; for (let k = 0; k < 4; k++) ctx.fillRect(x - 18, y + k * 6, 24 + (k * 7) % 12, 2);
      person(ctx, x, y + 20, lookFor(p.id * 7), { role: p.role, sit: true, moving: false, scale: 0.8 });
      text(ctx, p.name, x, y + 104, { size: 10, weight: 600 });
    });
    hs(40, 300, 880, 220, "Staff: hire and manage", { panel: "staff" }, false);
    // cabinets
    for (let i = 0; i < 2; i++) { rr(ctx, 850 + i * 52, 250, 46, 100, 4, "#8a93a8"); for (let k = 0; k < 3; k++) { rr(ctx, 855 + i * 52, 258 + k * 30, 36, 24, 3, "#aab3c8"); circle(ctx, 873 + i * 52, 270 + k * 30, 3, "#444"); } }
    chip(ctx, 62, 524, hourText(s), { size: 12 });
    drawFlashes();
  }

  const fmtMoney = n => "$" + (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
  function drawFlashes() {
    for (const f of flashes) { ctx.globalAlpha = clamp(f.t, 0, 1); text(ctx, f.text, 480, 300 - (1.6 - f.t) * 40, { size: 26, color: f.color || "#5eead4", weight: 800, font: "Fraunces, serif" }); }
    ctx.globalAlpha = 1;
  }

  return {
    frame, setScene, scene: () => scene,
    zoom: f => { const p = { x: W / 2, y: H / 2 }, before = toWorld(p); cam.z *= f; clampCam(); cam.x = p.x - before.x * cam.z; cam.y = p.y - before.y * cam.z; clampCam(); },
    reset: fit, flash: (text, color) => flashes.push({ text, color, t: 1.6 }), setReduced: v => { reduced = !!v; },
  };
}
