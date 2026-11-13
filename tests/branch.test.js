import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as Br from "../js/branch.js";
import * as SC from "../js/screens.js";
import * as D from "../js/data.js";
import { balance, totals, post } from "../js/ledger.js";
import { act, newForms } from "../js/actions.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 200000, seed: 21, ...o });
const stock = s => {   // extra stock bought with owner money, so the ledger still matches
  let add = 0; for (const p of D.PRODUCTS) { const v = Math.round(2000 * p.cost * 100) / 100; s.qty[p.id] += 2000; s.val[p.id] = Math.round((s.val[p.id] + v) * 100) / 100; add += v; }
  post(s.ledger, s.day, "test stock", [{ acct: "inventory", dr: add }, { acct: "capital", cr: add }], "t:stock");
};
const run = (s, days) => { const end = s.day + days; while (s.day < end && !s.ended) E.tick(s, 1); };

test("opening a branch checks place, size, limit and cash, and pays the fit-out", () => {
  const s = mk(), cash0 = balance(s.ledger, "cash");
  assert.equal(Br.openBranch(s, { location: s.location, area: 80 }).ok, false);
  assert.equal(Br.openBranch(s, { location: "nowhere", area: 80 }).ok, false);
  assert.equal(Br.openBranch(s, { location: "id-jakarta-central", area: 77 }).ok, false);
  assert.ok(Br.openBranch(s, { location: "id-jakarta-central", area: 80 }).ok);
  assert.equal(Math.round(cash0 - balance(s.ledger, "cash")), Br.fitout(80));
  assert.equal(Br.openBranch(s, { location: "id-jakarta-central", area: 80 }).ok, false);   // same place twice
  assert.ok(Br.openBranch(s, { location: "sg-central", area: 40 }).ok); assert.ok(Br.openBranch(s, { location: "my-kl-centre", area: 40 }).ok);
  assert.match(Br.openBranch(s, { location: "jp-tokyo-central", area: 40 }).error, /up to 3/);
  assert.ok(totals(s.ledger).balanced);
  const poor = mk({ capital: 5000 }); assert.match(Br.openBranch(poor, { location: "id-jakarta-central", area: 150 }).error, /Not enough cash/);
});
test("a branch sells from main stock, books double-entry, and stops when closed", () => {
  const s = mk(); stock(s); Br.openBranch(s, { location: "id-jakarta-central", area: 80 });
  const units0 = D.PRODUCTS.reduce((a, p) => a + s.qty[p.id], 0);
  run(s, 5);
  const br = s.branches.list[0];
  assert.ok(br.stats.units > 0 && br.stats.revenue > 0 && br.stats.costs > 0);
  assert.ok(totals(s.ledger).balanced); assert.equal(E.reconcile(s).ok, true);
  assert.ok(D.PRODUCTS.reduce((a, p) => a + s.qty[p.id], 0) < units0);
  assert.ok(Br.closeBranch(s, br.id).ok); const costs = br.stats.costs, rev = br.stats.revenue; run(s, 3);
  assert.equal(s.branches.list.length, 0); assert.equal(br.stats.costs, costs); assert.equal(br.stats.revenue, rev);
});
test("a branch with no stock earns nothing but still pays rent and staff", () => {
  const s = mk(); for (const p of D.PRODUCTS) { s.qty[p.id] = 0; s.val[p.id] = 0; }
  Br.openBranch(s, { location: "id-jakarta-central", area: 80 }); s.orders = []; run(s, 2);
  const br = s.branches.list[0]; assert.equal(br.stats.revenue, 0); assert.ok(br.stats.costs > 0);
});
test("old saves without branches load, the screen and actions work", () => {
  const s = mk(); delete s.branches; assert.deepEqual(Br.ensureBranches(s).list, []);
  const f = newForms(); assert.match(SC.branches(s, f), /Open branch/);
  assert.ok(act(s, f, "branchOpen", {}).ok); assert.equal(s.branches.list.length, 1); assert.match(SC.branches(s, f), /Close branch/);
  assert.ok(act(s, f, "branchClose", { id: s.branches.list[0].id }).ok);
  const back = E.validateSave(JSON.parse(E.serialize(s))); assert.ok(back.ok);
});
