// Selling your own juice in the shop. Juice is made in the factory, moved to the shop by truck (yours or a hired carrier), put on a juice shelf,
// priced by you, and sold to shoppers each day. Every step posts to the ledger: factory goods -> goods in transit -> shop inventory -> sales and cost of goods.
import { modOn, offMsg } from "./modules.js";
import { post, balance, round2 } from "./ledger.js";
import * as D from "./data.js";
import { getLocation } from "./locations.js";
import { streamNext, seedFrom } from "./rng.js";
import { JUICE } from "./factory.js";
import { planTrip, dispatch } from "./fleet.js";
import { transferDiscount, retailBoost } from "./hr.js";
import { demandLift, priceCut, csiFactor } from "./market.js";
import { expectedPrice, demandMood } from "./economy.js";
import { eventMult } from "./scenario.js";
import { mailPost } from "./mail.js";
import { WEEK, spaceFree, log } from "./engine.js";

const c = round2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const err = error => ({ ok: false, error }), ok = (o = {}) => ({ ok: true, ...o });
const zero = () => Object.fromEntries(D.JUICES.map(j => [j.id, 0]));
export const newJshop = () => ({ qty: zero(), val: zero(), prices: Object.fromEntries(D.JUICES.map(j => [j.id, c(j.ref * 1.05)])), accum: zero(), moves: [], seq: 0, sold: zero(), lost: zero(), hist: Object.fromEntries(D.JUICES.map(j => [j.id, []])), revenue: 0, listed: {} });
export const ensureJshop = s => (s.jshop = s.jshop || newJshop());
export const shelfSpace = s => D.JUICES.reduce((a, j) => a + ensureJshop(s).qty[j.id] * j.space, 0);
export const movingSpace = s => ensureJshop(s).moves.reduce((a, m) => a + m.qty * JUICE[m.jid].space, 0);
export const jshopValue = s => c(D.JUICES.reduce((a, j) => a + ensureJshop(s).val[j.id], 0));
export const movesValue = s => c(ensureJshop(s).moves.reduce((a, m) => a + m.value, 0));

export function setJuicePrice(s, jid, price) {
  const j = JUICE[jid]; if (!j) return err("Unknown juice."); const p = ensureJshop(s).prices;
  p[jid] = c(clamp(Math.round(Number(price) / j.step) * j.step, j.ref * 0.5, j.ref * 2.5)); return ok({ price: p[jid] });
}
export const adjustJuicePrice = (s, jid, dir) => setJuicePrice(s, jid, ensureJshop(s).prices[jid] + dir * JUICE[jid].step);

// ---------- moving juice from the factory to the shop ----------
export function quoteMove(s, lines, carrier = "hired") {
  const seen = new Set(), items = [];
  for (const l of Array.isArray(lines) ? lines : []) { const qty = Math.round(Number(l && l.qty)); if (!l || !JUICE[l.jid] || seen.has(l.jid) || !Number.isFinite(qty) || qty < 1) continue; seen.add(l.jid); items.push({ jid: l.jid, qty }); }
  if (!items.length) return err("Choose a quantity for at least one juice.");
  const fg = s.fx.fg, errors = [], out = items.map(l => {
    const have = fg.qty[l.jid]; if (l.qty > have) errors.push(`The factory has only ${have.toLocaleString("en-US")} ${JUICE[l.jid].name}.`);
    const value = !have ? 0 : l.qty >= have ? fg.val[l.jid] : c(fg.val[l.jid] / have * l.qty);
    return { jid: l.jid, qty: l.qty, value, fee: c(D.TRANSFER.rate * l.qty * JUICE[l.jid].space * (1 - transferDiscount(s))), space: l.qty * JUICE[l.jid].space };
  });
  const space = out.reduce((a, l) => a + l.space, 0), value = c(out.reduce((a, l) => a + l.value, 0));
  let fee = c(D.TRANSFER.fee * (1 - transferDiscount(s)) + out.reduce((a, l) => a + l.fee, 0)), days = D.TRANSFER.days, plan = null;
  if (carrier === "own") { plan = planTrip(s, { km: D.TRANSPORT.localKm, space }); if (!plan.ok) errors.push(plan.error); else { days = plan.days; fee = plan.fuel; } }
  const free = spaceFree(s) - movingSpace(s) - shelfSpace(s) + 0;
  if (fee > balance(s.ledger, "cash") + 0.004) errors.push(`Not enough cash for the carrier: $${fee.toFixed(2)}.`);
  if (space > free) errors.push(`Not enough space in the shop: this needs ${Math.round(space).toLocaleString("en-US")}, ${Math.max(0, Math.floor(free)).toLocaleString("en-US")} free.`);
  return { lines: out, carrier, plan, fee, space, value, days, eta: s.day + days, errors, ok: !errors.length };
}
export function moveJuice(s, { lines, carrier = "hired" } = {}) {
  if (!modOn(s, "factory")) return err(offMsg("factory"));
  if (s.ended) return err("The game is over.");
  const q = quoteMove(s, lines, carrier); if (q.error) return err(q.error); if (!q.ok) return err(q.errors[0]);
  const js = ensureJshop(s), own = q.carrier === "own", haul = own ? dispatch(s, q.plan, "juice to shop") : 0;
  for (const l of q.lines) { s.fx.fg.qty[l.jid] -= l.qty; s.fx.fg.val[l.jid] = c(s.fx.fg.val[l.jid] - l.value); js.moves.push({ id: ++js.seq, jid: l.jid, qty: l.qty, value: l.value, placed: s.day, eta: q.eta + haul, carrier: q.carrier }); }
  const lines2 = [{ acct: "transit", dr: q.value }, { acct: "inv_fg", cr: q.value }];
  if (!own && q.fee > 0) lines2.push({ acct: "delivery", dr: q.fee }, { acct: "cash", cr: q.fee });
  post(s.ledger, s.day, `Juice moved from the factory to the shop`, lines2, "jmove:" + js.seq);
  s.today.ship = c(s.today.ship + q.fee);
  log(s, `Sent ${q.lines.map(l => `${l.qty.toLocaleString("en-US")} ${JUICE[l.jid].name}`).join(", ")} to the shop. Arrives day ${q.eta + haul}.`);
  return ok({ eta: q.eta + haul, fee: q.fee });
}
export function juiceArrivals(s) {
  const js = ensureJshop(s), due = js.moves.filter(m => m.eta <= s.day);
  for (const m of due) {
    post(s.ledger, s.day, `Juice delivery to the shop (${JUICE[m.jid].name})`, [{ acct: "inventory", dr: m.value }, { acct: "transit", cr: m.value }], "jarr:" + m.id);
    js.listed[m.jid] = true; js.qty[m.jid] += m.qty; js.val[m.jid] = c(js.val[m.jid] + m.value);
  }
  js.moves = js.moves.filter(m => m.eta > s.day);
}

// ---------- selling ----------
export function juiceDemand(s, j) {
  const L = getLocation(s.location), price = ensureJshop(s).prices[j.id], area = Math.pow(s.area / D.AREA.def, 0.3);
  const pf = clamp(Math.pow(expectedPrice(s, j) / price, j.elast * L.priceSens * priceCut(s, "drinks")), 0.01, 2.5);
  return j.base * D.JUICE_SHOP.share * L.demand * L.cat.drinks * area * pf * (1 - 0.3 * L.competition) * WEEK[s.day % 7] * s.noise * demandLift(s, "drinks") * retailBoost(s) * csiFactor(s) * eventMult(s, "demand") * demandMood(s, "drinks") * D.diff(s).demand;
}
// Runs at day close, before service satisfaction is worked out, so juice stockouts count as missed sales.
export function juiceShopDay(s) {
  const js = ensureJshop(s); let rev = 0, cost = 0;
  for (const j of D.JUICES) {
    if (!js.listed[j.id]) continue;                       // a juice you never stocked draws no shoppers and no missed sales
    const want0 = juiceDemand(s, j); js.accum[j.id] += want0; const want = Math.floor(js.accum[j.id]); js.accum[j.id] -= want;
    const have = js.qty[j.id], n = Math.min(want, have), lost = want - n;
    if (lost > 0) { js.lost[j.id] += lost; s.today.lost[j.id] = (s.today.lost[j.id] || 0) + lost; }
    if (n > 0) {
      const cst = n >= have ? js.val[j.id] : c(js.val[j.id] / have * n), r = c(n * js.prices[j.id]);
      js.qty[j.id] -= n; js.val[j.id] = c(js.val[j.id] - cst); js.sold[j.id] += n; rev = c(rev + r); cost = c(cost + cst);
      s.today.units[j.id] = (s.today.units[j.id] || 0) + n;
    }
    const h = js.hist[j.id]; h.push(n + lost); if (h.length > D.FORECAST.window) h.shift();
  }
  if (rev > 0) { post(s.ledger, s.day, "Juice sales in the shop", [{ acct: "cash", dr: rev }, { acct: "sales", cr: rev }], "jsales:" + s.day); js.revenue = c(js.revenue + rev); s.today.rev = c(s.today.rev + rev); }
  if (cost > 0) { post(s.ledger, s.day, "Cost of juice sold", [{ acct: "cogs", dr: cost }, { acct: "inventory", cr: cost }], "jsales:" + s.day); s.today.cogs = c(s.today.cogs + cost); }
}
// Average juice wanted per day (sold plus missed) over the recent window.
export const shopPerDay = (s, jid) => { const h = ensureJshop(s).hist[jid]; return h.length ? h.reduce((a, b) => a + b, 0) / h.length : 0; };
