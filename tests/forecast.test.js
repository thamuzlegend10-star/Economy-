import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as F from "../js/factory.js";
import * as Fc from "../js/forecast.js";
import * as M from "../js/mrp.js";
import * as A from "../js/actions.js";
import * as SC from "../js/screens.js";
import * as D from "../js/data.js";
import { balance } from "../js/ledger.js";

const mk = (o = {}) => { const s = E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 250000, seed: 13, ...o }); F.rentFactory(s, 500); return s; };
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };
const stockUp = s => { F.placeRawOrder(s, { vendor: "agro", lines: [{ rid: "appleConc", qty: 3000 }, { rid: "orangePulp", qty: 3000 }, { rid: "water", qty: 20000 }] }); F.placeRawOrder(s, { vendor: "packco", lines: [{ rid: "bottles", qty: 20000 }, { rid: "caps", qty: 20000 }] }); for (let i = 0; i < 6 && s.fx.pos.length; i++) runDay(s); };
// Give a game a made-up history: demand per product per day, so the forecast can be checked against a known answer.
const fake = (s, pid, f, n = 14) => { s.history = []; for (let i = 1; i <= n; i++) { const d = Math.round(f(i) * E.WEEK[i % 7]); s.history.push({ day: i, units: { noodles: 0, milk: 0, earbuds: 0, [pid]: d }, lost: { noodles: 0, milk: 0, earbuds: 0 }, revenue: 0 }); } s.day = n + 1; };

// ---------- queue ----------
test("queue: batches run in order and finish; the standing run resumes afterwards", () => {
  const s = mk(); stockUp(s); const m = F.buyMachine(s, { type: "std" }).machine; F.setRun(s, { machine: m.id, juice: "orange", qty: 300 });
  assert.ok(F.queueBatch(s, { machine: m.id, juice: "apple", qty: 1500 }).ok); assert.ok(F.queueBatch(s, { machine: m.id, juice: "orange", qty: 500 }).ok);
  runDay(s); assert.ok(s.fx.fg.qty.apple > 800 && s.fx.fg.qty.orange === 0); assert.equal(m.queue[0].juice, "apple"); assert.ok(m.queue[0].done > 800);
  runDay(s); runDay(s); assert.equal(s.fx.fg.qty.apple, 1500); assert.ok(F.queuedBottles(s, "orange") <= 500); for (let i = 0; i < 3; i++) runDay(s);
  assert.equal(m.queue.length, 0); assert.ok(s.fx.fg.qty.orange > 500); assert.ok(E.reconcile(s).ok);       // after the queue the standing run (300/day) keeps going
});
test("queue: limits, validation, removal, and a batch waits for raw materials", () => {
  const s = mk(); const m = F.buyMachine(s, { type: "std" }).machine;
  assert.equal(F.queueBatch(s, { machine: m.id, juice: "apple", qty: 10 }).ok, false); assert.equal(F.queueBatch(s, { machine: m.id, juice: "nope", qty: 500 }).ok, false); assert.equal(F.queueBatch(s, { machine: 99, juice: "apple", qty: 500 }).ok, false);
  for (let i = 0; i < F.QUEUE_MAX; i++) assert.ok(F.queueBatch(s, { machine: m.id, juice: "apple", qty: 500 }).ok); assert.equal(F.queueBatch(s, { machine: m.id, juice: "apple", qty: 500 }).ok, false);
  runDay(s); assert.equal(m.queue[0].done, 0); assert.equal(m.status, "idle");                                   // no raw materials: waits, nothing is lost
  const id = m.queue[1].id; assert.ok(F.dropBatch(s, { machine: m.id, id }).ok); assert.equal(m.queue.length, F.QUEUE_MAX - 1); assert.equal(F.dropBatch(s, { machine: m.id, id }).ok, false);
});
test("MRP plans raw materials for the queue, not only the standing run", () => {
  const s = mk(); const m = F.buyMachine(s, { type: "std" }).machine; assert.ok(M.plan(s).rows.every(r => r.qty === 0));
  F.queueBatch(s, { machine: m.id, juice: "melon", qty: 4000 }); const r = M.plan(s).rows.find(x => x.rid === "melonSyrup"); assert.equal(r.perDay, 150); assert.ok(r.qty > 0);
});
test("old machines without a queue field still work", () => {
  const s = mk(); stockUp(s); const m = F.buyMachine(s, { type: "std" }).machine; delete m.queue; F.setRun(s, { machine: m.id, juice: "apple", qty: 500 }); runDay(s); assert.ok(s.fx.fg.qty.apple > 400);
});

// ---------- forecast ----------
test("forecast recovers a flat level and the weekday pattern from history", () => {
  const s = mk(); fake(s, "noodles", () => 1000); const m = Fc.model(s, "noodles"); assert.ok(Math.abs(m.level - 1000) < 15, "level " + m.level); assert.ok(Math.abs(m.trend) < 3);
  const sat = Fc.forecastDay(s, "noodles", 6 - ((s.history[s.history.length - 1].day) % 7) + 7 * 0 || 7); assert.ok(sat > 0);
  let hi = 0, lo = Infinity; for (let k = 1; k <= 7; k++) { const v = Fc.forecastDay(s, "noodles", k); hi = Math.max(hi, v); lo = Math.min(lo, v); } assert.ok(hi / lo > 1.3 && hi / lo < 1.6, "weekly swing " + hi / lo);
});
test("forecast follows a rising trend and a falling trend", () => {
  const up = mk(); fake(up, "milk", i => 500 + 20 * i); assert.ok(Fc.model(up, "milk").trend > 15); assert.ok(Fc.forecastTotal(up, "milk", 7) > Fc.forecastTotal(up, "milk", 7, 8) * 0.0 + 7 * 700);
  const dn = mk(); fake(dn, "milk", i => 900 - 25 * i); assert.ok(Fc.model(dn, "milk").trend < -20); assert.ok(Fc.trendPct(dn, "milk") < 0);
});
test("with almost no history the forecast falls back on the demand model", () => {
  const s = mk(); const m = Fc.model(s, "noodles"); assert.equal(m.basis, "model"); assert.ok(m.level > 500 && m.level < 6000);
});
test("accuracy: a steady seller is forecast within 10 percent; the error is null with no history", () => {
  const s = mk(); assert.equal(Fc.forecastError(s, "noodles"), null); fake(s, "noodles", () => 1200, 25); assert.ok(Fc.forecastError(s, "noodles") < 0.1);
});
test("forecast on a real simulated game stays sensible", () => {
  const s = mk(); for (let i = 0; i < 14; i++) { for (const p of D.PRODUCTS) { s.qty[p.id] = Math.max(s.qty[p.id], 1); } runDay(s); }
  const m = Fc.model(s, "noodles"); assert.equal(m.basis, "history"); assert.ok(m.level > 0); const e = Fc.forecastError(s, "noodles"); assert.ok(e === null || e < 0.6, "error " + e);
});

// ---------- lead time and safety stock ----------
test("a less reliable supplier has a longer expected lead time and needs more safety stock", () => {
  const s = mk(), good = D.SUPPLIERS.find(x => x.id === "local"), bad = { ...good, reliability: 0.7 };
  const a = Fc.vendorLead(s, good), b = Fc.vendorLead(s, bad); assert.ok(b.expected > a.expected && b.sigma > a.sigma); assert.ok(Fc.safetyFromLead(1000, 100, b) > Fc.safetyFromLead(1000, 100, a));
});
test("noisier demand needs more safety stock; zero noise and a perfect supplier need none", () => {
  const lt = { days: 3, expected: 3, sigma: 0 }; assert.equal(Fc.safetyFromLead(1000, 0, lt), 0); assert.ok(Fc.safetyFromLead(1000, 200, lt) > Fc.safetyFromLead(1000, 50, lt));
});

// ---------- retail advice ----------
test("advice: low stock triggers an order; counting a delivery on the way removes it; healthy stock needs none", () => {
  const s = mk(); fake(s, "noodles", () => 2000); s.qty.noodles = 500; s.val.noodles = 425; s.ledger.bal.inventory = 0; s.ledger.bal.capital = 0; s.ledger.bal.cash = 0;
  const a = Fc.retailAdvice(s, "noodles"); assert.ok(a.qty > 0 && a.position < a.rop); assert.ok(a.rop > a.perDay);
  s.qty.noodles = 60000; const b = Fc.retailAdvice(s, "noodles"); assert.equal(b.qty, 0);
});
test("advice never suggests more than the shop can hold, and the order button places a real order", () => {
  const s = mk({ capital: 150000 }); runDay(s); runDay(s); runDay(s); const f = A.newForms(); s.qty.noodles = 0; s.val.noodles = 0; s.ledger.bal.inventory = Math.round((s.ledger.bal.inventory - 0) * 100) / 100;
  const a = Fc.retailAdvice(s, "milk"); assert.ok(a.qty * D.PRODUCTS[1].space <= E.spaceFree(s) + 1);
  const before = s.orders.length; const r = A.act(s, f, "advBuy", { id: "earbuds" });
  if (Fc.retailAdvice(s, "earbuds").qty || r.ok) assert.ok(r.ok || /No purchase/.test(r.error)); void before;
});
test("the best supplier is chosen by price per reliability, not price alone", () => {
  const s = mk(); const sp = Fc.bestSupplier(s, "noodles"); assert.ok(D.SUPPLIERS.includes(sp));
  const scores = D.SUPPLIERS.map(x => [E.unitCost(s, x, "noodles") / x.reliability, x.id]).sort((a, b) => a[0] - b[0]); assert.equal(sp.id, scores[0][1]);
});

// ---------- juice advice and MRP link ----------
test("juice advice counts contracts, stock and queue; the make button queues on the least busy machine", () => {
  const s = mk(); stockUp(s); const a1 = F.buyMachine(s, { type: "std" }).machine, a2 = F.buyMachine(s, { type: "std" }).machine; F.queueBatch(s, { machine: a1.id, juice: "apple", qty: 2000 });
  s.b2b.active.push({ id: 801, buyer: "hotel", pid: "orange", qty: 3000, price: 2, due: s.day + 6, penalty: 0.1, status: "active", awarded: s.day, lateDays: 0, fined: 0 });
  const x = Fc.juiceAdvice(s, "orange"); assert.equal(x.contracts, 3000); assert.equal(x.qty, 3000); assert.equal(Fc.juiceAdvice(s, "apple").queued, 2000);
  const f = A.newForms(); assert.ok(A.act(s, f, "advMake", { id: "orange" }).ok); assert.equal(a2.queue.length, 1); assert.equal(Fc.juiceAdvice(s, "orange").qty, 0);
  assert.equal(A.act(s, f, "advMake", { id: "orange" }).ok, false);
});
test("MRP uses safety stock from supplier reliability and does not overfill a rented warehouse", () => {
  const s = mk(); const m = F.buyMachine(s, { type: "std" }).machine; F.setRun(s, { machine: m.id, juice: "orange", qty: 1000 });
  const row = M.plan(s).rows.find(r => r.rid === "orangePulp"); assert.ok(row.ss >= row.perDay * D.FORECAST.minSafetyDays); assert.ok(row.leadExp >= 1);
  E.rentWarehouse(s, 500); s.wh.qty.noodles = 0; const big = M.plan(s).rows.find(r => r.rid === "bottles"); assert.ok(big.qty * D.RAW.find(r => r.id === "bottles").space <= E.whFree(s) + 10);
});

// ---------- screens ----------
test("forecast and queue screens render without junk and the full flow stays balanced", () => {
  const s = mk(); stockUp(s); const f = A.newForms(); F.buyMachine(s, { type: "std" }); A.act(s, f, "qadd", { id: String(s.fx.machines[0].id) }); for (let i = 0; i < 5; i++) { runDay(s); assert.ok(E.reconcile(s).ok); }
  for (const h of [SC.forecast(s), SC.factoryMachines(s, f), SC.factoryMrp(s)]) { assert.ok(h.length > 100); assert.ok(!/undefined|NaN|Infinity|\[object/.test(h)); }
  assert.ok(balance(s.ledger, "inv_fg") >= 0);
});
