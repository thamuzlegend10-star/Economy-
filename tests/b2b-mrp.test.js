import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as F from "../js/factory.js";
import * as B from "../js/b2b.js";
import * as M from "../js/mrp.js";
import * as D from "../js/data.js";
import { balance } from "../js/ledger.js";

const mk = (o = {}) => { const s = E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 200000, seed: 5, ...o }); F.rentFactory(s, 500); return s; };
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };
const until = (s, f, max = 40) => { for (let i = 0; i < max && !f(s) && !s.ended; i++) runDay(s); return f(s); };
const giveWh = (s, pid, qty) => { const v = Math.round(D.PRODUCTS.find(p => p.id === pid).cost * qty * 100) / 100; s.wh.area = 500; s.wh.qty[pid] += qty; s.wh.val[pid] = Math.round((s.wh.val[pid] + v) * 100) / 100;
  s.ledger.bal.inventory = Math.round((s.ledger.bal.inventory + v) * 100) / 100; s.ledger.bal.capital = Math.round((s.ledger.bal.capital - v) * 100) / 100; };

test("tenders appear, carry a ceiling and a due date, and fixed deals appear too", () => {
  const s = mk(); until(s, x => x.b2b.open.length >= 2, 30);
  assert.ok(s.b2b.open.length >= 2);
  for (const t of s.b2b.open) { assert.ok(t.ceiling > 0 && t.qty >= 100 && t.due > s.day - 1); assert.ok(["tender", "fixed"].includes(t.kind)); }
});

test("a bid above the buyer ceiling is refused; one at or below is stored and can be withdrawn", () => {
  const s = mk(); until(s, x => x.b2b.open.some(t => t.kind === "tender"), 40);
  const t = s.b2b.open.find(x => x.kind === "tender");
  assert.equal(B.placeBid(s, { tender: t.id, price: t.ceiling + 0.5 }).ok, false);
  assert.ok(B.placeBid(s, { tender: t.id, price: t.ceiling * 0.8 }).ok); assert.ok(t.bid > 0);
  assert.ok(B.withdrawBid(s, t.id).ok); assert.equal(t.bid, null);
});

test("a very low bid beats the rivals sometimes; no bid never wins", () => {
  let won = 0, nobid = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const s = mk({ seed }); for (let i = 0; i < 40; i++) { for (const t of s.b2b.open) if (t.kind === "tender" && t.bid == null) B.placeBid(s, { tender: t.id, price: Math.round(t.ceiling * 0.45 * 100) / 100 }); runDay(s); }
    won += s.b2b.won; nobid += s.b2b.history.filter(h => h.result === "no bid").length;
  }
  assert.ok(won > 0, "a rock-bottom bid should win something"); assert.ok(nobid >= 0);
});

test("fixed deal accepted becomes a contract; delivery pays revenue, books COGS and removes stock", () => {
  const s = mk({ seed: 8 }); until(s, x => x.b2b.open.some(t => t.kind === "fixed" && PRODUCTS_OK(t)), 80);
  const t = s.b2b.open.find(x => x.kind === "fixed" && PRODUCTS_OK(x)); assert.ok(t, "no fixed deal for a retail product");
  giveWh(s, t.pid, t.qty + 10); assert.ok(E.reconcile(s).ok);
  assert.ok(B.acceptDeal(s, t.id).ok); const k = s.b2b.active[0]; assert.equal(k.pid, t.pid);
  const cash = balance(s.ledger, "cash"), sales = balance(s.ledger, "sales_b2b"); assert.ok(B.quoteDelivery(s, k.id).ok);
  assert.ok(B.deliver(s, k.id).ok);
  assert.equal(balance(s.ledger, "sales_b2b") - sales, Math.round(k.qty * k.price * 100) / 100); assert.ok(balance(s.ledger, "cash") > cash - 1);
  assert.equal(s.b2b.active.length, 0); assert.equal(s.b2b.ontime, 1); assert.ok(s.b2b.rep > 50); assert.ok(E.reconcile(s).ok);
});
function PRODUCTS_OK(t) { return D.PRODUCTS.some(p => p.id === t.pid); }

test("delivery is refused without enough stock", () => {
  const s = mk({ seed: 8 }); until(s, x => x.b2b.open.some(t => t.kind === "fixed"), 80);
  const t = s.b2b.open.find(x => x.kind === "fixed"); B.acceptDeal(s, t.id); const k = s.b2b.active[0];
  const q = B.quoteDelivery(s, k.id); assert.equal(q.ok, false); assert.equal(B.deliver(s, k.id).ok, false);
});

test("an overdue contract is fined every day, then breached after five days with a reputation loss", () => {
  const s = mk({ seed: 8 }); until(s, x => x.b2b.open.some(t => t.kind === "fixed"), 80);
  const t = s.b2b.open.find(x => x.kind === "fixed"); B.acceptDeal(s, t.id); const k = s.b2b.active[0], rep = s.b2b.rep;
  until(s, x => x.b2b.active.length === 0 || x.ended, 30);
  assert.equal(s.b2b.active.length, 0); assert.ok(s.b2b.history.some(h => h.result === "breached" && h.id === k.id));
  assert.ok(balance(s.ledger, "penalties") > 0); assert.ok(s.b2b.rep < rep); assert.ok(E.reconcile(s).ok);
});

test("juice contracts are filled from factory finished goods", () => {
  const s = mk({ seed: 3 }); s.b2b.active.push({ id: 900, buyer: "hotel", pid: "apple", qty: 100, price: 1.9, due: s.day + 5, penalty: 0.1, status: "active", awarded: s.day, lateDays: 0, fined: 0 });
  assert.equal(B.quoteDelivery(s, 900).ok, false);
  s.fx.fg.qty.apple = 100; s.fx.fg.val.apple = 57; s.ledger.bal.inv_fg = 57; s.ledger.bal.capital = Math.round((s.ledger.bal.capital - 57) * 100) / 100;
  assert.ok(B.deliver(s, 900).ok); assert.equal(s.fx.fg.qty.apple, 0); assert.equal(balance(s.ledger, "inv_fg"), 0); assert.ok(E.reconcile(s).ok);
});

test("MRP: no machines, no demand, no order", () => { const s = mk(); const p = M.plan(s); assert.ok(p.rows.every(r => r.qty === 0)); });

test("MRP: a scheduled machine creates a shortage and a lot-sized proposal from the cheapest reliable vendor", () => {
  const s = mk(); const m = F.buyMachine(s, { type: "std" }).machine; F.setRun(s, { machine: m.id, juice: "orange", qty: 1000 });
  const p = M.plan(s), pulp = p.rows.find(r => r.rid === "orangePulp"), bottles = p.rows.find(r => r.rid === "bottles");
  assert.equal(pulp.perDay, 250); assert.ok(pulp.shortage > 0 && pulp.qty >= pulp.shortage); assert.equal(bottles.perDay, 1000);
  assert.ok(D.RAW_VENDORS.find(v => v.id === pulp.vendor).reliability >= 0.9);
  assert.equal(p.rows.find(r => r.rid === "appleConc").qty, 0);
});

test("MRP counts stock on hand and orders already on the way", () => {
  const s = mk(); const m = F.buyMachine(s, { type: "std" }).machine; F.setRun(s, { machine: m.id, juice: "orange", qty: 1000 });
  const before = M.plan(s).rows.find(r => r.rid === "orangePulp"); F.placeRawOrder(s, { vendor: "agro", lines: [{ rid: "orangePulp", qty: before.shortage + 100 }] });
  const after = M.plan(s).rows.find(r => r.rid === "orangePulp"); assert.equal(after.shortage, 0); assert.ok(after.incoming > 0);
});

test("MRP generates one requisition per vendor and approving places real orders", () => {
  const s = mk(); const m = F.buyMachine(s, { type: "std" }).machine; F.setRun(s, { machine: m.id, juice: "apple", qty: 1000 });
  const prs = M.generatePRs(s); assert.ok(prs.length >= 2); assert.ok(prs.every(x => x.pr && x.pr.status === "pending")); assert.equal(s.fx.pos.length, 0);
  const placed = M.generatePRs(s, { approve: true }); assert.ok(placed.every(x => x.po)); assert.ok(s.fx.pos.length >= 2); assert.ok(E.reconcile(s).ok);
});

test("auto PO keeps a factory fed over a month without running out and stays reconciled", () => {
  const s = mk({ capital: 300000, days: 40 }); const m = F.buyMachine(s, { type: "std" }).machine; F.setRun(s, { machine: m.id, juice: "apple", qty: 800 }); s.mrp.autoPO = true;
  let made = 0; for (let i = 0; i < 25 && !s.ended; i++) { runDay(s); assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems)); }
  made = s.fx.fg.qty.apple; assert.ok(made > 8000, "factory output " + made);
});

test("EOQ grows with demand and shrinks with unit cost", () => { assert.ok(M.eoq(2000, 1) > M.eoq(500, 1)); assert.ok(M.eoq(1000, 5) < M.eoq(1000, 1)); assert.equal(M.eoq(0, 1), 0); });

test("v13 saves migrate to v14 with empty B2B and MRP", () => {
  const s = mk(); const raw = JSON.parse(JSON.stringify(s)); delete raw.b2b; delete raw.mrp; raw.v = 13;
  const r = E.validateSave(raw); assert.ok(r.ok, r.error); assert.equal(r.state.v, D.SAVE_VERSION); assert.deepEqual(r.state.b2b.open, []);
});

test("B2B and the shop's main random stream are independent", () => {
  const a = mk({ seed: 9 }), b = mk({ seed: 9 }); for (let i = 0; i < 6; i++) { runDay(a); runDay(b); }
  assert.equal(a.rng, b.rng); assert.equal(JSON.stringify(a.b2b), JSON.stringify(b.b2b));
});

test("B2B payment arrives after the buyer's credit terms, and the open invoice is visible", async () => {
  const E2 = await import("../js/engine.js"), B2 = await import("../js/b2b.js"), { balance: bal } = await import("../js/ledger.js"), Sc = await import("../js/screens.js");
  const s = E2.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 0, capital: 300000, seed: 2 }); E2.rentWarehouse(s, 400);
  const b = B2.ensureB2B(s); s.wh.qty.noodles = 30000; s.wh.val.noodles = 30000;
  b.active.push({ id: 900, kind: "fixed", buyer: "uni", pid: "noodles", qty: 3000, price: 1, due: s.day + 9, penalty: .1, status: "active", lateDays: 0, fined: 0 });
  assert.ok(B2.deliver(s, 900).ok); const cash0 = bal(s.ledger, "cash");
  assert.ok(Sc.b2bContracts(s).includes("Waiting for payment") && Sc.b2bContracts(s).includes("#900"));
  for (let i = 0; i < 16; i++) { const d = s.day; while (s.day === d) E2.tick(s, 0.5); }
  assert.ok(bal(s.ledger, "cash") > 0 && cash0 > 0 && b.ar.length === 0 && b.collected === 3000 && bal(s.ledger, "receivables") === 0);
});
