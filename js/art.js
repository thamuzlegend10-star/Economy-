// Procedural 2D art: all shapes are drawn in code (original artwork, no external assets).
import { CATEGORIES } from "./data.js";

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export const mix = (c1, c2, t) => { const a = hex(c1), b = hex(c2); return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(",")})`; };
export const shade = (c, k) => { const a = hex(c).map(v => clamp(Math.round(v * k), 0, 255)); return `rgb(${a.join(",")})`; };

export function rr(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
}
export function text(ctx, str, x, y, { size = 12, weight = 700, color = "#f6efe3", align = "center", font = "DM Sans, system-ui, sans-serif" } = {}) {
  ctx.font = `${weight} ${size}px ${font}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(str, x, y);
}
export function shadow(ctx, x, y, w, h, a = 0.3) { ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, 7); ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fill(); }
export function chip(ctx, x, y, label, { bg = "rgba(10,14,36,.82)", color = "#f6efe3", size = 12 } = {}) {
  ctx.font = `700 ${size}px DM Sans, system-ui, sans-serif`;
  const w = ctx.measureText(label).width + 16;
  rr(ctx, x - w / 2, y - size - 4, w, size + 10, (size + 10) / 2, bg);
  text(ctx, label, x, y, { size, color });
}
export function bubble(ctx, x, y, label, pid) {
  ctx.font = "700 12px DM Sans, system-ui, sans-serif";
  const w = ctx.measureText(label).width + (pid ? 40 : 18);
  rr(ctx, x - w / 2, y - 26, w, 28, 14, "#fffaf0");
  ctx.beginPath(); ctx.moveTo(x - 6, y + 1); ctx.lineTo(x, y + 9); ctx.lineTo(x + 6, y + 1); ctx.fillStyle = "#fffaf0"; ctx.fill();
  if (pid) drawProduct(ctx, pid, x - w / 2 + 17, y - 12, 0.75);
  text(ctx, label, x + (pid ? 10 : 0), y - 8, { size: 12, color: "#1a1a2e" });
}

// ---------- products ----------
export function drawProduct(ctx, pid, x, y, k = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
  switch (pid) {
    case "apple": circle(ctx, 0, 0, 8, "#e5383b"); circle(ctx, -3, -3, 2.4, "rgba(255,255,255,.5)"); ctx.fillStyle = "#3d8f3d"; ctx.fillRect(-1, -12, 2, 5); break;
    case "bread": ellipse(ctx, 0, 0, 12, 7, "#d9a05b"); ctx.strokeStyle = "#a8702f"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(-2, 4); ctx.moveTo(3, -5); ctx.lineTo(6, 4); ctx.stroke(); break;
    case "milk": rr(ctx, -6, -11, 12, 22, 2, "#f1f5f9"); rr(ctx, -6, -11, 12, 8, 2, "#4a6fd6"); break;
    case "water": rr(ctx, -5, -11, 10, 22, 4, "#9bd7ff"); rr(ctx, -3, -14, 6, 4, 1, "#2a6fb0"); break;
    case "juice": rr(ctx, -6, -11, 12, 22, 3, "#ff9f1c"); circle(ctx, 0, -1, 4, "#fff3b0"); break;
    case "rice": rr(ctx, -9, -10, 18, 20, 3, "#f6efe3"); rr(ctx, -9, -4, 18, 7, 0, "#c0392b"); break;
    case "noodles": rr(ctx, -9, -7, 18, 14, 4, "#f4c542"); rr(ctx, -9, -7, 18, 4, 4, "#d6451f"); break;
    case "soap": rr(ctx, -9, -5, 18, 10, 3, "#8ee0a8"); rr(ctx, -5, -2, 10, 3, 1, "rgba(255,255,255,.7)"); break;
    case "tissue": rr(ctx, -9, -8, 18, 16, 3, "#cdb4ff"); rr(ctx, -5, -4, 10, 8, 2, "#f6efe3"); break;
    case "notebook": rr(ctx, -7, -10, 14, 20, 2, "#7c5cff"); rr(ctx, -7, -10, 3, 20, 1, "#5a3fd0"); break;
    case "battery": rr(ctx, -9, -6, 18, 12, 2, "#222a3d"); rr(ctx, -9, -6, 18, 4, 2, "#ffd23f"); break;
    case "earbuds": rr(ctx, -8, -7, 16, 14, 4, "#e9ecf2"); circle(ctx, -3, 0, 3, "#222"); circle(ctx, 3, 0, 3, "#222"); break;
    default: rr(ctx, -8, -8, 16, 16, 3, "#999");
  }
  ctx.restore();
}
export function circle(ctx, x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = fill; ctx.fill(); }
export function ellipse(ctx, x, y, rx, ry, fill) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7); ctx.fillStyle = fill; ctx.fill(); }
export function box(ctx, x, y, w, h, color = "#c9945a") {
  rr(ctx, x, y, w, h, 2, color); ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(x + w / 2 - 1, y, 2, h);
  ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(x, y, w, 2);
}

// ---------- people ----------
const SKIN = ["#f5d0b0", "#e0a97d", "#b87a4f", "#8a5a3a"];
const HAIR = ["#2b1b12", "#5a3320", "#c98a3b", "#1c1c28", "#8a2f2f"];
const SHIRT = ["#f472b6", "#38bdf8", "#facc15", "#a78bfa", "#34d399", "#fb923c", "#60a5fa"];
export function lookFor(seed) {
  const r = n => Math.abs(Math.imul(seed ^ (n * 2654435761), 2246822519)) >>> 0;
  return { skin: SKIN[r(1) % SKIN.length], hair: HAIR[r(2) % HAIR.length], shirt: SHIRT[r(3) % SHIRT.length], long: r(4) % 3 === 0, hat: r(5) % 7 === 0 };
}
const ROLE_LOOK = {
  owner:     { shirt: "#ffb84d", apron: "#f6efe3" },
  cashier:   { shirt: "#2f9e6e", vest: "#f6efe3" },
  stocker:   { shirt: "#e8782e", cap: "#e8782e" },
  warehouse: { shirt: "#f2c230", helmet: "#f2c230", vest: "#ff7a00" },
  manager:   { shirt: "#2b2f5e", tie: "#e5383b" },
  driver:    { shirt: "#3b6fd4", cap: "#3b6fd4" },
};

// opts: walk (phase), carry (bool), sit (bool), role, flip (face left), scale
export function person(ctx, x, floorY, look, o = {}) {
  const role = o.role && ROLE_LOOK[o.role] ? ROLE_LOOK[o.role] : null;
  const k = o.scale || 1, w = o.walk || 0, moving = o.walk != null && o.moving !== false;
  const sw = moving ? Math.sin(w) * 6 : 0, bob = moving ? Math.abs(Math.sin(w)) * 2.2 : 0;
  const shirt = role ? role.shirt : look.shirt;
  ctx.save(); ctx.translate(x, floorY); ctx.scale((o.flip ? -1 : 1) * k, k);
  shadow(ctx, 0, 2, 17, 5, 0.28);
  if (!o.sit) {
    rr(ctx, -9, -24 + (sw > 0 ? 0 : 2), 8, 24 - (sw > 0 ? 0 : 2), 3, "#25284f");
    rr(ctx, 1, -24 + (sw < 0 ? 0 : 2), 8, 24 - (sw < 0 ? 0 : 2), 3, "#25284f");
    rr(ctx, -10, -3 - (sw > 0 ? 0 : 0), 10, 4, 2, "#111"); rr(ctx, 1, -3, 10, 4, 2, "#111");
  } else { rr(ctx, -12, -16, 24, 8, 3, "#25284f"); }
  const by = (o.sit ? -8 : 0) - bob;
  rr(ctx, -14, by - 72, 28, 50, [13, 13, 7, 7], shirt);
  if (role?.apron) rr(ctx, -10, by - 52, 20, 30, 5, role.apron);
  if (role?.vest) rr(ctx, -12, by - 68, 24, 40, 5, role.vest + "dd");
  if (role?.tie) { ctx.fillStyle = role.tie; ctx.beginPath(); ctx.moveTo(-3, by - 68); ctx.lineTo(3, by - 68); ctx.lineTo(2, by - 48); ctx.lineTo(-2, by - 48); ctx.fill(); }
  // arms
  const armY = by - 66;
  if (o.carry) { rr(ctx, -17, armY + 8, 7, 18, 4, look.skin); rr(ctx, 10, armY + 8, 7, 18, 4, look.skin); box(ctx, -10, armY + 12, 20, 16); }
  else { rr(ctx, -18 + sw * .4, armY, 7, 26, 4, look.skin); rr(ctx, 11 - sw * .4, armY, 7, 26, 4, look.skin); }
  // head
  circle(ctx, 0, by - 84, 13, look.skin);
  ctx.fillStyle = look.hair; ctx.beginPath(); ctx.arc(0, by - 88, 13, Math.PI, 0); ctx.fill();
  if (look.long) rr(ctx, -13, by - 88, 6, 20, 3, look.hair);
  if (role?.helmet) { ctx.fillStyle = role.helmet; ctx.beginPath(); ctx.arc(0, by - 89, 14, Math.PI, 0); ctx.fill(); ctx.fillRect(-15, by - 90, 30, 4); }
  else if (role?.cap) { ctx.fillStyle = role.cap; ctx.beginPath(); ctx.arc(0, by - 89, 13.5, Math.PI, 0); ctx.fill(); ctx.fillRect(2, by - 90, 16, 4); }
  else if (look.hat) { ctx.fillStyle = "#6b4220"; ctx.fillRect(-15, by - 92, 30, 4); ctx.fillRect(-9, by - 100, 18, 9); }
  ctx.fillStyle = "#1a1a1a"; ctx.fillRect(3, by - 86, 2, 3); ctx.fillRect(-5, by - 86, 2, 3);
  ctx.restore();
}

// ---------- vehicles ----------
// Side-view truck. (x,y) = ground contact of the rear wheel center line. dir: 1 faces right, -1 faces left.
export function truck(ctx, x, y, { dir = -1, moving = false, t = 0, label = "DELIVERY", color = "#f6efe3", cab = "#ffb84d", scale = 1, lights = false, open = false, cargo = 0 } = {}) {
  ctx.save(); ctx.translate(x, y); ctx.scale(dir * -1 * scale, scale);    // drawn facing LEFT at scale dir=-1
  const b = moving ? Math.sin(t * 28) * 1 : 0;
  ctx.translate(0, b);
  shadow(ctx, 70, 2, 112, 7, 0.35);
  rr(ctx, 40, -80, 160, 68, 8, color);                      // cargo box
  rr(ctx, 40, -52, 160, 10, 0, "#ff6b6b");
  if (open) { rr(ctx, 192, -78, 8, 64, 2, "#1a1d3f"); for (let i = 0; i < cargo; i++) box(ctx, 150 - (i % 4) * 26, -30 - Math.floor(i / 4) * 22, 22, 20); }
  rr(ctx, -32, -60, 74, 48, [20, 6, 4, 4], cab);          // cab
  rr(ctx, -22, -54, 36, 24, 7, "#bfe6ff");
  rr(ctx, -36, -26, 242, 13, 3, "#2b2f5e");
  if (lights) { ctx.fillStyle = "#fff6b0"; ctx.beginPath(); ctx.moveTo(-34, -36); ctx.lineTo(-90, -48); ctx.lineTo(-90, -14); ctx.closePath(); ctx.globalAlpha = 0.22; ctx.fill(); ctx.globalAlpha = 1; circle(ctx, -32, -34, 4, "#fff6b0"); }
  for (const wx of [10, 150]) {
    circle(ctx, wx, -9, 14, "#14162e");
    ctx.save(); ctx.translate(wx, -9); ctx.rotate(moving ? t * 14 : 0); ctx.fillStyle = "#c9ced9"; ctx.fillRect(-2, -9, 4, 18); ctx.fillRect(-9, -2, 18, 4); ctx.restore();
  }
  ctx.save(); ctx.translate(120, -60); if (dir > 0) ctx.scale(-1, 1);
  text(ctx, label, 0, 0, { size: 13, color: "#2a1700", weight: 800 });
  ctx.restore();
  ctx.restore();
}
export function car(ctx, x, y, color, dir = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
  shadow(ctx, 0, 2, 42, 5, 0.3);
  rr(ctx, -40, -22, 80, 18, 6, color); rr(ctx, -22, -36, 44, 18, 8, color); rr(ctx, -17, -33, 16, 12, 3, "#bfe6ff"); rr(ctx, 1, -33, 16, 12, 3, "#bfe6ff");
  circle(ctx, -24, -3, 8, "#14162e"); circle(ctx, 24, -3, 8, "#14162e"); ctx.restore();
}
export function forklift(ctx, x, y, { dir = 1, load = false, t = 0 } = {}) {
  ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
  shadow(ctx, 0, 2, 34, 5, 0.3);
  rr(ctx, -26, -34, 44, 26, 5, "#f2c230"); rr(ctx, -18, -54, 26, 22, 4, "#2b2f5e", "#f2c230");
  ctx.fillStyle = "#555"; ctx.fillRect(18, -64, 5, 58); ctx.fillStyle = "#777"; ctx.fillRect(18, -10, 24, 4);
  if (load) box(ctx, 22, -34, 22, 22, "#c9945a");
  circle(ctx, -14, -6, 8, "#14162e"); circle(ctx, 10, -6, 6, "#14162e"); ctx.restore();
}

export function tree(ctx, x, y, k = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
  shadow(ctx, 0, 2, 18, 5, 0.25);
  ctx.fillStyle = "#6b4220"; ctx.fillRect(-4, -34, 8, 34);
  circle(ctx, 0, -50, 22, "#2f8f58"); circle(ctx, -14, -40, 15, "#37a066"); circle(ctx, 14, -42, 16, "#287a4b"); ctx.restore();
}
export function catColor(cat) { return CATEGORIES[cat]?.color || "#999"; }
