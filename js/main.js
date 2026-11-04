// Wiring: the game loop, tabs, buttons, setup and dialogs. All rules live in engine.js.
import * as E from "./engine.js";
import * as D from "./data.js";
import * as LOC from "./locations.js";
import * as UI from "./ui.js";
import * as SC from "./screens.js";
import { act, newForms, setField } from "./actions.js";
import { createScene } from "./scene.js?v=20261104a";
import * as Ml from "./mail.js";
import * as Sn from "./scenario.js";
import * as Kp from "./kpi.js";
import { createLocationPicker } from "./locationpicker.js";
import { startFit } from "./fit.js";
import * as Lv from "./live.js";

const $ = id => document.getElementById(id);
const SAVE_KEY = "economy-save-v11", OLD_KEYS = ["economy-save-v3", "economy-mp-save"];
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } }, del: k => { try { localStorage.removeItem(k); } catch { /* storage blocked */ } } };

let s = null, paused = false, finalShown = false, chosenLoc = "id-medan-central", lastSave = 0, lastView = 0, lastDay = 0, live = null, liveStartAt = 0, liveFirst = false;
const ui = { results: [], unread: 0, f: newForms(), main: "finance", sub: { finance: "overview", retail: "location", warehouse: "stock", shipping: "co", factory: "machines", b2b: "market", data: "score", mail: "inbox" }, buy: { sup: "local", qty: { noodles: 10000, milk: 0, earbuds: 0 } }, whbuy: { mode: "wh", sup: "harbor", qty: { noodles: 100000, milk: 0, earbuds: 0 } }, tr: { qty: {} }, space: 10, spaceMode: "shop", poMode: "retail" };

// ---------- small helpers ----------
// ---------- news broadcast ticker ----------
const _bq = [], _bseen = new Map();
function broadcast(text, kind = "") {
  const key = text.slice(0, 60);
  const now = Date.now();
  // Deduplicate within a 5-second window
  if (_bseen.has(key) && now - _bseen.get(key) < 5000) return;
  _bseen.set(key, now);
  const prefix = kind === "err" ? "\u26a0 " : "";
  _bq.push(prefix + text);
  if (_bq.length > 12) _bq.shift();
  const el = document.getElementById("tickerText");
  if (!el) return;
  el.textContent = _bq.join("  \u2756  ");
  // Restart scroll animation by forcing a reflow
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
}
const toast = broadcast; // alias so existing call sites work
const save = () => { if (s) ls.set(SAVE_KEY, E.serialize(s)); lastSave = performance.now(); };

// ---------- render ----------
function renderHud() {
  if (!s) { setText($("hDay"), "Day - / -"); setText($("hTime"), "-"); return; }
  const d = E.dashboard(s), tl = Math.ceil(E.timeLeft(s));
  setText($("hDay"), s.days ? `Day ${Math.min(s.day, s.days)} / ${s.days}` : `Day ${s.day} / \u221e`);
  setText($("hTime"), s.ended ? "Finished" : `${tl} second${tl === 1 ? "" : "s"}`);
  document.querySelector(".k-time").classList.toggle("low", !s.ended && tl <= 5);
  setText($("hCash"), UI.money(d.cash));
  const n = $("hNet"); setText(n, UI.money(d.netProfit)); n.className = d.netProfit < 0 ? "neg" : d.netProfit > 0 ? "pos" : "";
  setText($("locLabel"), `${LOC.getLocation(s.location).city} · ${s.area} m²`);
  $("bPause").disabled = !!live; $("bPause").textContent = paused ? "Resume" : "Pause"; $("bPause").classList.toggle("on", paused);
  const wait = live && Date.now() < liveStartAt ? Math.ceil((liveStartAt - Date.now()) / 1000) : 0, lb = live && live.state.phase !== "lobby" ? live.leaderboard().find(r => r.me) : null;
  setText($("status"), wait ? `Live game starts in ${wait} s.` : s.ended ? "The game is over." : paused ? "Paused. The timer is stopped." : `Running. Day ${s.day} ends in ${tl} s.${lb && live.state.scores[live.state.id] ? ` Rank ${lb.place} of ${live.leaderboard().length}.` : ""}`);
  setHtml($("log"), s.log.slice(-8).reverse().map(l => `<div><small>Day ${l.day}</small> ${UI.esc(l.text)}</div>`).join(""));
}
const SOON = { mail: ["Mail", "Messages from suppliers, the bank and the facilitator will be here."], data: ["Data Explorer", "Charts and tables to dig into your numbers will be here."] };
function viewFor() {
  const m = ui.main, sub = ui.sub[m];
  if (m === "finance") return sub === "reports" ? UI.reports(s) : sub === "statements" ? SC.statements(s) : sub === "bank" ? SC.bank(s, ui.f) : sub === "ledger" ? SC.ledgerScreen(s, ui.f) : SC.warningsCard(s) + UI.dashboard(s);
  if (m === "factory") return sub === "raw" ? SC.factoryRaw(s, ui.f) : sub === "mrp" ? SC.factoryMrp(s) : sub === "juice" ? SC.factoryJuice(s, ui.f) : SC.factoryMachines(s, ui.f);
  if (m === "b2b") return sub === "contracts" ? SC.b2bContracts(s) : SC.b2bMarket(s, ui.f);
  if (m === "hr") return SC.hrScreen(s, ui.f);
  if (m === "marketing") return SC.marketing(s, ui.f);
  if (m === "ecom") return SC.ecom(s);
  if (m === "mail") return ui.sub.mail === "facilitator" ? SC.facilitatorScreen(s, ui.f, ui.results, live && live.state.phase !== "lobby" && live.state.phase !== "idle" ? { code: live.state.code, role: live.state.role, board: live.leaderboard() } : null) : SC.mailScreen(s);
  if (m === "data") return sub === "market" ? SC.competitors(s) : sub === "bi" ? SC.biScreen(s) : sub === "forecast" ? SC.forecast(s) : SC.scoring(s, ui.f);
  if (m === "warehouse" && sub === "b2b") return SC.b2bContracts(s);
  if (m === "retail") return { location: UI.location, procurement: x => UI.buy(x, ui), store: x => UI.store(x, "table"), price: x => UI.store(x, "prices"), tx: UI.transactions }[sub](s);
  if (m === "warehouse") return UI.warehouse(s, sub);
  if (m === "shipping") return UI.ship(s, ui);
  return UI.soon(...SOON[m]);
}
const setHtml = (el, h) => { if (el._h !== h) { el._h = h; el.innerHTML = h; } }, setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };
function renderNav() { const n = UI.navHtml(ui); setHtml($("tabs"), n.main); setHtml($("subtabs"), n.sub); $("subtabs").hidden = !n.sub; }
function goto(main, sub) { ui.main = main; if (sub) ui.sub[main] = sub; renderNav(); renderAll(true); }
let lastHtml = "";
function renderView(force) {
  if (!s) { lastHtml = ""; $("view").innerHTML = `<div class="card"><p>No game yet. Open the menu and start a new game.</p></div>`; return; }
  const a = document.activeElement;
  if (!force && a && a.closest && a.closest("#view") && /INPUT|SELECT/.test(a.tagName)) return;      // never rebuild while someone types
  const html = viewFor();
  if (html === lastHtml) return;                                    // nothing changed: no layout, no paint
  lastHtml = html; const y = window.scrollY;
  $("view").innerHTML = html;
  window.scrollTo(0, y);
}
function renderAll(force) { if (s && Ml.unread(s) !== ui.unread) { ui.unread = Ml.unread(s); renderNav(); } renderHud(); renderView(force); lastView = performance.now(); }

// ---------- game loop (the engine owns time; frames only feed it elapsed seconds) ----------
let prev = performance.now();
function loop(now) {
  const dt = Math.min(0.5, (now - prev) / 1000); prev = now;
  if (live && liveStartAt && !liveFirst && Date.now() >= liveStartAt) { liveFirst = true; liveReport(); }
  if (s && !paused && !s.ended && !document.hidden && !(live && Date.now() < liveStartAt)) {
    E.tick(s, dt);
    if (s.day !== lastDay) { liveReport(); const r = s.lastReport; if (r && lastDay) toast(`Day ${r.day}: sales ${UI.money(r.revenue)}, net ${UI.money(r.net)}`, r.net >= 0 ? "ok" : "err"); lastDay = s.day; save(); renderAll(true); }
    if (s.ended) { liveReport(); save(); renderAll(true); showFinal(); }
  }
  if (now - lastView > 400) renderAll(false);
  if (s && now - lastSave > 5000) save();
  requestAnimationFrame(loop);
}

// ---------- tabs and view actions ----------
$("tabs").addEventListener("click", e => {
  const b = e.target.closest("[data-main]"); if (!b) return;
  if (b.dataset.main === "info") { openMenu("menuHelp"); return; }
  goto(b.dataset.main);
});
$("subtabs").addEventListener("click", e => { const b = e.target.closest("[data-sub]"); if (b) goto(ui.main, b.dataset.sub); });
$("view").addEventListener("click", e => {
  if (!s) return; const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.resexport) { const card = Sn.resultCard(s, Kp.scoreboard(s).total, ui.f.team), a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(card)], { type: "application/json" })); a.download = `economy-result-${(card.name || "team").replace(/[^a-z0-9]+/gi, "-")}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast("Result saved. Hand the file to the facilitator.", "ok"); return; }
  if (t.dataset.respick) { $("resIn").click(); return; }
  if (t.dataset.liveleave) { leaveLive(); toast("You left the room. You keep playing on your own.", "ok"); renderAll(true); return; }
  if (t.dataset.resclear) { ui.results = []; renderAll(true); return; }
  if (t.dataset.goto) { goto(t.dataset.goto, t.dataset.gsub || undefined); return; }
  if (t.dataset.act) { const r = act(s, ui.f, t.dataset.act, { id: t.dataset.id, dir: t.dataset.dir, juice: t.dataset.juice, batch: t.dataset.batch }); if (!r.ok) toast(r.error, "err"); else { toast(r.msg, "ok"); save(); if (t.dataset.act === "evGo" && live && live.state.role === "host") live.announce(ui.f.ev); } renderAll(true); return; }
  if (t.dataset.price) { const r = E.adjustPrice(s, t.dataset.price, Number(t.dataset.dir)); if (!r.ok) toast(r.error, "err"); save(); renderAll(true); }
  else if (t.dataset.posup) { ui.buy.sup = t.dataset.posup; openPo("retail"); }
  else if (t.dataset.whsup) { ui.whbuy.sup = t.dataset.whsup; openPo("wh"); }
  else if (t.id === "poOpen") openPo("retail");
  else if (t.id === "whPoOpen") openPo("wh");
  else if (t.id === "spOpen") { ui.spaceMode = "shop"; ui.space = D.SPACE_STEPS.find(n => n <= D.AREA.max - s.area) || 10; renderSp(); $("spDlg").showModal(); }
  else if (t.id === "whRentOpen") { ui.spaceMode = "wh"; ui.space = D.WH.areaSteps.find(n => n <= D.WH.maxArea - s.wh.area) || D.WH.minArea; renderSp(); $("spDlg").showModal(); }
  else if (t.id === "trOpen") { ui.tr = { qty: {} }; renderTr(); $("trDlg").showModal(); }
});
// Module screens: selects and inputs. Form fields only store a value; a re-draw updates quotes and totals.
$("view").addEventListener("change", e => {
  const t = e.target; if (!s || !t) return;
  if (t.dataset.f) { setField(ui.f, t.dataset.f, t.value, !!t.dataset.num); renderAll(true); return; }
  if (t.dataset.mj) { const id = t.dataset.mj, juice = $("mj-" + id + "-juice").value, pc = Number($("mj-" + id + "-qty").value) || 0, m = s.fx.machines.find(x => x.id === Number(id));
    const pcx = t.id.endsWith("-juice") && m && !m.job ? 100 : pc, r = act(s, ui.f, "setjob", { id, juice, qty: juice && m ? Math.round(E.MACHINE_PER_DAY(m) * pcx / 100) : 0 }); if (!r.ok) toast(r.error, "err"); save(); renderAll(true); return; }
  if (t.dataset.hrf) { const r = act(s, ui.f, t.dataset.hrf, { value: t.value }); if (!r.ok) toast(r.error, "err"); save(); renderAll(true); return; }
  if (t.dataset.ecf) { const r = act(s, ui.f, "ecomAds", { value: t.value }); if (!r.ok) toast(r.error, "err"); save(); renderAll(true); }
});
$("view").addEventListener("input", e => { const t = e.target; if (s && t && t.dataset && t.dataset.f && t.type === "number") setField(ui.f, t.dataset.f, t.value, true); });
function renderSp() { if (s) { $("spTitle").textContent = ui.spaceMode === "wh" ? (s.wh.area ? "Rent more warehouse space" : "Rent a warehouse") : "Rent more space"; $("spBody").innerHTML = UI.spaceForm(s, ui.space, ui.spaceMode); } }
$("spDlg").addEventListener("change", e => { if (e.target.id === "spExtra") { ui.space = Number(e.target.value); renderSp(); } });
$("spDlg").addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t || !s) return;
  if (t.id === "spX" || t.id === "spCancel") $("spDlg").close();
  else if (t.id === "spSubmit") { const wh = ui.spaceMode === "wh", r = wh ? E.rentWarehouse(s, ui.space) : E.rentMoreSpace(s, ui.space); if (!r.ok) { toast(r.error, "err"); renderSp(); return; } $("spDlg").close(); toast(`${wh ? "Warehouse" : "Shop"} is now ${r.area} m². Rent ${UI.money2(r.rent)} per day.`, "ok"); save(); renderAll(true); }
});
const PB = () => (ui.poMode === "wh" ? ui.whbuy : ui.buy);
function renderTr() { if (s) $("trBody").innerHTML = UI.transferForm(s, ui.tr); }
$("trDlg").addEventListener("change", e => { const t = e.target, pid = t.dataset && t.dataset.pid; if (t.id === "trCarrier") { ui.tr.carrier = t.value; renderTr(); return; } if (!pid || !t.id.startsWith("trQty-")) return; ui.tr.qty[pid] = t.value === "all" ? s.wh.qty[pid] : Number(t.value); renderTr(); });
$("trDlg").addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t || !s) return;
  if (t.id === "trX" || t.id === "trCancel") $("trDlg").close();
  else if (t.id === "trSubmit") {
    const r = E.sendToRetail(s, { carrier: ui.tr.carrier, lines: D.PRODUCTS.map(p => ({ pid: p.id, qty: ui.tr.qty[p.id] || 0 })) });
    if (!r.ok) { toast(r.error, "err"); renderTr(); return; }
    $("trDlg").close(); toast(`Sent to the shop. Arrives day ${r.eta}.`, "ok"); save(); goto("shipping", "tx");
  }
});
function openPo(mode) { ui.poMode = mode; const d = $("poDlg"); renderPo(); if (!d.open) d.showModal(); }
function renderPo() { if (s) { $("poTitle").textContent = ui.poMode === "wh" ? "Bulk purchase order" : "Purchase order"; $("poBody").innerHTML = UI.orderForm(s, PB()); } }
$("poDlg").addEventListener("change", e => {
  const t = e.target, pid = t.dataset && t.dataset.pid, B = PB(), wh = ui.poMode === "wh", ch = wh ? D.WH_QTY : D.QTY_CHOICES, lo = wh ? D.WH.minQty : 1, hi = wh ? D.WH.maxQty : D.MAX_QTY;
  if (t.id === "poSup") B.sup = t.value;
  else if (t.id === "poCarrier") B.carrier = t.value;
  else if (pid && t.id.startsWith("poQty-")) { if (t.value === "custom") { const n = B.qty[pid]; B.qty[pid] = n > 0 && !ch.includes(n) ? n : (wh ? D.WH.minQty : 500); } else B.qty[pid] = Number(t.value); }
  else if (pid && t.id.startsWith("poCustom-")) { const v = Math.round(Number(t.value)); B.qty[pid] = v >= 1 ? Math.min(hi, Math.max(lo, v)) : 0; }
  else return;
  renderPo();
});
$("poDlg").addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t || !s) return;
  if (t.id === "poX" || t.id === "poCancel") $("poDlg").close();
  else if (t.id === "poSubmit") {
    const B = PB(), r = E.placeOrders(s, { supplier: B.sup, dest: ui.poMode === "wh" ? "wh" : "retail", carrier: B.carrier, lines: D.PRODUCTS.map(p => ({ pid: p.id, qty: B.qty[p.id] || 0 })) });
    if (!r.ok) { toast(r.error, "err"); renderPo(); return; }
    $("poDlg").close(); toast(`Ordered ${r.orders.length} item${r.orders.length > 1 ? "s" : ""}. Arrives day ${r.eta}.`, "ok"); save(); goto("shipping", "tx");
  }
});

// ---------- header buttons ----------
$("bPause").onclick = () => { if (live) { toast("Live games cannot be paused.", "err"); return; } if (!s || s.ended) return; paused = !paused; renderHud(); };
$("bHelp").onclick = () => openMenu("menuHelp");
$("bMenu").onclick = () => openMenu("menuMain");

// ---------- menu, setup, help ----------
const SECTIONS = ["menuMain", "menuSetup", "menuHelp", "menuLive"];
function openMenu(section = "menuMain") {
  SECTIONS.forEach(id => { $(id).hidden = id !== section; });
  $("mContinue").hidden = !s || !!s.ended; $("mClose").hidden = !s;
  $("helpBody").innerHTML = UI.HELP;
  if (!$("menuDlg").open) $("menuDlg").showModal();
  if (s && !s.ended && !paused && !live) { paused = true; menuPaused = true; renderHud(); }
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
$("resIn").onchange = async () => {
  const files = [...$("resIn").files]; $("resIn").value = ""; let bad = 0;
  for (const f of files) { const r = Sn.parseResult(await f.text()); if (r) ui.results.push(r); else bad++; }
  toast(bad ? `${files.length - bad} loaded, ${bad} not a result file.` : `${files.length} result${files.length === 1 ? "" : "s"} loaded.`, bad ? "err" : "ok"); renderAll(true);
};
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
  const inf = $("sDaysInf") && $("sDaysInf").checked;
  const dVal = inf ? 0 : $("sDays").value;
  return E.cleanSetup({ location: chosenLoc, area: $("sAreaN").value, secPerDay: $("sSec").value, days: dVal, capital: $("sCap").value });
}
function readSetup() {
  const c = setupValues(), info = E.siteInfo(c.location, c.area), cap = E.capacityOf(c.area);
  $("sLocLabel").textContent = LOC.getLocation(c.location).name;
  const isInf = !c.days;
  const rentTerm = isInf ? " \xc2\xb7 <b>Infinite days mode</b>" : ` \xc2\xb7 <b>${UI.money(info.rent * c.days)}</b> for ${c.days} days`;
  $("rentBox").innerHTML = `<div class="big"><b>${UI.money2(info.rentM2)}</b> / m\xc2\xb2 / day</div><div>Total rent: <b>${UI.money2(info.rent)}</b> per day${rentTerm}</div>
    <div>Storage: <b>${UI.num(cap)}</b> space (about ${UI.num(cap)} noodles, or half as many milk)</div><div class="muted">Estimated sales: ${UI.money(info.revenue)} per day at full stock.</div>`;
  const total = c.secPerDay * c.days;
  $("lenNote").textContent = isInf ? "Infinite days mode. Game runs continuously without a day limit." : `The whole game takes about ${Math.floor(total / 60)} min ${total % 60} s of real time.`;
}
$("sArea").oninput = () => { $("sAreaN").value = $("sArea").value; readSetup(); };
$("sAreaN").oninput = () => { $("sArea").value = Math.min(D.AREA.max, Math.max(D.AREA.min, Number($("sAreaN").value) || D.AREA.min)); readSetup(); };
$("areaChips").onclick = e => { const b = e.target.closest("[data-area]"); if (b) { $("sAreaN").value = $("sArea").value = b.dataset.area; readSetup(); } };
for (const id of ["sSec", "sDays", "sCap"]) $(id).oninput = readSetup;
if ($("sDaysInf")) $("sDaysInf").onchange = () => { $("sDays").disabled = $("sDaysInf").checked; readSetup(); };
$("sScn").innerHTML = D.SCENARIOS.map(x => `<option value="${x.id}">${x.name}</option>`).join(""); $("sScn").onchange = () => { $("scnNote").textContent = (D.SCENARIOS.find(x => x.id === $("sScn").value) || {}).desc || ""; };
$("sStart").onclick = () => {
  const c = { ...setupValues(), scenario: $("sScn").value }; $("sAreaN").value = $("sArea").value = c.area; $("sSec").value = c.secPerDay;
  if (c.days) $("sDays").value = c.days;
  adopt(E.newGame(c)); closeMenu(); toast("Shop open. Order stock in the Procurement tab.", "ok");
};

function adopt(state, keepLive = false) {
  if (!keepLive) leaveLive();
  s = state; ui.f = newForms(); paused = false; finalShown = !!s.ended; lastDay = s.day; ui.main = "finance"; ui.buy = { sup: "local", qty: { noodles: 10000, milk: 0, earbuds: 0 } }; ui.whbuy = { mode: "wh", sup: "harbor", qty: { noodles: 100000, milk: 0, earbuds: 0 } }; ui.tr = { qty: {} };
  renderNav();
  scene.reset(); save(); renderAll(true);
}

// ---------- live play ----------
const liveBoardCard = () => { const me = live && live.state.id, st = s; if (!st) return null; const d = E.dashboard(st), c = Sn.resultCard(st, 0); return { day: st.day, score: Kp.defaultScore(st), netWorth: c.netWorth, netProfit: c.netProfit, cash: d.cash, ended: !!st.ended, me }; };
function liveReport() { if (live && s && live.state.phase === "running") live.reportScore(liveBoardCard()); }
function leaveLive() { if (live) { live.leave(); live = null; liveStartAt = 0; } if ($("bPause")) $("bPause").disabled = false; }
function renderLive() {
  if (!live) return; const st = live.state, inRoom = st.role && st.phase !== "idle";
  $("lJoinBox").hidden = inRoom; $("lLobby").hidden = !inRoom;
  $("lShow").textContent = st.code || "------";
  $("lPlayers").innerHTML = Object.values(st.players).map(p => `<span class="chip">${UI.esc(p.name)}${p.host ? " (host)" : ""}${p.id === st.id ? " (you)" : ""}</span>`).join("");
  const host = st.role === "host"; $("lSet").hidden = !host; $("lStart").hidden = !host; $("lStart").disabled = st.phase !== "lobby";
  $("lNote").textContent = st.error || (st.phase !== "lobby" ? "Starting…" : host ? `${Object.keys(st.players).length} in the room. Start when everyone has joined.` : "Waiting for the host to start.");
  if (st.error && !inRoom) { $("lNote").textContent = ""; $("mNote").textContent = st.error; }
}
async function enterLive(role) {
  const name = $("lName").value.trim() || "Player", code = role === "host" ? undefined : $("lCode").value.trim();
  if (role === "guest" && !Lv.validCode(code)) { toast("A room code is six digits.", "err"); return; }
  leaveLive();
  live = Lv.createLive(Lv.supabaseTransport(), { onChange: renderLive,
    onStart: (settings, at) => { adopt(E.newGame(settings), true); liveStartAt = at; liveFirst = false; closeMenu(); toast(role === "host" ? "Starting for everyone…" : "The host started the game.", "ok"); renderHud(); },
    onEvent: ev => { if (!s || s.ended) return; const r = Sn.inject(s, ev); if (r.ok) { toast("Event from the host: " + (ev.title || ev.kind), "ok"); save(); renderAll(true); } } });
  toast("Connecting…", "ok");
  try { await (role === "host" ? live.host(name) : live.join(name, code)); } catch (e) { toast(e.message, "err"); live = null; return; }
  try { localStorage.setItem("economy-name", name); } catch { /* optional */ }
  renderLive();
}
$("mLive").onclick = () => { SECTIONS.forEach(id => { $(id).hidden = id !== "menuLive"; }); if (!live) { $("lJoinBox").hidden = false; $("lLobby").hidden = true; } try { $("lName").value = localStorage.getItem("economy-name") || ""; } catch { /* optional */ } $("lScn").innerHTML = D.SCENARIOS.map(x => `<option value="${x.id}">${x.name}</option>`).join(""); };
$("lBack").onclick = () => { SECTIONS.forEach(id => { $(id).hidden = id !== "menuMain"; }); };
$("lHost").onclick = () => enterLive("host"); $("lJoin").onclick = () => enterLive("guest");
$("lLeave").onclick = () => { leaveLive(); $("lJoinBox").hidden = false; $("lLobby").hidden = true; };
$("lStart").onclick = () => {
  if (!live) return; const c = setupValues(), r = live.start({ ...c, secPerDay: $("lSec").value, days: $("lDays").value, capital: $("lCap").value, scenario: $("lScn").value, seed: undefined });
  if (!r.ok) toast(r.error, "err");
};

// ---------- final report ----------
function showFinal() {
  if (finalShown || !s || !s.ended) return; finalShown = true;
  $("finalBody").innerHTML = UI.finalReport(s); if (!$("finalDlg").open) $("finalDlg").showModal();
}
$("finalClose").onclick = () => $("finalDlg").close();
$("finalNew").onclick = () => { $("finalDlg").close(); openMenu("menuSetup"); readSetup(); };

// ---------- boot ----------
const scene = createScene($("stage"), { getState: () => s });
$("sceneTabs").addEventListener("click", e => { const b = e.target.closest("[data-scene]"); if (!b) return; scene.setView(b.dataset.scene); document.querySelectorAll("#sceneTabs button").forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-selected", on); }); });
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
