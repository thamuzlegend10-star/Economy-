import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as F from "../js/factory.js";
import * as H from "../js/hr.js";
import * as K from "../js/market.js";
import * as Bk from "../js/bank.js";
import * as Kp from "../js/kpi.js";
import * as D from "../js/data.js";
import { balance, post } from "../js/ledger.js";

const mk = (o = {}) => { const s = E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 200000, seed: 21, ...o }); F.rentFactory(s, 500); return s; };
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };
const days = (s, n) => { for (let i = 0; i < n && !s.ended; i++) { runDay(s); assert.ok(E.reconcile(s).ok, JSON.stringify(E.reconcile(s).problems)); } };
const giveWh = (s, pid, qty) => { const v = Math.round(D.PRODUCTS.find(p => p.id === pid).cost * qty * 100) / 100; s.wh.area = Math.max(s.wh.area, 500); s.wh.qty[pid] += qty; s.wh.val[pid] = Math.round((s.wh.val[pid] + v) * 100) / 100;
  s.ledger.bal.inventory = Math.round((s.ledger.bal.inventory + v) * 100) / 100; s.ledger.bal.capital = Math.round((s.ledger.bal.capital - v) * 100) / 100; };

// ---------- HR ----------
test("hiring costs daily wages, firing stops them, wages follow the wage level", () => {
  const s = mk(); assert.equal(H.dailyPayroll(s), 0); H.hire(s, "retail", 2); const w1 = H.dailyPayroll(s); assert.ok(w1 > 0);
  days(s, 1); assert.ok(Math.abs(balance(s.ledger, "wages") - w1) < 0.02);
  H.setWageMult(s, 1.5); assert.ok(H.dailyPayroll(s) > w1 * 1.4); assert.equal(H.setWageMult(s, 99).wageMult, D.HR.wageMult.max);
  assert.equal(H.fire(s, "retail", 5).ok, false); assert.ok(H.fire(s, "retail", 2).ok); assert.equal(H.dailyPayroll(s), 0);
});
test("buying a machine hires its operators; factory wages go to production labour", () => {
  const s = mk(); F.buyMachine(s, { type: "fast" }); assert.equal(s.hr.staff.factory.n, D.MACHINES[1].operators); days(s, 1); assert.ok(balance(s.ledger, "cogs_labor") > 0);
});
test("too few operators cut factory output", () => {
  const run = fire => { const s = mk({ capital: 300000 }); F.placeRawOrder(s, { vendor: "agro", lines: [{ rid: "appleConc", qty: 500 }, { rid: "water", qty: 5000 }] }); F.placeRawOrder(s, { vendor: "packco", lines: [{ rid: "bottles", qty: 5000 }, { rid: "caps", qty: 5000 }] });
    days(s, 4); const m = F.buyMachine(s, { type: "std" }).machine; F.setRun(s, { machine: m.id, juice: "apple", qty: 1000 }); if (fire) H.fire(s, "factory", 1); days(s, 1); return s.fx.fg.qty.apple; };
  assert.ok(run(false) > run(true) * 1.5);
});
test("training raises skill; low pay lowers morale and makes people quit", () => {
  const s = mk(); H.hire(s, "sales", 2); H.setTraining(s, 2000); days(s, 5); assert.ok(s.hr.staff.sales.skill > 1);
  const t = mk({ seed: 4 }); H.hire(t, "retail", 30); H.setWageMult(t, 0.6); days(t, 25); assert.ok(t.hr.morale < 60); assert.ok(t.hr.quits > 0); assert.ok(t.hr.staff.retail.n < 30);
});
test("a staffed shop sells more than an unstaffed one; an empty HR changes nothing", () => {
  const a = mk(), b = mk(); H.hire(b, "retail", H.retailNeed(b)); for (const s of [a, b]) for (const p of D.PRODUCTS) s.demand[p.id] = 0;
  assert.equal(H.retailBoost(a), 1); assert.ok(H.retailBoost(b) > 1.05 && H.retailBoost(b) <= 1.2);
});
test("warehouse handlers trim the transfer fee", () => {
  const a = mk(), b = mk(); for (const s of [a, b]) { giveWh(s, "noodles", 50000); } H.hire(b, "warehouse", 2);
  const qa = E.quoteTransfer(a, [{ pid: "noodles", qty: 5000 }]), qb = E.quoteTransfer(b, [{ pid: "noodles", qty: 5000 }]); assert.ok(qb.fee < qa.fee);
});

// ---------- marketing ----------
test("a campaign costs its budget over its days, lifts awareness and demand, then fades", () => {
  const s = mk(); const base = E.expectedDemand(s, "noodles"); const r = K.startCampaign(s, { channel: "social", budget: 700, days: 7, cat: "all" }); assert.ok(r.ok);
  days(s, 3); assert.ok(K.awareness(s, "food") > 0); assert.ok(balance(s.ledger, "marketing") > 290 && balance(s.ledger, "marketing") < 310);
  assert.ok(K.demandLift(s, "food") > 1); assert.ok(K.priceCut(s, "food") < 1);
  days(s, 5); assert.equal(Math.round(balance(s.ledger, "marketing")), 700);
  const peak = K.awareness(s, "food"); days(s, 20); assert.ok(K.awareness(s, "food") < peak / 2 || s.mkt.campaigns.length === 0); assert.ok(base > 0);
});
test("a category campaign only lifts that category; budgets are checked", () => {
  const s = mk(); K.startCampaign(s, { channel: "search", budget: 500, days: 5, cat: "electronics" }); days(s, 2);
  assert.ok(K.awareness(s, "electronics") > 0); assert.equal(K.awareness(s, "food"), 0);
  assert.equal(K.startCampaign(s, { channel: "influencer", budget: 10, days: 5 }).ok, false); assert.equal(K.startCampaign(s, { channel: "radio", budget: 500, days: 99 }).ok, false); assert.equal(K.startCampaign(s, { channel: "tv", budget: 500, days: 5 }).ok, false);
});
test("influencers spike harder but fade faster than billboards", () => {
  const a = mk(), b = mk(); K.startCampaign(a, { channel: "influencer", budget: 1000, days: 5 }); K.startCampaign(b, { channel: "billboard", budget: 1000, days: 5 });
  days(a, 5); days(b, 5); assert.ok(K.awareness(a, "food") > K.awareness(b, "food")); days(a, 15); days(b, 15); assert.ok(K.awareness(b, "food") > K.awareness(a, "food"));
});

// ---------- e-commerce ----------
test("webstore: setup fee, hosting, orders ship from stock, escrow is released after delivery", () => {
  const s = mk(); giveWh(s, "noodles", 80000); const cash = balance(s.ledger, "cash");
  assert.ok(K.openWebstore(s).ok); assert.equal(balance(s.ledger, "cash"), cash - D.ECOM.setupFee); assert.equal(K.openWebstore(s).ok, false);
  K.setCatalog(s, ["noodles"]); K.setAdBudget(s, 400); days(s, 2); assert.ok(s.ecom.stats.orders > 0); assert.ok(balance(s.ledger, "escrow") > 0); assert.equal(balance(s.ledger, "sales_ecom"), 0);
  days(s, 6); assert.ok(balance(s.ledger, "sales_ecom") > 0); assert.ok(s.wh.qty.noodles < 80000); assert.ok(balance(s.ledger, "fees") > D.ECOM.setupFee);
});
test("web orders that cannot be filled are counted as lost, and the catalog is capped", () => {
  const s = mk(); K.openWebstore(s); K.setCatalog(s, ["noodles"]); K.setAdBudget(s, 800); days(s, 3); assert.ok(s.ecom.stats.lost > 0 && s.ecom.stats.orders === 0);
  assert.deepEqual(K.setCatalog(s, ["noodles", "nope", "noodles", "apple"]).catalog, ["noodles", "apple"]);
  assert.equal(K.setCatalog(s, ["noodles", "milk", "earbuds", "apple", "orange", "melon"]).ok, true);
});
test("a higher web price converts worse", () => {
  const run = pr => { const s = mk(); giveWh(s, "noodles", 100000); K.openWebstore(s); K.setCatalog(s, ["noodles"]); K.setWebPrice(s, "noodles", pr); K.setAdBudget(s, 500); days(s, 4); return s.ecom.stats.units; };
  assert.ok(run(1.2) > run(2.8));
});

// ---------- service ----------
test("stockouts pull the satisfaction index down; service staff and stock keep it up", () => {
  const a = mk(), b = mk(); for (const p of D.PRODUCTS) { a.ledger.bal.inventory = Math.round((a.ledger.bal.inventory - a.val[p.id]) * 100) / 100; a.ledger.bal.capital = Math.round((a.ledger.bal.capital + a.val[p.id]) * 100) / 100; a.qty[p.id] = 0; a.val[p.id] = 0; }   // empty shelves, ledger kept in step
  for (const [pid, q] of [["noodles", 14000], ["milk", 4000], ["earbuds", 1500]]) { const v = Math.round(D.PRODUCTS.find(p => p.id === pid).cost * q * 100) / 100; b.qty[pid] += q; b.val[pid] = Math.round((b.val[pid] + v) * 100) / 100; b.ledger.bal.inventory = Math.round((b.ledger.bal.inventory + v) * 100) / 100; b.ledger.bal.capital = Math.round((b.ledger.bal.capital - v) * 100) / 100; }
  days(a, 6); days(b, 6); assert.ok(b.srv.csi >= 80); assert.ok(a.srv.csi < b.srv.csi - 20);
});
test("service staff clear the ticket backlog", () => {
  const a = mk({ seed: 2 }), b = mk({ seed: 2 }); H.hire(b, "service", 3); days(a, 10); days(b, 10); assert.ok(b.srv.backlog <= a.srv.backlog); assert.ok(b.srv.resolved >= a.srv.resolved);
});

// ---------- banking ----------
test("credit line: limit, daily compounding interest, repayment, and forced repayment after 30 days", () => {
  const s = mk(); assert.equal(Bk.drawCredit(s, 80000).ok, false); assert.ok(Bk.drawCredit(s, 20000).ok); assert.equal(balance(s.ledger, "credit"), 20000);
  days(s, 3); assert.ok(s.bank.credit.bal > 20000); assert.ok(balance(s.ledger, "interest") > 0); assert.ok(Bk.repayCredit(s, 5000).ok);
  const t = mk({ days: 90 }); Bk.drawCredit(t, 10000); days(t, 31); assert.equal(t.bank.credit.bal, 0); assert.equal(balance(t.ledger, "credit"), 0);
});
test("equipment loan: capped by machinery, repaid daily with falling interest", () => {
  const s = mk(); assert.equal(Bk.takeLoan(s, { kind: "equipment", amount: 5000, termDays: 60 }).ok, false); F.buyMachine(s, { type: "fast" });
  assert.equal(Bk.takeLoan(s, { kind: "equipment", amount: 5000, termDays: 77 }).ok, false); const cap = Bk.loanCap(s, "equipment"); assert.ok(cap > 20000);
  assert.ok(Bk.takeLoan(s, { kind: "equipment", amount: 20000, termDays: 60 }).ok); const b0 = s.bank.loans[0].balance; days(s, 10); assert.ok(s.bank.loans[0].balance < b0 - 300); assert.ok(balance(s.ledger, "interest") > 0);
  const t = mk({ days: 90 }); F.buyMachine(t, { type: "std" }); Bk.takeLoan(t, { kind: "equipment", amount: 5000, termDays: 60 }); days(t, 61); assert.equal(t.bank.loans.length, 0); assert.equal(balance(t.ledger, "longdebt"), 0);
});
test("long-term loan needs the minimum amount; overdraft interest compounds", () => {
  const s = mk(); assert.equal(Bk.takeLoan(s, { kind: "long", amount: 5000 }).ok, false); assert.ok(Bk.takeLoan(s, { kind: "long", amount: 30000 }).ok);
  const o = mk(); const cash = balance(o.ledger, "cash");                                           // overdraw through two proper postings
  post(o.ledger, o.day, "test: overdraw", [{ acct: "rent", dr: cash + 5000 }, { acct: "cash", cr: cash }, { acct: "overdraft", cr: 5000 }]);
  const od = balance(o.ledger, "overdraft"); assert.equal(od, 5000); Bk.bankDay(o);
  assert.equal(balance(o.ledger, "overdraft"), Math.round(od * (1 + D.BANK.overdraft.rate) * 100) / 100); assert.ok(balance(o.ledger, "interest") > 0); assert.ok(E.reconcile(o).ok);
});

// ---------- storage overflow ----------
test("factory goods in the warehouse over capacity cost an overflow fee every day", () => {
  const s = mk(); F.placeRawOrder(s, { vendor: "packco", lines: [{ rid: "bottles", qty: 40000 }] }); days(s, 3); assert.ok(E.whOverflow(s) > 0);
  assert.ok(balance(s.ledger, "overflow") > 0); assert.equal(Math.round(balance(s.ledger, "overflow") * 100) > 0, true); assert.ok(E.dashboard(s).wh.overflow > 0);
  s.wh.area = 20000; assert.equal(E.whOverflow(s), 0);
});
test("with a warehouse large enough there is no overflow fee", () => {
  const s = mk(); E.rentWarehouse(s, 2500); F.placeRawOrder(s, { vendor: "packco", lines: [{ rid: "bottles", qty: 40000 }] }); days(s, 3); assert.equal(balance(s.ledger, "overflow"), 0);
});

// ---------- KPIs ----------
test("eight KPIs, normalised, weighted; weights re-normalise and a bad set is refused", () => {
  const s = mk(); days(s, 4); const sb = Kp.scoreboard(s); assert.equal(sb.rows.length, 8);
  assert.ok(Math.abs(sb.rows.reduce((a, r) => a + r.weight, 0) - 1) < 1e-6); assert.ok(sb.total > 0 && sb.total <= 100); for (const r of sb.rows) assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(Kp.setWeights(s, { netProfit: 1, revenue: 0, roa: 0, serviceLevel: 0, marketShare: 0, csi: 0, morale: 0, solvency: 0 }).ok); assert.equal(s.kpi.weights.netProfit, 1);
  assert.equal(Kp.setWeights(s, {}).ok, false);
});
test("market share is a sensible percentage and competitor prices are tracked for each product", () => {
  const s = mk(); days(s, 3); const k = Kp.kpis(s); assert.ok(k.marketShare > 0 && k.marketShare < 100); assert.ok(k.serviceLevel > 0 && k.serviceLevel <= 100);
  const cp = Kp.competitorPrices(s); assert.equal(cp.length, 3); assert.ok(cp.every(r => r.rivals.length === 3 && r.rivals.every(x => x > 0)));
});

// ---------- whole-game integration ----------
test("v14 saves migrate up to the current version with all the new systems empty", () => {
  const s = mk(); const raw = JSON.parse(JSON.stringify(s)); for (const k of ["hr", "mkt", "ecom", "srv", "bank", "kpi"]) delete raw[k]; raw.v = 14;
  const r = E.validateSave(raw); assert.ok(r.ok, r.error); assert.equal(r.state.v, D.SAVE_VERSION); assert.equal(r.state.bank.loans.length, 0); assert.equal(r.state.hr.staff.retail.n, 0);
});
test("a busy 30-day game using every module stays balanced and deterministic", () => {
  const run = () => { const s = mk({ capital: 250000, days: 35 }); E.rentWarehouse(s, 2500); giveWh(s, "noodles", 60000);
    const m = F.buyMachine(s, { type: "std" }).machine; F.setRun(s, { machine: m.id, juice: "orange", qty: 900 }); s.mrp.autoPO = true; H.hire(s, "retail", 3); H.hire(s, "service", 1); H.hire(s, "sales", 1);
    K.startCampaign(s, { channel: "radio", budget: 1400, days: 14 }); K.openWebstore(s); K.setCatalog(s, ["noodles", "orange"]); K.setAdBudget(s, 150); Bk.drawCredit(s, 15000);
    for (let i = 0; i < 30 && !s.ended; i++) { if (i % 7 === 6) F.preventiveMaintenance(s, m.id); runDay(s); assert.ok(E.reconcile(s).ok, `day ${s.day}: ` + JSON.stringify(E.reconcile(s).problems)); } return s; };
  const a = run(), b = run(); assert.equal(JSON.stringify(a.ledger.bal), JSON.stringify(b.ledger.bal)); assert.equal(JSON.stringify(a.hr), JSON.stringify(b.hr)); assert.equal(a.rng, b.rng);
  assert.ok(Kp.scoreboard(a).total > 0);
});
