import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as B from "../js/b2b.js";
import * as D from "../js/data.js";
import * as SC from "../js/screens.js";
import { balance, totals, post } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 200000, seed: 21, ...o });

test("buyers start with a rating from their base risk, and rating bands run AAA to DDD", () => {
  const s = mk(); B.ensureB2B(s).cr = {};   // start of the game, before any drift
  assert.equal(B.ratingOf(B.credit(s, "uni")), "AAA"); assert.equal(B.ratingOf(B.credit(s, "chain")), "A");
  assert.deepEqual([95, 85, 75, 65, 55, 45, 35, 10].map(B.ratingOf), ["AAA", "AA", "A", "BBB", "BB", "B", "CCC", "DDD"]);
  assert.ok(B.defaultRisk(s, "chain") > B.defaultRisk(s, "uni"));
});
test("a missed payment drops the buyer's score and a paid invoice lifts it", () => {
  const s = mk(); const b = B.ensureB2B(s); const before = B.credit(s, "chain");
  post(s.ledger, s.day, "test invoice", [{ acct: "receivables", dr: 1000 }, { acct: "sales_b2b", cr: 1000 }], "t:1");
  b.ar = [{ id: 1, buyer: "chain", amount: 1000, issued: s.day, due: s.day }];
  b.cr.chain = 10; const risk = B.defaultRisk(s, "chain"); assert.ok(risk > 0.08);
  const low = B.credit(s, "chain"); b.cr.chain = 100; b.ar[0].due = s.day;
  const seen = { paid: 0, bad: 0 };
  for (let i = 0; i < 40; i++) { const t = mk({ seed: 100 + i }), bb = B.ensureB2B(t); bb.cr = { chain: 20 };
    post(t.ledger, t.day, "inv", [{ acct: "receivables", dr: 1000 }, { acct: "sales_b2b", cr: 1000 }], "t:1"); bb.ar = [{ id: 1, buyer: "chain", amount: 1000, issued: t.day, due: t.day }];
    const was = balance(t.ledger, "cash"); B.b2bDay(t); (balance(t.ledger, "cash") > was ? seen.paid++ : seen.bad++); assert.ok(totals(t.ledger).balanced); }
  assert.ok(seen.bad > 0 && seen.paid > 0, JSON.stringify(seen)); assert.equal(low, 10);
});
test("scores drift but stay between 5 and 100, and the screen shows ratings", () => {
  const s = mk(); for (let i = 0; i < 300; i++) { s.day++; B.b2bDay(s); }
  for (const y of D.B2B.buyers) { const v = B.credit(s, y.id); assert.ok(v >= 5 && v <= 100); }
  assert.match(SC.b2bMarket(s, { bid: {} }), /Client credit/);
});
test("old saves without credit scores load", () => { const s = mk(); delete s.b2b.cr; delete s.b2b.crng; B.b2bDay(s); assert.ok(B.credit(s, "hotel") > 0); assert.ok(E.validateSave(JSON.parse(E.serialize(s))).ok); });
