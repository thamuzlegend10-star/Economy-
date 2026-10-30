// Wiring: the game loop, tabs, buttons, setup and dialogs. All rules live in engine.js.
import * as E from "./engine.js";
import * as D from "./data.js";
import * as LOC from "./locations.js";
import * as UI from "./ui.js";
import { createScene } from "./scene.js";
import { createLocationPicker } from "./locationpicker.js";
import { startFit } from "./fit.js";

const $ = id => document.getElementById(id);
const SAVE_KEY = "economy-save-v11", OLD_KEYS = ["economy-save-v3", "economy-mp-save"];
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } }, del: k => { try { localStorage.removeItem(k); } catch { /* storage blocked */ } } };

let s = null, paused = false, finalShown = false, chosenLoc = "id-medan-central", lastSave = 0, lastView = 0, lastDay = 0;
const ui = { tab: "dash", buy: { sup: "local", qty: { noodles: 10000, milk: 0, earbuds: 0 } } };

// ---------- small helpers ----------
function toast(text, kind = "") {
  const t = document.createElement("div"); t.className = "toast " + kind; t.textContent = text; $("toasts").appendChild(t);
  requestAnimationFrame(() => t.classList.add("show")); setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 250); }, 3200);
}
const save = () => { if (s) ls.set(SAVE_KEY, E.serialize(s)); lastSave = performance.now(); };

// ---------- render ----------
function renderHud() {
  if (!s) { $("hDay").textContent = "Day - / -"; $("hTime").textContent = "-"; return; }
  const d = E.dashboard(s), tl = Math.ceil(E.timeLeft(s));
  $("hDay").textContent = `Day ${Math.min(s.day, s.days)} / ${s.days}`;
  $("hTime").textContent = s.ended ? "Finished" : `${tl} second${tl === 1 ? "" : "s"}`;
  document.querySelector(".k-time").classList.toggle("low", !s.ended && tl <= 5);
  $("hCash").textContent = UI.money(d.cash);
  const n = $("hNet"); n.textContent = UI.money(d.netProfit); n.className = d.netProfit < 0 ? "neg" : d.netProfit > 0 ? "pos" : "";
  $("locLabel").textContent = `${LOC.getLocation(s.location).city} · ${s.area} m²`;
  $("bPause").textContent = paused ? "Resume" : "Pause"; $("bPause").classList.toggle("on", paused);
  $("status").textContent = s.ended ? "The game is over." : paused ? "Paused. The timer is stopped." : `Running. Day ${s.day} ends in ${tl} s.`;
  $("log").innerHTML = s.log.slice(-8).reverse().map(l => `<div><small>Day ${l.day}</small> ${UI.esc(l.text)}</div>`).join("");
}
function renderView(force) {
  if (!s) { $("view").innerHTML = `<div class="card"><p>No game yet. Open the menu and start a new game.</p></div>`; return; }
  const a = document.activeElement;
  if (!force && a && a.closest && a.closest("#view") && /INPUT|SELECT/.test(a.tagName)) return;      // never rebuild while someone types
  const y = window.scrollY;
  $("view").innerHTML = { dash: UI.dashboard, store: UI.store, buy: x => UI.buy(x, ui), ship: UI.ship, rep: UI.reports }[ui.tab](s);
  window.scrollTo(0, y);
}
function renderAll(force) { renderHud(); renderView(force); lastView = performance.now(); }

// ---------- game loop (the engine owns time; frames only feed it elapsed seconds) ----------
let prev = performance.now();
function loop(now) {
  const dt = Math.min(0.5, (now - prev) / 1000); prev = now;
  if (s && !paused && !s.ended && !document.hidden) {
    E.tick(s, dt);
    if (s.day !== lastDay) { const r = s.lastReport; if (r && lastDay) toast(`Day ${r.day}: sales ${UI.money(r.revenue)}, net ${UI.money(r.net)}`, r.net >= 0 ? "ok" : "err"); lastDay = s.day; save(); renderAll(true); }
    if (s.ended) { save(); renderAll(true); showFinal(); }
  }
  if (now - lastView > 400) renderAll(false);
  if (s && now - lastSave > 5000) save();
  requestAnimationFrame(loop);
}

// ---------- tabs and view actions ----------
$("tabs").addEventListener("click", e => {
  const b = e.target.closest("[data-tab]"); if (!b) return;
  ui.tab = b.dataset.tab; document.querySelectorAll("#tabs button").forEach(x => x.classList.toggle("on", x === b)); renderAll(true);
});
$("view").addEventListener("click", e => {
  if (!s) return; const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.price) { const r = E.adjustPrice(s, t.dataset.price, Number(t.dataset.dir)); if (!r.ok) toast(r.error, "err"); save(); renderAll(true); }
  else if (t.id === "poOpen") openPo();
  else if (t.id === "spOpen") { ui.space = D.SPACE_STEPS.find(n => n <= D.AREA.max - s.area) || 10; renderSp(); $("spDlg").showModal(); }
});
function renderSp() { if (s) $("spBody").innerHTML = UI.spaceForm(s, ui.space); }
$("spDlg").addEventListener("change", e => { if (e.target.id === "spExtra") { ui.space = Number(e.target.value); renderSp(); } });
$("spDlg").addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t || !s) return;
  if (t.id === "spX" || t.id === "spCancel") $("spDlg").close();
  else if (t.id === "spSubmit") { const r = E.rentMoreSpace(s, ui.space); if (!r.ok) { toast(r.error, "err"); renderSp(); return; } $("spDlg").close(); toast(`Shop is now ${r.area} m². Rent ${UI.money2(r.rent)} per day.`, "ok"); save(); renderAll(true); }
});
function openPo() { const d = $("poDlg"); renderPo(); if (!d.open) d.showModal(); }
function renderPo() { if (s) $("poBody").innerHTML = UI.orderForm(s, ui.buy); }
$("poDlg").addEventListener("change", e => {
  const t = e.target, pid = t.dataset && t.dataset.pid;
  if (t.id === "poSup") ui.buy.sup = t.value;
  else if (pid && t.id.startsWith("poQty-")) { if (t.value === "custom") { const n = ui.buy.qty[pid]; ui.buy.qty[pid] = n > 0 && !D.QTY_CHOICES.includes(n) ? n : 500; } else ui.buy.qty[pid] = Number(t.value); }
  else if (pid && t.id.startsWith("poCustom-")) { const v = Math.round(Number(t.value)); ui.buy.qty[pid] = v >= 1 ? Math.min(D.MAX_QTY, v) : 0; }
  else return;
  renderPo();
});
$("poDlg").addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t || !s) return;
  if (t.id === "poX" || t.id === "poCancel") $("poDlg").close();
  else if (t.id === "poSubmit") {
    const r = E.placeOrders(s, { supplier: ui.buy.sup, lines: D.PRODUCTS.map(p => ({ pid: p.id, qty: ui.buy.qty[p.id] || 0 })) });
    if (!r.ok) { toast(r.error, "err"); renderPo(); return; }
    $("poDlg").close(); toast(`Ordered ${r.orders.length} item${r.orders.length > 1 ? "s" : ""}. Arrives day ${r.eta}.`, "ok"); save(); ui.tab = "ship"; document.querySelectorAll("#tabs button").forEach(x => x.classList.toggle("on", x.dataset.tab === "ship")); renderAll(true);
  }
});

// ---------- header buttons ----------
$("bPause").onclick = () => { if (!s || s.ended) return; paused = !paused; renderHud(); };
$("bHelp").onclick = () => openMenu("menuHelp");
$("bMenu").onclick = () => openMenu("menuMain");

// ---------- menu, setup, help ----------
const SECTIONS = ["menuMain", "menuSetup", "menuHelp"];
function openMenu(section = "menuMain") {
  SECTIONS.forEach(id => { $(id).hidden = id !== section; });
  $("mContinue").hidden = !s || !!s.ended; $("mClose").hidden = !s;
  $("helpBody").innerHTML = UI.HELP;
  if (!$("menuDlg").open) $("menuDlg").showModal();
  if (s && !s.ended && !paused) { paused = true; menuPaused = true; renderHud(); }
}
let menuPaused = false;
function closeMenu() { if ($("menuDlg").open) $("menuDlg").close(); }
$("menuDlg").addEventListener("close", () => { if (menuPaused) { paused = false; menuPaused = false; renderHud(); } });
$("mContinue").onclick = closeMenu; $("mClose").onclick = closeMenu;
$("mNew").onclick = () => { SECTIONS.forEach(id => { $(id).hidden = id !== "menuSetup"; }); readSetup(); };
$("mHelp").onclick = () => { SECTIONS.forEach(id => { $(id).hidden = id !== "menuHelp"; }); };
document.querySelectorAll("[data-back]").forEach(b => b.addEventListener("click", () => { SECTIONS.forEach(id => { $(id).hidden = id !== "menuMain"; }); }));
$("sBack").onclick = () => { SECTIONS.forEach(id => { $(id).hidden = id !== "menuMain"; }); };
$("mExport").onclick = () => {
  if (!s) { toast("There is no game to save yet.", "err"); return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([E.serialize(s)], { type: "application/json" })); a.download = "economy-save.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$("mImport").onclick = () => $("fileIn").click();
$("fileIn").onchange = async () => {
  const f = $("fileIn").files[0]; $("fileIn").value = ""; if (!f) return;
  const v = E.validateSave(await f.text());
  if (!v.ok) { $("mNote").textContent = v.error; toast(v.old ? "Old save: not supported." : "Could not load that file.", "err"); return; }
  adopt(v.state); closeMenu(); toast("Save loaded.", "ok");
};

// setup form
const picker = createLocationPicker({ root: $("globeDlg"), getArea: () => Number($("sAreaN").value) || D.AREA.def, onPick: id => { chosenLoc = id; readSetup(); } });
$("sLocBtn").onclick = () => picker.open(chosenLoc);
function setupValues() {
  return E.cleanSetup({ location: chosenLoc, area: $("sAreaN").value, secPerDay: $("sSec").value, days: $("sDays").value, capital: $("sCap").value });
}
function readSetup() {
  const c = setupValues(), info = E.siteInfo(c.location, c.area), cap = E.capacityOf(c.area);
  $("sLocLabel").textContent = LOC.getLocation(c.location).name;
  $("rentBox").innerHTML = `<div class="big"><b>${UI.money2(info.rentM2)}</b> / m² / day</div><div>Total rent: <b>${UI.money2(info.rent)}</b> per day · <b>${UI.money(info.rent * c.days)}</b> for ${c.days} days</div>
    <div>Storage: <b>${UI.num(cap)}</b> space (about ${UI.num(cap)} noodles, or half as many milk)</div><div class="muted">Estimated sales: ${UI.money(info.revenue)} per day at full stock.</div>`;
  const total = c.secPerDay * c.days; $("lenNote").textContent = `The whole game takes about ${Math.floor(total / 60)} min ${total % 60} s of real time.`;
}
$("sArea").oninput = () => { $("sAreaN").value = $("sArea").value; readSetup(); };
$("sAreaN").oninput = () => { $("sArea").value = Math.min(D.AREA.max, Math.max(D.AREA.min, Number($("sAreaN").value) || D.AREA.min)); readSetup(); };
$("areaChips").onclick = e => { const b = e.target.closest("[data-area]"); if (b) { $("sAreaN").value = $("sArea").value = b.dataset.area; readSetup(); } };
for (const id of ["sSec", "sDays", "sCap"]) $(id).oninput = readSetup;
$("sStart").onclick = () => {
  const c = setupValues(); $("sAreaN").value = $("sArea").value = c.area; $("sSec").value = c.secPerDay; $("sDays").value = c.days;
  adopt(E.newGame(c)); closeMenu(); toast("Shop open. Order stock in the Procurement tab.", "ok");
};

function adopt(state) {
  s = state; paused = false; finalShown = !!s.ended; lastDay = s.day; ui.tab = "dash"; ui.buy = { sup: "local", qty: { noodles: 10000, milk: 0, earbuds: 0 } };
  document.querySelectorAll("#tabs button").forEach(x => x.classList.toggle("on", x.dataset.tab === "dash"));
  scene.reset(); save(); renderAll(true);
}

// ---------- final report ----------
function showFinal() {
  if (finalShown || !s || !s.ended) return; finalShown = true;
  $("finalBody").innerHTML = UI.finalReport(s); if (!$("finalDlg").open) $("finalDlg").showModal();
}
$("finalClose").onclick = () => $("finalDlg").close();
$("finalNew").onclick = () => { $("finalDlg").close(); openMenu("menuSetup"); readSetup(); };

// ---------- boot ----------
const scene = createScene($("stage"), { getState: () => s });
startFit();
for (const k of OLD_KEYS) if (ls.get(k)) { ls.del(k); $("mNote").textContent = "An old save from an earlier version was removed. The game changed completely, so old saves cannot be used."; }
const raw = ls.get(SAVE_KEY);
if (raw) { const v = E.validateSave(raw); if (v.ok) { s = v.state; lastDay = s.day; finalShown = true; paused = true; } else ls.del(SAVE_KEY); }
window.__economyBooted = true;
window.__economy = { get state() { return s; }, E };                       // read-only handle for tests
renderAll(true);
if (s) { openMenu("menuMain"); $("mNote").textContent = s.ended ? "Your last game is finished. Start a new one." : "Your game is paused. Tap Continue."; menuPaused = !s.ended; }
else { openMenu("menuMain"); $("mContinue").hidden = true; }
requestAnimationFrame(t => { prev = t; lastView = t; requestAnimationFrame(loop); });
