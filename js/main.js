// App entry: wires the engine, the canvas world, the management UI, saving and the menus together.
import * as D from "./data.js";
import * as E from "./engine.js";
import { createWorld } from "./world.js";
import { createUI, money, money0 } from "./ui.js";
import { createCloud } from "./cloud.js";
import { createTutorial } from "./tutorial.js";
import { sound } from "./sound.js";
import { createMultiplayer } from "./multiplayer.js";
import { createSupabaseNet, createLocalNet } from "./net.js";
import { startFit } from "./fit.js";
import * as LOC from "./locations.js";
import { createLocationPicker } from "./locationpicker.js";

const $ = id => document.getElementById(id);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MP_KEY = "economy-mp-save", FAST = Math.max(1, Math.min(60, Number(new URLSearchParams(location.search).get("fast")) || 1));
const SAVE_KEY = "economy-save-v3", SETTINGS_KEY = "economy-settings-v1", TUT_KEY = "economy-tutorial-done";
const SPEEDS = [1, 2, 4];
const PACE = 0.5;   // game seconds per real second at 1x: one day lasts about 4 minutes

let mpMatch = false;
let state = null, speed = 1, paused = false, reportShown = false, finalShown = false;
let setupMode = "standard", lastHud = 0, lastSideKey = "";
const settings = Object.assign({ reduceMotion: false, confirm: true, sound: true, volume: 0.5 }, readJSON(SETTINGS_KEY));
sound.setEnabled(settings.sound); sound.setVolume(settings.volume);
const nativeConfirm = window.confirm.bind(window);

function readJSON(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function writeLS(key, val) { try { localStorage.setItem(key, val); return true; } catch { return false; } }

// ---------- toasts & status ----------
function toast(msg, kind = "info") {
  const el = document.createElement("div");
  el.className = "toast " + kind; el.textContent = msg;
  if (kind === "err") sound.play("error");
  $("toasts").appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, kind === "err" ? 4500 : 2600);
}
function setStatus(text, kind = "") { const el = $("status"); el.textContent = text; el.className = kind; }

// ---------- world + ui ----------
let ui = null;
const world = createWorld($("stage"), {
  getState: () => state,
  onOpen: panel => ui && ui.open(panel),
  onScene: name => document.querySelectorAll("#scenes [data-scene]").forEach(b => b.classList.toggle("on", b.dataset.scene === name)),
});
ui = createUI({ getState: () => state, onChange: () => { E.updateDerived(state); saveLocal(); updateHud(true); }, toast, world });
const tut = createTutorial({ getState: () => state, ui, world, setPaused: v => { paused = v; updateHud(true); } });
world.setReduced(settings.reduceMotion);
if (!settings.confirm) window.confirm = () => true;

// ---------- saving ----------
function saveLocal() { if (state) writeLS(mpMatch ? MP_KEY : SAVE_KEY, E.serialize(state)); }
function loadLocal() {
  const raw = (() => { try { return localStorage.getItem(SAVE_KEY); } catch { return null; } })();
  if (!raw) return null;
  const v = E.validateSave(raw);
  return v.ok ? v.state : null;
}
const cloud = createCloud();

// Progress is saved in this browser only. Supabase is used just for the online multiplayer channel.

// ---------- game flow ----------
function startState(s) {
  state = s; reportShown = false; finalShown = false;
  for (const k of Object.keys(hud)) delete hud[k];            // a different game: snap the money numbers instead of gliding from the old game
  if (state.phase === "report" && state.lastReport) reportShown = false;
  E.updateDerived(state);
  saveLocal(); updateHud(true); ui.refresh();
  maybeDialogs();
}

function maybeDialogs() {
  if (!state) return;
  if (state.phase === "report" && !reportShown) {
    reportShown = true;
    if (mpMatch) mp.reportProgress(state);
    ui.dayReport(state, () => {
      reportShown = false;
      if (state.ended) { showFinal(); return; }
      E.nextDay(state); saveLocal(); updateHud(true);
      if (mpMatch) mp.reportProgress(state);
      world.flash("Day " + state.day, "#ffb84d");
    });
  } else if (state.ended && state.phase !== "report" && !finalShown) {
    showFinal();
  }
}
function showFinal() {
  if (finalShown) return; finalShown = true;
  if (mpMatch) mp.submitFinal(E.serialize(state));   // host checks it and computes the official score
  ui.finalReport(state, {
    cont: () => { E.continueAfterEnd(state); finalShown = false; reportShown = false; saveLocal(); updateHud(true); },
    again: () => { if (mpMatch) { toast("Waiting for the other players to finish..."); return; } finalShown = false; openMenu(false); },
  });
  $("finalAgain").textContent = mpMatch ? "Wait for results" : "New game";
  if (mpMatch) $("finalContinue").hidden = true;
}

// ---------- HUD ----------
// Money numbers glide to their new value and the pill flashes green (up) or red (down).
const hud = {};
function setTarget(id, v) {
  if (!hud[id]) { hud[id] = { shown: v, target: v }; $(id).textContent = money0(v); return; }   // first value (new game, loaded save): show it at once
  const h = hud[id];
  if (v === h.target) return;
  const pill = $(id).parentElement, dir = v > h.target ? "up" : "down";
  const good = id === "hDebt" ? dir === "down" : dir === "up";   // less debt is good news
  pill.classList.remove("flash-up", "flash-down"); void pill.offsetWidth; pill.classList.add(good ? "flash-up" : "flash-down");
  h.target = v;
}
function tweenHud() {
  for (const [id, h] of Object.entries(hud)) {
    if (h.shown === h.target) continue;
    h.shown += (h.target - h.shown) * (settings.reduceMotion ? 1 : 0.18);
    if (Math.abs(h.target - h.shown) < 0.5) h.shown = h.target;
    $(id).textContent = money0(h.shown);
  }
}

function clockText(s) {
  const f = Math.min(1, s.clock / D.DAY_LEN), mins = Math.floor(D.OPEN_HOUR * 60 + f * (D.CLOSE_HOUR - D.OPEN_HOUR) * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}
function updateHud(force) {
  const now = performance.now();
  if (!state || (!force && now - lastHud < 200)) return;
  lastHud = now;
  const s = state, d = E.updateDerived(s), t = E.liveToday(s);
  $("hDay").textContent = s.dayLimit ? `${s.day} / ${s.dayLimit}` : s.day;
  $("hTime").textContent = s.phase === "open" ? clockText(s) : "Closed";
  setTarget("hCash", d.cash ?? 0); setTarget("hBank", d.bank ?? 0); setTarget("hDebt", d.debt ?? 0); setTarget("hNet", d.netWorth ?? 0);
  $("hHappy").textContent = Math.round(s.sat) + "%";
  $("hHappyBar").style.width = Math.max(0, Math.min(100, s.sat)) + "%";
  $("modeLabel").textContent = s.mode === "infinite" ? "Infinite mode" : "Standard mode";
  $("tCust").textContent = t.customers; $("tSales").textContent = money0(t.revenue);
  $("tMiss").textContent = (t.lost.stockout || 0) + (t.lost.price || 0) + (t.lost.patience || 0);
  $("tExp").textContent = Math.round(E.expectedCustomers(s));
  const ban = $("banner"), txt = s.events.todayText.join(" · ");
  ban.hidden = !txt; ban.textContent = txt;

  const al = E.alerts(s), key = JSON.stringify([al, s.log.slice(-8), s.day, SPEEDS.indexOf(speed), paused]);
  if (key !== lastSideKey) {
    lastSideKey = key;
    $("alerts").innerHTML = al.length ? al.map((a, i) => `<button class="alert ${a.kind}" data-alert="${i}">${esc(a.text)}</button>`).join("") : `<div class="muted small">No alerts. Nice.</div>`;
    $("alerts").querySelectorAll("[data-alert]").forEach(b => b.onclick = () => ui.open(al[Number(b.dataset.alert)].panel));
    $("log").innerHTML = s.log.slice(-8).reverse().map(l => `<div class="${l.kind}"><small>D${l.day}</small> ${esc(l.text)}</div>`).join("");
    document.querySelectorAll(".spd").forEach(b => b.classList.toggle("on", Number(b.dataset.speed) === speed));
    $("bPause").textContent = paused ? "Resume" : "Pause"; $("bPause").classList.toggle("on", paused);
  }
  renderTutorial();
}
const SVG = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const PANEL_ICON = {
  store: SVG('<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/>'),
  procure: SVG('<path d="M2 6h11v10H2zM13 9h4l3 3v4h-7"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>'),
  inventory: SVG('<path d="M3 8l9-5 9 5-9 5zM3 8v8l9 5 9-5V8M12 13v8"/>'),
  staff: SVG('<circle cx="9" cy="8" r="3.500"/><path d="M2 20c0-4 3-6 7-6s7 2 7 6M17 5a3 3 0 010 6M22 20c0-3-2-5-4-5.500"/>'),
  bank: SVG('<path d="M3 10l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18"/>'),
  finance: SVG('<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>'),
  upgrades: SVG('<path d="M12 21V7M6 12l6-6 6 6M5 21h14"/>'),
  plan: SVG('<path d="M3 20h18M5 16l4-5 3 3 5-7M17 7h3v3"/>'),
  branches: SVG('<path d="M3 21V9l5-3 5 3v12M13 21V4l8 3v14M7 13h2M7 17h2M17 11h1M17 15h1"/>'),
  goals: SVG('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0zM17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3"/>'),
};
function renderManage() {
  $("manage").innerHTML = ui.PANELS.map(([id, name]) => `<button data-panel="${id}" class="mb mb-${id}"><span class="mb-ic">${PANEL_ICON[id] || ""}</span>${name}</button>`).join("");
  $("manage").querySelectorAll("[data-panel]").forEach(b => b.onclick = () => ui.open(b.dataset.panel));
}
function renderTutorial() {
  const el = $("tutorial");
  if (!state || tut.isActive() || readJSON(TUT_KEY) === true) { el.hidden = true; return; }
  const obj = ui.objectives(state), done = obj.every(o => o.done);
  if (done) { writeLS(TUT_KEY, "true"); el.hidden = true; return; }
  el.hidden = false;
  const sig = obj.map(o => o.done ? 1 : 0).join("");
  if (el.dataset.sig === sig) return;                  // rebuild only when a checklist item changes
  el.dataset.sig = sig;
  el.innerHTML = `<b>Getting started</b><ul class="todo">${obj.map(o => `<li class="${o.done ? "done" : ""}">${o.done ? "✓" : "○"} ${esc(o.text)}</li>`).join("")}</ul><button class="ghost mini" id="tutSkip">Hide tips</button>`;
  $("tutSkip").onclick = () => { writeLS(TUT_KEY, "true"); el.hidden = true; };
}

// ---------- menus ----------
const menu = $("menuDlg");
const sections = ["menuMain", "menuSetup", "menuHelp", "menuSettings", "menuMulti", "menuLobby"];
function showSection(id) { sections.forEach(s => { $(s).hidden = s !== id; }); }
function openMenu(inGame) {
  $("mContinue").hidden = !(inGame ? state : loadLocal());   // no save on this device: no Continue button
  $("mClose").hidden = !inGame;
  const vw = mp.view();
  $("mRejoin").hidden = !!vw.code || !mp.savedSession();
  $("mLeaveMp").hidden = !vw.code;
  $("mNote").textContent = "";
  showSection("menuMain");
  if (!menu.open) menu.showModal();
}
function openSetup(mode) {
  setupMode = mode;
  $("setupTitle").textContent = mode === "standard" ? "New game: Standard" : "New game: Infinite";
  $("setupDesc").textContent = mode === "standard"
    ? "A fixed number of days. At the end you get a score and a final report."
    : "No end date. Grow forever. Bankruptcy offers a recovery, not a game over.";
  $("sDaysWrap").hidden = mode !== "standard";
  showSection("menuSetup");
}
menu.addEventListener("cancel", e => { if (!state) e.preventDefault(); });
const mpBlock = () => { if (mpMatch) { toast("Leave the online match first.", "err"); return true; } return false; };
$("mStandard").onclick = () => { if (!mpBlock()) openSetup("standard"); };
$("mInfinite").onclick = () => { if (!mpBlock()) openSetup("infinite"); };
$("sBack").onclick = () => showSection("menuMain");
let chosenLoc = "default";
const picker = createLocationPicker({ root: $("globeDlg"), getDifficulty: () => $("sDiff").value, onPick: id => { chosenLoc = id; $("sLocLabel").textContent = LOC.getLocation(id).name; } });
$("sLocBtn").onclick = () => picker.open(chosenLoc);
$("lbLoc").innerHTML = ["default", ...LOC.playableLocations().map(l => l.id)].map(id => `<option value="${id}">${LOC.getLocation(id).id === "default" ? "Neutral start" : LOC.getLocation(id).name}</option>`).join("");
$("sStart").onclick = () => {
  const s = E.newGame({ mode: setupMode, difficulty: $("sDiff").value, capital: Number($("sCap").value), dayLimit: Number($("sDays").value), location: chosenLoc });
  writeLS(TUT_KEY, "false"); localStorage.removeItem(TUT_KEY);
  menu.close(); startState(s); world.setScene("district"); world.reset();
  paused = false; tut.start();
};
// Continue always goes through startState(): it re-checks the phase, so a game saved on the day report or on the final
// screen shows that dialog again instead of sitting frozen in a phase the main loop never advances.
$("mContinue").onclick = () => {
  if (mpBlock()) return;
  const s = state || loadLocal();
  if (!s) { $("mContinue").hidden = true; toast("No saved game found on this device.", "err"); return; }
  menu.close(); paused = false;
  startState(s);
  tut.resume();
};
$("mClose").onclick = () => menu.close();
$("mHelp").onclick = () => { showHelp("goal"); showSection("menuHelp"); };
$("bHelp").onclick = () => { openMenu(!!state); showHelp("goal"); showSection("menuHelp"); };
$("mTutorial").onclick = () => { if (!state) return toast("Start or continue a game first.", "err"); menu.close(); ui.close(); tut.start(); };
$("mSettings").onclick = () => { $("setSound").checked = settings.sound; $("setVol").value = Math.round(settings.volume * 100); $("setMotion").checked = settings.reduceMotion; $("setConfirm").checked = settings.confirm; showSection("menuSettings"); };
document.querySelectorAll("[data-back]").forEach(b => b.onclick = () => showSection("menuMain"));
$("setMotion").onchange = e => { settings.reduceMotion = e.target.checked; world.setReduced(settings.reduceMotion); writeLS(SETTINGS_KEY, JSON.stringify(settings)); };
$("setConfirm").onchange = e => { settings.confirm = e.target.checked; window.confirm = settings.confirm ? nativeConfirm : () => true; writeLS(SETTINGS_KEY, JSON.stringify(settings)); };
$("setSound").onchange = e => { settings.sound = e.target.checked; sound.setEnabled(settings.sound); writeLS(SETTINGS_KEY, JSON.stringify(settings)); if (settings.sound) sound.play("order"); };
$("setVol").oninput = e => { settings.volume = Number(e.target.value) / 100; sound.setVolume(settings.volume); writeLS(SETTINGS_KEY, JSON.stringify(settings)); };
$("setVol").onchange = () => sound.play("sale");
$("bSound").onclick = () => { settings.sound = !settings.sound; sound.setEnabled(settings.sound); writeLS(SETTINGS_KEY, JSON.stringify(settings)); $("bSound").textContent = settings.sound ? "Sound on" : "Sound off"; $("bSound").classList.toggle("on", settings.sound); if (settings.sound) sound.play("order"); };
$("setExport").onclick = () => {
  if (!state) return toast("Start a game first.", "err");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([E.serialize(state)], { type: "application/json" }));
  a.download = `economy-day${state.day}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("setReset").onclick = () => { if (nativeConfirm("Delete the local save?")) { localStorage.removeItem(SAVE_KEY); toast("Local save deleted.", "ok"); $("mContinue").hidden = !state; } };
$("mImport").onclick = () => { if (!mpBlock()) $("fileIn").click(); };
function readSaveFile(file) {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error || new Error("Save file read failed."));
    reader.onabort = () => reject(new Error("Save file read was canceled."));
    reader.readAsText(file, "UTF-8");
  });
}
$("fileIn").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  if (f.size > 5e6) return toast("File too large.", "err");
  let raw;
  try { raw = await readSaveFile(f); }
  catch { return toast("Could not read this file. Try a valid UTF-8 JSON save.", "err"); }
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const v = E.validateSave(raw);
  if (!v.ok) return toast(v.error, "err");
  menu.close(); startState(v.state); toast("Save loaded.", "ok");
};
$("bMenu").onclick = () => openMenu(true);


// ---------- how-to-play guide ----------
const HELP = {
  goal: `<h3>The goal</h3>
    <p>You own a small corner shop. Buy goods from suppliers, sell them to customers for more than you paid, pay your bills, and grow into a bigger business. Your score is based on how much your <b>net worth</b> grows.</p>
    <ul><li><b>Standard mode:</b> you get a fixed number of days. At the end you see a score from S (best) to D, with a full report.</li>
    <li><b>Infinite mode:</b> no end date. Unlock products, expand, and chase milestones. If money runs out you get a recovery option, not a game over.</li></ul>
    <p class="help-note">Net worth = cash + bank + inventory + equipment - debt.</p>`,
  place: `<h3>Location</h3>
    <p>In <b>New game</b> press <b>Choose on globe</b>. Drag to rotate, scroll or pinch to zoom, search a name, or go Country, Region, City, District. Each site shows an <b>estimate</b> (customers, sales range, fixed costs, break-even) and a suitability score with its reasons. Add up to three sites to compare them side by side.</p>
    <ul><li><b>Demand</b>: a big busy district brings more customers, but rivals take a share.</li><li><b>Costs</b>: rent, wages, utilities and delivery fees change with the place.</li><li><b>Taste and wallet</b>: each place buys different product types, and reacts differently to your prices.</li><li><b>Suppliers</b>: remote towns wait longer and some suppliers do not deliver there.</li></ul>
    <p><b>Rivals:</b> busy districts have simulated rival shops (small buildings at the map edge). Cheaper prices, good reputation and full shelves win share; rivals cut prices when you undercut them and run promos. See them in <i>Planning</i>.</p>
    <p class="help-note">Districts are simulated and all numbers are game-balancing estimates, not real statistics. The globe is a schematic and works offline.</p>`,
  branches: `<h3>Branches</h3>
    <p>From day 5 and $1,200 net worth you can open up to 2 <b>branches</b> in other districts (<i>Branches</i> panel). Each has its own customers, rivals, reputation, rent, utilities and 1 to 3 cashiers.</p>
    <ul><li><b>Stock:</b> send goods from your warehouse with <i>Transfer</i> (small fee, instant). No stock, no sales.</li><li><b>Capacity:</b> a cashier serves about 45 customers a day; extra customers are turned away.</li><li><b>Books:</b> branch sales, costs and stock are part of your company accounts and day report.</li></ul>
    <p class="help-note">Branches are simulated once a day, not customer by customer, and share your prices and suppliers.</p>`,
  loop: `<h3>One business day</h3>
    <ol class="steps">
      <li><b>Order</b> goods in <i>Procurement</i>. A truck brings them to the warehouse.</li>
      <li><b>Restock</b> shelves in <i>Store</i>. Only shelf goods can be sold.</li>
      <li><b>Customers</b> walk in, pick items, queue and pay at the counter.</li>
      <li><b>At 20:00</b> the shop closes. Bills are paid and a <b>report</b> explains the day.</li>
      <li><b>Next day</b> starts. Adjust prices, staff and orders, then repeat.</li>
    </ol>
    <p>One day takes about four minutes at 1x speed. Use <b>Pause</b>, <b>1x / 2x / 4x</b> (keys <kbd>Space</kbd>, <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>) to control time.</p>`,
  money: `<h3>Money</h3>
    <ul><li><b>Cash</b>: the till. Every sale lands here. Extra cash is moved to the bank at closing.</li>
    <li><b>Bank</b>: pays suppliers and bills. Bills are paid from the bank first, then cash.</li>
    <li><b>Overdraft</b>: if both are empty, bills still get paid but at 1% daily interest. Avoid it.</li>
    <li><b>Loans</b>: cash now, repaid in daily installments with interest. Good for growth, risky for survival.</li>
    <li><b>Daily costs</b>: rent, utilities, wages, loan payments. Campaigns are paid when you book them. A tax of 10% of profit is charged every 7th day.</li>
    <li><b>Profit</b> = sales - cost of goods - expenses. The report shows each line and explains changes.</li></ul>`,
  people: `<h3>Staff and growth</h3>
    <ul><li><b>Cashier</b>: faster checkout. Fixes long queues.</li>
    <li><b>Shelf stocker</b>: moves goods from warehouse to shelves faster.</li>
    <li><b>Warehouse worker</b>: unloads trucks faster.</li>
    <li><b>Manager</b>: raises customer happiness.</li>
    <li><b>Upgrades</b>: more lanes, more shelf and warehouse space, faster unloading.</li>
    <li><b>Campaigns</b> (Planning): pay now, customers come later for a few days. Radio and social ads start after a delay, so book them early.</li>
    <li><b>Planning</b>: the customer forecast, days of cover per product and a daily budget. The report compares forecast and budget with what happened.</li></ul>
    <p class="help-note">Hire when profit can carry the wage. Wages are charged every closing.</p>`,
  tips: `<h3>Tips for a strong start</h3>
    <ul><li>Never let best sellers run out. Empty shelves lose sales and happiness.</li>
    <li>Set an <b>Auto target</b> (10 to 15) on each product so stockers refill shelves for you.</li>
    <li>Order a little more than you sell in a day, not a mountain. Unsold stock ties up cash.</li>
    <li>If customers leave because of queues, add a <b>Checkout counter</b> or a <b>Cashier</b>.</li>
    <li>Raise prices slowly. If &quot;skipped, price too high&quot; grows in the report, go back down.</li>
    <li>Keep at least 3 days of bills in the bank.</li>
    <li>Check <b>Planning</b> before ordering: low <b>days of cover</b> means you will run out before the next truck.</li>
    <li>Supplier prices drift every day. When the price tag says a few percent below normal, stock up (mind warehouse space).</li>
    <li>Watch events: rain, festivals, supplier delays and price rises change your day.</li></ul>`,
  words: `<h3>Glossary</h3>
    <dl><dt>Margin</dt><dd>Selling price minus what the goods cost you.</dd>
    <dt>COGS</dt><dd>Cost of goods sold: what the sold items cost you.</dd>
    <dt>Inventory</dt><dd>Goods you own: warehouse + shelves. Counted as an asset.</dd>
    <dt>Break-even</dt><dd>Customers per day needed to cover rent and utilities.</dd>
    <dt>Forecast</dt><dd>An estimate of customers, shown as a range. It cannot see random events.</dd>
    <dt>Variance</dt><dd>Actual result minus budget. Positive is good.</dd>
    <dt>Days of cover</dt><dd>How many days your stock lasts at the expected sales.</dd>
    <dt>Lead time</dt><dd>How long a supplier truck needs to arrive.</dd>
    <dt>Net worth</dt><dd>Everything you own minus everything you owe.</dd>
    <dt>Happiness</dt><dd>Customer mood. Raises or lowers daily visitors.</dd>
    <dt>Ledger</dt><dd>The double-entry books behind every number. Reports are built from it.</dd></dl>`,
};
function showHelp(tab) {
  document.querySelectorAll("#helpTabs [data-help]").forEach(b => b.classList.toggle("on", b.dataset.help === tab));
  $("helpBody").innerHTML = HELP[tab] || "";
}
$("helpTabs").addEventListener("click", e => { const b = e.target.closest("[data-help]"); if (b) showHelp(b.dataset.help); });

// ---------- controls ----------
document.querySelectorAll("#scenes [data-scene]").forEach(b => b.onclick = () => world.setScene(b.dataset.scene));
$("zIn").onclick = () => world.zoom(1.2); $("zOut").onclick = () => world.zoom(1 / 1.2); $("zReset").onclick = () => world.reset();
document.querySelectorAll(".spd").forEach(b => b.onclick = () => { speed = Number(b.dataset.speed); paused = false; updateHud(true); });
$("bPause").onclick = () => { paused = !paused; updateHud(true); };
document.addEventListener("keydown", e => {
  if (e.target.matches("input,select,textarea") || menu.open || $("dayDlg").open || $("finalDlg").open) return;
  if (e.code === "KeyF" && fsSupported && !/input|select|textarea/i.test((document.activeElement || {}).tagName || "")) { toggleFull(); return; }
  if (e.code === "Space") { e.preventDefault(); paused = !paused; updateHud(true); }
  else if (["Digit1", "Digit2", "Digit3"].includes(e.code)) { speed = SPEEDS[Number(e.code.slice(-1)) - 1]; paused = false; updateHud(true); }
  else if (e.code === "Escape" && ui.isOpen()) ui.close();
});


// ---------- online multiplayer ----------
const sbClient = cloud.client && cloud.client();
const net = sbClient ? createSupabaseNet(sbClient) : createLocalNet();
const mp = createMultiplayer({
  net, storage: sessionStorage,
  onChange: v => renderMp(v),
  onStart: cfg => startMatch(cfg),
  onResume: cfg => resumeMatch(cfg),
  onResults: rows => showResults(rows),
});
const mpEsc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));   // every network-supplied value goes through this before it reaches innerHTML

function startMatch(cfg) {
  const s = E.newGame({ mode: "standard", difficulty: cfg.difficulty, capital: cfg.capital, dayLimit: cfg.days, seed: cfg.seed, location: cfg.location });
  mpMatch = true; tut.stop(); ui.close(); menu.close();
  startState(s); world.setScene("district"); world.reset(); paused = false;
  setStatus(`Match started: ${cfg.days} days. Everyone has the same start. Good luck!`, "ok");
}
function resumeMatch(cfg) {
  let v = null;
  try { const raw = localStorage.getItem(MP_KEY); v = raw ? E.validateSave(raw) : null; } catch { v = null; }
  if (v && v.ok && v.state.dayLimit === cfg.days && v.state.difficulty === cfg.difficulty && v.state.capital === cfg.capital && v.state.loc === cfg.location) {
    mpMatch = true; menu.close(); startState(v.state); paused = false; toast("Rejoined your match.", "ok");
  } else { toast("Your local progress for this match was lost, so you cannot resume it.", "err"); mp.leave(); }
}
function endMatchLocal() { mpMatch = false; state = null; try { localStorage.removeItem(MP_KEY); } catch { /* blocked */ } $("mpBoard").hidden = true; $("mpH").hidden = true; updateHud(true); }

function showResults(rows) {
  const me = mp.view().me.id;
  $("mpResults").innerHTML = `<table class="tbl"><thead><tr><th>#</th><th>Player</th><th class="r">Score</th><th class="r">Net worth</th><th>Note</th></tr></thead><tbody>${rows.map(r =>
    `<tr class="${r.id === me ? "me" : ""}"><td>${mpEsc(r.rank)}</td><td><b>${mpEsc(r.name)}</b>${r.id === me ? " (you)" : ""}</td><td class="r">${r.finished ? mpEsc(r.score) + " " + mpEsc(r.rating) : "-"}</td><td class="r">${mpEsc(money0(Number(r.netWorth) || 0))}</td><td class="muted small">${mpEsc(r.note || "")}</td></tr>`).join("")}</tbody></table>`;
  $("finalDlg").open && $("finalDlg").close();
  if (!$("mpDlg").open) $("mpDlg").showModal();
}
$("mpDone").onclick = () => { $("mpDlg").close(); mp.leave(); endMatchLocal(); openMenu(false); };

function renderMp(v) {
  // connection pill
  const pill = $("netPill");
  pill.hidden = !v.code;
  if (v.code) {
    pill.className = "netpill " + (v.status === "in-room" ? "ok" : v.status === "connecting" || v.status === "connected" ? "wait" : "bad");
    $("netText").textContent = v.status === "in-room" ? `Room ${v.code} · ${v.players.filter(p => p.connected).length} online` : v.error || "Connecting...";
  }
  // scoreboard during a match
  const showBoard = v.code && (v.phase === "playing" || v.phase === "finished");
  $("mpBoard").hidden = $("mpH").hidden = !showBoard;
  if (showBoard) {
    const rows = [...v.players].sort((a, b) => (b.finished - a.finished) || ((b.netWorth ?? -1e9) - (a.netWorth ?? -1e9)));
    $("mpBoard").innerHTML = rows.map((p, i) => `<div class="mprow ${p.isMe ? "me" : ""}"><b>${i + 1}</b><span class="mpname">${mpEsc(p.name)}${p.isHost ? " ★" : ""}</span>
      <span class="muted small">Day ${mpEsc(p.day)}/${mpEsc(v.config.days)}</span><span class="mpnw">${p.netWorth == null ? "-" : mpEsc(money0(Number(p.netWorth) || 0))}</span>
      <span class="tag ${p.finished ? (p.verdict.ok ? "ok" : "bad") : p.connected ? "info" : "warn"}">${p.finished ? (p.verdict.ok ? (p.verdict.bankrupt ? "Bankrupt" : mpEsc(p.verdict.rating)) : "Rejected") : p.connected ? "Playing" : "Offline"}</span></div>`).join("");
  }
  // lobby
  if (!$("menuLobby").hidden) {
    if (!v.code) { showSection("menuMain"); if (v.error) $("mNote").textContent = v.error; return; }
    $("lbCode").textContent = v.code;     // textContent: never parsed as HTML
    $("lbTransport").textContent = v.transport === "supabase" ? "Online" : "Local test";
    $("lbPlayers").innerHTML = v.players.map(p => `<div class="lbrow ${p.connected ? "" : "off"}"><span class="av">${mpEsc(p.name.slice(0, 1).toUpperCase())}</span>
      <span class="lbname">${mpEsc(p.name)}${p.isMe ? " (you)" : ""}</span>
      ${p.isHost ? '<span class="tag warn">Host</span>' : `<span class="tag ${p.ready ? "ok" : ""}">${p.ready ? "Ready" : "Not ready"}</span>`}
      ${v.isHost && !p.isMe ? `<button class="ghost mini" data-kick="${mpEsc(p.id)}" aria-label="Remove ${mpEsc(p.name)}">Remove</button>` : ""}</div>`).join("");
    $("lbPlayers").querySelectorAll("[data-kick]").forEach(b => b.onclick = () => mp.kick(b.dataset.kick));
    const editable = v.isHost && v.phase === "lobby";
    for (const [id, key] of [["lbDays", "days"], ["lbDiff", "difficulty"], ["lbCap", "capital"], ["lbLoc", "location"]]) { const el = $(id); el.disabled = !editable; if (document.activeElement !== el) el.value = v.config[key]; }
    $("lbStart").hidden = !v.isHost; $("lbReady").hidden = v.isHost;
    const me = v.players.find(p => p.isMe);
    $("lbReady").textContent = me && me.ready ? "Not ready" : "I am ready"; $("lbReady").classList.toggle("on", !!(me && me.ready));
    $("lbMsg").textContent = v.error || (v.isHost ? (v.players.length < 2 ? "Share the code. You can start alone to test, but a match is better with friends." : "Start when everyone is ready.") : "Waiting for the host to start...");
    $("lbMsg").className = "mp-msg" + (v.error ? " err" : "");
  }
}
const mpName = () => { const n = $("mpName").value.trim().slice(0, 16); if (n) { try { localStorage.setItem("economy-mp-name", n); } catch { /* blocked */ } } return n; };
function needName() { if (mpName()) return true; $("mpMsg").textContent = "Enter your name first."; $("mpMsg").className = "mp-msg err"; $("mpName").focus(); return false; }
$("mMulti").onclick = () => {
  if (mpBlock()) return;
  $("mpName").value = (() => { try { return localStorage.getItem("economy-mp-name") || ""; } catch { return ""; } })();
  $("mpNote").textContent = net.kind === "supabase" ? "Enter your name, then compete shop against shop across devices. Everyone gets the same start settings and seed. Highest score wins." : "Supabase did not load, so this is LOCAL TEST mode: it only works between tabs of this browser.";
  $("mpMsg").textContent = ""; showSection("menuMulti");
};
async function enterRoom(promise) {
  $("mpMsg").className = "mp-msg"; $("mpMsg").textContent = "Connecting...";
  const r = await promise;
  if (r.error) { $("mpMsg").textContent = r.error; $("mpMsg").className = "mp-msg err"; return; }
  $("mpMsg").textContent = ""; showSection("menuLobby"); renderMp(mp.view());
}
$("mpCreate").onclick = () => { if (needName()) enterRoom(mp.create(mpName())); };
$("mpJoin").onclick = () => { if (needName()) enterRoom(mp.join($("mpCode").value, mpName())); };
$("mpCode").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });
$("mpCode").addEventListener("keydown", e => { if (e.key === "Enter") $("mpJoin").click(); });
$("mRejoin").onclick = async () => {
  $("mNote").textContent = "Rejoining...";
  const r = await mp.rejoin();
  if (r.error) { $("mNote").textContent = r.error; return; }
  if (!mpMatch) { showSection("menuLobby"); renderMp(mp.view()); }
};
$("mLeaveMp").onclick = () => { if (!nativeConfirm("Leave the room? If a match is running you forfeit it.")) return; mp.leave(); endMatchLocal(); openMenu(!!state); };
$("lbCopy").onclick = async () => { try { await navigator.clipboard.writeText(mp.view().code); toast("Room code copied.", "ok"); } catch { toast("Copy failed. Read the code aloud instead.", "err"); } };
$("lbReady").onclick = () => { const me = mp.view().players.find(p => p.isMe); mp.setReady(!(me && me.ready)); };
$("lbStart").onclick = () => { const r = mp.start(); if (r.error) { $("lbMsg").textContent = r.error; $("lbMsg").className = "mp-msg err"; } };
$("lbLeave").onclick = () => { mp.leave(); showSection("menuMain"); openMenu(!!state && !mpMatch); };
for (const id of ["lbDays", "lbDiff", "lbCap", "lbLoc"]) $(id).addEventListener("change", () => mp.setConfig({ days: Number($("lbDays").value), difficulty: $("lbDiff").value, capital: Number($("lbCap").value), location: $("lbLoc").value }));
setInterval(() => { if (mpMatch && state && !state.ended) mp.reportProgress(state); }, 5000);
window.addEventListener("beforeunload", () => { if (mpMatch) saveLocal(); });

// ---------- sound cues (derived from state changes, never from animation) ----------
let prev = { sales: 0, done: 0, ms: 0, staff: 0, orders: 0, day: 0, phase: "" };
function watchSounds() {
  if (!state) { prev = { sales: 0, done: 0, ms: 0, staff: 0, orders: 0, day: 0, phase: "" }; return; }
  const cur = { sales: state.stats.totalSales, done: state.doneOrders.length + (state.orderSeq || 0) * 0, ms: state.milestones.length, staff: state.staff.length, orders: state.orderSeq || 0, day: state.day, phase: state.phase };
  if (prev.day === state.day || prev.day === 0) {
    if (cur.sales > prev.sales && prev.sales > 0) sound.play("sale");
    if (state.doneOrders.length && state.doneOrders[state.doneOrders.length - 1].id !== prev.lastDone && prev.lastDone !== undefined) sound.play("delivery");
    if (cur.orders > prev.orders && prev.orders > 0) sound.play("order");
    if (cur.ms > prev.ms && prev.ms > 0) sound.play("milestone");
    if (cur.staff > prev.staff && prev.staff > 0) sound.play("hire");
  }
  if (cur.phase === "report" && prev.phase === "open") sound.play("dayend");
  cur.lastDone = state.doneOrders.length ? state.doneOrders[state.doneOrders.length - 1].id : null;
  prev = cur;
}
document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("button"); if (b && !b.disabled) sound.play("click"); });

// ---------- main loop ----------
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.25, (now - lastT) / 1000); lastT = now;
  if (state && !paused && !menu.open && state.phase === "open" && !state.ended) {
    E.tick(state, dt * speed * PACE * FAST);
    if (state.phase !== "open" || state.ended) { saveLocal(); maybeDialogs(); updateHud(true); }
  }
  world.setFrozen(!!state && (paused || menu.open || state.phase !== "open"));
  world.frame(now);
  tweenHud(); watchSounds();
  tut.update();
  updateHud(false);
  requestAnimationFrame(frame);
}

// ---------- autosave & lifecycle ----------
setInterval(() => { if (state) { saveLocal(); } }, 20000);
window.addEventListener("beforeunload", saveLocal);
document.addEventListener("visibilitychange", () => { if (document.hidden) saveLocal(); });   // browsers already stop animation frames in hidden tabs, so the game does not run in the background

// ---------- fullscreen (PC and Android) ----------
const fsEl = document.documentElement;
const fsSupported = !!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen);
const fsActive = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
function fsLabel() {
  const on = fsActive();
  $("bFull").querySelector(".fl").textContent = on ? " Exit full screen" : " Full screen"; $("bFull").setAttribute("aria-pressed", String(on)); $("bFull").classList.toggle("on", on);
  if ($("setFull")) $("setFull").textContent = on ? "Exit full screen" : "Full screen";
}
async function toggleFull() {
  try {
    if (fsActive()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else await (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen).call(fsEl);
  } catch { toast("Full screen is not allowed here.", "err"); }
  fsLabel();
}
if (fsSupported) {
  $("bFull").onclick = toggleFull; if ($("setFull")) $("setFull").onclick = toggleFull;
  document.addEventListener("fullscreenchange", fsLabel); document.addEventListener("webkitfullscreenchange", fsLabel);
  fsLabel();
} else { $("bFull").hidden = true; if ($("setFull")) $("setFull").hidden = true; }   // e.g. iPhone Safari has no Fullscreen API

// ---------- phone helpers ----------
try { if (sessionStorage.getItem("economy-rotate-hint")) $("rotateHint").hidden = true; } catch { /* blocked */ }
$("rotateOk").onclick = () => { $("rotateHint").hidden = true; try { sessionStorage.setItem("economy-rotate-hint", "1"); } catch { /* blocked */ } };

// ---------- boot ----------
(async function boot() {
  window.__economyBooted = true;
  renderManage();
  $("bSound").textContent = settings.sound ? "Sound on" : "Sound off"; $("bSound").classList.toggle("on", settings.sound);
  world.setScene("district");
  requestAnimationFrame(frame);
  const saved = loadLocal();
  if (saved) { state = saved; E.updateDerived(state); paused = true; }
  openMenu(false);
  setStatus("Progress is saved on this device.");
})();
startFit();
