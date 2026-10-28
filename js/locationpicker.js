// Location picker: globe + hierarchy (Earth > Country > Region > City > District) + search + market summary + comparison.
// Reads the location catalog and the engine's estimate functions; changes no game state by itself.
import * as LOC from "./locations.js";
import * as E from "./engine.js";
import { createGlobe } from "./globe.js";

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money0 = n => "$" + Math.round(n).toLocaleString();
const CATS = { food: "Food", drinks: "Drinks", household: "Household", stationery: "Stationery", electronics: "Electronics" };

export function createLocationPicker({ root, getDifficulty = () => "normal", onPick }) {
  const body = root.querySelector("#globeBody");
  const canvasHost = root.querySelector("#globeCv");
  const st = { country: null, region: null, city: null, sel: null, q: "", compare: [] };
  let globe = null, current = "default";

  const all = () => LOC.playableLocations();
  const level = () => (st.q ? "search" : !st.country ? "earth" : !st.region ? "country" : !st.city ? "region" : "city");
  function items() {
    const L = all();
    if (st.q) return LOC.search(st.q).map(l => ({ kind: "site", loc: l }));
    if (!st.country) return LOC.countries().map(c => ({ kind: "country", name: c, n: L.filter(l => l.country === c).length }));
    const inC = L.filter(l => l.country === st.country);
    if (!st.region) return [...new Set(inC.map(l => l.region))].map(r => ({ kind: "region", name: r, n: inC.filter(l => l.region === r).length }));
    const inR = inC.filter(l => l.region === st.region);
    if (!st.city) return [...new Set(inR.map(l => l.city))].map(c => ({ kind: "city", name: c, n: inR.filter(l => l.city === c).length }));
    return inR.filter(l => l.city === st.city).map(l => ({ kind: "site", loc: l }));
  }
  function focusOn(list) {
    if (!globe || !list.length) return;
    const la = list.reduce((a, l) => a + l.lat, 0) / list.length, lo = list.reduce((a, l) => a + l.lon, 0) / list.length;
    globe.focus(la, lo, list.length === 1 ? 2.4 : 1.4);
  }
  function selectSite(id) {
    const l = LOC.getLocation(id); if (l.id === "default") return;
    st.sel = id; st.q = ""; st.country = l.country; st.region = l.region; st.city = l.city;
    globe && (globe.select(id), globe.focus(l.lat, l.lon, 2.6)); render();
  }
  function crumbs() {
    const parts = [["Earth", () => { st.country = st.region = st.city = null; globe && globe.reset(); }]];
    if (st.country) parts.push([st.country, () => { st.region = st.city = null; focusOn(all().filter(l => l.country === st.country)); }]);
    if (st.region) parts.push([st.region, () => { st.city = null; focusOn(all().filter(l => l.region === st.region)); }]);
    if (st.city) parts.push([st.city, () => focusOn(all().filter(l => l.city === st.city))]);
    return parts;
  }
  const bar = v => `<span class="gbar"><i style="width:${Math.max(4, Math.min(100, v * 100))}%"></i></span>`;
  function detail(id) {
    const l = LOC.getLocation(id), d = getDifficulty(), est = E.siteEstimate(id, d), fit = E.siteSuitability(id);
    const sup = ["FreshFarm Co-op", "Metro Wholesale", "QuickShip Express"].map((n, i) => ({ n, ok: !l.noSupplier.includes(["freshfarm", "metro", "quickship"][i]) }));
    return `<div class="gdetail">
      <h4>${esc(l.name)} <span class="tag info">simulated district</span></h4>
      <p class="muted small">${esc(l.country)} · ${esc(l.region)} · ${esc(l.city)} · ${esc(l.character)}, ${esc(l.popClass)} · ${esc(l.tz)} · local currency ${esc(l.currency)} (game money stays in $)</p>
      <div class="cards">
        <div class="stat"><small>Customers / day</small><b>${est.customers[0]}–${est.customers[1]}</b></div>
        <div class="stat"><small>Sales / day (est.)</small><b>${money0(est.revenue[0])}–${money0(est.revenue[1])}</b></div>
        <div class="stat"><small>Fixed cost / day</small><b>${money0(est.fixedPerDay)}</b></div>
        <div class="stat"><small>Break-even</small><b>${est.breakEvenCustomers == null ? "n/a" : est.breakEvenCustomers + " cust/day"}</b></div>
      </div>
      <p class="muted small">Estimate, not a promise. ${esc(est.assumptions)}</p>
      <h5>Corner-shop suitability: ${fit.total} / 100</h5>
      <table class="tbl"><thead><tr><th>Factor</th><th>Weight</th><th>Score</th><th>Why</th></tr></thead><tbody>${fit.parts.map(p => `<tr><td>${esc(p.name)}</td><td>${p.w}%</td><td>${Math.round(p.v * 100)}% ${bar(p.v)}</td><td>${esc(p.why)}</td></tr>`).join("")}</tbody></table>
      <p class="muted small">Score = sum of weight × factor score. A higher score is not a guarantee: prices, stock, staff and events still decide the result.</p>
      <h5>What sells here (demand vs neutral start)</h5>
      <div class="gcats">${Object.entries(l.cat).map(([k, v]) => `<div><span>${CATS[k]}</span>${bar(v / 1.6)}<b>×${v}</b></div>`).join("")}</div>
      <h5>Operating conditions</h5>
      <div class="gkv"><span>Rent</span><b>×${l.rent}</b><span>Wages</span><b>×${l.wage}</b><span>Utilities</span><b>×${l.utilities}</b><span>Delivery fee and time</span><b>×${l.logistics}</b><span>Purchasing power</span><b>×${l.power}</b><span>Price sensitivity</span><b>×${l.priceSens}</b><span>Rival pressure</span><b>${Math.round(l.competition * 100)}%</b></div>
      <p class="small">Suppliers: ${sup.map(s => `<span class="tag ${s.ok ? "ok" : "bad"}">${esc(s.n)}${s.ok ? "" : " (not served)"}</span>`).join(" ")}</p>
      <p class="muted small">Data note: ${esc(l.provenance)}</p>
      <div class="row gap wrap"><button class="primary" data-g="use" data-id="${esc(id)}">Use this location</button>
        <button class="ghost" data-g="cmp" data-id="${esc(id)}">${st.compare.includes(id) ? "Remove from comparison" : "Add to comparison"}</button></div></div>`;
  }
  function compareTable() {
    if (st.compare.length < 2) return st.compare.length ? `<p class="muted small">Add one more site to compare side by side.</p>` : "";
    const d = getDifficulty(), rows = st.compare.map(id => ({ l: LOC.getLocation(id), e: E.siteEstimate(id, d), f: E.siteSuitability(id) }));
    const r = (label, fn) => `<tr><th>${label}</th>${rows.map(x => `<td>${fn(x)}</td>`).join("")}</tr>`;
    return `<h5>Comparison</h5><div class="scroll"><table class="tbl"><thead><tr><th></th>${rows.map(x => `<th>${esc(x.l.city)}<br><small>${esc(x.l.district)}</small></th>`).join("")}</tr></thead><tbody>
      ${r("Suitability", x => x.f.total + " / 100")}${r("Customers / day", x => `${x.e.customers[0]}–${x.e.customers[1]}`)}${r("Sales / day", x => `${money0(x.e.revenue[0])}–${money0(x.e.revenue[1])}`)}
      ${r("Fixed cost / day", x => money0(x.e.fixedPerDay))}${r("Break-even", x => (x.e.breakEvenCustomers == null ? "n/a" : x.e.breakEvenCustomers + " cust/day"))}${r("Rent", x => "×" + x.l.rent)}${r("Wages", x => "×" + x.l.wage)}
      ${r("Competition", x => Math.round(x.l.competition * 100) + "%")}${r("Purchasing power", x => "×" + x.l.power)}${r("Logistics", x => "×" + x.l.logistics)}</tbody></table></div>`;
  }
  function render() {
    const lv = level(), list = items();
    const crumb = st.q ? `<span class="muted small">Search results for “${esc(st.q)}”</span>` : crumbs().map(([n], i) => `<button class="ghost mini" data-g="crumb" data-i="${i}">${esc(n)}</button>`).join(" › ");
    const listHtml = list.length ? list.map((it, i) => it.kind === "site"
      ? `<button class="gitem ${st.sel === it.loc.id ? "on" : ""}" data-g="site" data-id="${esc(it.loc.id)}"><b>${esc(it.loc.district)}</b><small>${esc(it.loc.city)}, ${esc(it.loc.country)} · ${esc(it.loc.character)}</small></button>`
      : `<button class="gitem" data-g="${it.kind}" data-name="${esc(it.name)}"><b>${esc(it.name)}</b><small>${it.n} site${it.n === 1 ? "" : "s"}</small></button>`).join("")
      : `<p class="muted">No location matches “${esc(st.q)}”. Try a city or country name.</p>`;
    const keep = body.querySelector("#gq"), had = document.activeElement === keep, pos = keep ? keep.selectionStart : 0;
    body.innerHTML = `<label class="field">Search a place<input id="gq" type="search" placeholder="Medan, Tokyo, Indonesia…" value="${esc(st.q)}" autocomplete="off"></label>
      <div class="gcrumb">${crumb}</div><div class="glist" data-level="${lv}">${listHtml}</div>
      ${st.sel ? detail(st.sel) : `<p class="muted small">Pick a country, then a region, city and district. Or tap a marker on the globe. The globe is a schematic with simplified coastlines.</p>`}
      ${compareTable()}
      <div class="row gap wrap"><button class="ghost" data-g="neutral">Use the neutral start (no location)</button>${current !== "default" ? `<span class="muted small">Current: ${esc(LOC.getLocation(current).name)}</span>` : ""}</div>`;
    const q = body.querySelector("#gq"); if (had && q) { q.focus(); q.setSelectionRange(pos, pos); }
  }
  body.addEventListener("input", e => { if (e.target.id === "gq") { st.q = e.target.value; render(); } });
  body.addEventListener("click", e => {
    const t = e.target.closest("[data-g]"); if (!t) return; const a = t.dataset.g;
    if (a === "country") { st.country = t.dataset.name; st.region = st.city = null; focusOn(all().filter(l => l.country === st.country)); render(); }
    else if (a === "region") { st.region = t.dataset.name; st.city = null; focusOn(all().filter(l => l.region === st.region)); render(); }
    else if (a === "city") { st.city = t.dataset.name; focusOn(all().filter(l => l.city === st.city)); render(); }
    else if (a === "site") selectSite(t.dataset.id);
    else if (a === "crumb") { const fn = crumbs()[Number(t.dataset.i)]; fn && fn[1](); st.q = ""; render(); }
    else if (a === "cmp") { const id = t.dataset.id; st.compare = st.compare.includes(id) ? st.compare.filter(x => x !== id) : [...st.compare, id].slice(-3); render(); }
    else if (a === "use") { onPick(t.dataset.id); close(); }
    else if (a === "neutral") { onPick("default"); close(); }
  });
  function open(cur = "default") {
    current = cur; root.hidden = false; document.body.classList.add("modal-open");
    if (!globe) globe = createGlobe(canvasHost, { markers: all(), onPick: id => selectSite(id) });
    globe.start(); if (cur !== "default") { const l = LOC.getLocation(cur); st.sel = cur; st.country = l.country; st.region = l.region; st.city = l.city; globe.select(cur); globe.focus(l.lat, l.lon, 2.4); } else globe.reset();
    render(); root.querySelector("[data-gclose]").focus();
  }
  function close() { root.hidden = true; document.body.classList.remove("modal-open"); globe && globe.stop(); }
  root.querySelectorAll("[data-gclose]").forEach(b => b.addEventListener("click", close));
  root.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  root.addEventListener("click", e => { if (e.target === root) close(); });
  root.querySelector("#gZoomIn").onclick = () => globe && globe.zoomBy(1.25);
  root.querySelector("#gZoomOut").onclick = () => globe && globe.zoomBy(0.8);
  root.querySelector("#gReset").onclick = () => globe && globe.reset();
  return { open, close };
}
