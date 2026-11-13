import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as X from "../js/exportdata.js";
import * as SC from "../js/screens.js";
import * as D from "../js/data.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 200000, seed: 21, ...o });
const runDays = (s, n) => { const end = s.day + n; while (s.day < end && !s.ended) E.tick(s, 1); };
// a small CSV reader that follows the same quoting rules, to prove the file round-trips
const parse = text => { const rows = []; let row = [], cur = "", q = false; text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cur); cur = ""; } else if (ch === "\r") { /* skip */ } else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; } else cur += ch; }
  return rows; };

test("quoting: commas, quotes and newlines survive, and formula starters are neutralised", () => {
  const csv = X.toCsv(["a", "b"], [["x,y", 'say "hi"'], ["line\nbreak", "=SUM(A1)"], [-5, 1.25], ["-cmd", "@x"]]);
  const r = parse(csv); assert.deepEqual(r[1], ["x,y", 'say "hi"']); assert.deepEqual(r[2], ["line\nbreak", "'=SUM(A1)"]); assert.deepEqual(r[3], ["-5", "1.25"]); assert.deepEqual(r[4], ["'-cmd", "'@x"]);
  assert.ok(csv.startsWith("﻿"));
});
test("daily export has one row per closed day with matching columns", () => {
  const s = mk(); runDays(s, 4); const x = X.exportCsv(s, "daily"), r = parse(x.text);
  assert.equal(r.length - 1, s.history.length); assert.ok(r.every(row => row.length === r[0].length)); assert.equal(r[0].length, 8 + 2 * D.PRODUCTS.length);
  assert.equal(Number(r[1][0]), s.history[0].day); assert.equal(Number(r[1][1]), s.history[0].revenue); assert.match(x.name, /^economy-daily-day\d+\.csv$/);
});
test("journal export: debits equal credits and every line is present", () => {
  const s = mk(); runDays(s, 3); const r = parse(X.exportCsv(s, "journal").text).slice(1);
  assert.equal(r.length, s.ledger.entries.reduce((a, e) => a + e.lines.length, 0));
  const dr = r.reduce((a, x) => a + Number(x[5]), 0), cr = r.reduce((a, x) => a + Number(x[6]), 0); assert.ok(Math.abs(dr - cr) < 0.02, dr + " vs " + cr);
});
test("trial balance and b2b exports work, unknown kind is null, screen has the buttons", () => {
  const s = mk(); runDays(s, 6);
  const tb = parse(X.exportCsv(s, "trial").text).slice(1); assert.ok(Math.abs(tb.reduce((a, x) => a + Number(x[3]) - Number(x[4]), 0)) < 0.02);
  assert.ok(X.exportCsv(s, "b2b").text.startsWith("﻿day,tender")); assert.equal(X.exportCsv(s, "nope"), null);
  for (const k of X.KINDS) assert.match(SC.biScreen(s), new RegExp(`data-export="${k.id}"`));
});
