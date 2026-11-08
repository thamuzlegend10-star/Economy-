import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import * as Ml from "../js/mail.js";
import * as Sn from "../js/scenario.js";
import * as F from "../js/factory.js";
import * as H from "../js/hr.js";
import * as SC from "../js/screens.js";
import { act, newForms } from "../js/actions.js";
import { balance } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 100000, seed: 12, ...o });
const runDay = s => { const d = s.day; while (!s.ended && s.day === d) E.tick(s, 0.5); };

test("mail: real events create messages; read, mark-all, clear and the cap work", () => {
  const s = mk(); for (let i = 0; i < 8; i++) runDay(s);
  assert.ok(Ml.ensureMail(s).items.some(m => m.from === "Management"), "weekly report");
  const n = Ml.unread(s); assert.ok(n > 0); const id = s.mail.items[0].id; Ml.markRead(s, id); assert.equal(Ml.unread(s), n - 1);
  Ml.markRead(s, "all"); assert.equal(Ml.unread(s), 0); Ml.clearMail(s); assert.equal(s.mail.items.length, 0);
  for (let i = 0; i < 90; i++) Ml.mailPost(s, { from: "t", subject: "x", body: "y" }); assert.equal(s.mail.items.length, 60);
});

test("mail: a machine breakdown sends mail", () => {
  const s = mk({ capital: 300000 }); F.rentFactory(s, 250); F.buyMachine(s, { type: "std" }); const m = s.fx.machines[0]; m.health = 5; for (const r of D.RAW) s.fx.raw.qty[r.id] = 100000, s.fx.raw.val[r.id] = 500; F.setRun(s, { machine: m.id, juice: "apple", qty: 500 });
  D.MAINT.breakdownChance = 1; try { runDay(s); } finally { D.MAINT.breakdownChance = 0.35; }
  assert.ok(s.mail.items.some(x => /broke down/.test(x.subject) && x.goto[0] === "factory"));
});

const eventsOf = (scenario, seed, days = 40) => { const s = mk({ scenario, seed, days: 60, capital: 20000 }); const seen = []; while (s.day <= days && !s.ended) { runDay(s); } return s.scn.events.map(e => ({ key: e.key, kind: e.kind, mult: e.mult, from: e.from, until: e.until, title: e.title })); };

test("scenario events are random: not on a fixed day, within their ranges, repeatable per seed", () => {
  const firsts = new Set(); let any = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const ev = eventsOf("boom", seed), fest = ev.filter(e => e.key === "festival");
    for (const e of fest) { any++; assert.ok(e.mult >= 1.15 && e.mult <= 1.35, "festival strength"); assert.ok(e.until - e.from + 1 >= 5 && e.until - e.from + 1 <= 9, "festival length"); assert.ok(e.from >= 3); }
    if (fest[0]) firsts.add(fest[0].from);
  }
  assert.ok(any >= 10, "festivals do happen"); assert.ok(firsts.size >= 5, "first festival day varies: " + [...firsts]);
  assert.deepEqual(eventsOf("boom", 7), eventsOf("boom", 7)); assert.notDeepEqual(eventsOf("boom", 7), eventsOf("boom", 8));
});

test("a slump only follows a festival, and never overlaps it", () => {
  let slumps = 0;
  for (let seed = 1; seed <= 40; seed++) { const ev = eventsOf("boom", seed, 45); for (const sl of ev.filter(e => e.key === "slump")) { slumps++; const f = ev.filter(e => e.key === "festival" && e.until < sl.from); assert.ok(f.length, "slump without a festival"); assert.ok(sl.from - Math.max(...f.map(e => e.until)) <= 6); assert.ok(sl.mult < 1); } }
  assert.ok(slumps >= 3);
});

test("event rate is sensible: free play has none, the others a few per month", () => {
  assert.equal(eventsOf("free", 3).length, 0);
  for (const sc of ["boom", "supply", "pricewar"]) { let n = 0; for (let seed = 1; seed <= 25; seed++) n += eventsOf(sc, seed, 30).length; assert.ok(n / 25 > 0.5 && n / 25 < 5, `${sc} averages ${n / 25} events`); }
});

test("a random event is announced by mail, changes demand and ends", () => {
  let s = null; for (let seed = 1; seed < 60 && !s; seed++) { const t = mk({ scenario: "boom", seed }); const base = E.expectedDemand(t, "milk"); while (t.day < 30 && !Sn.activeEvents(t).some(e => e.key === "festival")) runDay(t); if (Sn.activeEvents(t).some(e => e.key === "festival")) { s = t; s.base = base; } }
  assert.ok(s, "found a festival"); assert.ok(Sn.eventMult(s, "demand") > 1); assert.ok(s.mail.items.some(m => /Festival/.test(m.subject)));
  while (Sn.eventMult(s, "demand") > 1 && s.day < 60) runDay(s); assert.ok(s.mail.items.some(m => /Over: Festival/.test(m.subject)));
});

test("cost events raise supplier and vendor prices; delay events add a day to deliveries", () => {
  const s = mk(); const sp = D.SUPPLIERS[0], before = E.unitCost(s, sp, "noodles"), rawBefore = F.quoteRaw(s, { vendor: "agro", lines: [{ rid: "water", qty: 1000 }] }).lines[0].unit;
  const base = E.quoteMulti(s, sp.id, [{ pid: "noodles", qty: 1000 }]).eta;
  assert.ok(Sn.inject(s, { kind: "cost", mult: 1.5, days: 3 }).ok); assert.ok(E.unitCost(s, sp, "noodles") > before * 1.45);
  assert.ok(F.quoteRaw(s, { vendor: "agro", lines: [{ rid: "water", qty: 1000 }] }).lines[0].unit >= rawBefore);
  Sn.inject(s, { kind: "delay", days: 3 }); const o = E.placeOrders(s, { supplier: sp.id, lines: [{ pid: "noodles", qty: 1000 }] }); assert.ok(o.ok); assert.ok(o.eta >= base + 1);
  for (let i = 0; i < 5; i++) runDay(s); assert.equal(Sn.eventMult(s, "cost"), 1); assert.ok(E.reconcile(s).ok);
});

test("facilitator injection is validated and can be stopped", () => {
  const s = mk(); assert.equal(Sn.inject(s, { kind: "x", mult: 1, days: 3 }).ok, false); assert.equal(Sn.inject(s, { kind: "demand", mult: 5, days: 3 }).ok, false); assert.equal(Sn.inject(s, { kind: "demand", mult: 1.2, days: 99 }).ok, false);
  const r = Sn.inject(s, { kind: "demand", mult: 1.2, days: 5, title: "Heatwave" }); assert.ok(r.ok); assert.equal(Sn.activeEvents(s).length, 1);
  assert.ok(act(s, newForms(), "evStop", { id: String(r.event.id) }).ok); assert.equal(Sn.activeEvents(s).length, 0);
  const f = newForms(); f.ev = { kind: "demand", mult: 1.3, days: 4, title: "Fair" }; assert.ok(act(s, f, "evGo").ok); assert.equal(Sn.eventMult(s, "demand"), 1.3);
});

test("result cards export, parse, reject junk, and rank by score then net worth", () => {
  const s = mk(); const card = Sn.resultCard(s, 61.234, "Team A"); assert.equal(card.score, 61.23);
  const a = Sn.parseResult(JSON.stringify(card)); assert.equal(a.name, "Team A"); assert.equal(Sn.parseResult("nope"), null); assert.equal(Sn.parseResult('{"game":"other"}'), null);
  const r = Sn.rank([{ name: "B", score: 50, netWorth: 10 }, { name: "A", score: 70, netWorth: 5 }, { name: "C", score: 50, netWorth: 20 }]);
  assert.deepEqual(r.map(x => x.name), ["A", "C", "B"]); assert.equal(r[0].place, 1);
});

test("mail and facilitator screens render; v19 saves migrate to v20", () => {
  const s = mk(); for (let i = 0; i < 8; i++) runDay(s);
  assert.match(SC.mailScreen(s), /Inbox/); const f = newForms(); assert.match(SC.facilitatorScreen(s, f, [{ name: "T", score: 5, netWorth: 1, netProfit: 1 }]), /Announce an event/);
  const old = JSON.parse(JSON.stringify(mk())); old.v = 19; delete old.mail; delete old.scn; const m = E.validateSave(old); assert.ok(m.ok, m.error); assert.equal(m.state.scn.id, "free"); assert.deepEqual(m.state.mail.items, []);
});

import * as UIx from "../js/ui.js";
import * as Dx from "../js/data.js";
test("scenario list explains every scenario in plain words", () => {
  const h = UIx.scenarioList(Dx.SCENARIOS, "supply");
  for (const s of Dx.SCENARIOS) { assert.ok(h.includes(s.name)); assert.ok(s.about && s.about.length > 30, s.id); }
  assert.match(h, /Port strike raises prices<\/em> about 7% a day: supplier prices \+20% to \+40% for 6 to 12 days/); assert.match(h, /deliveries arrive late for 5 to 10 days/); assert.match(h, /rival prices -8% to -22% for 8 to 14 days/);
  assert.match(UIx.scenarioList(Dx.SCENARIOS, "boom"), /35% a day for 6 days after the festival ends/);
  assert.ok(h.includes('class="scn on" data-scn="supply"') && !h.includes('class="scn on" data-scn="free"'));
});

import { cleanMods, MODS, tabOff } from "../js/modules.js";
import * as B from "../js/b2b.js";
import * as Jx from "../js/juiceshop.js";
test("modules: choices are cleaned, b2b needs a warehouse or a factory", () => {
  assert.deepEqual(cleanMods(), { warehouse: true, factory: true, b2b: true }); assert.deepEqual(cleanMods({ factory: false }), { warehouse: true, factory: false, b2b: true });
  assert.deepEqual(cleanMods({ warehouse: false, factory: false }), { warehouse: false, factory: false, b2b: false }); assert.deepEqual(cleanMods({ warehouse: "no", junk: 1 }), cleanMods()); assert.equal(MODS.length, 2, "the factory is no longer a choice");
  assert.deepEqual(E.cleanSetup({ mods: { b2b: false } }).mods, { warehouse: true, factory: true, b2b: false });
});
test("the factory is retired: off in every new game and old save, no menu choice, no tab", () => {
  const was = globalThis.ECONOMY_LEGACY_FACTORY; globalThis.ECONOMY_LEGACY_FACTORY = false;
  try {
    assert.equal(cleanMods({ factory: true }).factory, false); assert.equal(E.newGame({ seed: 3, mods: { factory: true } }).mods.factory, false);
    const s = E.newGame({ seed: 3 }); for (let i = 0; i < 6; i++) runDay(s); assert.ok(E.reconcile(s).ok);
    assert.match(F.rentFactory(s, 100).error, /Factory/); assert.equal(tabOff(s.mods, "factory"), true);
    const old = JSON.parse(JSON.stringify(s)); old.mods.factory = true; const r = E.validateSave(JSON.stringify(old)); assert.ok(r.ok, r.error); assert.equal(r.state.mods.factory, false);
  } finally { globalThis.ECONOMY_LEGACY_FACTORY = was; }
});
test("modules: a turned-off department refuses its actions", () => {
  const s = mk({ mods: { warehouse: false, factory: false } }); assert.equal(s.mods.b2b, false);
  assert.match(E.rentWarehouse(s, 100).error, /Warehouse department is turned off/); assert.match(E.placeOrders(s, { supplier: "harbor", dest: "wh", lines: [{ pid: "noodles", qty: 1000 }] }).error, /Warehouse/);
  assert.match(E.sendToRetail(s, { lines: [] }).error, /Warehouse/); assert.match(F.rentFactory(s, 100).error, /Factory/); assert.match(F.buyMachine(s, { type: "std" }).error, /Factory/); assert.match(Jx.moveJuice(s, { lines: [] }).error, /Factory/);
  assert.match(B.placeBid(s, { tender: 1, price: 1 }).error, /B2B/);
  assert.ok(E.placeOrders(s, { supplier: "local", lines: [{ pid: "noodles", qty: 500 }] }).ok, "the shop still buys stock");
  for (let i = 0; i < 12; i++) runDay(s); assert.equal(s.b2b.open.length, 0); assert.ok(E.reconcile(s).ok);
});
test("modules: b2b only offers goods from a department that is on", () => {
  const nofac = mk({ mods: { factory: false } }); for (let i = 0; i < 15; i++) runDay(nofac); const a = nofac.b2b.open; assert.ok(a.length > 0); assert.ok(a.every(t => !!E.PRODUCT[t.pid]), "retail goods only");
  const nowh = mk({ mods: { warehouse: false } }); for (let i = 0; i < 15; i++) runDay(nowh); const b = nowh.b2b.open; assert.ok(b.length > 0); assert.ok(b.every(t => !E.PRODUCT[t.pid]), "juice only");
});
test("modules: an older save loads with everything on and a scenario stream", () => {
  const s = mk(); const o = JSON.parse(E.serialize(s)); o.v = 22; delete o.mods; delete o.scn.rng; delete o.scn.last;
  const r = E.validateSave(JSON.stringify(o)); assert.ok(r.ok, r.error); assert.deepEqual(r.state.mods, { warehouse: true, factory: true, b2b: true }); assert.ok(Number.isFinite(r.state.scn.rng));
});

test("difficulty moves demand and event chance; old saves count as normal", async () => {
  const E2 = await import("../js/engine.js"), D2 = await import("../js/data.js");
  const mk = d => E2.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 40, capital: 40000, seed: 21, difficulty: d });
  const dem = s => E2.expectedDemand(s, "noodles") / E2.WEEK[s.day % 7] / s.noise;
  const easy = dem(mk("easy")), normal = dem(mk("normal")), hard = dem(mk("hard"));
  assert.ok(easy > normal * 1.05 && normal > hard * 1.05, `${easy} ${normal} ${hard}`);
  assert.equal(E2.cleanSetup({ difficulty: "nonsense" }).difficulty, "normal");
  assert.equal(D2.diff({}).demand, 1);
  const s = mk("hard"); assert.equal(s.difficulty, "hard"); const v = E2.validateSave(JSON.parse(JSON.stringify(s))); assert.ok(v.ok);
});

test("result card v2 carries the scorecard; analytics and the team report use it", async () => {
  const E2 = await import("../js/engine.js"), Kp2 = await import("../js/kpi.js"), Sn2 = await import("../js/scenario.js");
  const mkc = (seed, name) => { const s = E2.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 40, capital: 40000, seed }); for (let i = 0; i < 9; i++) { const d = s.day; while (!s.ended && s.day === d) E2.tick(s, 0.5); } const sb = Kp2.scoreboard(s); return Sn2.resultCard(s, sb.total, name, sb); };
  const a = mkc(1, "Alpha"), b = mkc(2, "Beta"), pa = Sn2.parseResult(JSON.stringify(a)), pb = Sn2.parseResult(JSON.stringify(b));
  assert.ok(pa.kpis.length > 5 && pa.depts.length >= 1 && pa.cash_flow && pa.customers);
  assert.equal(Sn2.parseResult(JSON.stringify({ game: "economy-result", score: 50, netWorth: 1000, kpis: "x", depts: 5 })).kpis.length, 0);   // junk shapes are ignored, not trusted
  const an = Sn2.analytics(Sn2.rank([pa, pb])); assert.equal(an.n, 2); assert.ok(an.kpis[0].mean <= an.kpis[an.kpis.length - 1].mean && an.hints.length >= 1);
  assert.equal(Sn2.analytics([]), null);
  const html = Sn2.reportHtml({ ...pa, name: "<b>Alpha</b>" }); assert.ok(html.includes("Scorecard") && !html.includes("<b>Alpha</b>") && html.includes("&lt;b&gt;Alpha"));
  assert.deepEqual(Sn2.rank([pa, pb]).map(r => r.idx).sort(), [0, 1]);
});

test("hard difficulty raises the number of random events over many games", async () => {
  const E2 = await import("../js/engine.js"), D2 = await import("../js/data.js"), Sn2 = await import("../js/scenario.js");
  const scn = D2.SCENARIOS.find(x => x.pool && x.pool.length).id, count = d => { let n = 0; for (let seed = 1; seed <= 12; seed++) { const s = E2.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 60, capital: 40000, seed, scenario: scn, difficulty: d }); for (let k = 0; k < 40; k++) Sn2.scenarioDay(s), s.day++; n += s.scn.events.length; } return n; };
  assert.ok(count("hard") > count("easy"), "more events on hard");
});
