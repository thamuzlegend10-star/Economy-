// Delivery route map and warehouse yard pictures. Pure view helpers: they read game state and return SVG text. They change nothing and post no money.
import { getLocation, playableLocations } from "./locations.js";
import * as D from "./data.js";
import { ensureFleet } from "./fleet.js";

const W = 640, H = 270, PAD = 30;
const rad = x => x * Math.PI / 180;
export function kmBetween(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon), h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
// The nine city nodes: your own district plus the eight nearest other cities (one district per city). Nodes are real coordinates.
export function cityNodes(s, count = 9) {
  const me = getLocation(s.location), seen = new Set([me.city]), out = [{ id: me.id, city: me.city || me.district, lat: me.lat, lon: me.lon, home: true, km: 0 }];
  const rest = playableLocations().filter(l => l.id !== me.id && l.city && !seen.has(l.city)).map(l => ({ id: l.id, city: l.city, lat: l.lat, lon: l.lon, home: false, km: Math.round(kmBetween(me, l)) })).sort((a, b) => a.km - b.km);
  for (const n of rest) { if (out.length >= count) break; if (seen.has(n.city)) continue; seen.add(n.city); out.push(n); }
  return out;
}
// The node a trip of this length is shown going to: the city whose real distance is closest to the trip's km.
export const destFor = (nodes, km) => nodes.filter(n => !n.home).reduce((best, n) => (!best || Math.abs(n.km - km) < Math.abs(best.km - km) ? n : best), null);
// Fraction of the way along a trip's outbound-and-back journey, 0 to 1, from the day it started to its ETA.
export const tripProgress = (s, t) => { const span = Math.max(1, t.eta - t.day), now = s.day - 1 + (s.stepsPerDay ? s.dayStep / s.stepsPerDay : 0); return Math.max(0, Math.min(1, (now - t.day + 1) / span)); };
export function activeTrips(s) { return ensureFleet(s).trips.filter(t => s.day < t.eta || (s.day === t.eta && tripProgress(s, t) < 1)); }

export function routeMapSvg(s) {
  const nodes = cityNodes(s), f = ensureFleet(s);
  const lats = nodes.map(n => n.lat), lons = nodes.map(n => n.lon), latMin = Math.min(...lats), latMax = Math.max(...lats), lonMin = Math.min(...lons), lonMax = Math.max(...lons);
  const sx = (W - 2 * PAD) / Math.max(0.5, lonMax - lonMin), sy = (H - 2 * PAD) / Math.max(0.5, latMax - latMin), k = Math.min(sx, sy);
  const ox = (W - k * (lonMax - lonMin)) / 2, oy = (H - k * (latMax - latMin)) / 2;
  const P = n => ({ x: Math.round(ox + (n.lon - lonMin) * k), y: Math.round(H - oy - (n.lat - latMin) * k) });
  const home = P(nodes[0]), trips = activeTrips(s);
  const lines = nodes.slice(1).map(n => { const p = P(n); return `<line class="rm-road" x1="${home.x}" y1="${home.y}" x2="${p.x}" y2="${p.y}"/>`; }).join("");
  // Labels are placed one by one; a label that would overlap an earlier one is nudged down so every name stays readable.
  const placed = nodes.map(n => { const p = P(n); return { x0: p.x - 8, x1: p.x + 8, y: p.y, id: n.id }; });
  const dots = nodes.map(n => {
    const p = P(n), right = n.home || p.x > W - 130, lx = right ? -9 : 9, anchor = right ? "end" : "start", text = n.city.replace(/&/g, "&amp;") + (n.home ? "" : ` · ${n.km} km`), w = text.length * 6.8;
    let y = p.y + 4; const x0 = right ? p.x + lx - w : p.x + lx;
    for (let i = 0; i < 12 && placed.some(q => q.id !== n.id && Math.abs(q.y - y) < 13 && x0 < q.x1 && x0 + w > q.x0); i++) y += 13;
    placed.push({ x0, x1: x0 + w, y, id: n.id + ":label" });
    return `<circle class="rm-node${n.home ? " home" : ""}" cx="${p.x}" cy="${p.y}" r="${n.home ? 7 : 5}"/><text class="rm-label${n.home ? " home" : ""}" x="${p.x + lx}" y="${y}" text-anchor="${anchor}">${text}</text>`;
  }).join("");
  const trucks = trips.map(t => {
    const d = destFor(nodes, t.km); if (!d) return ""; const a = home, b = P(d), pr = tripProgress(s, t), leg = pr < 0.5 ? pr * 2 : (1 - pr) * 2;
    const x = Math.round(a.x + (b.x - a.x) * leg), y = Math.round(a.y + (b.y - a.y) * leg), van = t.trucks.some(id => { const tk = f.trucks.find(q => q.id === id); return tk && tk.type === "van"; });
    const warn = t.delay ? `<g class="rm-warn" transform="translate(0 -14)"><circle r="8"/><text y="4">!</text></g>` : "";
    return `<g class="rm-truck" transform="translate(${x} ${y})">${warn}<rect x="${van ? -6 : -8}" y="-5" width="${van ? 12 : 16}" height="10" rx="2"/><circle cx="${van ? -3 : -4}" cy="6" r="2"/><circle cx="${van ? 3 : 5}" cy="6" r="2"/></g>`;
  }).join("");
  return `<svg class="rm" viewBox="0 0 ${W} ${H}" role="img" aria-label="Delivery map: your district and the eight nearest cities, with trucks on the road">${lines}${dots}${trucks}</svg>`;
}

// Warehouse yard: crates that did not fit stand outside. Each crate is a slice of overflow; crates left more than 3 days turn brown and spoilt-looking.
export const YARD_DAYS = 3, CRATE_SPACE = 25, MAX_CRATES = 24;
export function yardInfo(s, overflow) { const days = s.whOverDays || 0; return { crates: Math.min(MAX_CRATES, Math.ceil(Math.max(0, overflow) / CRATE_SPACE)), old: days > YARD_DAYS, days }; }
export function yardSvg(s, overflow) {
  const y = yardInfo(s, overflow); if (!y.crates) return "";
  const per = 8, cells = Array.from({ length: y.crates }, (_, i) => { const col = i % per, row = Math.floor(i / per); return `<rect class="crate${y.old ? " old" : ""}" x="${12 + col * 44}" y="${74 - row * 28}" width="38" height="24" rx="3"/><path class="crate-x" d="M${12 + col * 44} ${74 - row * 28} l38 24 M${50 + col * 44} ${74 - row * 28} l-38 24"/>`; }).join("");
  return `<svg class="yard" viewBox="0 0 372 104" role="img" aria-label="${y.crates} crates stand in the yard${y.old ? ", left out for more than " + YARD_DAYS + " days" : ""}"><line class="yard-ground" x1="0" y1="100" x2="372" y2="100"/>${cells}</svg>`;
}

// Trip list under the map: progress bar, ETA, and a warning when a breakdown delayed the trip.
export function tripListHtml(s) {
  return activeTrips(s).map(t => { const pr = Math.round(tripProgress(s, t) * 100), left = Math.max(0, t.eta - s.day);
    return `<div class="trip"><div class="trip-top"><span>Trip ${t.id} · ${t.kind} · ${Math.round(t.km).toLocaleString("en-US")} km</span><b>${left ? "arrives in " + left + " day" + (left > 1 ? "s" : "") : "arrives today"}</b></div><div class="meter"><i style="width:${pr}%"></i></div>${t.delay ? `<small class="warnr">Breakdown on the road: ${t.delay} day${t.delay > 1 ? "s" : ""} late.</small>` : ""}</div>`; }).join("");
}

// Factory floor picture: juice bottling line on top, electronics assembly line below. A line is lit when one of its machines has a run set.
export function factorySceneSvg(s) {
  const fx = s.fx; if (!fx || !fx.machines) return "";
  const lines = { juice: [], gadget: [] }; for (const m of fx.machines) (lines[(D.MACHINES.find(x => x.id === m.type) || {}).line || "juice"] || lines.juice).push(m);
  const run = l => lines[l].some(m => m.job), n = l => lines[l].length;
  const bottles = Array.from({ length: 9 }, (_, i) => `<rect class="bt${run("juice") ? " go" : ""}" style="animation-delay:${-i * .4}s" x="${150 + i * 46}" y="52" width="10" height="22" rx="3"/>`).join("");
  const boards = Array.from({ length: 7 }, (_, i) => `<rect class="pcb${run("gadget") ? " go" : ""}" style="animation-delay:${-i * .5}s" x="${150 + i * 56}" y="150" width="26" height="14" rx="2"/>`).join("");
  return `<svg class="fsc" viewBox="0 0 600 200" role="img" aria-label="Factory floor: ${n("juice")} juice machine(s) above, ${n("gadget")} electronics machine(s) below"><rect class="fsc-bg" width="600" height="200" rx="10"/>
<g><rect class="tank" x="20" y="22" width="34" height="56" rx="6"/><rect class="tank" x="62" y="30" width="34" height="48" rx="6"/><path class="pipe" d="M54 40 H62 M96 52 H130 V70 H570"/><rect class="belt" x="130" y="74" width="450" height="8"/>${bottles}<text class="fsc-t" x="20" y="102">Juice line · ${n("juice")} machine${n("juice") === 1 ? "" : "s"} · ${run("juice") ? "running" : "idle"}</text></g>
<line class="fsc-div" x1="14" y1="112" x2="586" y2="112"/>
<g><rect class="bin" x="20" y="132" width="26" height="30" rx="3"/><rect class="bin" x="52" y="132" width="26" height="30" rx="3"/><path class="arm${run("gadget") ? " go" : ""}" d="M104 168 V140 L130 120 L150 130"/><circle class="joint" cx="104" cy="168" r="6"/><rect class="belt" x="130" y="164" width="450" height="8"/>${boards}<text class="fsc-t" x="20" y="192">Electronics assembly line · ${n("gadget")} machine${n("gadget") === 1 ? "" : "s"} · ${run("gadget") ? "running" : "idle"}</text></g></svg>`;
}
