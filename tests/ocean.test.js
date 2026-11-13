import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as H from "../js/hr.js";
import * as D from "../js/data.js";
import * as SC from "../js/screens.js";
import { act, newForms } from "../js/actions.js";
import { totals } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 300, secPerDay: 10, days: 80, capital: 200000, seed: 21, ...o });

test("traits stay in 0..100, fit stays in -1..1, and the shortlist is stable until someone is hired", () => {
  const s = mk(); for (const r of D.HR_ROLES) { const a = H.shortlist(s, r.id), b = H.shortlist(s, r.id); assert.deepEqual(a, b); assert.equal(a.length, D.HR_OCEAN.candidates);
    for (const c of a) { assert.ok(Object.values(c.o).every(v => v >= 0 && v <= 100)); assert.ok(c.fit >= -1 && c.fit <= 1); assert.ok(c.skill >= D.HR.skillStart * 0.7 && c.skill <= D.HR.skillStart * 1.3); } }
  const before = H.shortlist(s, "retail"); H.hireCandidate(s, "retail", 0); assert.notDeepEqual(H.shortlist(s, "retail").map(c => c.name), before.map(c => c.name));
  assert.equal(H.shortlist(s, "nope").length, 0);
});
test("fit follows the role: a careful person suits the warehouse, an outgoing agreeable one suits the shop", () => {
  assert.ok(H.fitOf("warehouse", { O: 50, C: 95, E: 50, A: 50, N: 50 }) > 0.8); assert.ok(H.fitOf("warehouse", { O: 50, C: 5, E: 50, A: 50, N: 50 }) < -0.8);
  assert.ok(H.fitOf("retail", { O: 50, C: 50, E: 90, A: 90, N: 50 }) > 0.7); assert.ok(H.fitOf("driver", { O: 50, C: 50, E: 50, A: 50, N: 95 }) < 0);
  assert.equal(H.fitOf("retail", { O: 50, C: 50, E: 50, A: 50, N: 50 }), 0);
});
test("hiring by interview keeps the person's name and traits, pays the usual fee, and a better fit starts with more skill", () => {
  const a = mk(), b = mk(); const sl = H.shortlist(a, "retail"), best = sl.reduce((x, y) => (y.fit > x.fit ? y : x)), worst = sl.reduce((x, y) => (y.fit < x.fit ? y : x));
  assert.ok(best.fit > worst.fit);
  const cash = a.ledger.bal.cash; const ra = H.hireCandidate(a, "retail", best.idx), rb = H.hireCandidate(b, "retail", worst.idx);
  assert.ok(ra.ok && rb.ok); assert.equal(ra.name, best.name); assert.ok(a.ledger.bal.cash < cash); assert.ok(totals(a.ledger).balanced);
  const ma = a.hr.staff.retail.crew.at(-1); assert.equal(ma.name, best.name); assert.deepEqual(ma.o, best.o); assert.equal(ma.skill, best.skill);
  assert.ok(a.hr.staff.retail.skill > b.hr.staff.retail.skill);
  assert.equal(H.hireCandidate(a, "retail", 9).ok, false);
});
test("a high-neuroticism team quits more; plain hires are untouched", () => {
  const s = mk(); assert.equal(H.quitFactor(s, "retail"), 1); H.hire(s, "retail", 2); assert.equal(H.quitFactor(s, "retail"), 1);
  const st = s.hr.staff.retail; for (const m of st.crew) m.o = { O: 50, C: 50, E: 50, A: 50, N: 100 }; assert.ok(H.quitFactor(s, "retail") > 1.3);
  for (const m of st.crew) m.o = { O: 50, C: 50, E: 50, A: 50, N: 0 }; assert.ok(H.quitFactor(s, "retail") < 0.7);
});
test("screen, action and save round trip", () => {
  const s = mk(), f = newForms(); assert.match(SC.hrScreen(s, f), /Interview/); f.iv = "warehouse";
  assert.ok(act(s, f, "hirePick", { id: "warehouse:1" }).ok); assert.match(SC.hrScreen(s, f), /fit /);
  const back = E.validateSave(JSON.parse(E.serialize(s))); assert.ok(back.ok); assert.ok(back.state.hr.staff.warehouse.crew.some(m => m.o));
  assert.equal(act(s, f, "hirePick", { id: "warehouse:7" }).ok, false);
});
