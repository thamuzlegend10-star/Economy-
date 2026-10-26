// App entry: wires the engine, the canvas world, the management UI, saving and the menus together.
import * as D from "./data.js";
import * as E from "./engine.js";
import { createWorld } from "./world.js";
import { createUI, money, money0 } from "./ui.js";
import { createCloud } from "./cloud.js";
import { createTutorial } from "./tutorial.js";

const $ = id => document.getElementById(id);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const SAVE_KEY = "economy-save-v3", SETTINGS_KEY = "economy-settings-v1", TUT_KEY = "economy-tutorial-done";
const SPEEDS = [1, 2, 4];

let state = null, speed = 1, paused = false, reportShown = false, finalShown = false;
let dirtyCloud = false, setupMode = "standard", lastHud = 0, lastSideKey = "";
const settings = Object.assign({ reduceMotion: false, confirm: true }, readJSON(SETTINGS_KEY));
const nativeConfirm = window.confirm.bind(window);

function readJSON(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function writeLS(key, val) { try { localStorage.setItem(key, val); return true; } catch { return false; } }

// ---------- toasts & status ----------
function toast(msg, kind = "info") {
  const el = document.createElement("div");
  el.className = "toast " + kind; el.textContent = msg;
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
ui = createUI({ getState: () => state, onChange: () => { E.updateDerived(state); dirtyCloud = true; saveLocal(); updateHud(true); }, toast, world });
const tut = createTutorial({ getState: () => state, ui, world, setPaused: v => { paused = v; updateHud(true); } });
world.setReduced(settings.reduceMotion);
if (!settings.confirm) window.confirm = () => true;

// ---------- saving ----------
function saveLocal() { if (state) writeLS(SAVE_KEY, E.serialize(state)); }
function loadLocal() {
  const raw = (() => { try { return localStorage.getItem(SAVE_KEY); } catch { return null; } })();
  if (!raw) return null;
  const v = E.validateSave(raw);
  return v.ok ? v.state : null;
}
const cloud = createCloud();

async function saveCloud(manual) {
  if (!cloud.available()) { if (manual) setStatus(cloud.reason() || "Cloud save is off.", "err"); return false; }
  if (!cloud.user()) { if (manual) setStatus("Not signed in. Sign in first.", "err"); return false; }
  if (!state) return false;
  if (manual) setStatus("Saving...");
  const r = await cloud.save(E.serialize(state));
  if (r.error) { setStatus("Cloud save failed: " + r.error, "err"); return false; }
  dirtyCloud = false;
  setStatus("Saved to cloud at " + new Date().toLocaleTimeString(), "ok");
  return true;
}

function showAuth() {
  const u = cloud.user();
  $("signedOut").hidden = !!u; $("signedIn").hidden = !u;
  $("who").textContent = u ? "Signed in as " + u.email : "";
}

async function afterSignIn() {
  showAuth();
  const r = await cloud.load();
  if (r.error) { setStatus("Cloud load failed: " + r.error, "err"); return; }
  if (!r.data) { setStatus("Signed in. No cloud save yet.", "ok"); if (state) await saveCloud(false); return; }
  const v = E.validateSave(r.data);
  if (!v.ok) { setStatus("Cloud save not usable: " + v.error, "err"); return; }
  const cloudDay = v.state.day, localDay = state ? state.day : 0;
  if (!state || cloudDay > localDay || nativeConfirm(`Cloud save is on day ${cloudDay}. Your current game is on day ${localDay}. Load the cloud save?`)) {
    startState(v.state);
    setStatus(`Loaded cloud save (day ${cloudDay}).`, "ok");
  } else { await saveCloud(false); }
}

async function auth(kind) {
  const email = $("email").value.trim(), password = $("password").value;
  if (!email || password.length < 6) return setStatus("Enter your email and a password of 6+ characters.", "err");
  setStatus(kind === "up" ? "Signing up..." : "Signing in...");
  const r = kind === "up" ? await cloud.signUp(email, password) : await cloud.signIn(email, password);
  if (r.error) return setStatus(r.error, "err");
  if (r.notice) return setStatus(r.notice, "ok");
  await afterSignIn();
}

// ---------- game flow ----------
function startState(s) {
  state = s; reportShown = false; finalShown = false;
  if (state.phase === "report" && state.lastReport) reportShown = false;
  E.updateDerived(state);
  saveLocal(); updateHud(true); ui.refresh();
  maybeDialogs();
}

function maybeDialogs() {
  if (!state) return;
  if (state.phase === "report" && !reportShown) {
    reportShown = true;
    ui.dayReport(state, () => {
      reportShown = false;
      if (state.ended) { showFinal(); return; }
      E.nextDay(state); dirtyCloud = true; saveLocal(); updateHud(true);
      world.flash("Day " + state.day, "#ffb84d");
    });
  } else if (state.ended && state.phase !== "report" && !finalShown) {
    showFinal();
  }
}
function showFinal() {
  if (finalShown) return; finalShown = true;
  ui.finalReport(state, {
    cont: () => { E.continueAfterEnd(state); finalShown = false; reportShown = false; saveLocal(); updateHud(true); },
    again: () => { finalShown = false; openMenu(false); },
  });
}

// ---------- HUD ----------
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
  $("hCash").textContent = money0(d.cash ?? 0);
  $("hBank").textContent = money0(d.bank ?? 0);
  $("hDebt").textContent = money0(d.debt ?? 0);
  $("hNet").textContent = money0(d.netWorth ?? 0);
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
  el.innerHTML = `<b>Getting started</b><ul class="todo">${obj.map(o => `<li class="${o.done ? "done" : ""}">${o.done ? "✓" : "○"} ${esc(o.text)}</li>`).join("")}</ul><button class="ghost mini" id="tutSkip">Hide tips</button>`;
  $("tutSkip").onclick = () => { writeLS(TUT_KEY, "true"); el.hidden = true; };
}

// ---------- menus ----------
const menu = $("menuDlg");
const sections = ["menuMain", "menuSetup", "menuHelp", "menuSettings"];
function showSection(id) { sections.forEach(s => { $(s).hidden = s !== id; }); }
function openMenu(inGame) {
  $("mContinue").hidden = !(inGame ? state : loadLocal());
  $("mClose").hidden = !inGame;
  $("mNote").textContent = cloud.available() ? "" : "Cloud save is off. " + cloud.reason();
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
$("mStandard").onclick = () => openSetup("standard");
$("mInfinite").onclick = () => openSetup("infinite");
$("sBack").onclick = () => showSection("menuMain");
$("sStart").onclick = () => {
  const s = E.newGame({ mode: setupMode, difficulty: $("sDiff").value, capital: Number($("sCap").value), dayLimit: Number($("sDays").value) });
  writeLS(TUT_KEY, "false"); localStorage.removeItem(TUT_KEY);
  menu.close(); startState(s); world.setScene("district"); world.reset();
  dirtyCloud = true; saveCloud(false);
  paused = false; tut.start();
};
$("mContinue").onclick = () => { if (!state) { const s = loadLocal(); if (s) startState(s); } menu.close(); paused = false; tut.resume(); };
$("mClose").onclick = () => menu.close();
$("mHelp").onclick = () => { showHelp("goal"); showSection("menuHelp"); };
$("bHelp").onclick = () => { openMenu(!!state); showHelp("goal"); showSection("menuHelp"); };
$("mTutorial").onclick = () => { if (!state) return toast("Start or continue a game first.", "err"); menu.close(); ui.close(); tut.start(); };
$("mSettings").onclick = () => { $("setMotion").checked = settings.reduceMotion; $("setConfirm").checked = settings.confirm; showSection("menuSettings"); };
document.querySelectorAll("[data-back]").forEach(b => b.onclick = () => showSection("menuMain"));
$("setMotion").onchange = e => { settings.reduceMotion = e.target.checked; world.setReduced(settings.reduceMotion); writeLS(SETTINGS_KEY, JSON.stringify(settings)); };
$("setConfirm").onchange = e => { settings.confirm = e.target.checked; window.confirm = settings.confirm ? nativeConfirm : () => true; writeLS(SETTINGS_KEY, JSON.stringify(settings)); };
$("setExport").onclick = () => {
  if (!state) return toast("Start a game first.", "err");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([E.serialize(state)], { type: "application/json" }));
  a.download = `economy-day${state.day}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("setReset").onclick = () => { if (nativeConfirm("Delete the local save? Cloud saves are not affected.")) { localStorage.removeItem(SAVE_KEY); toast("Local save deleted.", "ok"); $("mContinue").hidden = !state; } };
$("mImport").onclick = () => $("fileIn").click();
$("fileIn").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  if (f.size > 5e6) return toast("File too large.", "err");
  const v = E.validateSave(await f.text());
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
  loop: `<h3>One business day</h3>
    <ol class="steps">
      <li><b>Order</b> goods in <i>Procurement</i>. A truck brings them to the warehouse.</li>
      <li><b>Restock</b> shelves in <i>Store</i>. Only shelf goods can be sold.</li>
      <li><b>Customers</b> walk in, pick items, queue and pay at the counter.</li>
      <li><b>At 20:00</b> the shop closes. Bills are paid and a <b>report</b> explains the day.</li>
      <li><b>Next day</b> starts. Adjust prices, staff and orders, then repeat.</li>
    </ol>
    <p>One day takes about two minutes at 1x speed. Use <b>Pause</b>, <b>1x / 2x / 4x</b> (keys <kbd>Space</kbd>, <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>) to control time.</p>`,
  money: `<h3>Money</h3>
    <ul><li><b>Cash</b>: the till. Every sale lands here. Extra cash is moved to the bank at closing.</li>
    <li><b>Bank</b>: pays suppliers and bills. Bills are paid from the bank first, then cash.</li>
    <li><b>Overdraft</b>: if both are empty, bills still get paid but at 1% daily interest. Avoid it.</li>
    <li><b>Loans</b>: cash now, repaid in daily installments with interest. Good for growth, risky for survival.</li>
    <li><b>Daily costs</b>: rent, utilities, wages, marketing, loan payments. A tax of 10% of profit is charged every 7th day.</li>
    <li><b>Profit</b> = sales - cost of goods - expenses. The report shows each line and explains changes.</li></ul>`,
  people: `<h3>Staff and growth</h3>
    <ul><li><b>Cashier</b>: faster checkout. Fixes long queues.</li>
    <li><b>Shelf stocker</b>: moves goods from warehouse to shelves faster.</li>
    <li><b>Warehouse worker</b>: unloads trucks faster.</li>
    <li><b>Manager</b>: raises customer happiness.</li>
    <li><b>Upgrades</b>: more lanes, more shelf and warehouse space, faster unloading.</li>
    <li><b>Marketing</b>: costs money every day but brings more customers.</li></ul>
    <p class="help-note">Hire when profit can carry the wage. Wages are charged every closing.</p>`,
  tips: `<h3>Tips for a strong start</h3>
    <ul><li>Never let best sellers run out. Empty shelves lose sales and happiness.</li>
    <li>Set an <b>Auto target</b> (10 to 15) on each product so stockers refill shelves for you.</li>
    <li>Order a little more than you sell in a day, not a mountain. Unsold stock ties up cash.</li>
    <li>If customers leave because of queues, add a <b>Checkout counter</b> or a <b>Cashier</b>.</li>
    <li>Raise prices slowly. If &quot;skipped, price too high&quot; grows in the report, go back down.</li>
    <li>Keep at least 3 days of bills in the bank.</li>
    <li>Watch events: rain, festivals, supplier delays and price rises change your day.</li></ul>`,
  words: `<h3>Glossary</h3>
    <dl><dt>Margin</dt><dd>Selling price minus what the goods cost you.</dd>
    <dt>COGS</dt><dd>Cost of goods sold: what the sold items cost you.</dd>
    <dt>Inventory</dt><dd>Goods you own: warehouse + shelves. Counted as an asset.</dd>
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
$("signin").onclick = () => auth("in"); $("signup").onclick = () => auth("up");
$("saveCloud").onclick = () => saveCloud(true);
$("signout").onclick = async () => { await saveCloud(false); await cloud.signOut(); showAuth(); setStatus("Signed out."); };
document.addEventListener("keydown", e => {
  if (e.target.matches("input,select,textarea") || menu.open || $("dayDlg").open || $("finalDlg").open) return;
  if (e.code === "Space") { e.preventDefault(); paused = !paused; updateHud(true); }
  else if (["Digit1", "Digit2", "Digit3"].includes(e.code)) { speed = SPEEDS[Number(e.code.slice(-1)) - 1]; paused = false; updateHud(true); }
  else if (e.code === "Escape" && ui.isOpen()) ui.close();
});

// ---------- main loop ----------
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.25, (now - lastT) / 1000); lastT = now;
  if (state && !paused && !menu.open && state.phase === "open" && !state.ended) {
    E.tick(state, dt * speed);
    if (state.phase !== "open" || state.ended) { dirtyCloud = true; saveLocal(); maybeDialogs(); updateHud(true); }
  }
  world.frame(now);
  tut.update();
  updateHud(false);
  requestAnimationFrame(frame);
}

// ---------- autosave & lifecycle ----------
setInterval(() => { if (state) { saveLocal(); if (dirtyCloud && cloud.user()) saveCloud(false); } }, 20000);
window.addEventListener("beforeunload", saveLocal);
document.addEventListener("visibilitychange", () => { if (document.hidden) { saveLocal(); paused = paused || false; } });

// ---------- boot ----------
(async function boot() {
  renderManage(); showAuth();
  world.setScene("district");
  requestAnimationFrame(frame);
  const saved = loadLocal();
  if (saved) { state = saved; E.updateDerived(state); paused = true; }
  openMenu(false);
  if (cloud.available()) {
    await cloud.restore(); showAuth();
    if (cloud.user()) setStatus(`Signed in as ${cloud.user().email}. Your cloud save loads when you press Continue or sign in again.`, "ok");
    else setStatus("Playing offline. Sign in to save to the cloud.");
  } else setStatus(cloud.reason() || "Local save only.", "err");
})();
