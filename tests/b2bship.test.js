import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as B from "../js/b2b.js";
import * as D from "../js/data.js";
import { balance, totals } from "../js/ledger.js";
import { post } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 20, days: 40, capital: 100000, seed: 31, mods: { warehouse: true }, ...o });
function contract(s, buyer = "airline") {
  const b = B.ensureB2B(s), qty = 1000; post(s.ledger, s.day, "test stock", [{ acct: "inventory", dr: 1500 }, { acct: "capital", cr: 1500 }], "t:stock");
  s.wh.qty.noodles = qty; s.wh.val.noodles = 1500; const k = { id: 900, buyer, pid: "noodles", qty, price: 2, due: s.day + 5, penalty: 0.1, status: "active", awarded: s.day, lateDays: 0, fined: 0 }; b.active.push(k); return k;
}
test("pickup is the default and costs nothing; old games are the same", () => {
  const s = mk(); assert.equal(s.b2bShip, "pickup"); const k = contract(s); assert.equal(B.freightFor(s, k), 0);
  const old = mk(); delete old.b2bShip; const k2 = contract(old); assert.equal(B.freightFor(old, k2), 0);
});
test("delivering to the buyer costs freight that grows with distance", () => {
  const s = mk({ b2bShip: "deliver" }), near = contract(s, "hotel"), far = { ...near, buyer: "airline" };
  assert.ok(B.freightFor(s, far) > B.freightFor(s, near)); assert.ok(Math.abs(B.freightFor(s, near) - near.qty * D.PRODUCTS.find(p => p.id === "noodles").ref * D.B2B.freightRate * 8) < 0.01);
});
test("delivery books the freight as a delivery cost and the books balance", () => {
  const s = mk({ b2bShip: "deliver" }); const k = contract(s, "airline"), f = B.freightFor(s, k), d0 = balance(s.ledger, "delivery"), c0 = balance(s.ledger, "cash");
  const r = B.deliver(s, k.id); assert.equal(r.ok, true);
  assert.ok(Math.abs(balance(s.ledger, "delivery") - d0 - f) < 0.01); assert.ok(Math.abs(c0 - balance(s.ledger, "cash") - f) < 0.01);
  assert.ok(totals(s.ledger).balanced); assert.equal(E.reconcile(s).ok, true);
});
test("pickup delivery posts no freight", () => {
  const s = mk(); const k = contract(s); const d0 = balance(s.ledger, "delivery"); assert.equal(B.deliver(s, k.id).ok, true); assert.equal(balance(s.ledger, "delivery"), d0);
});
test("restart keeps the delivery mode", () => { assert.equal(E.restartSame(mk({ b2bShip: "deliver" })).b2bShip, "deliver"); });
