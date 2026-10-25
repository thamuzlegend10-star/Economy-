// App entry: wires the engine, the canvas world, the management UI, saving and the menus together.
import * as D from "./data.js";
import * as E from "./engine.js";
import { createWorld } from "./world.js";
import { createUI, money, money0 } from "./ui.js";
import { createCloud } from "./cloud.js";

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
function renderManage() {
  $("manage").innerHTML = ui.PANELS.map(([id, name]) => `<button data-panel="${id}">${name}</button>`).join("");
  $("manage").querySelectorAll("[data-panel]").forEach(b => b.onclick = () => ui.open(b.dataset.panel));
}
function renderTutorial() {
  const el = $("tutorial");
  if (!state || readJSON(TUT_KEY) === true) { el.hidden = true; return; }
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
};
$("mContinue").onclick = () => { if (!state) { const s = loadLocal(); if (s) startState(s); } menu.close(); };
$("mClose").onclick = () => menu.close();
$("mHelp").onclick = () => showSection("menuHelp");
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
  // First "Continue" or "New game" resumes the clock.
  const resume = () => { paused = false; };
  $("mContinue").addEventListener("click", resume); $("sStart").addEventListener("click", resume);
})();
