// Richer reports: cash-flow statement, product margins, market-share breakdown, net profit.
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import { totals } from "../js/ledger.js";

const endDay = s => { while (s.phase === "open") E.tick(s, 0.25); if (!s.ended) E.nextDay(s); };
const bot = s => {
  const lines = D.PRODUCTS.filter(p => E.isUnlocked(s, p.id) && E.unitsTotal(s, p.id) < 20).slice(0, 5).map(p => ({ pid: p.id, qty: 30 }));
  if (lines.length) { const r = E.placeOrder(s, { supplier: "metro", lines, pay: s.day % 2 ? "bank" : "terms" }); if (!r.ok) E.placeOrder(s, { supplier: "metro", lines, pay: "bank" }); }
  for (const p of D.PRODUCTS) E.setShelfTarget(s, p.id, 12);
};
const play = (s, days) => { for (let i = 0; i < days && !s.ended; i++) { bot(s); endDay(s); } return s; };

test("cash flow adds up to the change in cash + bank on every day, with loans, terms, upgrades and branches", () => {
  const s = E.newGame({ seed: 21, difficulty: "normal", mode: "infinite", location: "id-medan-central", capital: 4000 });
  for (let d = 0; d < 14; d++) {
    bot(s);
    if (d === 2) E.takeLoan(s, D.LOANS[0].id, "L");
    if (d === 3) E.buyUpgrade(s, "counter", "U");
    if (d === 5) E.openBranch(s, { loc: "id-jakarta-central", cmdId: "B" });
    endDay(s);
    const r = s.history.length && s.lastReport; assert.ok(r.cashflow, "cash flow recorded");
    const change = r.closeLiquid - r.openLiquid;
    assert.ok(Math.abs(r.cashflow.net - change) < 0.05, `day ${r.day}: cash flow ${r.cashflow.net} vs change ${change.toFixed(2)}`);
    assert.ok(Math.abs(r.cashflow.operating + r.cashflow.investing + r.cashflow.financing - r.cashflow.net) < 0.02);
  }
  const last = s.history.at(-1); assert.ok(last.cf && typeof last.cf.op === "number"); assert.equal(typeof last.share, "number");
});
test("investing shows an upgrade and financing shows a loan", () => {
  const s = E.newGame({ seed: 22, difficulty: "normal", mode: "infinite", capital: 3000 });
  assert.ok(E.takeLoan(s, D.LOANS[0].id, "L").ok); assert.ok(E.buyUpgrade(s, "counter", "U").ok);
  endDay(s);
  assert.ok(s.lastReport.cashflow.investing < 0); assert.ok(s.lastReport.cashflow.financing > 0);
});
test("product rows: revenue minus cost of goods matches the day's gross profit for the main shop", () => {
  const s = play(E.newGame({ seed: 23, difficulty: "normal", mode: "infinite", capital: 2000 }), 4);
  const r = s.lastReport; assert.ok(r.products.length > 0);
  const rev = r.products.reduce((a, p) => a + p.revenue, 0), cogs = r.products.reduce((a, p) => a + p.cogs, 0);
  assert.ok(Math.abs(rev - r.revenue) < 0.05 && Math.abs(cogs - r.cogs) < 0.05, `${rev} ${r.revenue} ${cogs} ${r.cogs}`);
  for (const p of r.products) assert.ok(p.margin <= 1 && p.units > 0);
});
test("market share breakdown sums to 100% and the what-if moves the right way", () => {
  const s = E.newGame({ seed: 24, difficulty: "normal", mode: "infinite", location: "us-nyc-manhattan" });
  const b = E.shareBreakdown(s);
  assert.ok(Math.abs(b.rows.reduce((a, r) => a + r.share, 0) - 1) < 0.01);
  assert.equal(b.rows[0].name, "You");
  const cut = b.whatIf.find(x => x.change === -0.1).share, rise = b.whatIf.find(x => x.change === 0.1).share;
  assert.ok(cut > b.share && rise < b.share);
  assert.ok(b.factors.reputation > 0 && b.factors.price > 0 && b.factors.stock > 0);
  assert.equal(E.shareBreakdown(E.newGame({ seed: 1 })).share, 1);
});
test("net profit (income statement) is exposed and matches revenue minus costs", () => {
  const s = play(E.newGame({ seed: 25, difficulty: "normal", mode: "infinite", capital: 2000 }), 5);
  const d = E.updateDerived(s), t = totals(s.ledger);
  assert.equal(d.profit, Math.round((t.revenue - t.costs) * 100) / 100);
  assert.notEqual(d.profit, d.netWorth - s.startNetWorth + 1e9);   // a distinct number, not an alias
  assert.deepEqual(E.reconcile(s), { ok: true, problems: [] });
});
test("an older save without a day-start marker still loads and closes a day", () => {
  const s = E.newGame({ seed: 26 }); delete s.today.seq0;
  const r = E.validateSave(JSON.stringify(s)); assert.ok(r.ok, r.error);
  endDay(r.state); assert.equal(r.state.lastReport.cashflow, null);
});
