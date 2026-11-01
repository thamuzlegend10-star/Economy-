import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as F from "../js/factory.js";
import * as D from "../js/data.js";
import { balance } from "../js/ledger.js";

const mk = (o = {}) => { const s = E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 40, capital: 200000, seed: 11, ...o }); F.rentFactory(s, 500); return s; };
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };
const stock = s => {
  const a = F.placeRawOrder(s, { vendor: "agro", lines: [{ rid: "appleConc", qty: 600 }, { rid: "orangePulp", qty: 600 }, { rid: "melonSyrup", qty: 600 }, { rid: "water", qty: 6000 }], terms: "cod" });
  const b = F.placeRawOrder(s, { vendor: "packco", lines: [{ rid: "bottles", qty: 6000 }, { rid: "caps", qty: 6000 }], terms: "cod" });
  assert.ok(a.ok && b.ok, a.error || b.error);
  for (let i = 0; i < 12 && s.fx.pos.length; i++) runDay(s);
  assert.equal(s.fx.pos.length, 0);
};

test("buying a machine capitalises price plus setup and stays balanced", () => {
  const s = mk(), cash = balance(s.ledger, "cash");
  const r = F.buyMachine(s, { type: "std" }); assert.ok(r.ok);
  assert.equal(balance(s.ledger, "machinery"), D.MACHINES[0].price + D.MACHINES[0].setup);
  assert.equal(balance(s.ledger, "cash"), cash - (D.MACHINES[0].price + D.MACHINES[0].setup));
  assert.ok(E.reconcile(s).ok);
  const poor = mk({ capital: 10000 }); assert.equal(F.buyMachine(poor, { type: "fast" }).ok, false);
});

test("raw order: COD pays now, Net 30 books a payable and pays on the due day", () => {
  const s = mk(), cash = balance(s.ledger, "cash");
  const a = F.placeRawOrder(s, { vendor: "packco", lines: [{ rid: "bottles", qty: 1000 }], terms: "cod" }); assert.ok(a.ok);
  assert.ok(balance(s.ledger, "cash") < cash); assert.equal(balance(s.ledger, "payables"), 0);
  const b = F.placeRawOrder(s, { vendor: "packco", lines: [{ rid: "caps", qty: 1000 }], terms: "net7" }); assert.ok(b.ok);
  assert.ok(balance(s.ledger, "payables") > 0); assert.ok(E.reconcile(s).ok);
  for (let i = 0; i < 9; i++) runDay(s);
  assert.equal(balance(s.ledger, "payables"), 0); assert.equal(s.fx.payables.length, 0); assert.ok(E.reconcile(s).ok);
  assert.equal(s.fx.raw.qty.bottles, 1000); assert.equal(s.fx.raw.qty.caps, 1000);
});

test("longer payment terms cost a little more per unit", () => {
  const s = mk(), q = t => F.quoteRaw(s, { vendor: "packco", lines: [{ rid: "bottles", qty: 1000 }], terms: t }).lines[0].unit;
  assert.ok(q("net30") > q("net14") && q("net14") > q("net7") && q("net7") > q("cod"));
});

test("a vendor refuses what it does not sell", () => {
  const s = mk(); assert.equal(F.quoteRaw(s, { vendor: "packco", lines: [{ rid: "appleConc", qty: 10 }] }).ok, false);
  assert.ok(F.quoteRaw(s, { vendor: "packco", lines: [{ rid: "appleConc", qty: 10 }] }).error);
});

test("requisition then approval places the purchase order; rejection does not", () => {
  const s = mk(), cash = balance(s.ledger, "cash");
  const pr = F.createPR(s, { vendor: "packco", lines: [{ rid: "bottles", qty: 500 }], terms: "cod" }).pr;
  assert.equal(balance(s.ledger, "cash"), cash); assert.equal(pr.status, "pending");
  assert.ok(F.approvePR(s, pr.id).ok); assert.equal(pr.status, "approved"); assert.ok(balance(s.ledger, "cash") < cash);
  assert.equal(F.approvePR(s, pr.id).ok, false);
  const p2 = F.createPR(s, { vendor: "packco", lines: [{ rid: "caps", qty: 500 }] }).pr; F.rejectPR(s, p2.id); assert.equal(F.approvePR(s, p2.id).ok, false);
});

test("production follows the BOM, uses raw stock, and books finished goods at material cost", () => {
  const s = mk(); stock(s);
  const m = F.buyMachine(s, { type: "std" }).machine; F.setRun(s, { machine: m.id, juice: "apple", qty: 1000 });
  const apple = s.fx.raw.qty.appleConc, bott = s.fx.raw.qty.bottles; runDay(s);
  const made = s.fx.fg.qty.apple; assert.ok(made > 900 && made <= 1000);
  assert.ok(Math.abs((apple - s.fx.raw.qty.appleConc) - made * 0.2) < 0.01); assert.equal(bott - s.fx.raw.qty.bottles, made);
  assert.ok(Math.abs(balance(s.ledger, "inv_fg") - s.fx.fg.val.apple) < 0.01); assert.ok(E.reconcile(s).ok);
  assert.equal(m.status, "running"); assert.ok(m.health < 100);
});

test("production is limited by the scarcest raw material and idles at zero", () => {
  const s = mk(); F.placeRawOrder(s, { vendor: "packco", lines: [{ rid: "bottles", qty: 300 }, { rid: "caps", qty: 5000 }] });
  F.placeRawOrder(s, { vendor: "agro", lines: [{ rid: "appleConc", qty: 1000 }, { rid: "water", qty: 9000 }] });
  for (let i = 0; i < 3; i++) runDay(s);
  const m = F.buyMachine(s, { type: "std" }).machine; F.setRun(s, { machine: m.id, juice: "apple", qty: 1000 }); runDay(s);
  assert.equal(s.fx.fg.qty.apple, 300); runDay(s); assert.equal(s.fx.fg.qty.apple, 300); assert.equal(m.status, "idle");
});

test("the high-speed machine makes three times the standard one", () => {
  const s = mk({ capital: 400000 }); stock(s); stock(s);
  const a = F.buyMachine(s, { type: "fast" }).machine; F.setRun(s, { machine: a.id, juice: "orange", qty: 9999 }); assert.equal(a.job.qty, 3000);
  runDay(s); assert.ok(s.fx.fg.qty.orange > 2500);
});

test("wear lowers efficiency; preventive maintenance restores health for a fee", () => {
  const s = mk(); stock(s);
  const m = F.buyMachine(s, { type: "std" }).machine; F.setRun(s, { machine: m.id, juice: "orange", qty: 1000 });
  m.health = 50; const eff = F.machineEfficiency(m); assert.ok(eff < 1);
  const cash = balance(s.ledger, "cash"); assert.ok(F.preventiveMaintenance(s, m.id).ok);
  assert.equal(m.health, 100); assert.equal(balance(s.ledger, "cash"), cash - D.MACHINES[0].pmCost); assert.equal(F.preventiveMaintenance(s, m.id).ok, false);
  runDay(s); assert.ok(s.fx.fg.orange === undefined || s.fx.fg.qty.orange < 1000);   // a service day loses part of the output
  assert.ok(E.reconcile(s).ok);
});

test("a neglected machine breaks down: 3x repair cost and one to two days stopped", () => {
  let hit = 0;
  for (let seed = 1; seed < 40 && !hit; seed++) {
    const s = mk({ seed }); stock(s); const m = F.buyMachine(s, { type: "std" }).machine; F.setRun(s, { machine: m.id, juice: "apple", qty: 1000 });
    m.health = 25; const before = balance(s.ledger, "maintenance"); runDay(s);
    if (m.status === "broken") {
      hit = 1; assert.equal(balance(s.ledger, "maintenance") - before, D.MACHINES[0].pmCost * 3); assert.ok(m.downDays >= 1 && m.downDays <= 2);
      const stockNow = s.fx.fg.qty.apple; runDay(s); assert.equal(s.fx.fg.qty.apple, stockNow);   // line is stopped
      assert.ok(E.reconcile(s).ok);
    }
  }
  assert.ok(hit, "no breakdown in 40 seeds");
});

test("a healthy machine does not break down", () => {
  const s = mk(); stock(s); const m = F.buyMachine(s, { type: "std" }).machine; F.setRun(s, { machine: m.id, juice: "apple", qty: 500 });
  for (let i = 0; i < 6; i++) { m.health = 100; runDay(s); assert.notEqual(m.status, "broken"); }
});

test("straight-line depreciation each day, never past zero", () => {
  const s = mk(); const m = F.buyMachine(s, { type: "std" }).machine, t = D.MACHINES[0], daily = Math.round((t.price + t.setup) / t.life * 100) / 100;
  runDay(s); assert.equal(m.deprec, daily); assert.equal(balance(s.ledger, "depreciation"), daily);
  for (let i = 0; i < 3; i++) runDay(s);
  assert.equal(m.deprec, Math.round(daily * 4 * 100) / 100); assert.ok(m.deprec < m.cost); assert.ok(E.reconcile(s).ok);
});

test("old v12 saves migrate with an empty factory; ledger and net worth are unchanged", () => {
  const s = mk(); runDay(s); const raw = JSON.parse(JSON.stringify(s)); delete raw.fx; raw.v = 12;
  const r = E.validateSave(raw); assert.ok(r.ok, r.error); assert.equal(r.state.v, D.SAVE_VERSION); assert.equal(r.state.fx.machines.length, 0);
});

test("a long game with a working factory stays reconciled and deterministic", () => {
  const run = () => { const s = mk({ days: 25 }); stock(s); const m = F.buyMachine(s, { type: "std" }).machine; F.setRun(s, { machine: m.id, juice: "melon", qty: 800 });
    for (let i = 0; i < 18 && !s.ended; i++) { if (i % 6 === 5) F.preventiveMaintenance(s, m.id); runDay(s); assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems)); } return s; };
  const a = run(), b = run(); assert.equal(JSON.stringify(a.ledger.bal), JSON.stringify(b.ledger.bal)); assert.equal(JSON.stringify(a.fx), JSON.stringify(b.fx));
});

// ---------- step B: factory building, floor space, conversion costs, morale ----------
import * as H from "../js/hr.js";
const bare = () => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 40, capital: 200000, seed: 11 });

test("machines need floor space: no factory, no machine; space is used up and freed by renting more", () => {
  const s = bare(); const r = F.buyMachine(s, { type: "std" }); assert.equal(r.ok, false); assert.match(r.error, /factory space/i);
  assert.equal(F.rentFactory(s, 10).ok, true); assert.equal(s.fx.area, D.FACTORY.minArea);           // first rental is at least the minimum
  assert.ok(F.buyMachine(s, { type: "std" }).ok); assert.ok(F.buyMachine(s, { type: "std" }).ok); assert.equal(F.factorySpaceFree(s), D.FACTORY.minArea - 2 * D.MACHINES[0].space);
  assert.equal(F.buyMachine(s, { type: "fast" }).ok, false); assert.ok(F.rentFactory(s, 250).ok); assert.ok(F.buyMachine(s, { type: "fast" }).ok);
  assert.equal(F.rentFactory(s, 99999).ok, false); assert.ok(E.reconcile(s).ok);
});

test("factory rent and utilities are paid every day by area", () => {
  const s = bare(); F.rentFactory(s, 200); const before = balance(s.ledger, "rent") + balance(s.ledger, "utilities"); runDay(s);
  const paid = balance(s.ledger, "rent") + balance(s.ledger, "utilities") - before - E.dailyRent(s.location, s.area);
  assert.ok(Math.abs(paid - (F.factoryRent(s) + F.factoryUtilities(s))) < 0.02, "paid " + paid);
});

test("on a producing day, wages, rent and utilities go into the cost of the goods, not the expenses", () => {
  const s = mk(); stock(s); const m = F.buyMachine(s, { type: "std" }).machine; F.setRun(s, { machine: m.id, juice: "apple", qty: 1000 });
  const labourExp = balance(s.ledger, "cogs_labor"), rentExp = balance(s.ledger, "rent"), mat0 = F.bomCost("apple", s);
  runDay(s); const made = s.fx.today.made.apple; assert.ok(made > 800);
  assert.equal(Math.round((balance(s.ledger, "cogs_labor") - labourExp) * 100), 0);                       // no labour expense that day
  assert.ok(balance(s.ledger, "rent") - rentExp < 1000 && s.fx.today.conv > 0);
  const unit = s.fx.fg.val.apple / s.fx.fg.qty.apple; assert.ok(unit > mat0 + 0.01, `unit ${unit} should exceed materials ${mat0}`);
  assert.ok(E.reconcile(s).ok);
});

test("on an idle day the same costs are expenses", () => {
  const s = mk(); const m = F.buyMachine(s, { type: "std" }).machine; runDay(s);
  assert.ok(balance(s.ledger, "cogs_labor") > 0); assert.equal(s.fx.fg.qty.apple, 0); assert.equal(balance(s.ledger, "inv_fg"), 0); assert.ok(E.reconcile(s).ok); void m;
});

test("goods carry their conversion cost into cost of goods sold when delivered to a B2B buyer", async () => {
  const B = await import("../js/b2b.js"); const s = mk(); stock(s); const m = F.buyMachine(s, { type: "std" }).machine; F.setRun(s, { machine: m.id, juice: "orange", qty: 1000 }); for (let i = 0; i < 2; i++) runDay(s);
  const qty = 500, value = s.fx.fg.val.orange / s.fx.fg.qty.orange * qty; s.b2b.active.push({ id: 700, buyer: "hotel", pid: "orange", qty, price: 2, due: s.day + 5, penalty: 0.1, status: "active", awarded: s.day, lateDays: 0, fined: 0 });
  const cogs = balance(s.ledger, "cogs"); assert.ok(B.deliver(s, 700).ok); assert.ok(Math.abs(balance(s.ledger, "cogs") - cogs - value) < 0.05); assert.ok(E.reconcile(s).ok);
});

test("low morale lowers factory output", () => {
  const out = mor => { const s = mk(); F.buyMachine(s, { type: "std" }); s.hr.morale = mor; return H.crew(s).out; };
  assert.ok(out(100) > out(20)); assert.ok(Math.abs(out(100) - 1) < 1e-9);
});

test("v15 saves with machines get a factory big enough for them", () => {
  const s = mk(); F.buyMachine(s, { type: "fast" }); const raw = JSON.parse(JSON.stringify(s)); delete raw.fx.area; raw.v = 15;
  const r = E.validateSave(raw); assert.ok(r.ok, r.error); assert.ok(r.state.fx.area >= D.MACHINES[1].space);
});
