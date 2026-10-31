// Lists every element that shows a visible scrollbar (takes layout space), on every screen and dialog. Needs playwright and a static server on 8765.
import { createRequire } from "module";
const { chromium } = createRequire(import.meta.url)("playwright");
const b = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] }); const found = new Set();
const scan = async (p, tag) => { const r = await p.evaluate(() => {
  const out = []; const de = document.documentElement;
  if (window.innerWidth - de.clientWidth > 0) out.push("PAGE vertical bar " + (window.innerWidth - de.clientWidth) + "px");
  if (window.innerHeight - de.clientHeight > 0) out.push("PAGE horizontal bar");
  for (const el of document.querySelectorAll("*")) { const cs = getComputedStyle(el); if (cs.display === "none") continue;
    const v = el.offsetWidth - el.clientWidth - (parseFloat(cs.borderLeftWidth) || 0) - (parseFloat(cs.borderRightWidth) || 0), h = el.offsetHeight - el.clientHeight - (parseFloat(cs.borderTopWidth) || 0) - (parseFloat(cs.borderBottomWidth) || 0);
    if (el !== de && el !== document.body && (v > 1 || h > 1) && /auto|scroll/.test(cs.overflowX + cs.overflowY)) out.push((el.id ? "#" + el.id : el.tagName.toLowerCase()) + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").join(".") : "") + (v > 1 ? " v" + Math.round(v) : "") + (h > 1 ? " h" + Math.round(h) : "")); }
  return out; }); for (const x of r) found.add(tag + " :: " + x); };
for (const [w, h] of [[1280, 800], [390, 844], [320, 640]]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage(); const t = `${w}x${h}`;
  await p.goto("http://localhost:8765/index.html"); await p.waitForTimeout(200); await scan(p, t + " start");
  await p.click("#mNew"); await scan(p, t + " new-game dialog"); await p.click("#sLocBtn"); await p.waitForTimeout(400); await scan(p, t + " map picker"); await p.keyboard.press("Escape");
  await p.click("#sStart"); await p.waitForTimeout(200);
  for (const [m, sb] of [["finance","overview"],["finance","reports"],["retail","location"],["retail","procurement"],["retail","store"],["retail","price"],["retail","tx"],["warehouse","stock"],["warehouse","procure"],["warehouse","send"],["warehouse","b2b"],["shipping","co"],["shipping","tx"],["b2b"],["mail"],["data"]]) {
    await p.click(`[data-main="${m}"]`); if (sb) await p.click(`[data-sub="${sb}"]`); await scan(p, `${t} ${m}/${sb || ""}`); }
  await p.click('[data-main="retail"]'); await p.click('[data-sub="procurement"]'); await p.click("#poOpen"); await scan(p, t + " order dialog"); await p.keyboard.press("Escape");
  await p.click('[data-main="finance"]'); await p.click('[data-sub="overview"]'); await p.click("#spOpen"); await scan(p, t + " space dialog"); await p.keyboard.press("Escape");
  await p.click("#bHelp").catch(() => {}); await scan(p, t + " help"); await p.keyboard.press("Escape");
  await p.click("#bMenu").catch(() => {}); await scan(p, t + " menu"); await p.keyboard.press("Escape");
  await p.evaluate(() => { const s = window.__economy.state; let n = 0; while (!s.ended && n++ < 200000) window.__economy.E.tick(s, 0.5); }); await p.waitForTimeout(600); await scan(p, t + " final report");
}
await b.close(); const arr = [...found]; console.log(arr.length ? arr.join("\n") : "NO VISIBLE SCROLLBARS"); process.exit(arr.length ? 1 : 0);
