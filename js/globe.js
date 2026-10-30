// Flat world map (equirectangular) drawn on a canvas. Works offline: no map service, no tiles.
// Coastlines are deliberately coarse hand-made outlines. Drag to pan, wheel or pinch to zoom, markers are clickable.
// The default view runs from the Americas in the west to Australia and New Zealand in the east.
const LAND = [
  [[70, -165], [72, -125], [68, -95], [58, -80], [62, -65], [48, -53], [44, -66], [30, -81], [25, -80], [18, -95], [15, -92], [8, -80], [18, -105], [30, -115], [40, -124], [55, -130], [60, -148], [64, -165]],
  [[12, -72], [8, -60], [0, -50], [-8, -35], [-23, -42], [-35, -57], [-42, -65], [-54, -68], [-50, -75], [-30, -71], [-18, -70], [-5, -81], [5, -77]],
  [[36, -9], [44, -9], [51, 2], [58, 5], [70, 20], [70, 60], [75, 100], [72, 140], [66, 178], [60, 160], [52, 142], [40, 130], [35, 127], [22, 120], [10, 108], [1, 104], [8, 98], [16, 94], [22, 90], [8, 77], [22, 70], [25, 57], [13, 45], [30, 35], [37, 27], [41, 19], [44, 8]],
  [[35, -6], [37, 10], [31, 32], [12, 44], [11, 51], [-2, 41], [-15, 40], [-26, 33], [-34, 20], [-22, 14], [-5, 12], [5, -8], [15, -17], [28, -12]],
  [[-11, 132], [-12, 142], [-24, 153], [-38, 146], [-35, 117], [-22, 114]],
  [[5.5, 95], [2, 99], [-3, 104], [-5.8, 105.8], [-2, 100.5], [2, 96.5]],
  [[-6, 105.5], [-6.5, 111], [-7.8, 114.5], [-8.5, 114], [-7.5, 108], [-7, 105.5]],
  [[7, 117], [1, 119], [-3.5, 116], [-4, 110.5], [1, 109], [4, 113]],
  [[45.5, 142], [41, 141.5], [35, 140.8], [33, 135], [34, 131], [36, 135.5], [40, 139.5]],
  [[83, -40], [78, -20], [70, -22], [60, -43], [68, -55], [78, -70]],
  [[-34.5, 172.7], [-37, 175.5], [-39.5, 177], [-41.5, 175], [-40, 172.7]],
  [[-41, 173], [-43.5, 172.5], [-46.5, 169], [-45.5, 166.8], [-42, 171.5]],
  [[18.5, 121], [14, 124], [9, 126], [6, 125.5], [8, 122], [12, 120], [16, 120]],
  [[1.5, 120.5], [1, 125], [-5.5, 122], [-5, 119.5], [-1, 119.8]],
  [[-2, 131], [-2.5, 141], [-8.5, 141], [-8.5, 137], [-4.5, 133]],
  [[58.5, -5], [57, 1.7], [52, 1.5], [50, -5.5], [53, -4.5], [55, -5.5]],
  [[-12, 49], [-16, 50.5], [-25, 47], [-24, 43.5], [-16, 44]],
];

const VIEW = { lon0: -135, lon1: 180, lat0: -52, lat1: 74 };            // the whole playable world
export function createMap(canvas, { markers = [], onPick = () => {} } = {}) {
  const ctx = canvas.getContext("2d"), hit = [];
  const home = { lon: (VIEW.lon0 + VIEW.lon1) / 2, lat: (VIEW.lat0 + VIEW.lat1) / 2 };
  let cLon = home.lon, cLat = home.lat, zoom = 1, sel = null, running = false, raf = 0, anim = null, list = markers, moved = 0, drag = null, pinch = null;
  const ptrs = new Map();
  const size = () => { const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, w = Math.max(200, Math.round(r.width)), h = Math.max(120, Math.round(r.height)); if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; } ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { w, h }; };
  const base = w => w / (VIEW.lon1 - VIEW.lon0);                          // px per degree at zoom 1: the full width fits
  const clampView = (w, h) => {
    const k = base(w) * zoom, hl = w / 2 / k, hv = h / 2 / k;
    cLon = hl * 2 >= 360 ? 0 : Math.max(-180 + hl, Math.min(180 - hl, cLon));
    cLat = Math.max(-80 + hv, Math.min(84 - hv, cLat));
  };
  const toXY = (lat, lon, w, h) => { const k = base(w) * zoom; return { x: w / 2 + (lon - cLon) * k, y: h / 2 - (lat - cLat) * k }; };
  function draw() {
    const { w, h } = size(); clampView(w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0b1730"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.lineWidth = 1;
    for (let lo = -180; lo <= 180; lo += 30) { const a = toXY(0, lo, w, h); ctx.beginPath(); ctx.moveTo(a.x, 0); ctx.lineTo(a.x, h); ctx.stroke(); }
    for (let la = -60; la <= 80; la += 30) { const a = toXY(la, 0, w, h); ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(w, a.y); ctx.stroke(); }
    const eq = toXY(0, 0, w, h); ctx.strokeStyle = "rgba(242,169,59,.25)"; ctx.beginPath(); ctx.moveTo(0, eq.y); ctx.lineTo(w, eq.y); ctx.stroke();
    for (const poly of LAND) {
      ctx.beginPath();
      poly.forEach(([la, lo], i) => { const p = toXY(la, lo, w, h); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.closePath(); ctx.fillStyle = "#2f6b4a"; ctx.fill(); ctx.strokeStyle = "#4f9a6f"; ctx.lineWidth = 1.2; ctx.stroke();
    }
    hit.length = 0;
    for (const m of list) {
      const p = toXY(m.lat, m.lon, w, h); if (p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) continue;
      const on = sel === m.id, r = on ? 7 : 4.5;
      if (on) { ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, 7); ctx.strokeStyle = "#ffd36b"; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fillStyle = on ? "#ffd36b" : "#f2a93b"; ctx.fill(); ctx.strokeStyle = "#1c1100"; ctx.lineWidth = 1.5; ctx.stroke();
      hit.push({ id: m.id, x: p.x, y: p.y });
    }
  }
  function loop() {
    if (!running) return;
    if (anim) { anim.t = Math.min(1, anim.t + 0.06); const k = 1 - Math.pow(1 - anim.t, 3); cLon = anim.lon + (anim.toLon - anim.lon) * k; cLat = anim.lat + (anim.toLat - anim.lat) * k; zoom = anim.z + (anim.toZ - anim.z) * k; if (anim.t >= 1) anim = null; }
    draw(); raf = requestAnimationFrame(loop);
  }
  const local = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const setZoom = z => { zoom = Math.max(1, Math.min(10, z)); };
  canvas.addEventListener("pointerdown", e => {
    ptrs.set(e.pointerId, local(e)); try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoom }; drag = null; } else { drag = local(e); moved = 0; }
    anim = null;
  });
  canvas.addEventListener("pointermove", e => {
    if (!ptrs.has(e.pointerId)) return; const p = local(e); ptrs.set(e.pointerId, p);
    if (pinch && ptrs.size >= 2) { const [a, b] = [...ptrs.values()]; setZoom(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) || 1) / pinch.d); moved = 99; return; }
    if (drag) { const k = base(canvas.getBoundingClientRect().width) * zoom; cLon -= (p.x - drag.x) / k; cLat += (p.y - drag.y) / k; moved += Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y); drag = p; }
  });
  canvas.addEventListener("pointerup", e => {
    const p = local(e), wasClick = moved < 6 && !pinch; ptrs.delete(e.pointerId); if (!ptrs.size) { pinch = null; drag = null; }
    if (!wasClick) return;
    let best = null, bd = 18; for (const h of hit) { const d = Math.hypot(h.x - p.x, h.y - p.y); if (d < bd) { bd = d; best = h; } }
    if (best) onPick(best.id);
  });
  canvas.addEventListener("pointercancel", e => { ptrs.delete(e.pointerId); drag = null; pinch = null; });
  canvas.addEventListener("wheel", e => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
  canvas.tabIndex = 0;
  canvas.addEventListener("keydown", e => {
    const k = { ArrowLeft: () => (cLon -= 10 / zoom), ArrowRight: () => (cLon += 10 / zoom), ArrowUp: () => (cLat += 8 / zoom), ArrowDown: () => (cLat -= 8 / zoom), "+": () => setZoom(zoom * 1.25), "-": () => setZoom(zoom / 1.25) }[e.key];
    if (k) { e.preventDefault(); k(); }
  });
  const go = (lat, lon, z) => { anim = { t: 0, lon: cLon, lat: cLat, z: zoom, toLon: lon, toLat: lat, toZ: z }; };
  return {
    start() { if (running) return; running = true; loop(); },
    stop() { running = false; cancelAnimationFrame(raf); },
    select(id) { sel = id; },
    setMarkers(m) { list = m; },
    focus(lat, lon, z = 3) { go(lat, lon, Math.max(1, Math.min(10, z * 0.8))); },
    reset() { go(home.lat, home.lon, 1); },
    zoomBy(f) { setZoom(zoom * f); },
  };
}
