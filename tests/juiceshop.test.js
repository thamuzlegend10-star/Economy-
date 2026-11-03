import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import * as F from "../js/factory.js";
import * as Fl from "../js/fleet.js";
import * as H from "../js/hr.js";
import * as Js from "../js/juiceshop.js";
import * as Fc from "../js/forecast.js";
import * as SC from "../js/screens.js";
import { act, newForms } from "../js/actions.js";
import { balance } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 400, secPerDay: 10, days: 60, capital: 200000, seed: 9, ...o });
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };
// Put finished juice in the factory through real ledger entries (raw cost into finished goods).
function stockJuice(s, jid, qty, unit = 0.8) { const v = Math.round(qty * unit * 100) / 100; s.ledger.bal.inv_fg = Math.round((s.ledger.bal.inv_fg + v) * 100) / 100; s.ledger.bal.capital = Math.round((s.ledger.bal.capital - v) * 100) / 100; s.fx.fg.qty[jid] += qty; s.fx.fg.val[jid] = Math.round((s.fx.fg.val[jid] + v) * 100) / 100; }

test("moving juice posts goods in transit, then shop inventory on arrival, and the books reconcile at every step", () => {
  const s = mk(); stockJuice(s, "apple", 3000); assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems));
  const cash = balance(s.ledger, "cash"), r = Js.moveJuice(s, { lines: [{ jid: "apple", qty: 1000 }] }); assert.ok(r.ok, r.error);
  assert.equal(s.fx.fg.qty.apple, 2000); assert.ok(balance(s.ledger, "transit") > 0); assert.ok(balance(s.ledger, "cash") < cash); assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems));
  runDay(s); runDay(s); assert.equal(s.jshop.qty.apple + s.jshop.sold.apple, 1000); assert.ok(s.jshop.listed.apple); assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems));
});

test("juice on the shelf sells at the shop price, earns revenue, books cost of goods, and shelf space is counted", () => {
  const s = mk(); stockJuice(s, "orange", 2000, 0.8); Js.moveJuice(s, { lines: [{ jid: "orange", qty: 2000 }] }); const used0 = E.spaceUsed(s), inc = E.spaceIncoming(s); assert.ok(inc >= 2000);
  const sales0 = balance(s.ledger, "sales"); for (let i = 0; i < 4; i++) runDay(s);
  assert.ok(s.jshop.sold.orange > 0); assert.ok(balance(s.ledger, "sales") > sales0); assert.ok(s.today.rev >= 0);
  const cogsJ = s.jshop.sold.orange * 0.8; assert.ok(balance(s.ledger, "cogs") >= cogsJ * 0.95, "cost of goods booked at the factory cost");
  assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems));
});

test("price changes demand: cheaper sells more, dearer sells less; unstocked juice draws no missed sales", () => {
  const s = mk(); const j = D.JUICES[0]; s.jshop.listed.apple = true;
  Js.setJuicePrice(s, "apple", j.ref * 0.8); const cheap = Js.juiceDemand(s, j); Js.setJuicePrice(s, "apple", j.ref * 1.6); const dear = Js.juiceDemand(s, j); assert.ok(cheap > dear * 1.5);
  const t = mk(); for (let i = 0; i < 5; i++) runDay(t); assert.equal(t.jshop.lost.apple, 0); assert.equal(t.jshop.sold.apple, 0);
});

test("an empty shelf for a stocked juice counts as missed sales and lowers satisfaction through the real loop", () => {
  const s = mk(); s.jshop.listed.melon = true; for (let i = 0; i < 3; i++) runDay(s); assert.ok(s.jshop.lost.melon > 0);
});

test("own truck carries the juice for fuel only; carrier errors and stock limits are enforced", () => {
  const s = mk(); stockJuice(s, "apple", 2000); assert.equal(Js.quoteMove(s, [{ jid: "apple", qty: 100 }], "own").ok, false);
  Fl.buyTruck(s, { type: "van" }); H.hire(s, "driver", 1); const q = Js.quoteMove(s, [{ jid: "apple", qty: 1000 }], "own"); assert.ok(q.ok, JSON.stringify(q.errors)); assert.ok(q.fee < 80);
  assert.ok(Js.moveJuice(s, { lines: [{ jid: "apple", qty: 1000 }], carrier: "own" }).ok); assert.equal(Fl.trucksOut(s), 1);
  assert.equal(Js.quoteMove(s, [{ jid: "apple", qty: 5000 }]).ok, false); assert.equal(Js.moveJuice(s, { lines: [] }).ok, false);
  assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems));
});

test("production advice counts shop juice demand; the actions and the screen work; v21 saves migrate", () => {
  const s = mk(); s.jshop.listed.apple = true; for (let i = 0; i < 3; i++) runDay(s); const a = Fc.juiceAdvice(s, "apple"); assert.ok(a.shopPerDay > 0); assert.ok(a.need >= a.shopPerDay * D.FORECAST.reviewDays * 0.9);
  stockJuice(s, "apple", 1500); const f = newForms(); f.jm = { apple: 500 }; assert.ok(act(s, f, "jmove").ok); assert.deepEqual(f.jm, {});
  const p0 = s.jshop.prices.apple; assert.ok(act(s, f, "jprice", { id: "apple", dir: "1" }).ok); assert.ok(s.jshop.prices.apple > p0);
  assert.match(SC.factoryJuice(s, newForms()), /Juice to the shop/);
  const old = JSON.parse(JSON.stringify(mk())); old.v = 21; delete old.jshop; const m = E.validateSave(old); assert.ok(m.ok, m.error); assert.equal(m.state.jshop.qty.apple, 0);
});
