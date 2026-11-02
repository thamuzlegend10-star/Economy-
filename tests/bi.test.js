import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import * as F from "../js/factory.js";
import * as Bi from "../js/bi.js";
import * as SC from "../js/screens.js";
import { balance } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 200000, seed: 8, ...o });
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };

test("gross profit and margin come from the ledger", () => {
  const s = mk(); for (let i = 0; i < 4; i++) runDay(s);
  const m = Bi.bi(s), rev = balance(s.ledger, "sales") + balance(s.ledger, "sales_b2b") + balance(s.ledger, "sales_ecom"), cogs = balance(s.ledger, "cogs") + balance(s.ledger, "cogs_labor");
  assert.ok(Math.abs(m.revenue - rev) < 0.02); assert.ok(Math.abs(m.gross - (rev - cogs)) < 0.02);
  if (rev > 0) assert.ok(Math.abs(m.grossMargin - m.gross / rev * 100) < 0.02);
});

test("supplier on-time rate counts real deliveries, late ones too", () => {
  const s = mk(); const sp = D.SUPPLIERS[0].id;
  Bi.trackArrival(s, sp, false); Bi.trackArrival(s, sp, true); Bi.trackArrival(s, sp, false); Bi.trackArrival(s, sp, false);
  const m = Bi.bi(s); assert.equal(m.supplierOrders, 4); assert.equal(m.supplierOnTime, 75); assert.equal(m.suppliers[0].late, 1);
  const o = E.placeOrders(s, { supplier: sp, lines: [{ pid: "noodles", qty: 1000 }] }); assert.ok(o.ok); const before = s.perf.orders;
  for (let i = 0; i < 8; i++) runDay(s); assert.equal(s.perf.orders, before + 1);
});

test("factory utilisation is output over full capacity: zero when idle, positive when producing", () => {
  const s = mk(); F.rentFactory(s, 250); F.buyMachine(s, { type: "std" }); runDay(s);
  assert.equal(Bi.bi(s).prodEff, 0); assert.ok(Bi.bi(s).capUnits > 0);
  F.placeRawOrder(s, { vendor: "agro", lines: [{ rid: "appleConc", qty: 500 }, { rid: "water", qty: 5000 }] }); F.placeRawOrder(s, { vendor: "packco", lines: [{ rid: "bottles", qty: 5000 }, { rid: "caps", qty: 5000 }] });
  for (let i = 0; i < 4; i++) runDay(s); F.queueBatch(s, { machine: s.fx.machines[0].id, juice: "apple", qty: 2000 }); for (let i = 0; i < 3; i++) runDay(s);
  const m = Bi.bi(s); assert.ok(m.madeUnits > 0); assert.ok(m.prodEff > 0 && m.prodEff <= 100, String(m.prodEff));
});

test("turnover and days of stock follow stock value and cost of goods", () => {
  const s = mk(); runDay(s); runDay(s); const m = Bi.bi(s), inv = balance(s.ledger, "inventory") + balance(s.ledger, "inv_raw") + balance(s.ledger, "inv_fg");
  assert.ok(Math.abs(m.inventory - inv) < 0.02); assert.ok(m.cogs > 0, "the shop sold something");
  if (inv > 0) { assert.ok(m.turnoverYear > 0); assert.ok(Math.abs(m.daysOfStock * m.turnoverYear - 365) < 1); } else { assert.equal(m.turnoverYear, 0); }
});

test("the dashboard renders with and without history, and the chart draws a line per series", () => {
  const s = mk(); assert.match(SC.biScreen(s), /Profit and loss/); assert.match(SC.biScreen(s), /appear after two day reports/);
  for (let i = 0; i < 3; i++) runDay(s); const html = SC.biScreen(s); assert.match(html, /<polyline/); assert.equal((html.match(/<polyline/g) || []).length, 3); assert.match(html, /Supplier reliability/);
});
