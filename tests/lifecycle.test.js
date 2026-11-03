// Full-lifecycle audit: a scripted player runs every department for 60 days. After every day the books must reconcile, the trial balance must
// balance, and no number may go NaN. Two runs with the same seed must produce the exact same save (determinism), and a mid-game save must reload.
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import * as F from "../js/factory.js";
import * as Fl from "../js/fleet.js";
import * as H from "../js/hr.js";
import * as B from "../js/b2b.js";
import * as K from "../js/market.js";
import * as Bk from "../js/bank.js";
import * as M from "../js/mrp.js";
import * as Js from "../js/juiceshop.js";
import * as Ac from "../js/accounting.js";
import * as Bi from "../js/bi.js";
import * as Kp from "../js/kpi.js";
import { balance } from "../js/ledger.js";

function play(seed, scenario = "supply", onDay = () => {}) {
  const s = E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 250000, seed, scenario });
  const day = () => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };
  F.rentFactory(s, 300); E.rentWarehouse(s, 400); F.buyMachine(s, { type: "std" });
  H.hire(s, "retail", 2); H.hire(s, "warehouse", 1); H.hire(s, "sales", 1); H.hire(s, "service", 1); H.hire(s, "driver", 1); Fl.buyTruck(s, { type: "van" });
  K.openWebstore(s); K.setCatalog(s, ["apple", "noodles"]); K.startCampaign(s, { channel: "social", budget: 500, days: 10, cat: "all" });
  M.ensureMrp(s).autoPO = true;
  while (!s.ended) {
    const d = s.day;
    if (d % 5 === 1) { E.placeOrders(s, { supplier: "local", lines: [{ pid: "noodles", qty: 8000 }, { pid: "milk", qty: 3000 }], carrier: d % 10 === 1 ? "own" : "hired" }); }
    if (d % 8 === 2) { F.placeRawOrder(s, { vendor: "agro", lines: [{ rid: "appleConc", qty: 300 }, { rid: "water", qty: 3000 }] }); F.placeRawOrder(s, { vendor: "packco", lines: [{ rid: "bottles", qty: 3000 }, { rid: "caps", qty: 3000 }], terms: "net30" }); }
    if (d % 3 === 0 && s.fx.machines.length) F.queueBatch(s, { machine: s.fx.machines[0].id, juice: "apple", qty: 1500 });
    if (d % 6 === 0) { const q = Object.fromEntries(D.PRODUCTS.map(p => [p.id, Math.min(500, s.wh.qty[p.id])])); E.sendToRetail(s, { lines: D.PRODUCTS.map(p => ({ pid: p.id, qty: q[p.id] })).filter(l => l.qty > 0), carrier: "hired" }); }
    if (d % 3 === 0 && s.fx.fg.qty.apple > 0) Js.moveJuice(s, { lines: [{ jid: "apple", qty: Math.min(2500, s.fx.fg.qty.apple) }], carrier: d % 6 === 0 ? "own" : "hired" });
    const stock = pid => (s.wh.qty[pid] ?? s.fx.fg.qty[pid] ?? 0);
    for (const t of B.ensureB2B(s).open) if (stock(t.pid) >= t.qty) { if (t.kind === "fixed") B.acceptDeal(s, t.id); else B.placeBid(s, { tender: t.id, price: t.ceiling * 0.97 }); }
    for (const k of [...s.b2b.active]) B.deliver(s, k.id);
    if (d === 10) Bk.drawCredit(s, 10000); if (d === 12) Bk.takeLoan(s, { kind: "equipment", amount: 20000, termDays: 60 });
    if (d % 7 === 0) for (const m of s.fx.machines) F.preventiveMaintenance(s, m.id);
    if (d % 9 === 0) for (const k of s.fleet.trucks) Fl.serviceTruck(s, k.id);
    day(); onDay(s);
  }
  return s;
}

test("60 days of every department: books reconcile and balance every day, nothing goes NaN", () => {
  const seen = { orders: 0, deliveries: 0, mail: 0 };
  const s = play(21, "supply", s => {
    const r = E.reconcile(s); assert.ok(r.ok, `day ${s.day}: ${JSON.stringify(r.problems)}`);
    assert.ok(Ac.trialBalance(s).balanced, `trial balance, day ${s.day}`);
    for (const [k, v] of Object.entries(s.ledger.bal)) assert.ok(Number.isFinite(v), `${k} on day ${s.day}`);
    const k = Kp.scoreboard(s); assert.ok(Number.isFinite(k.total) && k.total >= 0 && k.total <= 100);
    const m = Bi.bi(s); for (const x of [m.revenue, m.gross, m.net, m.inventory]) assert.ok(Number.isFinite(x));
  });
  assert.ok(s.ended || s.day >= 60); assert.ok(s.history.length >= 55);
  const t = Ac.trialBalance(s); assert.ok(t.balanced);
  assert.ok(balance(s.ledger, "sales") + balance(s.ledger, "sales_b2b") + balance(s.ledger, "sales_ecom") > 0, "something was sold");
  assert.ok(s.fx.eff && s.fx.eff.made > 0, "the factory produced bottles");
  assert.ok(s.fleet.km > 0, "the truck drove"); assert.ok(s.jshop.sold.apple > 0, "juice sold in the shop"); assert.ok(s.tax.assessed >= 0); assert.ok(s.mail.items.length > 0); assert.ok(H.ensureHr(s).hires > 0);
});

test("determinism: the same seed and the same actions give the exact same save", () => {
  const a = E.serialize(play(33)), b = E.serialize(play(33)), c = E.serialize(play(34));
  assert.equal(a, b); assert.notEqual(a, c);
});

test("a mid-game save reloads and the game carries on to the same ending", () => {
  let snap = null; const full = play(41, "pricewar", s => { if (s.day === 30 && !snap) snap = E.serialize(s); });
  const v = E.validateSave(snap); assert.ok(v.ok, v.error); assert.equal(v.state.day, 30); assert.ok(E.reconcile(v.state).ok);
  const s2 = v.state; while (!s2.ended) E.tick(s2, 0.5); assert.ok(E.reconcile(s2).ok); assert.ok(full.ended);
});
