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

test("a scenario fires on its day, announces by mail, changes demand and ends", () => {
  const s = mk({ scenario: "boom" }); assert.equal(s.scn.id, "boom"); const base = E.expectedDemand(s, "milk");
  while (s.day < 5) runDay(s); assert.ok(Sn.eventMult(s, "demand") > 1); assert.ok(s.mail.items.some(m => /Festival/.test(m.subject)));
  const d5 = E.expectedDemand(s, "milk"); assert.ok(d5 > 0);
  while (s.day < 14) runDay(s); assert.equal(Sn.eventMult(s, "demand"), 1); assert.ok(s.mail.items.some(m => /Over: Festival/.test(m.subject)));
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
  assert.match(h, /Port strike raises prices: supplier prices \+30% for 10 days/); assert.match(h, /deliveries arrive late for 8 days/); assert.match(h, /rival prices -15% for 12 days/);
  assert.ok(h.includes('class="scn on" data-scn="supply"') && !h.includes('class="scn on" data-scn="free"'));
});
