import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const setup = html.slice(html.indexOf('id="menuSetup"'), html.indexOf('id="menuLive"'));
test("setup has five steps, each with a tab and a panel", () => {
  assert.equal((setup.match(/class="cfg-tab/g) || []).length, 5);
  assert.equal((setup.match(/class="cfg-step"/g) || []).length, 5);
  for (let i = 1; i <= 5; i++) { assert.match(setup, new RegExp(`data-cfg="${i}"`)); assert.match(setup, new RegExp(`data-step="${i}"`)); }
});
test("every setup control the code reads is still present exactly once", () => {
  for (const id of ["sLocBtn", "sLocLabel", "sArea", "sAreaN", "areaChips", "rentBox", "sSec", "sDays", "sDaysInf", "lenNote", "sCap", "sScn", "scnList", "sMods", "sDiff", "sBk", "sTg", "cfgSum", "sBack", "sPrev", "sNext", "sStart"]) assert.equal((setup.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, id);
});
test("Open the shop is always available, as the intro says; the tabs name their step for screen readers", () => {
  assert.doesNotMatch(setup, /id="sStart"[^>]*hidden/); assert.match(setup, /aria-label="Step 3: Session"/);
});
test("every id used in setup is unique in the whole page", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]); const dup = ids.filter((x, i) => ids.indexOf(x) !== i); assert.deepEqual(dup, []);
});
