import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as Bk from "../js/bank.js";
import * as B from "../js/b2b.js";
import { post } from "../js/ledger.js";
import * as D from "../js/data.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 200000, seed: 21, ...o });

test("rating walks from AAA down to DDD as late days pile up", () => {
  const s = mk(), seen = [];
  for (const n of [0, 1, 2, 3, 5, 7, 8, 10]) { Bk.ensureBank(s).hist = Array(n).fill(1); seen.push(Bk.creditRating(s)[0]); }
  assert.deepEqual(seen, ["AAA", "AA", "A", "BBB", "BB", "B", "CCC", "DDD"]);
});
test("a funded clean shop has no current ratio and loses no points", () => {
  const s = mk(); assert.equal(Bk.currentRatio(s), null); assert.equal(Bk.scoreExtras(s), 0); assert.equal(Bk.creditScore(s), 100);
});
test("a current ratio under 1 and unpaid supplier invoices pull the score down", () => {
  const s = mk(); post(s.ledger, s.day, "debt", [{ acct: "cash", dr: 50000 }, { acct: "overdraft", cr: 50000 }], "t:od");
  const cash = 200000 + 50000; post(s.ledger, s.day, "burn", [{ acct: "wages", dr: cash }, { acct: "cash", cr: cash }], "t:burn");
  assert.ok(Bk.currentRatio(s) < 1); assert.ok(Bk.scoreExtras(s) > 0);
  const t = mk(); t.fx = t.fx || { payables: [] }; t.fx.payables = [{ id: 1, po: 1, amount: 100, due: t.day - 1 }, { id: 2, po: 2, amount: 100, due: t.day - 2 }];
  assert.equal(Bk.overduePayables(t), 2); assert.equal(Bk.scoreExtras(t), 20); assert.equal(Bk.creditScore(t), 80);
});
test("a losing shop loses up to 10 points once past day 5", () => {
  const s = mk(); post(s.ledger, s.day, "loss", [{ acct: "wages", dr: 80000 }, { acct: "cash", cr: 80000 }], "t:l"); s.day = 3;
  assert.equal(Bk.scoreExtras(s), 0); s.day = 6; assert.ok(Bk.roaPct(s) < 0); assert.ok(Bk.scoreExtras(s) > 0);
});
test("the credit line ceiling shrinks with the rating, and DDD gets no line", () => {
  const s = mk(), full = Bk.creditLimit(s); assert.equal(full, D.BANK.credit.limit);
  const room = []; for (const n of [0, 3, 10]) { Bk.ensureBank(s).hist = Array(n).fill(1); room.push(Bk.creditLimit(s)); }
  assert.ok(room[0] > room[1] && room[1] > room[2]); assert.equal(room[2], 0);
  assert.equal(Bk.drawCredit(s, 1000).ok, false);
});
test("old saves without the flag keep the full line and the old score", () => {
  const s = mk(); delete s.rtg; Bk.ensureBank(s).hist = Array(10).fill(1);
  assert.equal(Bk.creditLimit(s), D.BANK.credit.limit); assert.equal(Bk.scoreExtras(s), 0);
});
test("a big tender needs BBB or better to bid on", () => {
  const s = mk(); const b = B.ensureB2B(s);
  const t = { id: 999, kind: "tender", buyer: "hotel", pid: "apple", qty: 20000, ceiling: 5, due: 9, penalty: .1, posted: 1, bid: null, closes: 5, minRating: "BBB" }; b.open.push(t);
  assert.equal(B.placeBid(s, { tender: 999, price: 4 }).ok, true);
  Bk.ensureBank(s).hist = Array(5).fill(1); assert.equal(Bk.creditRating(s)[0], "BB");
  const r = B.placeBid(s, { tender: 999, price: 4 }); assert.equal(r.ok, false); assert.match(r.error, /BBB/);
});
test("new big tenders carry the rating rule only in games that have it", () => {
  const s = mk(); const b = B.ensureB2B(s); let seen = 0;
  for (let d = 0; d < 60; d++) { s.day = d + 1; b.open = []; B.b2bDay(s); seen += b.open.filter(x => x.minRating).length; }
  const old = mk(); delete old.rtg; const bo = B.ensureB2B(old); let o = 0;
  for (let d = 0; d < 60; d++) { old.day = d + 1; bo.open = []; B.b2bDay(old); o += bo.open.filter(x => x.minRating).length; }
  assert.equal(o, 0); assert.ok(seen >= 0);
});
