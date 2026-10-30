import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 10, capital: 40000, seed: 7, ...o });
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };
const order = (s, o) => E.placeOrder(s, o);

test("setup is clamped and rent is per m2", () => {
  const c = E.cleanSetup({ area: 1, secPerDay: 1, days: 999, capital: 5, location: "nope" });
  assert.equal(c.area, D.AREA.min); assert.equal(c.secPerDay, D.SECONDS_PER_DAY.min); assert.equal(c.days, D.DAYS.max); assert.equal(c.capital, D.CAPITAL.min); assert.equal(c.location, "id-medan-central");
  assert.equal(E.dailyRent("id-medan-central", 100), E.rentPerM2("id-medan-central") * 100);
  assert.equal(E.capacityOf(300), 30000);
});

test("only three products exist and the game starts balanced with opening stock", () => {
  assert.equal(D.PRODUCTS.length, 3);
  const s = mk(); assert.ok(E.reconcile(s).ok);
  assert.deepEqual(Object.keys(s.qty).sort(), ["earbuds", "milk", "noodles"]);
  assert.equal(s.qty.noodles, D.START_STOCK.noodles);
  assert.equal(E.dashboard(s).netWorth, s.startNetWorth);
});

test("timer: a day lasts exactly secPerDay seconds whatever the frame size", () => {
  const a = mk(), b = mk();
  for (let i = 0; i < 200; i++) E.tick(a, 0.05);
  for (let i = 0; i < 10; i++) E.tick(b, 1);
  assert.equal(a.day, 2); assert.equal(b.day, 2);
  assert.equal(a.rng, b.rng); assert.equal(JSON.stringify(a.ledger.bal), JSON.stringify(b.ledger.bal));
  assert.ok(E.timeLeft(a) > 9.9);
});

test("sales reduce stock, create revenue, and stop when stock is gone", () => {
  const s = mk(); const before = s.qty.noodles; runDay(s);
  assert.ok(s.stats.units > 0); assert.ok(s.qty.noodles >= 0 && s.qty.noodles < before);
  assert.ok(E.dashboard(s).revenue > 0); assert.ok(E.reconcile(s).ok);
  const t = mk({ seed: 3 }); const v = t.val.earbuds; t.qty.earbuds = 0; t.val.earbuds = 0;   // direct edit, only to test the stop rule
  t.ledger.bal.inventory = Math.round((t.ledger.bal.inventory - v) * 100) / 100; t.ledger.bal.capital = Math.round((t.ledger.bal.capital + v) * 100) / 100;
  runDay(t); assert.equal(t.stats.prod.earbuds.units, 0); assert.ok(t.stats.prod.earbuds.lost > 0);
});

test("purchase quote shows total, bulk discount, eta; limits are enforced", () => {
  const s = mk();
  const q = E.quote(s, "metro", "noodles", 10000); assert.ok(q.ok); assert.equal(q.discount, 0.03); assert.ok(q.days >= 1); assert.ok(q.ship > 0);
  assert.ok(E.quote(s, "metro", "noodles", 3000).unit > q.unit);
  assert.match(E.quote(s, "metro", "noodles", 150000).errors.join(" "), /cash/);
  const big = mk({ capital: 200000, area: 200 }); assert.match(E.quote(big, "pacific", "milk", 30000).errors.join(" "), /storage/);
  assert.match(E.quote(big, "local", "noodles", 100000).errors.join(" "), /in stock/);
  assert.ok(E.quote(mk(), "metro", "noodles", 0).error); assert.ok(E.quote(mk(), "metro", "noodles", 150001).error);
  for (const sup of D.SUPPLIERS) assert.ok(E.quote(s, sup.id, "milk", 1000).days >= 1);
});

test("order: cash leaves now, goods arrive on the eta day, books stay balanced", () => {
  const s = mk({ seed: 11 }); const cash0 = E.dashboard(s).cash, q = E.quote(s, "local", "noodles", 5000);
  assert.ok(order(s, { supplier: "local", pid: "noodles", qty: 5000 }).ok);
  assert.ok(Math.abs(E.dashboard(s).cash - (cash0 - q.total)) < 0.01); assert.equal(s.orders.length, 1); assert.ok(E.reconcile(s).ok);
  const eta = s.orders[0].eta;
  while (!s.ended && s.day < eta) runDay(s);
  assert.equal(s.orders.length, 0); assert.ok(E.reconcile(s).ok); assert.ok(s.qty.noodles > 3000); assert.ok(E.dashboard(s).expenses > 0);
});

test("shipments reserve storage so a delivery can never overflow", () => {
  const s = mk({ capital: 200000, area: 150 });
  assert.ok(order(s, { supplier: "pacific", pid: "noodles", qty: 5000 }).ok);
  assert.equal(order(s, { supplier: "pacific", pid: "noodles", qty: 9000 }).ok, false);
  for (let i = 0; i < 12; i++) runDay(s);
  assert.ok(E.spaceUsed(s) <= E.capacityOf(s.area));
});

test("price controls change demand and margin and respect bounds", () => {
  const s = mk(); const base = E.expectedDemand(s, "noodles"), p0 = s.prices.noodles;
  E.adjustPrice(s, "noodles", 1); assert.ok(s.prices.noodles > p0); assert.ok(E.expectedDemand(s, "noodles") < base);
  const hi = s.prices.noodles; E.adjustPrice(s, "noodles", -1); E.adjustPrice(s, "noodles", -1); assert.ok(s.prices.noodles < hi); assert.ok(E.expectedDemand(s, "noodles") > base);
  for (let i = 0; i < 200; i++) E.adjustPrice(s, "earbuds", -1);
  assert.equal(s.prices.earbuds, E.priceBounds(D.PRODUCTS[2]).min);
  assert.ok(E.margin(s, "milk").pct > 0);
});

test("locations differ and runs are deterministic", () => {
  const a = mk({ location: "id-jakarta-central" }), b = mk({ location: "id-siantar-town" }), c = mk({ location: "id-jakarta-central" });
  runDay(a); runDay(b); runDay(c);
  assert.ok(a.stats.units > b.stats.units); assert.equal(JSON.stringify(a.ledger.bal), JSON.stringify(c.ledger.bal));
  assert.ok(E.dailyRent("id-jakarta-central", 300) > E.dailyRent("id-siantar-town", 300));
});

test("a full game reaches a final report with the best product and reconciles", () => {
  const s = mk({ days: 8, seed: 5 });
  let n = 0; while (!s.ended && n++ < 200) {
    for (const p of D.PRODUCTS) if (s.qty[p.id] < 2500) order(s, { supplier: "local", pid: p.id, qty: p.id === "earbuds" ? 1000 : 3000 });
    runDay(s);
  }
  assert.equal(s.ended.reason, "completed"); assert.equal(s.history.length, 8);
  const r = E.finalReport(s); assert.ok(r.revenue > 0 && r.expenses > 0); assert.ok(r.best && r.best.profit > 0); assert.equal(r.rows.length, 3);
  assert.ok(Math.abs(r.netProfit - (r.revenue - r.expenses)) < 0.01); assert.ok(E.reconcile(s).ok);
});

test("unpaid rent makes an overdraft, and three days of it ends the game", () => {
  const s = mk({ capital: 10000, area: 2000, days: 40 });
  s.qty = { noodles: 0, milk: 0, earbuds: 0 }; s.val = { noodles: 0, milk: 0, earbuds: 0 };
  s.ledger.bal.inventory = 0; s.ledger.bal.cash = 0; s.ledger.bal.capital = 0;                  // direct edit to force a cash crisis, books stay balanced
  let n = 0; while (!s.ended && n++ < 20) runDay(s);
  assert.equal(s.ended.reason, "bankrupt");
});

test("save round trip works; old saves are refused with a clear message", () => {
  const s = mk(); runDay(s); const v = E.validateSave(E.serialize(s)); assert.ok(v.ok); assert.equal(v.state.day, s.day);
  const old = JSON.parse(E.serialize(s)); old.v = 10; const r = E.validateSave(JSON.stringify(old)); assert.equal(r.ok, false); assert.equal(r.old, true);
  assert.equal(E.validateSave("{").ok, false);
  const bad = JSON.parse(E.serialize(s)); bad.ledger.bal.cash += 5; assert.equal(E.validateSave(JSON.stringify(bad)).ok, false);
});
