// Flat world map (equirectangular) drawn on a canvas. Works offline: no map service, no tiles.
// Outlines live in worldmap.js. Drag to pan, wheel or pinch to zoom, tap a dot to pick it. Nearby dots merge into a counted
// bubble until you zoom in. Every dot is drawn at its exact coordinate, snapped to a device pixel.
import { LAND, WATER } from "./worldmap.js";

const VIEW = { lon0: -135, lon1: 180, lat0: -52, lat1: 74 };            // the whole playable world
const MAXZ = 28, MONO = '"IBM Plex Mono", ui-monospace, monospace', HEAD = '"Pixelify Sans", ui-monospace, monospace';
const C = { sea1: "#0c1a38", sea2: "#060c1e", land: "#2b6049", landHi: "#356f55", coast: "#68c295", grid: "rgba(160,190,255,.07)", gridMajor: "rgba(160,190,255,.14)", label: "rgba(170,190,230,.55)", eq: "rgba(242,169,59,.35)", dot: "#f2a93b", dotHi: "#ffd36b", ink: "#1a1000", chip: "rgba(8,14,32,.92)", chipLine: "#3b4a73", text: "#e8eefc" };

export function createMap(canvas, { markers = [], onPick = () => {} } = {}) {
  const ctx = canvas.getContext("2d");
  const home = { lon: (VIEW.lon0 + VIEW.lon1) / 2, lat: (VIEW.lat0 + VIEW.lat1) / 2 };
  let cLon = home.lon, cLat = home.lat, zoom = 1, sel = null, running = false, raf = 0, anim = null, list = markers, moved = 0, drag = null, pinch = null, hover = null, dpr = 1, W = 0, H = 0, t0 = 0;
  let hit = [];
  const ptrs = new Map();
  function size() {
    const r = canvas.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; W = Math.max(200, Math.round(r.width)); H = Math.max(120, Math.round(r.height));
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const base = () => W / (VIEW.lon1 - VIEW.lon0);                          // px per degree at zoom 1: the full width fits
  const clampView = () => {
    const k = base() * zoom, hl = W / 2 / k, hv = H / 2 / k;
    cLon = hl * 2 >= 360 ? 0 : Math.max(-180 + hl, Math.min(180 - hl, cLon));
    cLat = Math.max(-80 + hv, Math.min(84 - hv, cLat));
  };
  const toXY = (lat, lon) => { const k = base() * zoom; return { x: W / 2 + (lon - cLon) * k, y: H / 2 - (lat - cLat) * k }; };
  const snap = v => Math.round(v * dpr) / dpr;                             // land exactly on a device pixel
  const nice = km => { const p = Math.pow(10, Math.floor(Math.log10(km))), f = km / p; return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p; };

  function drawGrid() {
    const step = zoom >= 8 ? 5 : zoom >= 3 ? 10 : 15;
    const pxStep = step * base() * zoom, lonEvery = Math.max(1, Math.ceil(52 / pxStep)), latEvery = Math.max(1, Math.ceil(30 / pxStep));   // labels never touch
    ctx.lineWidth = 1; ctx.font = `500 9px ${MONO}`; ctx.fillStyle = C.label; ctx.textBaseline = "top";
    const tl = { lon: cLon - W / 2 / (base() * zoom), lat: cLat + H / 2 / (base() * zoom) }, br = { lon: cLon + W / 2 / (base() * zoom), lat: cLat - H / 2 / (base() * zoom) };
    for (let lo = Math.ceil(tl.lon / step) * step; lo <= br.lon; lo += step) { const x = snap(toXY(0, lo).x) + .5; ctx.strokeStyle = lo % 30 === 0 ? C.gridMajor : C.grid; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); if (Math.round(lo / step) % lonEvery === 0) { ctx.textAlign = "left"; ctx.fillText(`${Math.abs(lo)}°${lo < 0 ? "W" : lo > 0 ? "E" : ""}`, x + 3, 3); } }
    for (let la = Math.ceil(br.lat / step) * step; la <= tl.lat; la += step) { const y = snap(toXY(la, 0).y) + .5; const eq = la === 0; ctx.strokeStyle = eq ? C.eq : la % 30 === 0 ? C.gridMajor : C.grid; ctx.setLineDash(eq ? [5, 4] : []); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]); ctx.textAlign = "left"; if (Math.round(la / step) % latEvery === 0) ctx.fillText(`${Math.abs(la)}°${la < 0 ? "S" : la > 0 ? "N" : ""}`, 4, y + 2); }
  }
  function drawLand() {
    const path = rings => { ctx.beginPath(); for (const ring of rings) { ring.forEach(([la, lo], i) => { const p = toXY(la, lo); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath(); } };
    path(LAND);
    ctx.shadowColor = "rgba(104,194,149,.35)"; ctx.shadowBlur = 8; ctx.fillStyle = C.land; ctx.fill(); ctx.shadowBlur = 0;     // soft glow along every coast
    ctx.save(); ctx.clip(); const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(255,255,255,.07)"); g.addColorStop(1, "rgba(0,0,0,.18)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
    path(WATER); ctx.fillStyle = C.sea1; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(104,194,149,.55)"; ctx.stroke();
    path(LAND); ctx.lineWidth = 1.1; ctx.strokeStyle = C.coast; ctx.lineJoin = "round"; ctx.stroke();
  }
  // Merge dots that would touch on screen. A bubble shows how many sites it hides.
  function groups() {
    const pts = []; for (const m of list) { const p = toXY(m.lat, m.lon); if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) continue; pts.push({ m, x: p.x, y: p.y }); }
    pts.sort((a, b) => (b.m.id === sel) - (a.m.id === sel));              // the picked site never hides inside a bubble
    const out = [], R = 11;
    for (const p of pts) { const g = p.m.id === sel ? null : out.find(o => !o.keep && Math.hypot(o.x - p.x, o.y - p.y) < R); if (g) { g.items.push(p.m); g.sx += p.x; g.sy += p.y; } else out.push({ x: p.x, y: p.y, sx: p.x, sy: p.y, items: [p.m], keep: p.m.id === sel }); }
    for (const g of out) if (g.items.length > 1) { g.x = g.sx / g.items.length; g.y = g.sy / g.items.length; }
    return out;
  }
  const chip = (text, x, y, align = "left", color = C.text) => {
    ctx.font = `600 10px ${MONO}`; const w = Math.ceil(ctx.measureText(text).width) + 12, h = 18; let bx = align === "left" ? x : align === "right" ? x - w : x - w / 2; bx = Math.max(3, Math.min(W - w - 3, bx)); const by = Math.max(3, Math.min(H - h - 3, y - h / 2));
    ctx.fillStyle = C.chip; ctx.strokeStyle = C.chipLine; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(snap(bx) + .5, snap(by) + .5, w, h, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(text, bx + 6, by + h / 2 + .5); return { x: bx, y: by, w, h };
  };
  function drawDots(now) {
    const gs = groups().sort((a, b) => (a.keep ? 1 : 0) - (b.keep ? 1 : 0)); hit = []; const boxes = [];            // the picked dot is drawn last, on top
    for (const g of gs) {
      g.key = g.items.map(m => m.id).join("|"); const one = g.items.length === 1, m = g.items[0], on = one && sel === m.id, hv = !!hover && hover.key === g.key, x = snap(g.x), y = snap(g.y);
      if (!one) {
        const r = 8 + Math.min(4, g.items.length / 4);
        ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, 7); ctx.fillStyle = "rgba(242,169,59,.18)"; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = hv ? C.dotHi : C.dot; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = C.ink; ctx.stroke();
        ctx.fillStyle = C.ink; ctx.font = `700 10px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(g.items.length), x, y + .5);
        hit.push({ g, x, y, r: r + 6 }); continue;
      }
      if (on) {                                                              // picked: pulsing halo and crosshair ticks
        const pulse = (Math.sin((now - t0) / 380) + 1) / 2;
        ctx.beginPath(); ctx.arc(x, y, 11 + pulse * 4, 0, 7); ctx.strokeStyle = `rgba(255,211,107,${0.55 - pulse * 0.35})`; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 10, 0, 7); ctx.strokeStyle = C.dotHi; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.strokeStyle = "rgba(255,211,107,.7)"; ctx.lineWidth = 1; ctx.beginPath(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * 13, y + dy * 13); ctx.lineTo(x + dx * 18, y + dy * 18); } ctx.stroke();
      }
      const r = on ? 5.5 : hv ? 5.5 : 4.2;
      ctx.beginPath(); ctx.arc(x, y, r + 1.6, 0, 7); ctx.fillStyle = "rgba(4,8,20,.65)"; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = on || hv ? C.dotHi : C.dot; ctx.fill();
      ctx.fillStyle = C.ink; ctx.fillRect(x - .75, y - .75, 1.5, 1.5);       // the exact point
      hit.push({ g, x, y, r: 12 });
      if (zoom >= 2.4 && !on) { const w = ctx.measureText(m.city).width; if (!boxes.some(b => Math.abs(b.x - x) < b.w / 2 + w / 2 + 14 && Math.abs(b.y - y) < 14)) { ctx.font = `600 10px ${MONO}`; ctx.fillStyle = "rgba(4,8,20,.8)"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.strokeStyle = "rgba(4,8,20,.85)"; ctx.lineWidth = 3; ctx.strokeText(m.city, x + 9, y + .5); ctx.fillStyle = "#cfe0ff"; ctx.fillText(m.city, x + 9, y + .5); boxes.push({ x, y, w: ctx.measureText(m.city).width }); } }
    }
    const s = gs.find(g => g.items.length === 1 && g.items[0].id === sel);                    // labels for the picked and the hovered site
    if (s) { const m = s.items[0]; chip(`${m.city} · ${m.district}`, snap(s.x) + 14, snap(s.y) - 20, s.x > W * .6 ? "right" : "left", C.dotHi); }
    const hg = hover && gs.find(g => g.key === hover.key);
    if (hg && hg !== s && hg.items.length === 1) { const m = hg.items[0]; chip(`${m.city} · ${m.district}`, snap(hg.x) + 10, snap(hg.y) - 16, hg.x > W * .6 ? "right" : "left"); }
    if (hg && hg.items.length > 1) chip(`${hg.items.length} sites · tap to zoom`, snap(hg.x), snap(hg.y) - 22, "center");
  }
  function drawHud() {
    const k = base() * zoom, kmPerPx = 111.32 * Math.cos(cLat * Math.PI / 180) / k, len = nice(kmPerPx * 80), px = len / kmPerPx, x = 52, y = H - 12;
    ctx.strokeStyle = C.label; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 4); ctx.stroke();
    ctx.font = `500 9px ${MONO}`; ctx.fillStyle = C.label; ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillText(`${len >= 1000 ? len.toLocaleString("en") : len} km`, x, y - 6);
    const m = sel && list.find(l => l.id === sel); if (m) { ctx.textAlign = "right"; ctx.textBaseline = "bottom"; ctx.fillText(`${Math.abs(m.lat).toFixed(2)}°${m.lat < 0 ? "S" : "N"}  ${Math.abs(m.lon).toFixed(2)}°${m.lon < 0 ? "W" : "E"}`, W - 10, H - 8); }
  }
  function draw(now) {
    size(); clampView();
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, C.sea1); g.addColorStop(1, C.sea2); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    drawGrid(); drawLand(); drawDots(now);
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .45, W / 2, H / 2, Math.max(W, H) * .75); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.35)"); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    drawHud();
  }
  function loop(now) {
    if (!running) return;
    if (anim) { anim.t = Math.min(1, anim.t + 0.06); const k = 1 - Math.pow(1 - anim.t, 3); cLon = anim.lon + (anim.toLon - anim.lon) * k; cLat = anim.lat + (anim.toLat - anim.lat) * k; zoom = anim.z + (anim.toZ - anim.z) * k; if (anim.t >= 1) anim = null; }
    draw(now); raf = requestAnimationFrame(loop);
  }
  const local = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const setZoom = z => { zoom = Math.max(1, Math.min(MAXZ, z)); };
  const pick = p => { let best = null, bd = Infinity; for (const h of hit) { const d = Math.hypot(h.x - p.x, h.y - p.y); if (d < h.r && d < bd) { bd = d; best = h; } } return best; };
  const go = (lat, lon, z) => { anim = { t: 0, lon: cLon, lat: cLat, z: zoom, toLon: lon, toLat: lat, toZ: z }; };
  canvas.addEventListener("pointerdown", e => {
    ptrs.set(e.pointerId, local(e)); try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoom }; drag = null; } else { drag = local(e); moved = 0; canvas.style.cursor = "grabbing"; }
    anim = null;
  });
  canvas.addEventListener("pointermove", e => {
    const p = local(e);
    if (!ptrs.has(e.pointerId)) { const h = pick(p); hover = h ? { key: h.g.key } : null; canvas.style.cursor = h ? "pointer" : "grab"; return; }
    ptrs.set(e.pointerId, p);
    if (pinch && ptrs.size >= 2) { const [a, b] = [...ptrs.values()]; setZoom(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) || 1) / pinch.d); moved = 99; return; }
    if (drag) { const k = base() * zoom; cLon -= (p.x - drag.x) / k; cLat += (p.y - drag.y) / k; moved += Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y); drag = p; hover = null; }
  });
  canvas.addEventListener("pointerleave", () => { hover = null; });
  canvas.addEventListener("pointerup", e => {
    const p = local(e), wasClick = moved < 6 && !pinch; ptrs.delete(e.pointerId); canvas.style.cursor = "grab"; if (!ptrs.size) { pinch = null; drag = null; }
    if (!wasClick) return;
    const h = pick(p); if (!h) return;
    if (h.g.items.length === 1) onPick(h.g.items[0].id);
    else { const la = h.g.items.reduce((a, m) => a + m.lat, 0) / h.g.items.length, lo = h.g.items.reduce((a, m) => a + m.lon, 0) / h.g.items.length; go(la, lo, Math.min(MAXZ, zoom * 2.6)); }
  });
  canvas.addEventListener("pointercancel", e => { ptrs.delete(e.pointerId); drag = null; pinch = null; });
  canvas.addEventListener("wheel", e => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
  canvas.tabIndex = 0;
  canvas.addEventListener("keydown", e => {
    const k = { ArrowLeft: () => (cLon -= 10 / zoom), ArrowRight: () => (cLon += 10 / zoom), ArrowUp: () => (cLat += 8 / zoom), ArrowDown: () => (cLat -= 8 / zoom), "+": () => setZoom(zoom * 1.25), "-": () => setZoom(zoom / 1.25) }[e.key];
    if (k) { e.preventDefault(); k(); }
  });
  return {
    start() { if (running) return; running = true; t0 = performance.now(); loop(t0); },
    stop() { running = false; cancelAnimationFrame(raf); },
    select(id) { sel = id; },
    setMarkers(m) { list = m; },
    focus(lat, lon, z = 3) { go(lat, lon, Math.max(1, Math.min(MAXZ, z))); },
    reset() { go(home.lat, home.lon, 1); },
    zoomBy(f) { setZoom(zoom * f); },
    get zoom() { return zoom; },
    project(lat, lon) { size(); clampView(); return toXY(lat, lon); },   // screen position of a coordinate (used by tests)
  };
}
