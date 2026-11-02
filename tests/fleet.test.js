import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import * as Fl from "../js/fleet.js";
import * as H from "../js/hr.js";
import * as UI from "../js/ui.js";
import { balance } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 200000, seed: 5, ...o });
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };
const sup = s => { const wh = D.SUPPLIERS[0]; return wh.id; };

test("buying a truck posts to machinery, reconciles, and needs cash", () => {
  const s = mk(), cash = balance(s.ledger, "cash"), r = Fl.buyTruck(s, { type: "van" });
  assert.ok(r.ok); assert.equal(Math.round(cash - balance(s.ledger, "cash")), 14000); assert.equal(balance(s.ledger, "machinery"), 14000);
  assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems));
  const p = mk({ capital: 5000 }); assert.equal(Fl.buyTruck(p, { type: "van" }).ok, false); assert.equal(Fl.buyTruck(s, { type: "x" }).ok, false);
});

test("a trip needs a truck and a driver; fuel follows distance", () => {
  const s = mk(); assert.equal(Fl.planTrip(s, { km: 100, space: 1000 }).ok, false);
  Fl.buyTruck(s, { type: "van" }); assert.match(Fl.planTrip(s, { km: 100, space: 1000 }).error, /driver/);
  H.hire(s, "driver", 1);
  const a = Fl.planTrip(s, { km: 100, space: 1000 }), b = Fl.planTrip(s, { km: 200, space: 1000 });
  assert.ok(a.ok && b.ok); assert.ok(Math.abs(b.fuel - 2 * a.fuel) < 0.02); assert.equal(a.rounds, 1);
  assert.equal(Fl.planTrip(s, { km: 100, space: 13000 }).rounds, 3);
});

test("ordering by own truck pays only fuel, dispatches the truck, and the books balance through delivery", () => {
  const s = mk(); Fl.buyTruck(s, { type: "truck" }); H.hire(s, "driver", 1);
  const lines = [{ pid: "noodles", qty: 2000 }], hired = E.quoteMulti(s, sup(s), lines, "retail", "hired"), own = E.quoteMulti(s, sup(s), lines, "retail", "own");
  assert.ok(own.ok, JSON.stringify(own.errors)); assert.equal(own.goods, hired.goods); assert.ok(own.ship !== hired.ship);
  const cash = balance(s.ledger, "cash"), r = E.placeOrders(s, { supplier: sup(s), lines, carrier: "own" });
  assert.ok(r.ok); assert.equal(Math.round((cash - balance(s.ledger, "cash")) * 100), Math.round((own.goods + own.ship) * 100));
  assert.equal(Fl.trucksOut(s), 1); assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems));
  assert.equal(E.quoteMulti(s, sup(s), lines, "retail", "own").ok, false);                     // truck and driver are busy
  for (let i = 0; i < 12; i++) runDay(s);
  assert.equal(Fl.trucksOut(s), 0); assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems));
});

test("warehouse to shop by own truck: fuel only, stock moves, books balance", () => {
  const s = mk(); E.rentWarehouse(s, 400); Fl.buyTruck(s, { type: "van" }); H.hire(s, "driver", 1);
  s.wh.qty.noodles = 3000; s.wh.val.noodles = 1500; s.ledger.bal.inventory = Math.round((s.ledger.bal.inventory + 1500) * 100) / 100; s.ledger.bal.capital = Math.round((s.ledger.bal.capital - 1500) * 100) / 100;
  const q = E.quoteTransfer(s, [{ pid: "noodles", qty: 1000 }], "own"); assert.ok(q.ok, JSON.stringify(q.errors));
  const r = E.sendToRetail(s, { carrier: "own", lines: [{ pid: "noodles", qty: 1000 }] }); assert.ok(r.ok);
  assert.equal(s.wh.qty.noodles, 2000); assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems));
});

test("trucks depreciate daily, wear with use, can break down when worn, and servicing restores them", () => {
  const s = mk(); Fl.buyTruck(s, { type: "van" }); runDay(s);
  const k = s.fleet.trucks[0]; assert.ok(k.deprec > 0); assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems));
  H.hire(s, "driver", 1); k.health = 10; let broke = false;
  for (let i = 0; i < 40 && !broke; i++) { s.fleet.trucks[0].status = "idle"; s.fleet.trucks[0].busyUntil = 0; s.fleet.trucks[0].health = 10; const p = Fl.planTrip(s, { km: 50, space: 100 }); Fl.dispatch(s, p, "test"); broke = s.fleet.trucks[0].status === "down"; }
  assert.ok(broke); assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems));
  k.status = "idle"; k.busyUntil = 0; assert.ok(Fl.serviceTruck(s, k.id).ok); assert.equal(k.health, 100);
});

test("save v17 round-trips; a v16 save migrates; the fleet screen renders", () => {
  const s = mk(); Fl.buyTruck(s, { type: "van" }); const back = E.validateSave(JSON.parse(JSON.stringify(s)));
  assert.ok(back.ok, back.error); assert.equal(back.state.fleet.trucks.length, 1);
  const old = JSON.parse(JSON.stringify(mk())); old.v = 16; delete old.fleet; delete old.hr.staff.driver;
  const m = E.validateSave(old); assert.ok(m.ok, m.error); assert.equal(m.state.fleet.trucks.length, 0); assert.equal(m.state.hr.staff.driver.n, 0);
  assert.match(UI.ship(s, { sub: { shipping: "fleet" } }), /My fleet/);
});
