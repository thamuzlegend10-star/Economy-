// Branch shops: up to three extra outlets in other places. Each pays its own rent and staff, and sells from the main shop's stock
// at the main shop's prices. A branch sells what the main shop has left at the end of its day, so a busy main shop starves it.
import { post, balance, round2 } from "./ledger.js";
import * as D from "./data.js";
import { getLocation, hasLocation, playableLocations } from "./locations.js";
import { demandFor, dailyRent, log, PRODUCT } from "./engine.js";

const c = round2, err = error => ({ ok: false, error }), ok = (o = {}) => ({ ok: true, ...o });
export const newBranches = () => ({ seq: 0, list: [] });
export const ensureBranches = s => (s.branches = s.branches || newBranches());

function payOut(s, acct, amount, memo, ref) {
  amount = c(amount); if (amount <= 0) return;
  const cash = Math.max(0, balance(s.ledger, "cash")), paid = c(Math.min(cash, amount)), short = c(amount - paid);
  const lines = [{ acct, dr: amount }]; if (paid > 0) lines.push({ acct: "cash", cr: paid }); if (short > 0) lines.push({ acct: "overdraft", cr: short });
  post(s.ledger, s.day, memo, lines, ref);
}
export const fitout = area => c(D.BRANCH.fitoutPerM2 * area);
export const staffCost = loc => c(D.BRANCH.staffPerDay * getLocation(loc).wage);
export const branchRunCost = (loc, area) => c(dailyRent(loc, area) + staffCost(loc));

export function openBranch(s, { location, area } = {}) {
  const b = ensureBranches(s);
  if (s.ended) return err("The game is over.");
  if (!hasLocation(location)) return err("Choose a place for the branch.");
  area = Math.round(Number(area));
  if (!D.BRANCH.areas.includes(area)) return err("Choose a size from the list.");
  if (b.list.length >= D.BRANCH.max) return err(`You can run up to ${D.BRANCH.max} branches.`);
  if (location === s.location || b.list.some(x => x.location === location)) return err("You already have a shop in that place. Choose another.");
  const cost = fitout(area), cash = balance(s.ledger, "cash");
  if (cost > cash + 0.004) return err(`Not enough cash: fitting out the branch costs $${cost.toFixed(2)}, you have $${c(cash).toFixed(2)}.`);
  const id = ++b.seq;
  post(s.ledger, s.day, `Fit-out of branch #${id} in ${getLocation(location).name}`, [{ acct: "equipment", dr: cost }, { acct: "cash", cr: cost }], "branch:open:" + id);
  b.list.push({ id, location, area, opened: s.day, acc: {}, stats: { units: 0, revenue: 0, cogs: 0, costs: 0, lost: 0 }, today: { units: 0, revenue: 0 } });
  log(s, `Opened branch #${id} in ${getLocation(location).name}.`);
  return ok({ id, cost });
}
export function closeBranch(s, id) {
  const b = ensureBranches(s), i = b.list.findIndex(x => x.id === Number(id));
  if (i < 0) return err("Unknown branch.");
  const [x] = b.list.splice(i, 1); log(s, `Closed branch #${x.id} in ${getLocation(x.location).name}.`);
  return ok({ id: x.id });
}

// Expected units per day for one branch today, before stock limits.
export const branchDemand = (s, br) => D.PRODUCTS.reduce((a, p) => a + demandFor(s, p, br.location, br.area) * D.BRANCH.demandShare, 0);

export function branchDay(s) {
  const b = ensureBranches(s); if (!b.list.length) return;
  for (const br of b.list) {
    const name = getLocation(br.location).name, rent = dailyRent(br.location, br.area), staff = staffCost(br.location);
    payOut(s, "rent", rent, `Rent, branch #${br.id}`, `branch:rent:${br.id}:${s.day}`);
    payOut(s, "wages", staff, `Staff, branch #${br.id}`, `branch:staff:${br.id}:${s.day}`);
    br.stats.costs = c(br.stats.costs + rent + staff); br.today = { units: 0, revenue: 0 };
    for (const p of D.PRODUCTS) {
      br.acc[p.id] = (br.acc[p.id] || 0) + demandFor(s, p, br.location, br.area) * D.BRANCH.demandShare;
      const want = Math.floor(br.acc[p.id]); br.acc[p.id] -= want; if (want < 1) continue;
      const have = s.qty[p.id], n = Math.min(want, have), lost = want - n;
      if (lost) br.stats.lost += lost;
      if (n < 1) continue;
      const cost = n >= have ? s.val[p.id] : c(s.val[p.id] / have * n), rev = c(n * s.prices[p.id]), ship = c(n * D.BRANCH.transferPerUnit);
      s.qty[p.id] -= n; s.val[p.id] = c(s.val[p.id] - cost);
      post(s.ledger, s.day, `Branch #${br.id} sold ${n} ${p.name}`, [{ acct: "cash", dr: rev }, { acct: "sales", cr: rev }], `branch:sale:${br.id}:${p.id}:${s.day}`);
      post(s.ledger, s.day, `Cost of goods, branch #${br.id}`, [{ acct: "cogs", dr: cost }, { acct: "inventory", cr: cost }], `branch:cogs:${br.id}:${p.id}:${s.day}`);
      payOut(s, "delivery", ship, `Stock moved to branch #${br.id}`, `branch:ship:${br.id}:${p.id}:${s.day}`);
      br.stats.units += n; br.stats.revenue = c(br.stats.revenue + rev); br.stats.cogs = c(br.stats.cogs + cost); br.stats.costs = c(br.stats.costs + ship);
      br.today.units += n; br.today.revenue = c(br.today.revenue + rev);
    }
  }
}

// Places a new branch could go: everywhere except the main shop and the existing branches.
export const sites = s => playableLocations().filter(l => l.id !== s.location && !ensureBranches(s).list.some(x => x.location === l.id));
export const defaultSite = s => (sites(s)[0] || {}).id || "";
