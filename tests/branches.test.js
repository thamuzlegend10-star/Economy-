// Branches: a second shop in another district, simulated daily, sharing the books.
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import { balance } from "../js/ledger.js";

const clean = s => assert.deepEqual(E.reconcile(s), { ok: true, problems: [] });
const endDay = s => { while (s.phase === "open") E.tick(s, 0.25); if (!s.ended) E.nextDay(s); };
const rich = (o = {}) => {
  const s = E.newGame({ seed: 11, difficulty: "normal", mode: "infinite", location: "id-medan-central", capital: 6000, ...o });
  while (s.day < 5) endDay(s);
  return s;
};
const stockWh = (s, pid, n) => { s.stock[pid].wh += n; const v = D.PRODUCTS.find(p => p.id === pid).cost * n; s.val[pid] += v; s.ledger.bal.inventory += v; s.ledger.bal.capital -= v; };

test("opening a branch costs a fit-out, keeps the books balanced, and has its own rivals", () => {
  const s = rich(); const before = s.derived.netWorth;
  const r = E.openBranch(s, { loc: "id-jakarta-central", cmdId: "b1" });
  assert.ok(r.ok, r.error); assert.equal(s.branches.length, 1);
  assert.equal(E.openBranch(s, { loc: "id-jakarta-central", cmdId: "b1" }).ok, false);   // duplicate command
  assert.ok(s.branches[0].rivals.length >= 1);
  assert.equal(s.derived.netWorth, before);   // the fit-out is an asset, not a loss
  clean(s);
});
test("opening is validated: day, same district, unknown site, limit, money", () => {
  const e = E.newGame({ seed: 1, difficulty: "normal", mode: "infinite", capital: 6000 });
  assert.equal(E.openBranch(e, { loc: "id-jakarta-central" }).ok, false);   // too early
  const s = rich();
  assert.equal(E.openBranch(s, { loc: "id-medan-central" }).ok, false);     // same district as HQ
  assert.equal(E.openBranch(s, { loc: "nowhere" }).ok, false);
  assert.equal(E.openBranch(s, { loc: "default" }).ok, false);
  assert.ok(E.openBranch(s, { loc: "id-jakarta-central" }).ok);
  assert.equal(E.openBranch(s, { loc: "id-jakarta-central" }).ok, false);   // already there
  assert.ok(E.openBranch(s, { loc: "sg-central" }).ok);
  assert.equal(E.openBranch(s, { loc: "jp-tokyo-shibuya" }).ok, false);     // limit 2
  const poor = rich({ capital: 1000 }); poor.ledger.bal.bank = 0;
  assert.equal(E.openBranch(poor, { loc: "sg-central" }).ok, false);
});
test("transfer moves goods and value, charges a fee, and checks warehouse and capacity", () => {
  const s = rich(); E.openBranch(s, { loc: "id-jakarta-central" }); const b = s.branches[0];
  stockWh(s, "water", 100); const inv = E.updateDerived(s).inventory; const wh = s.stock.water.wh;
  const r = E.transferStock(s, { branch: b.id, pid: "water", qty: 40, cmdId: "t1" });
  assert.ok(r.ok, r.error); assert.ok(r.fee > 0);
  assert.equal(s.stock.water.wh, wh - 40); assert.equal(b.stock.water, 40);
  assert.ok(Math.abs(E.updateDerived(s).inventory - inv) < 0.01);
  assert.equal(E.transferStock(s, { branch: b.id, pid: "water", qty: 9999 }).ok, false);
  assert.equal(E.transferStock(s, { branch: b.id, pid: "water", qty: 0 }).ok, false);
  assert.equal(E.transferStock(s, { branch: 99, pid: "water", qty: 1 }).ok, false);
  clean(s);
});
test("a stocked branch sells, a bare one does not; consolidated books still balance", () => {
  const s = rich(); E.openBranch(s, { loc: "id-jakarta-central" }); const b = s.branches[0];
  endDay(s); assert.equal(b.last.revenue, 0); assert.ok(b.last.net < 0, "costs with no sales");
  stockWh(s, "water", 150); stockWh(s, "bread", 100);
  E.transferStock(s, { branch: b.id, pid: "water", qty: 150 }); E.transferStock(s, { branch: b.id, pid: "bread", qty: 100 });
  endDay(s);
  assert.ok(b.last.customers > 0 && b.last.revenue > 0 && b.last.units > 0);
  assert.ok(s.lastReport.branches.length === 1 && s.lastReport.branches[0].revenue === b.last.revenue);
  assert.ok(s.lastReport.revenue >= b.last.revenue, "branch revenue is in company revenue");
  clean(s);
});
test("staff limit capacity; more cashiers serve more customers", () => {
  const a = rich(), b2 = rich();
  for (const s of [a, b2]) { E.openBranch(s, { loc: "us-nyc-manhattan" }); stockWh(s, "water", 200); E.transferStock(s, { branch: s.branches[0].id, pid: "water", qty: 200 }); }
  E.setBranchStaff(b2, { branch: b2.branches[0].id, n: 3 });
  assert.equal(E.setBranchStaff(b2, { branch: b2.branches[0].id, n: 4 }).ok, false);
  endDay(a); endDay(b2);
  assert.ok(b2.branches[0].last.customers > a.branches[0].last.customers);
  assert.ok(a.branches[0].last.capLost >= 0);
  assert.ok(E.branchWages(b2, b2.branches[0]) > E.branchWages(a, a.branches[0]));
});
test("closing returns stock to the warehouse, writes off the rest, keeps books balanced", () => {
  const s = rich(); E.openBranch(s, { loc: "id-jakarta-central" }); const b = s.branches[0];
  stockWh(s, "water", 60); E.transferStock(s, { branch: b.id, pid: "water", qty: 60 });
  const wh = s.stock.water.wh; const r = E.closeBranch(s, { branch: b.id });
  assert.ok(r.ok, r.error); assert.equal(s.branches.length, 0); assert.equal(s.stock.water.wh, wh + 60);
  clean(s);
  assert.equal(E.closeBranch(s, { branch: b.id }).ok, false);
});
test("same seed gives the same branch history", () => {
  const run = () => { const s = rich(); E.openBranch(s, { loc: "id-jakarta-central" }); stockWh(s, "water", 120); E.transferStock(s, { branch: s.branches[0].id, pid: "water", qty: 120 }); for (let i = 0; i < 4; i++) endDay(s); return JSON.stringify([s.branches, s.ledger.bal]); };
  assert.equal(run(), run());
});
test("without branches the game is unchanged (no extra rng use)", () => {
  const a = rich(), b = rich(); for (let i = 0; i < 3; i++) { endDay(a); endDay(b); }
  assert.equal(a.rng, b.rng); assert.deepEqual(a.branches, []);
});
test("save round trip keeps branches; v7 migrates; crafted branch data rejected", () => {
  const s = rich(); E.openBranch(s, { loc: "id-jakarta-central" }); stockWh(s, "water", 50); E.transferStock(s, { branch: s.branches[0].id, pid: "water", qty: 50 }); endDay(s);
  const r = E.validateSave(JSON.stringify(s)); assert.ok(r.ok, r.error); assert.deepEqual(r.state.branches, s.branches);
  const old = JSON.parse(JSON.stringify(rich())); old.v = 7; delete old.branches; delete old.branchSeq;
  const m = E.validateSave(old); assert.ok(m.ok, m.error); assert.equal(m.state.v, D.SAVE_VERSION); assert.deepEqual(m.state.branches, []);
  for (const f of [o => { o.branches[0].stock.water = -5; }, o => { o.branches[0].staff = 9; }, o => { o.branches[0].rivals[0].price = NaN; }, o => { o.branches[0].loc = "x"; }, o => { o.branches[0].last.revenue = "a"; }]) {
    const bad = JSON.parse(JSON.stringify(s)); f(bad); assert.equal(E.validateSave(bad).ok, false);
  }
});
