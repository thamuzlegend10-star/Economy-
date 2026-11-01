import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import * as A from "../js/actions.js";
import * as SC from "../js/screens.js";
import * as UI from "../js/ui.js";
import { balance } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 200000, seed: 5, ...o });
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };
const bad = html => /undefined|NaN|\[object|Infinity|null</.test(html);
const ok = r => { assert.ok(r.ok, r.error); return r; };

function allScreens(s, f) {
  return { machines: SC.factoryMachines(s), raw: SC.factoryRaw(s, f), mrp: SC.factoryMrp(s), market: SC.b2bMarket(s, f), contracts: SC.b2bContracts(s), hr: SC.hrScreen(s), mkt: SC.marketing(s, f), ecom: SC.ecom(s), bank: SC.bank(s, f), stmts: SC.statements(s), score: SC.scoring(s, f), comp: SC.competitors(s), wh: UI.warehouse(s, "stock") };
}

test("every new screen renders on a fresh game without junk text", () => {
  const s = mk(), f = A.newForms(); for (const [k, h] of Object.entries(allScreens(s, f))) { assert.ok(h.length > 40, k); assert.ok(!bad(h), k + ": " + (h.match(/.{30}(undefined|NaN|\[object|Infinity|null<).{20}/) || [""])[0]); }
});

test("a full play-through using only screen actions, rendering every screen after each step", () => {
  const s = mk({ capital: 300000 }), f = A.newForms(), check = tag => { for (const [k, h] of Object.entries(allScreens(s, f))) assert.ok(!bad(h), `${tag} ${k}`); assert.ok(E.reconcile(s).ok, tag + " " + JSON.stringify(E.reconcile(s).problems)); };
  ok(A.act(s, f, "buyMachine", { id: "std" })); check("machine");
  const m = s.fx.machines[0]; ok(A.act(s, f, "setjob", { id: String(m.id), juice: "apple", qty: 800 })); check("job");
  A.setField(f, "vendor", "agro"); A.setField(f, "rq.appleConc", 2000, true); A.setField(f, "rq.water", 10000, true); ok(A.act(s, f, "prCreate")); check("pr");
  const pr = s.fx.prs[0]; ok(A.act(s, f, "prApprove", { id: String(pr.id) })); check("approve");
  A.setField(f, "vendor", "packco"); A.setField(f, "terms", "net14", false); A.setField(f, "rq.bottles", 10000, true); A.setField(f, "rq.caps", 10000, true); ok(A.act(s, f, "poNow")); check("po");
  ok(A.act(s, f, "mrpPlan")); A.act(s, f, "mrpAuto"); check("mrp");
  ok(A.act(s, f, "hire", { id: "retail" })); ok(A.act(s, f, "hire", { id: "service" })); ok(A.act(s, f, "wage", { value: "1.2" })); ok(A.act(s, f, "training", { value: "250" })); ok(A.act(s, f, "fire", { id: "service" })); check("hr");
  A.setField(f, "mkt.channel", "radio"); A.setField(f, "mkt.budget", 1000, true); ok(A.act(s, f, "mktStart")); check("mkt");
  ok(A.act(s, f, "ecomOpen")); ok(A.act(s, f, "ecomCat", { id: "orange" })); ok(A.act(s, f, "ecomPrice", { id: "orange", dir: "1" })); ok(A.act(s, f, "ecomAds", { value: "100" })); check("ecom");
  A.setField(f, "credit", 10000, true); ok(A.act(s, f, "credDraw")); A.setField(f, "loan.amount", 10000, true); A.setField(f, "loan.term", 60, true); ok(A.act(s, f, "loan")); check("bank");
  A.setField(f, "w.netProfit", 50, true); ok(A.act(s, f, "weights")); ok(A.act(s, f, "weightsReset")); check("score");
  for (let i = 0; i < 12; i++) { runDay(s); if (s.b2b.open.length) { const t = s.b2b.open.find(x => x.kind === "tender"); if (t) { A.setField(f, "bid." + t.id, t.ceiling * 0.6, true); A.act(s, f, "bid", { id: String(t.id) }); } const fx = s.b2b.open.find(x => x.kind === "fixed"); if (fx) A.act(s, f, "accept", { id: String(fx.id) }); } check("day " + s.day); }
  assert.ok(s.fx.fg.qty.apple > 0, "factory made juice"); assert.ok(balance(s.ledger, "wages") > 0);
});

test("actions refuse bad input with a readable message", () => {
  const s = mk({ capital: 10000 }), f = A.newForms();
  assert.equal(A.act(s, f, "buyMachine", { id: "fast" }).ok, false); assert.match(A.act(s, f, "buyMachine", { id: "fast" }).error, /cash/i);
  assert.equal(A.act(s, f, "poNow").ok, false); assert.equal(A.act(s, f, "mrpGen").ok, false); assert.equal(A.act(s, f, "deliver", { id: "99" }).ok, false);
  assert.equal(A.act(s, f, "credDraw").ok, true); A.setField(f, "credit", 60000, true); assert.equal(A.act(s, f, "credDraw").ok, false);
  assert.equal(A.act(s, f, "nope").ok, false); assert.equal(A.act(s, f, "fire", { id: "retail" }).ok, false);
});

test("navigation lists every module and no sub tab is empty-named", () => {
  const ids = UI.NAV.map(n => n.id); for (const id of ["factory", "b2b", "hr", "marketing", "ecom", "data"]) assert.ok(ids.includes(id), id);
  for (const n of UI.NAV) for (const [id, label] of n.subs) assert.ok(id && label);
});
