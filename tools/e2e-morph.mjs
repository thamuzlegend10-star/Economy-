import { createRequire } from "module"; const require = createRequire(import.meta.url.replace("tools/e2e-morph.mjs", "package.json"));
const { chromium } = require("playwright");
const b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
await p.goto("http://localhost:8765/index.html?more=1"); await p.waitForFunction(() => window.__economyBooted); await p.click("#mNew"); await p.evaluate(() => { const d = document.getElementById("sAdv"); if (d) d.open = true; }); await p.fill("#sSec", "10"); await p.click("#sStart"); await p.waitForTimeout(500);
for (const [tab, sub] of [["retail", "store"], ["finance", "overview"], ["marketing", null], ["hr", null]]) {
  await p.evaluate(([t, s]) => { document.querySelector(`[data-main="${t}"]`).click(); if (s) document.querySelector(`[data-sub="${s}"]`)?.click(); }, [tab, sub]); await p.waitForTimeout(300);
  await p.evaluate(() => { const v = document.querySelector("#view"); v.querySelectorAll("*").forEach((e, i) => { e.__k = i; }); window.__n = v.querySelectorAll("*").length; });
  await p.waitForTimeout(2500);
  const r = await p.evaluate(() => { const v = document.querySelector("#view"), all = [...v.querySelectorAll("*")]; return { total: all.length, kept: all.filter(e => e.__k !== undefined).length, was: window.__n }; });
  console.log(tab, JSON.stringify(r));
}
// a select left open / focused keeps its value while the game runs
await p.evaluate(() => document.querySelector('[data-main="marketing"]').click()); await p.waitForTimeout(300);
const sel = await p.$("#view select"); if (sel) { await sel.focus(); await p.waitForTimeout(1500); console.log("select still same element", await p.evaluate(() => document.activeElement.tagName)); }
if (errs.length) { console.log("ERRORS", errs); process.exitCode = 1; } else console.log("morph: nodes survive refresh, no errors"); await b.close();
