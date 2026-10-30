// Browser check of the whole loop plus an overflow audit. Needs: playwright, and `python3 -m http.server 8765` in the repo root.
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const b = await chromium.launch(); const errs = []; const bad = [];
const sizes = [[320, 640], [360, 740], [390, 844], [768, 1024], [1280, 800]];
for (const [w, h] of sizes) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage();
  p.on("pageerror", e => errs.push("PE " + e.message)); p.on("console", m => { if (m.type() === "error" && !/fonts|ERR_|Failed to load/.test(m.text())) errs.push("CE " + m.text()); });
  await p.goto("http://localhost:8765/index.html"); await p.waitForTimeout(300);
  await p.click("#mNew"); await p.fill("#sSec", "10"); await p.fill("#sDays", "5"); await p.click("#sStart"); await p.waitForTimeout(200);
  for (const t of ["dash", "store", "buy", "ship", "rep"]) {
    await p.click(`[data-tab="${t}"]`);
    if (t === "buy") { await p.click("#poOpen"); await p.selectOption("#poQty","10000"); await p.screenshot({path:`/tmp/po-${w}.png`}); await p.click("#poSubmit"); await p.click('[data-tab="buy"]'); }
    await p.waitForTimeout(150);
    const r = await p.evaluate(() => {
      const out = [], vw = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth > vw + 1) out.push("page scrolls sideways " + document.documentElement.scrollWidth + ">" + vw);
      for (const el of document.querySelectorAll("body *")) {
        if (el.closest(".scroll, dialog, .tabs, .toasts, canvas, .overlay")) continue;
        const cs = getComputedStyle(el); if (cs.display === "none" || !el.clientWidth) continue;
        if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX === "visible" && el.children.length === 0) out.push(el.tagName + "." + el.className + " '" + (el.textContent || "").slice(0, 30) + "'");
        const rc = el.getBoundingClientRect(); if (rc.right > vw + 1 && rc.width > 0) out.push("right edge " + el.tagName + "." + el.className + " " + Math.round(rc.right));
      }
      return out.slice(0, 6);
    });
    if (r.length) bad.push(`${w}x${h} ${t}: ${r.join(" | ")}`);
  }
  await p.screenshot({ path: `/tmp/shot-${w}.png`, fullPage: true });
  await ctx.close();
}
console.log(bad.length ? "OVERFLOW:\n" + bad.join("\n") : "overflow audit CLEAN at " + sizes.length + " viewports"); console.log("errors", JSON.stringify(errs));
await b.close();
