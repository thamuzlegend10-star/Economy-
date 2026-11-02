import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The scenes draw on a canvas (browser only), so these tests check that every view is registered, reachable from the page, and reads real state.
const src = readFileSync(new URL("../js/scene.js", import.meta.url), "utf8"), html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
test("six scene views exist and every one has a tab", () => {
  for (const v of ["store", "warehouse", "city", "factory", "yard", "bank"]) { assert.match(src, new RegExp(`\\b${v}: draw`)); assert.match(html, new RegExp(`data-scene="${v}"`)); }
});
test("the new scenes read real state, not made-up numbers", () => {
  for (const needle of ["fx.machines", "fx.raw.qty", "s.fleet", "balance(s.ledger, \"cash\")", "balance(s.ledger, \"overdraft\")", "s.bank", "tax_payable"]) assert.ok(src.includes(needle), needle);
});
