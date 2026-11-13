import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as Sv from "../js/services.js";
import * as H from "../js/hr.js";
import * as D from "../js/data.js";
import * as SC from "../js/screens.js";
import * as Kp from "../js/kpi.js";
import { act, newForms } from "../js/actions.js";
import { balance, totals } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 120, capital: 200000, seed: 21, ...o });
const runDays = (s, n) => { const end = s.day + n; while (s.day < end && !s.ended) E.tick(s, 1); };
const withRfq = (s, over = {}) => { const v = Sv.ensureSvc(s); const r = { id: ++v.seq, type: "setup", client: "Test client", hours: 6, posted: s.day, expires: s.day + 3, deadline: s.day + 8, quote: null, cap: 200, ...over }; v.rfqs.push(r); return r; };

test("requests appear over time, with valid fields, and the cap is above market on average", () => {
  const s = mk(); runDays(s, 25); const v = Sv.ensureSvc(s); assert.ok(v.seq > 5, "requests " + v.seq);
  for (const r of v.rfqs) { assert.ok(Sv.typeOf(r.type)); assert.ok(r.hours >= 2); assert.ok(r.deadline > r.posted); assert.ok(r.cap >= Sv.marketPrice(r) * D.SVC.capMult[0] - 0.01); }
  assert.ok(v.rfqs.filter(r => r.quote == null).length <= D.SVC.maxOpen);
});
test("no service staff means no hours and no quotes; staff give hours by skill and the desk keeps a share", () => {
  const s = mk(); const r = withRfq(s); assert.equal(Sv.hoursToday(s), 0); assert.match(Sv.sendQuote(s, r.id, 100).error, /no service staff/);
  H.hire(s, "service", 2); const h = Sv.hoursToday(s); assert.ok(h > 0 && h <= 2 * D.SVC.hoursPerStaff * 1.6 * (1 - D.SVC.ticketShare) + 0.01);
  assert.ok(Sv.sendQuote(s, r.id, Sv.marketPrice(r)).ok); assert.match(Sv.sendQuote(s, r.id, 100).error, /already/);
});
test("quote limits: range, client cap, win chance falls with price", () => {
  const s = mk(); H.hire(s, "service", 1); const r = withRfq(s, { cap: 100 }), mk0 = Sv.marketPrice(r);
  assert.match(Sv.sendQuote(s, r.id, mk0 * 0.3).error, /Quote between/); assert.match(Sv.sendQuote(s, r.id, mk0 * 1.45).error, /will not pay more/);
  assert.ok(Sv.winChance(s, r, mk0 * 0.8) > Sv.winChance(s, r, mk0) && Sv.winChance(s, r, mk0) > Sv.winChance(s, r, mk0 * 1.4));
  for (const m of [0.7, 1, 1.5]) { const p = Sv.winChance(s, r, mk0 * m); assert.ok(p >= 0.05 && p <= 0.95); }
});
test("a won job is worked in hours, paid on completion, books double-entry and lifts reputation", () => {
  const s = mk(); H.hire(s, "service", 2); const v = Sv.ensureSvc(s);
  v.jobs.push({ id: 900, type: "setup", client: "Test client", hours: 6, left: 6, price: 90, deadline: s.day + 10, won: s.day, prio: 1 });
  const cash0 = balance(s.ledger, "cash"), rev0 = balance(s.ledger, "sales_service"); runDays(s, 2);
  assert.equal(v.jobs.find(j => j.id === 900), undefined); assert.equal(v.stats.done, 1); assert.ok(balance(s.ledger, "sales_service") - rev0 >= 89.99);
  assert.ok(totals(s.ledger).balanced); assert.equal(E.reconcile(s).ok, true);
  void cash0;
});
test("scheduling: priority decides who gets hours, per-job cap applies, and moving a job changes the projection", () => {
  const s = mk(); H.hire(s, "service", 1); const v = Sv.ensureSvc(s), hrs = Sv.hoursToday(s);
  v.jobs.push({ id: 1, type: "fitout", client: "A", hours: 28, left: 28, price: 520, deadline: s.day + 30, won: s.day, prio: 1 }, { id: 2, type: "setup", client: "B", hours: 6, left: 6, price: 90, deadline: s.day + 30, won: s.day, prio: 2 });
  let a = Sv.allocate(s); assert.equal(a[1], Math.min(hrs, D.SVC.perJobPerDay)); assert.ok(a[2] <= hrs - a[1] + 0.01);
  const f1 = Sv.project(s); Sv.moveJob(s, 2, -1); const f2 = Sv.project(s); assert.ok(f2[2] <= f1[2]); assert.ok(f2[1] >= f1[1]);
  Sv.sortByDeadline(s); assert.deepEqual(v.jobs.slice().sort((x, y) => x.prio - y.prio).map(j => j.id), [1, 2]);
  assert.ok(Object.values(Sv.allocate(s)).reduce((x, y) => x + y, 0) <= hrs + 0.01);
});
test("late jobs are paid less; a job far past its deadline is cancelled with a penalty", () => {
  const s = mk(); H.hire(s, "service", 1); const v = Sv.ensureSvc(s);
  v.jobs.push({ id: 10, type: "setup", client: "Late client", hours: 6, left: 6, price: 100, deadline: s.day - 2, won: s.day - 5, prio: 1 });
  const rev0 = balance(s.ledger, "sales_service"); runDays(s, 2); const got = balance(s.ledger, "sales_service") - rev0;
  assert.ok(got < 100 && got >= 100 * (1 - D.SVC.lateCap) - 0.01, "paid " + got); assert.equal(v.stats.late, 1);
  v.jobs.push({ id: 11, type: "fitout", client: "Gone client", hours: 500, left: 500, price: 400, deadline: s.day - D.SVC.cancelAfter - 1, won: s.day - 20, prio: 1 });
  const pen0 = balance(s.ledger, "penalties"); runDays(s, 1); assert.equal(v.stats.cancelled, 1); assert.ok(balance(s.ledger, "penalties") - pen0 >= 59.99);
  assert.ok(totals(s.ledger).balanced); assert.equal(E.reconcile(s).ok, true);
});
test("a quote is answered the next day: win moves it to the queue, loss closes it", () => {
  let won = 0, lost = 0; for (let seed = 1; seed <= 40; seed++) { const s = mk({ seed }); H.hire(s, "service", 1); const r = withRfq(s, { id: 500 }); const q = Sv.sendQuote(s, 500, Sv.marketPrice(r) * 0.8); assert.ok(q.ok);
    runDays(s, 2); const v = Sv.ensureSvc(s); assert.equal(v.rfqs.some(x => x.id === 500), false); if (v.stats.won + v.stats.done > 0) won++; else lost++; }
  assert.ok(won > 15 && lost > 0, `won ${won} lost ${lost}`);
});
test("a long game with staff stays balanced, deterministic and reconciled; screen, actions, warnings and old saves work", () => {
  const run = () => { const s = mk(); H.hire(s, "service", 2); const f = newForms(); for (let d = 0; d < 30; d++) { runDays(s, 1); for (const r of Sv.ensureSvc(s).rfqs.filter(x => x.quote == null)) act(s, f, "svcQuote", { id: r.id }); } return s; };
  const a = run(), b = run(); assert.equal(E.serialize(a), E.serialize(b)); assert.equal(E.reconcile(a).ok, true); assert.ok(totals(a.ledger).balanced);
  assert.ok(a.svcj.stats.won > 0, JSON.stringify(a.svcj.stats)); const f = newForms();
  assert.match(SC.services(a, f), /Queue/); assert.match(SC.services(a, f), /Hours for jobs today/);
  const x = mk(); H.hire(x, "service", 1); Sv.ensureSvc(x).jobs.push({ id: 1, type: "fitout", client: "A", hours: 28, left: 28, price: 520, deadline: x.day + 1, won: x.day, prio: 1 });
  assert.ok(Kp.warnings(x).some(w => /finish late/.test(w.text)));
  const old = JSON.parse(E.serialize(mk())); delete old.svcj; delete old.ledger.bal.sales_service; const v = E.validateSave(old); assert.ok(v.ok, v.error); runDays(v.state, 3); assert.equal(E.reconcile(v.state).ok, true);
  assert.ok(act(x, f, "svcSort", {}).ok); assert.ok(E.validateSave(JSON.parse(E.serialize(x))).ok);
});
