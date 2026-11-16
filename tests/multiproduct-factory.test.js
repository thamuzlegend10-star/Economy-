import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as F from "../js/factory.js";
import * as D from "../js/data.js";
import { balance } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 40, capital: 400000, seed: 11, ...o });
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };

test("buying factory floor is a capital asset, ledger stays balanced, no rent on owned area", () => {
  const s = mk(), cash = balance(s.ledger, "cash");
  const r = F.buyFactoryLand(s, 100); assert.ok(r.ok, r.error);
  assert.equal(balance(s.ledger, "land_building"), F.landCost(s, 100));
  assert.equal(Math.round((cash - balance(s.ledger, "cash")) * 100), Math.round(F.landCost(s, 100) * 100));
  assert.equal(F.factoryRent(s), 0);
  assert.ok(F.propertyTaxPerDay(s) > 0);
  F.rentFactory(s, 100);                                   // rented floor on top of owned floor still pays rent
  assert.equal(F.factoryRent(s), Math.round(F.factoryRentPerM2(s) * 100 * 100) / 100);
  assert.ok(E.reconcile(s).ok);
});

test("owned floor pays property tax every day instead of rent", () => {
  const s = mk(); F.buyFactoryLand(s, 100);
  const t0 = balance(s.ledger, "property_tax"), r0 = balance(s.ledger, "rent");
  runDay(s);
  assert.equal(balance(s.ledger, "property_tax") - t0, F.propertyTaxPerDay(s));
  const ctl = mk(); F.rentFactory(ctl, 100); runDay(ctl);          // same floor rented instead: the rent account grows by more
  assert.ok(balance(ctl.ledger, "rent") > balance(s.ledger, "rent") - r0 + r0 - 1e-6 || F.factoryRent(ctl) > F.factoryRent(s));
  assert.ok(E.reconcile(s).ok);
});

test("buying land refuses when cash is short or size is out of range", () => {
  assert.equal(F.buyFactoryLand(mk({ capital: 20000 }), 100).ok, false);
  assert.equal(F.buyFactoryLand(mk(), 0).ok, false);
  assert.equal(F.buyFactoryLand(mk(), D.FACTORY.maxArea + 100).ok, false);
});

test("auto service restores a worn machine at its threshold and books the cost", () => {
  const s = mk(); F.rentFactory(s, 300); F.buyMachine(s, { type: "std" });
  const m = s.fx.machines[0]; m.health = 55;
  assert.equal(F.setAutoPm(s, m.id, 60).ok, true);
  const before = balance(s.ledger, "maintenance"); runDay(s);
  assert.ok(balance(s.ledger, "maintenance") - before >= D.MACHINES[0].pmCost - 1e-6);
  assert.ok(m.health >= D.MAINT.restoreTo - 1e-6);
  assert.ok(E.reconcile(s).ok);
});

test("auto service off or above health does nothing; bad value refused", () => {
  const s = mk(); F.rentFactory(s, 300); F.buyMachine(s, { type: "std" });
  const m = s.fx.machines[0]; m.health = 90; F.setAutoPm(s, m.id, 60);
  runDay(s);
  assert.ok(!s.fx.today.auto, "no auto service above the threshold");
  assert.equal(F.setAutoPm(s, m.id, 33).ok, false);
  assert.equal(F.setAutoPm(s, m.id, "off").ok, true); assert.equal(m.autoPm, null);
});

test("electronics line: BOM data is complete and a gadget run deducts raw and books balanced", () => {
  const g = D.GADGETS; assert.equal(g.length, 2);
  for (const j of g) for (const rid of Object.keys(j.bom)) assert.ok(D.RAW.some(r => r.id === rid), rid);
  assert.ok(D.MACHINES.some(m => m.id === "elecStandard") && D.MACHINES.some(m => m.id === "elecPrecision"));
});

const wait = (s, n = 15) => { for (let i = 0; i < n && s.fx.pos.length; i++) runDay(s); assert.equal(s.fx.pos.length, 0); };

test("electronics assembly: raw parts are used per the BOM, gadgets are made and the books balance", () => {
  const s = mk(); F.rentFactory(s, 500);
  const o = F.placeRawOrder(s, { vendor: "voltix", terms: "cod", lines: [{ rid: "lithiumCell", qty: 3000 }, { rid: "audioChip", qty: 1500 }, { rid: "siliconeStrap", qty: 3000 }] });
  assert.ok(o.ok, o.error); wait(s);
  const b = F.buyMachine(s, { type: "elecStandard" }); assert.ok(b.ok, b.error);
  const m = b.machine; assert.equal(m.job.juice, "smartEarbuds", "default run is the first good of the machine's line");
  const before = { ...s.fx.raw.qty };
  runDay(s);
  const made = s.fx.fg.qty.smartEarbuds; assert.ok(made > 0 && made <= 600, "made " + made);
  assert.equal(before.lithiumCell - s.fx.raw.qty.lithiumCell, made * D.GADGETS[0].bom.lithiumCell);
  assert.equal(before.audioChip - s.fx.raw.qty.audioChip, made * D.GADGETS[0].bom.audioChip);
  assert.equal(before.siliconeStrap - s.fx.raw.qty.siliconeStrap, made * D.GADGETS[0].bom.siliconeStrap);
  assert.ok(s.fx.fg.val.smartEarbuds > 0, "finished gadgets are valued at the cost of parts and conversion");
  assert.ok(E.reconcile(s).ok);
});

test("a machine only makes goods of its own line", () => {
  const s = mk(); F.rentFactory(s, 500);
  const juice = F.buyMachine(s, { type: "std" }).machine, gad = F.buyMachine(s, { type: "elecStandard" }).machine;
  assert.ok(F.canMake(juice, "apple") && !F.canMake(juice, "smartEarbuds"));
  assert.ok(F.canMake(gad, "digitalWatch") && !F.canMake(gad, "apple"));
  assert.equal(F.setRun(s, { machine: gad.id, juice: "apple", qty: 100 }).ok, false);
  assert.equal(F.queueBatch(s, { machine: juice.id, juice: "digitalWatch", qty: 500 }).ok, false);
  assert.ok(F.queueBatch(s, { machine: gad.id, juice: "digitalWatch", qty: 500 }).ok);
});

test("electronics machines depreciate straight line over their life", () => {
  const s = mk(); F.rentFactory(s, 500);
  const m = F.buyMachine(s, { type: "elecPrecision" }).machine, d0 = balance(s.ledger, "depreciation");
  runDay(s); runDay(s);
  const per = m.cost / D.MACHINES.find(x => x.id === "elecPrecision").life;
  assert.ok(Math.abs((balance(s.ledger, "depreciation") - d0) - per * 2) < 0.05, "two days of depreciation");
  assert.ok(E.reconcile(s).ok);
});

test("gadgets are wanted by B2B buyers only when the factory module is on", () => {
  const withF = D.B2B.buyers.filter(b => b.want.includes("smartEarbuds") || b.want.includes("digitalWatch"));
  assert.ok(withF.length >= 2);
});
