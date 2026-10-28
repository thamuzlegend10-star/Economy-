// Headless balance check: plays N days with simple bot policies and prints outcomes.
import * as D from "../js/data.js";
import * as E from "../js/engine.js";

function play(policy, difficulty, seed, days = 30) {
  const s = E.newGame({ mode: "standard", difficulty, dayLimit: days, seed });
  let guardN = 0;
  while (!s.ended && guardN++ < 500000) {
    if (s.phase === "report") { E.nextDay(s); continue; }
    if (s.clock === 0) policy(s);
    E.tick(s, 0.5);
  }
  const d = E.updateDerived(s), sc = E.score(s);
  return { nw: d.netWorth, start: s.startNetWorth, cust: s.stats.customers, lost: s.stats.stockLost || 0, rep: Math.round(s.rep), debt: d.debt, score: sc.total, reason: s.ended && s.ended.reason, rec: E.reconcile(s).ok };
}
const stockUp = (s, target, sup = "metro") => {
  const lines = [];
  for (const p of D.PRODUCTS) {
    if (!E.isUnlocked(s, p.id)) continue;
    const have = E.unitsTotal(s, p.id) + E.incomingOf(s, p.id);
    if (have < target * 0.5 && D.SUPPLIERS.find(x => x.id === sup).cats.includes(p.cat)) lines.push({ pid: p.id, qty: Math.round(target - have) });
  }
  let room = E.whCap(s) - E.whUsed(s) - E.incomingUnits(s);
  for (const l of lines) { l.qty = Math.max(1, Math.min(l.qty, Math.floor(room / Math.max(1, lines.length)))); }
  {
  }
  if (lines.length) E.placeOrder(s, { supplier: sup, lines, pay: "bank" });
  for (const p of D.PRODUCTS) if (E.isUnlocked(s, p.id)) E.setShelfTarget(s, p.id, 14);
};
const policies = {
  idle: () => {},
  basic: s => stockUp(s, 24),
  smart: s => {
    stockUp(s, 24);
    if (s.day === 2 && s.staff.length === 0) { for (const c of [...s.candidates]) if (c.role === "stocker" || c.role === "cashier") E.hire(s, c.id); }
    if (s.day >= 3 && !s.campaigns.length) E.launchCampaign(s, "flyers");
    if (s.day === 6 && E.updateDerived(s).liquid > 600) E.buyUpgrade(s, "counter", "u" + s.day);
  },
};
for (const diff of ["easy", "normal", "hard"]) {
  for (const [name, pol] of Object.entries(policies)) {
    const rs = [1, 2, 3, 4, 5].map(sd => play(pol, diff, sd * 7919));
    const avg = k => (rs.reduce((a, r) => a + r[k], 0) / rs.length);
    console.log(`${diff.padEnd(6)} ${name.padEnd(6)} netWorth ${avg("nw").toFixed(0).padStart(6)} (start ${rs[0].start.toFixed(0)}) cust ${avg("cust").toFixed(0).padStart(4)} lost ${avg("lost").toFixed(0).padStart(4)} rep ${avg("rep").toFixed(0)} debt ${avg("debt").toFixed(0)} score ${avg("score").toFixed(0)} ended:${[...new Set(rs.map(r => r.reason))]} reconciled:${rs.every(r => r.rec)}`);
  }
}
