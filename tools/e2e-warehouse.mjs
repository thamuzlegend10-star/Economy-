// Browser check of the warehouse flow: rent, bulk order, deliver, send to the shop. Needs playwright and `python3 -m http.server 8765` in the repo root.
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const b = await chromium.launch(); const errs = []; let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log("FAIL", m); } };
for (const [w, h] of [[320, 640], [390, 844], [1280, 800]]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
  p.on("pageerror", e => errs.push(e.message));
  await p.goto("http://localhost:8765/index.html"); await p.click("#mNew"); await p.fill("#sSec", "10"); await p.fill("#sDays", "10"); await p.selectOption("#sCap", { index: 3 }).catch(() => {}); await p.click("#sStart"); await p.waitForTimeout(200);
  await p.click('[data-main="warehouse"]'); ok(await p.isVisible("#whRentOpen"), "rent button visible");
  await p.click("#whRentOpen"); await p.selectOption("#spExtra", "1000"); await p.screenshot({ path: `/tmp/wh-rent-${w}.png` }); await p.click("#spSubmit");
  await p.click('[data-sub="procure"]'); await p.click("#whPoOpen"); await p.selectOption("#poQty-noodles", "100000"); await p.screenshot({ path: `/tmp/wh-po-${w}.png` });
  ok(!(await p.isDisabled("#poSubmit")), "bulk order allowed"); await p.click("#poSubmit"); await p.waitForTimeout(150);
  ok(await p.evaluate(() => window.__economy.state.orders.some(o => o.dest === "wh")), "warehouse shipment exists");
  await p.evaluate(() => { const s = window.__economy.state, E = window.__economy.E; let n = 0; while (s.orders.length && n++ < 4000) E.tick(s, 0.5); });
  await p.click('[data-main="warehouse"]'); await p.click('[data-sub="send"]'); await p.waitForTimeout(100);
  ok(await p.evaluate(() => window.__economy.state.wh.qty.noodles >= 100000), "stock arrived in the warehouse");
  await p.click("#trOpen"); await p.selectOption("#trQty-noodles", "5000"); await p.screenshot({ path: `/tmp/wh-send-${w}.png` }); await p.click("#trSubmit"); await p.waitForTimeout(150);
  ok(await p.evaluate(() => window.__economy.state.orders.some(o => o.kind === "transfer")), "transfer shipment exists");
  ok(await p.evaluate(() => window.__economy.E.reconcile(window.__economy.state).ok), "books reconcile");
  await p.click('[data-main="warehouse"]'); await p.click('[data-sub="b2b"]'); ok(await p.isVisible(".soon"), "B2B placeholder");
  const sideways = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1); ok(!sideways, `no sideways scroll at ${w}`);
}
console.log(fail ? "FAILED " + fail : "warehouse flow OK", "errors", errs); await b.close(); process.exit(fail ? 1 : 0);
