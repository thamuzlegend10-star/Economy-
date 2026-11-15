import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as Bk from "../js/blanket.js";
import * as D from "../js/data.js";
import * as SC from "../js/screens.js";
import { act, newForms } from "../js/actions.js";
import { balance, totals } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 2000, secPerDay: 20, days: 80, capital: 200000, seed: 17, ...o });
const base = { supplier: "metro", pid: "noodles", total: 20000, count: 4, start: 0, gap: 7 };

test("the quote locks the unit price with the discount for the whole quantity and lays out the schedule", () => {
  const s = mk(), q = Bk.blanketQuote(s, base);
  assert.equal(q.ok, true); assert.equal(q.sched.length, 4); assert.equal(q.sched.reduce((a, x) => a + x.qty, 0), 20000);
  assert.deepEqual(q.sched.map(x => x.day), [s.day, s.day + 7, s.day + 14, s.day + 21]);
  assert.equal(q.discount, E.discountFor(20000)); assert.ok(q.saving >= 0);
});
test("an uneven total spreads the remainder and still adds up", () => {
  const q = Bk.blanketQuote(mk(), { ...base, total: 10001, count: 3 }); assert.deepEqual(q.sched.map(x => x.qty), [3334, 3334, 3333]);
});
test("bad inputs are refused", () => {
  const s = mk(); for (const o of [{ supplier: "harbor" }, { pid: "x" }, { total: 0 }, { count: 5 }, { start: 5 }, { gap: 2 }, { total: 3, count: 4 }]) assert.equal(Bk.blanketQuote(s, { ...base, ...o }).ok, false, JSON.stringify(o));
});
test("shipments are sent on their days at the fixed price and the books balance", () => {
  const s = mk(); const r = Bk.createBlanket(s, base); assert.equal(r.ok, true); const b = r.blanket;
  E.stepDay(s); assert.ok(s.orders.some(o => o.sup === "metro") || b.sched[0].done);   // the first shipment goes out the morning of day 1 (start 0) or on the next day boundary
  while (s.day < 25 && !s.ended) E.stepDay(s);
  assert.equal(b.got, 20000); assert.equal(b.state, "done"); assert.ok(totals(s.ledger).balanced); assert.equal(E.reconcile(s).ok, true);
});
test("the fixed price holds even when the supplier price moves", () => {
  const s = mk(); const r = Bk.createBlanket(s, { ...base, count: 2, start: 3, gap: 3 }); const b = r.blanket;
  s.supIdx.metro = 1.15; while (!b.sched.every(x => x.done) && s.day < 20) E.stepDay(s);
  const mine = s.ledger.entries ? null : null; void mine;
  const bought = [...s.orders].filter(o => o.sup === "metro"); for (const o of bought) assert.equal(o.unit, b.unit);
});
test("a future-dated order sends nothing until its day", () => {
  const s = mk(); const b = Bk.createBlanket(s, { ...base, count: 1, start: 7 }).blanket;
  for (let i = 0; i < 5; i++) E.stepDay(s); assert.equal(b.got, 0); while (s.day < 12) E.stepDay(s); assert.equal(b.got, 20000);
});
test("a shipment that cannot be paid waits, then the agreement ends after three days", () => {
  const s = mk({ capital: 10000, area: 100 }); const b = Bk.createBlanket(s, { ...base, total: 400000, count: 4, gap: 3 }).blanket;
  assert.ok(b);
  for (let i = 0; i < 6 && b.state === "open"; i++) E.stepDay(s);
  assert.equal(b.state, "dropped"); assert.ok(totals(s.ledger).balanced);
});
test("cancel stops the rest; limit on open agreements", () => {
  const s = mk(); const a = Bk.createBlanket(s, { ...base, start: 14 }).blanket; assert.equal(Bk.cancelBlanket(s, a.id).ok, true); assert.equal(Bk.cancelBlanket(s, a.id).ok, false);
  for (let i = 0; i < Bk.BLK.maxOpen; i++) assert.equal(Bk.createBlanket(s, { ...base, start: 14, total: 1000, count: 1 }).ok, true); assert.equal(Bk.createBlanket(s, { ...base, start: 14 }).ok, false);
});
test("old saves have no blanket state and play as before; ordinary orders are unchanged", () => {
  const s = mk(); assert.equal(s.blk, undefined); E.stepDay(s); assert.equal(s.blk, undefined);
  const r = E.placeOrders(s, { supplier: "metro", lines: [{ pid: "milk", qty: 500 }] }); assert.equal(r.ok, true);
});
test("the card renders and the actions work", () => {
  const s = mk(), f = newForms(); assert.match(SC.blanketCard(s, f), /Blanket and future orders/);
  f.blk = { ...base, sup: "metro", count: 2 }; assert.equal(act(s, f, "blkCreate", {}).ok, true); assert.match(SC.blanketCard(s, f), /Open agreements/);
  const id = Bk.openBlankets(s)[0].id; assert.equal(act(s, f, "blkCancel", { id }).ok, true);
});
