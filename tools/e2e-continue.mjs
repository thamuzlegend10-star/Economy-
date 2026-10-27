// Browser regression check for "Continue" and full screen. Needs Playwright and a static server:
//   python3 -m http.server 8765   (in another terminal)   then   node tools/e2e-continue.mjs
import { createRequire } from "node:module";
import * as E from "../js/engine.js";
const { chromium } = createRequire(import.meta.url)("playwright");
const URL_ = process.env.GAME_URL || "http://localhost:8765/";

function save(kind) {
  const s = E.newGame({ mode: "standard", difficulty: "normal", capital: 1000, dayLimit: 5, seed: 7 });
  if (kind === "open") { E.tick(s, 20); return E.serialize(s); }
  let guard = 0; while (s.phase === "open" && guard++ < 5000) E.tick(s, 1);       // run to the end of day 1 = report phase
  if (kind === "report") return E.serialize(s);
  while (!s.ended && guard++ < 50000) { if (s.phase === "report") E.nextDay(s); else E.tick(s, 1); }
  return E.serialize(s);                                                            // finished game
}

const b = await chromium.launch(); let failed = 0;
const check = (name, ok) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) failed++; };
async function fresh(data) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }), p = await ctx.newPage(), errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(URL_);
  await p.evaluate(d => { localStorage.setItem("economy-tutorial-v2", JSON.stringify({ done: true })); if (d) localStorage.setItem("economy-save-v3", d); }, data);
  await p.reload(); await p.waitForTimeout(700);
  return { p, errs };
}

{ const { p } = await fresh(null); check("no save: Continue is hidden", !(await p.isVisible("#mContinue"))); }
for (const kind of ["open", "report", "ended"]) {
  const { p, errs } = await fresh(save(kind));
  check(`${kind} save: Continue is shown`, await p.isVisible("#mContinue"));
  await p.click("#mContinue"); await p.waitForTimeout(1500);
  const st = await p.evaluate(() => ({ day: document.getElementById("dayDlg").open, fin: document.getElementById("finalDlg").open, time: document.getElementById("hTime").textContent }));
  if (kind === "open") check("open save: game runs (clock is not 'Closed')", st.time !== "Closed");
  if (kind === "report") { check("report save: day report is shown again", st.day); await p.click("#dayNext"); await p.waitForTimeout(800); check("report save: next day starts and the clock runs", (await p.textContent("#hTime")) !== "Closed"); }
  if (kind === "ended") { if (st.day) { await p.click("#dayNext"); await p.waitForTimeout(800); } check("ended save: final report is shown", await p.evaluate(() => document.getElementById("finalDlg").open)); }
  check(`${kind} save: no script errors`, errs.length === 0);
}
{ const { p } = await fresh(null); await p.click("#mStandard"); await p.click("#sStart"); await p.click("#bFull"); await p.waitForTimeout(300);
  check("full screen turns on", await p.evaluate(() => !!document.fullscreenElement));
  await p.click("#bFull"); await p.waitForTimeout(300);
  check("full screen turns off", await p.evaluate(() => !document.fullscreenElement)); }
await b.close(); console.log(failed ? `${failed} FAILED` : "all passed"); process.exit(failed ? 1 : 0);
