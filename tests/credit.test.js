import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as Bk from "../js/bank.js";
import { balance, post } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 200000, seed: 21, ...o });

test("a clean record is AAA and costs the base rate", () => {
  const s = mk(); assert.equal(Bk.creditRating(s)[0], "AAA"); assert.equal(Bk.rateFactor(s), 1); assert.equal(Bk.creditScore(s), 100);
});
test("late days lower the rating step by step and raise the bank's rate", () => {
  const s = mk(), seen = [];
  for (const n of [0, 1, 2, 3, 5, 7, 8, 10]) { Bk.ensureBank(s).hist = Array(n).fill(1); seen.push(Bk.creditRating(s)[0]); }
  assert.deepEqual(seen, ["AAA", "AA", "A", "BBB", "BB", "B", "CCC", "DDD"]);
  Bk.ensureBank(s).hist = Array(6).fill(1); assert.ok(Bk.rateFactor(s) > 1);
  Bk.ensureBank(s).hist = Array(10).fill(1); assert.equal(Bk.rateFactor(s), 1.75);
});
test("a bad rating makes a new loan dearer and overdraft interest heavier", () => {
  const a = mk(), b = mk();
  assert.ok(Bk.takeLoan(a, { kind: "long", amount: 30000 }).ok);
  Bk.ensureBank(b).hist = Array(10).fill(1); assert.ok(Bk.takeLoan(b, { kind: "long", amount: 30000 }).ok);
  assert.ok(b.bank.loans[0].rate > a.bank.loans[0].rate);
  const x = mk(), y = mk(); for (const g of [x, y]) post(g.ledger, g.day, "test overdraft", [{ acct: "wages", dr: 1000 }, { acct: "overdraft", cr: 1000 }], "t:1");
  Bk.ensureBank(y).hist = Array(10).fill(1);
  const o0 = balance(x.ledger, "overdraft"); Bk.bankDay(x); Bk.bankDay(y);
  assert.ok(balance(y.ledger, "overdraft") - 1000 > balance(x.ledger, "overdraft") - 1000 - 1e-9 && balance(x.ledger, "overdraft") > o0 - 1e-9);
});
test("an overdrawn day counts, a bad change sends a mail, and old saves without history still load", () => {
  const s = mk(); post(s.ledger, s.day, "test", [{ acct: "wages", dr: 500 }, { acct: "overdraft", cr: 500 }], "t:2");
  Bk.bankDay(s); assert.equal(s.bank.hist.at(-1), 1);
  const t = mk(); delete t.bank.hist; delete t.bank.rating; delete t.bank.hrLate;
  assert.doesNotThrow(() => Bk.bankDay(t)); assert.equal(t.bank.hist.length, 1);
  const u = mk(); u.bank.hist = Array(9).fill(1); u.bank.rating = "AAA"; const n0 = u.mail.items.length; Bk.bankDay(u);
  assert.ok(u.mail.items.length > n0 && /credit rating/i.test(u.mail.items.at(-1).subject));
});
test("history keeps only the last 30 days", () => {
  const s = mk(); for (let i = 0; i < 45; i++) Bk.bankDay(s); assert.equal(s.bank.hist.length, 30);
});
