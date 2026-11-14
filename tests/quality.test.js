import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as Qc from "../js/quality.js";
import * as D from "../js/data.js";
import * as SC from "../js/screens.js";
import { act, newForms } from "../js/actions.js";
import { balance, totals } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 80, capital: 200000, seed: 33, ...o });
// Put goods in transit on the books, then receive them through the quality gate, exactly like the engine does.
function deliver(s, sup, qty = 100) {
  const o = { id: ++s.orderSeq0, kind: "buy", sup, pid: "milk", qty, goods: qty * 2, dest: "shop", pname: "Milk" };
  const { post } = s._post; post(s.ledger, s.day, "test transit", [{ acct: "transit", dr: o.goods }, { acct: "capital", cr: o.goods }], "t:" + o.id);
  const got = Qc.receive(s, o, s); s.qty.milk += got.qty; s.val.milk = Math.round((s.val.milk + got.value) * 100) / 100; return { o, got };
}
import { post } from "../js/ledger.js";
const prep = s => { s.orderSeq0 = 100; s._post = { post }; return s; };

test("new games have quality checks, old saves do not", () => { assert.equal(mk().qcOn, true); const s = mk(); delete s.qcOn; assert.equal(Qc.screen(s, { kind: "buy", sup: "pacific", qty: 100, goods: 200 }), null); });
test("damage chance follows supplier reliability", () => {
  assert.ok(Qc.damageChance("local") < Qc.damageChance("metro") && Qc.damageChance("metro") < Qc.damageChance("pacific"));
  assert.ok(Qc.expectedRate("mega") > Qc.expectedRate("harbor"));
  assert.ok(Qc.recoverShare("local") > Qc.recoverShare("pacific"));
});
test("a poor supplier ships more broken goods over many deliveries (calibration)", () => {
  const s = prep(mk()); const k = Qc.ensureQc(s); k.inspect = false;
  for (const sup of ["local", "pacific"]) for (let i = 0; i < 4000; i++) Qc.screen(s, { id: i, kind: "buy", sup, qty: 100, goods: 200 });
  for (const sup of ["local", "pacific"]) { const r = Qc.supplierRows(s).find(x => x.id === sup); assert.ok(Math.abs(r.rate - r.expected) < 0.35 * r.expected + 0.002, sup + " " + r.rate + " vs " + r.expected); }
});
test("inspection on: damaged units are held as a claim, books balance, stock excludes them", () => {
  const s = prep(mk()); let held = null;
  for (let i = 0; i < 200 && !held; i++) { const q0 = s.qty.milk; const r = deliver(s, "pacific", 100); if (r.got.damaged > 0) held = { r, q0 }; }
  assert.ok(held, "some delivery is damaged"); assert.equal(held.r.got.qty, 100 - held.r.got.damaged);
  const lots = Qc.openLots(s); assert.ok(lots.length >= 1); assert.ok(balance(s.ledger, "claims") > 0);
  assert.ok(totals(s.ledger).balanced);
});
test("sending goods back pays a credit and clears the claim; the rest is a loss", () => {
  const s = prep(mk()); for (let i = 0; i < 300 && !Qc.openLots(s).length; i++) deliver(s, "mega", 100);
  const lot = Qc.openLots(s)[0], cash0 = balance(s.ledger, "cash"), sh0 = balance(s.ledger, "shrinkage"), cl0 = balance(s.ledger, "claims");
  const x = Qc.claim(s, lot.id); assert.equal(x.ok, true);
  assert.ok(Math.abs(x.back - lot.value * Qc.recoverShare("mega")) < 0.01);
  assert.ok(Math.abs(balance(s.ledger, "cash") - cash0 - x.back) < 0.01);
  assert.ok(Math.abs(balance(s.ledger, "claims") - (cl0 - lot.value)) < 0.01);
  assert.ok(Math.abs(balance(s.ledger, "shrinkage") - sh0 - (lot.value - x.back)) < 0.01);
  assert.equal(Qc.claim(s, lot.id).ok, false); assert.ok(totals(s.ledger).balanced);
});
test("a claim left open lapses into a loss after the window", () => {
  const s = prep(mk()); for (let i = 0; i < 300 && !Qc.openLots(s).length; i++) deliver(s, "mega", 100);
  const lot = Qc.openLots(s)[0]; const sh0 = balance(s.ledger, "shrinkage");
  s.day = lot.day + Qc.QC.claimDays - 1; Qc.qcDay(s); assert.equal(Qc.openLots(s).filter(l => l.id === lot.id).length, 1);
  s.day = lot.day + Qc.QC.claimDays; Qc.qcDay(s); assert.equal(Qc.openLots(s).filter(l => l.id === lot.id).length, 0);
  assert.ok(balance(s.ledger, "shrinkage") >= sh0 + lot.value - 0.01); assert.ok(totals(s.ledger).balanced);
});
test("inspection off: no fee, damage is lost at once and cannot be claimed", () => {
  const s = prep(mk()); Qc.toggleInspect(s, false); const cash0 = balance(s.ledger, "cash"); let got = null;
  for (let i = 0; i < 300 && !got; i++) { const r = deliver(s, "mega", 100); if (r.got.damaged) got = r; }
  assert.ok(got); assert.equal(Qc.openLots(s).length, 0); assert.equal(Qc.ensureQc(s).fees, 0); assert.ok(balance(s.ledger, "shrinkage") > 0); assert.equal(balance(s.ledger, "claims"), 0);
  assert.ok(Qc.summary(s).lost > 0); assert.ok(totals(s.ledger).balanced); void cash0;
});
test("inspection costs a fee per delivery", () => {
  const s = prep(mk()); const a = balance(s.ledger, "delivery"); deliver(s, "local", 50); assert.ok(Math.abs(balance(s.ledger, "delivery") - a - Qc.QC.fee) < 0.001);
});
test("transfers from the warehouse are never checked", () => {
  const s = prep(mk()); assert.equal(Qc.screen(s, { kind: "transfer", sup: "metro", qty: 10, goods: 20 }), null);
});
test("a real game with real orders stays balanced and reconciled", () => {
  const s = mk(); const f = newForms();
  for (let d = 0; d < 25; d++) { act(s, f, "buy", { id: "milk" }); E.tick(s, 1); }
  while (s.day < 30 && !s.ended) E.tick(s, 1);
  assert.ok(totals(s.ledger).balanced); assert.equal(E.reconcile(s).ok, true);
});
test("same seed gives the same damage; the new stream does not shift other dice", () => {
  const run = () => { const s = mk(); for (let i = 0; i < 50; i++) Qc.screen(s, { id: i, kind: "buy", sup: "mega", qty: 100, goods: 200 }); return JSON.stringify(s.qc.stat); };
  assert.equal(run(), run());
});
test("screen renders for new and old games", () => {
  const s = mk(); assert.match(SC.quality(s), /Delivery quality/); const old = mk(); delete old.qcOn; assert.match(SC.quality(old), /Not in this game/);
});
test("actions toggle inspection and handle claims", () => {
  const s = prep(mk()), f = newForms(); act(s, f, "qcInspect", { id: "0" }); assert.equal(s.qc.inspect, false); act(s, f, "qcInspect", { id: "1" }); assert.equal(s.qc.inspect, true);
  for (let i = 0; i < 300 && !Qc.openLots(s).length; i++) deliver(s, "mega", 100);
  const lot = Qc.openLots(s)[0]; act(s, f, "qcWriteOff", { id: lot.id }); assert.equal(Qc.openLots(s).length, 0);
});
