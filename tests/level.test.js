import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/engine.js";
import * as D from "../js/data.js";
import * as UI from "../js/ui.js";
import * as Sh from "../js/shelf.js";
import { totals } from "../js/ledger.js";

const mk = (o = {}) => E.newGame({ location: "id-medan-central", area: 250, secPerDay: 20, days: 30, capital: 60000, seed: 51, ...o });
const subsOf = (ui, level) => UI.navHtml(ui, undefined, level);
test("advanced is the default and shows everything; old saves count as advanced", () => {
  const s = mk(); assert.equal(s.level, "advanced"); assert.equal(s.shelfOn, true); assert.equal(s.qcOn, true); assert.equal(s.intelFee, true);
  const old = mk(); delete old.level; assert.equal(E.levelOf(old).id, "advanced"); assert.equal(E.levelOf({ level: "bogus" }).id, "advanced");
});
test("beginner turns the advanced mechanics off, intermediate keeps delivery checks only", () => {
  const b = mk({ level: "beginner" }), i = mk({ level: "intermediate" });
  assert.deepEqual([b.shelfOn, b.qcOn, b.intelFee], [false, false, false]); assert.deepEqual([i.shelfOn, i.qcOn, i.intelFee], [false, true, false]);
  assert.equal(Sh.onShelf(b, "noodles"), b.qty.noodles);
});
test("lower levels hide advanced tabs and sub tabs; advanced hides nothing", () => {
  const ui = { main: "retail", sub: { retail: "procurement" }, more: true, wide: true };
  const adv = subsOf(ui, E.levelOf({ level: "advanced" })), beg = subsOf(ui, E.levelOf({ level: "beginner" }));
  assert.match(adv.main, /data-main="branch"/); assert.doesNotMatch(beg.main, /data-main="branch"/);
  assert.match(adv.sub, /data-sub="quality"/); assert.doesNotMatch(beg.sub, /data-sub="quality"/); assert.doesNotMatch(beg.sub, /data-sub="freshness"/); assert.match(beg.sub, /data-sub="store"/);
  const fin = { ...ui, main: "finance", sub: { finance: "overview" } }; assert.doesNotMatch(subsOf(fin, E.levelOf({ level: "beginner" })).sub, /ledger/); assert.match(subsOf(fin, E.levelOf({ level: "advanced" })).sub, /ledger/);
});
test("a game at every level runs balanced and reconciled", () => {
  for (const level of ["beginner", "intermediate", "advanced"]) { const s = mk({ level }); while (s.day < 8 && !s.ended) E.tick(s, 1); assert.ok(s.stats.units > 0, level); assert.ok(totals(s.ledger).balanced); assert.equal(E.reconcile(s).ok, true, level); }
});
test("restart keeps the level; every level has a note and valid hidden tabs", () => {
  assert.equal(E.restartSame(mk({ level: "beginner" })).level, "beginner");
  const subs = D.LEVELS.flatMap(l => l.hideSubs); for (const key of subs) { const [m, sub] = key.split("."); assert.ok(UI.NAV.find(n => n.id === m).subs.some(x => x[0] === sub), key); }
  for (const l of D.LEVELS) { assert.ok(l.note.length > 20); for (const t of l.hideTabs) assert.ok(UI.NAV.some(n => n.id === t), t); }
});
