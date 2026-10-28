// Schematic Earth globe: orthographic projection drawn on a canvas. Works offline (no map service, no tiles).
// Coastlines are deliberately coarse hand-made outlines. Rotation by mouse/touch, zoom by wheel/pinch, markers are clickable.
const D2R = Math.PI / 180;
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
];

export function createGlobe(canvas, { markers = [], onPick = () => {} } = {}) {
  const ctx = canvas.getContext("2d");
  let lon0 = 105, lat0 = 5, zoom = 1, sel = null, running = false, raf = 0, anim = null;
  const ptrs = new Map(); let drag = null, pinch = null, moved = 0;
  let list = markers;

  const size = () => { const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, w = Math.max(200, Math.round(r.width)), h = Math.max(200, Math.round(r.height)); if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; } ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { w, h }; };
  const proj = (lat, lon, R, cx, cy) => {
    const φ = lat * D2R, λ = (lon - lon0) * D2R, φ0 = lat0 * D2R;
    const cosc = Math.sin(φ0) * Math.sin(φ) + Math.cos(φ0) * Math.cos(φ) * Math.cos(λ);
    return { x: cx + R * Math.cos(φ) * Math.sin(λ), y: cy - R * (Math.cos(φ0) * Math.sin(φ) - Math.sin(φ0) * Math.cos(φ) * Math.cos(λ)), z: cosc };
  };
  function draw() {
    const { w, h } = size(), cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.45 * zoom;
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R); g.addColorStop(0, "#1b2c52"); g.addColorStop(1, "#0b1226");
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();
    // graticule
    ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.lineWidth = 1;
    for (let lo = -180; lo < 180; lo += 30) { ctx.beginPath(); let on = false; for (let la = -90; la <= 90; la += 5) { const p = proj(la, lo, R, cx, cy); if (p.z > 0) { on ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); on = true; } else on = false; } ctx.stroke(); }
    for (let la = -60; la <= 60; la += 30) { ctx.beginPath(); let on = false; for (let lo = -180; lo <= 180; lo += 5) { const p = proj(la, lo, R, cx, cy); if (p.z > 0) { on ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); on = true; } else on = false; } ctx.stroke(); }
    // land: points behind the horizon are pushed onto the rim so shapes close cleanly
    for (const poly of LAND) {
      const pts = poly.map(([la, lo]) => proj(la, lo, R, cx, cy));
      if (!pts.some(p => p.z > 0)) continue;
      ctx.beginPath();
      pts.forEach((p, i) => { let x = p.x, y = p.y; if (p.z <= 0) { const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1; x = cx + dx / d * R; y = cy + dy / d * R; } i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath(); ctx.fillStyle = "#2f6b4a"; ctx.fill(); ctx.strokeStyle = "#4f9a6f"; ctx.lineWidth = 1.2; ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.strokeStyle = "rgba(242,169,59,.55)"; ctx.lineWidth = 2; ctx.stroke();
    // markers
    hit.length = 0;
    for (const m of list) {
      const p = proj(m.lat, m.lon, R, cx, cy); if (p.z <= 0.05) continue;
      const on = sel === m.id, r = on ? 7 : 4.5;
      if (on) { ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, 7); ctx.strokeStyle = "#ffd36b"; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fillStyle = on ? "#ffd36b" : "#f2a93b"; ctx.fill(); ctx.strokeStyle = "#1c1100"; ctx.lineWidth = 1.5; ctx.stroke();
      hit.push({ id: m.id, x: p.x, y: p.y });
    }
  }
  const hit = [];
  function loop() {
    if (!running) return;
    if (anim) { anim.t = Math.min(1, anim.t + 0.05); const k = 1 - Math.pow(1 - anim.t, 3); lon0 = anim.lon + ((((anim.toLon - anim.lon + 540) % 360) - 180)) * k; lat0 = anim.lat + (anim.toLat - anim.lat) * k; if (anim.t >= 1) anim = null; }
    draw(); raf = requestAnimationFrame(loop);
  }
  const local = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener("pointerdown", e => {
    ptrs.set(e.pointerId, local(e)); try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoom }; drag = null; } else { drag = local(e); moved = 0; }
    anim = null;
  });
  canvas.addEventListener("pointermove", e => {
    if (!ptrs.has(e.pointerId)) return; const p = local(e); ptrs.set(e.pointerId, p);
    if (pinch && ptrs.size >= 2) { const [a, b] = [...ptrs.values()]; zoom = Math.max(0.8, Math.min(4, pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) || 1) / pinch.d)); moved = 99; return; }
    if (drag) { const k = 0.3 / zoom; lon0 -= (p.x - drag.x) * k; lat0 = Math.max(-80, Math.min(80, lat0 + (p.y - drag.y) * k)); moved += Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y); drag = p; }
  });
  const up = e => {
    const p = local(e), wasClick = moved < 6 && !pinch; ptrs.delete(e.pointerId); if (!ptrs.size) { pinch = null; drag = null; }
    if (!wasClick) return;
    let best = null, bd = 18; for (const h of hit) { const d = Math.hypot(h.x - p.x, h.y - p.y); if (d < bd) { bd = d; best = h; } }
    if (best) onPick(best.id);
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", e => { ptrs.delete(e.pointerId); drag = null; pinch = null; });
  canvas.addEventListener("wheel", e => { e.preventDefault(); zoom = Math.max(0.8, Math.min(4, zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); }, { passive: false });
  // keyboard: arrows rotate, +/- zoom (the canvas is focusable)
  canvas.tabIndex = 0;
  canvas.addEventListener("keydown", e => {
    const k = { ArrowLeft: () => (lon0 -= 8), ArrowRight: () => (lon0 += 8), ArrowUp: () => (lat0 = Math.min(80, lat0 + 6)), ArrowDown: () => (lat0 = Math.max(-80, lat0 - 6)), "+": () => (zoom = Math.min(4, zoom * 1.15)), "=": () => (zoom = Math.min(4, zoom * 1.15)), "-": () => (zoom = Math.max(0.8, zoom / 1.15)) }[e.key];
    if (k) { e.preventDefault(); k(); }
  });
  return {
    start() { if (running) return; running = true; loop(); },
    stop() { running = false; cancelAnimationFrame(raf); },
    select(id) { sel = id; },
    setMarkers(m) { list = m; },
    focus(lat, lon, z) { anim = { t: 0, lon: lon0, lat: lat0, toLon: lon, toLat: Math.max(-70, Math.min(70, lat)) }; if (z) zoom = z; },
    reset() { anim = { t: 0, lon: lon0, lat: lat0, toLon: 105, toLat: 5 }; zoom = 1; },
    zoomBy(f) { zoom = Math.max(0.8, Math.min(4, zoom * f)); },
  };
}
