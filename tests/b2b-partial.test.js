import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as B from "../js/b2b.js";
import { balance, totals, post } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 20, days: 40, capital: 100000, seed: 31, mods: { warehouse: true }, ...o });
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };
function contract(s, have = 1000, qty = 1000) {
  const b = B.ensureB2B(s); if (have > 0) post(s.ledger, s.day, "test stock", [{ acct: "inventory", dr: have * 1.5 }, { acct: "capital", cr: have * 1.5 }], "t:stock");
  s.wh.qty.noodles = have; s.wh.val.noodles = have * 1.5;
  const k = { id: 900, buyer: "airline", pid: "noodles", qty, price: 2, due: s.day + 3, penalty: 0.1, status: "active", awarded: s.day, lateDays: 0, fined: 0 }; b.active.push(k); return k;
}

test("a partial delivery books revenue and cost for the units sent only and keeps the contract open", () => {
  const s = mk(), k = contract(s, 400, 1000);
  assert.equal(B.quoteDelivery(s, 900).ok, false, "all 1,000 are not in stock");
  assert.equal(B.quoteDelivery(s, 900, 400).ok, true);
  const r = B.deliver(s, 900, 400); assert.ok(r.ok, r.error); assert.equal(r.partial, true); assert.equal(r.left, 600);
  assert.equal(balance(s.ledger, "sales_b2b"), 800); assert.equal(balance(s.ledger, "cogs"), 600);
  assert.equal(B.remaining(k), 600); assert.equal(s.b2b.active.length, 1); assert.equal(s.wh.qty.noodles, 0);
  assert.equal(s.b2b.history.length, 0, "not finished yet");
  assert.ok(totals(s.ledger).balanced);
});

test("the rest can be sent later, the contract then closes with the full revenue and one invoice per part", () => {
  const s = mk(), k = contract(s, 400, 1000); B.deliver(s, 900, 400);
  post(s.ledger, s.day, "more stock", [{ acct: "inventory", dr: 900 }, { acct: "capital", cr: 900 }], "t:more"); s.wh.qty.noodles = 600; s.wh.val.noodles = 900;
  const r = B.deliver(s, 900); assert.ok(r.ok, r.error); assert.ok(!r.partial);
  assert.equal(balance(s.ledger, "sales_b2b"), 2000); assert.equal(s.b2b.active.length, 0);
  assert.equal(s.b2b.history.at(-1).revenue, 2000); assert.equal(s.b2b.ar.length, 2);
  assert.equal(new Set(s.b2b.ar.map(x => x.id)).size, 2, "each invoice has its own id");
  assert.ok(E.reconcile(s).ok);
});

test("a late fine counts only the units still owed", () => {
  const full = mk(), part = mk(); contract(full, 0, 1000); contract(part, 400, 1000); B.deliver(part, 900, 400);
  for (const s of [full, part]) { while (s.day < 5) runDay(s); }
  const pf = balance(full.ledger, "penalties"), pp = balance(part.ledger, "penalties");
  assert.ok(pf > 0 && pp > 0 && Math.abs(pp - pf * 0.6) < 0.05 * pf, `${pp} vs ${pf}`);
});

test("bad quantities are refused and a contract of an older save still delivers in one go", () => {
  const s = mk(), k = contract(s, 1000, 1000);
  assert.equal(B.quoteDelivery(s, 900, 0).ok, false); assert.ok(B.quoteDelivery(s, 900, 0).error);
  assert.ok(B.quoteDelivery(s, 900, 5000).error);
  assert.equal(k.got, undefined, "no new field is needed on old contracts"); assert.equal(B.remaining(k), 1000);
  assert.ok(B.deliver(s, 900).ok); assert.equal(balance(s.ledger, "sales_b2b"), 2000);
});

test("freight on a part delivery is paid on the part only", () => {
  const s = mk({ b2bShip: "deliver" }), k = contract(s, 400, 1000), part = B.freightFor(s, k, 400), all = B.freightFor(s, k);
  assert.ok(all > 0 && Math.abs(part - all * 0.4) < 0.02);
  const d0 = balance(s.ledger, "delivery"); B.deliver(s, 900, 400); assert.ok(Math.abs(balance(s.ledger, "delivery") - d0 - part) < 0.01);
});
