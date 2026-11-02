// Company trucks and drivers (spec section 3). A truck carries space units, burns fuel per km, wears, breaks down and needs a driver.
// Used for pickups from suppliers, warehouse-to-shop moves and factory-to-warehouse moves. Every trip moves real stock and books real costs.
import { post, balance, round2 } from "./ledger.js";
import * as D from "./data.js";
import { streamNext, seedFrom } from "./rng.js";
import { log } from "./engine.js";
import { mailPost } from "./mail.js";

const c = round2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const err = error => ({ ok: false, error }), ok = (o = {}) => ({ ok: true, ...o });
export const TRUCK = Object.fromEntries(D.TRUCKS.map(t => [t.id, t]));
export const newFleet = (seed = 0) => ({ rng: seedFrom(seed, 0xf1ee7), trucks: [], seq: 0, trips: [], tripSeq: 0, km: 0, fuelPaid: 0 });
export const ensureFleet = s => (s.fleet = s.fleet || newFleet(s.seed));
function payOut(s, acct, amount, memo, ref) {
  amount = c(amount); if (amount <= 0) return;
  const cash = Math.max(0, balance(s.ledger, "cash")), paid = c(Math.min(cash, amount)), short = c(amount - paid);
  const lines = [{ acct, dr: amount }]; if (paid > 0) lines.push({ acct: "cash", cr: paid }); if (short > 0) lines.push({ acct: "overdraft", cr: short });
  post(s.ledger, s.day, memo, lines, ref);
}
export const idleTrucks = s => ensureFleet(s).trucks.filter(t => t.status === "idle" && t.busyUntil <= s.day);
export const trucksOut = s => ensureFleet(s).trucks.filter(t => t.status === "out").length;
export const driversFree = s => s.hr.staff.driver.n - trucksOut(s);

// ---------- buying and care ----------
export function buyTruck(s, { type } = {}) {
  if (s.ended) return err("The game is over."); const t = TRUCK[type]; if (!t) return err("Unknown truck type.");
  if (t.price > balance(s.ledger, "cash") + 0.004) return err(`Not enough cash: need $${t.price.toFixed(2)}.`);
  const f = ensureFleet(s), k = { id: ++f.seq, type, name: `${t.name} ${f.seq}`, health: 100, status: "idle", busyUntil: 0, downDays: 0, cost: t.price, deprec: 0, km: 0, trips: 0 };
  f.trucks.push(k); post(s.ledger, s.day, `Bought ${k.name}`, [{ acct: "machinery", dr: t.price }, { acct: "cash", cr: t.price }], "truck:" + k.id);
  log(s, `Bought ${k.name} for $${t.price.toFixed(2)}. Hire a driver for it in HR.`); return ok({ truck: k });
}
export function serviceTruck(s, id) {
  const k = ensureFleet(s).trucks.find(x => x.id === Number(id)); if (!k) return err("Unknown truck.");
  if (k.status !== "idle") return err("A truck on the road or broken down cannot be serviced now.");
  const t = TRUCK[k.type]; if (t.serviceCost > balance(s.ledger, "cash") + 0.004) return err("Not enough cash.");
  k.health = D.TRANSPORT.restoreTo; k.busyUntil = s.day + 1; k.status = "idle";
  post(s.ledger, s.day, `Service of ${k.name}`, [{ acct: "maintenance", dr: t.serviceCost }, { acct: "cash", cr: t.serviceCost }], "tsvc:" + k.id + ":" + s.day); return ok();
}

// ---------- planning and dispatch ----------
// km: one-way distance. space: total storage space to carry. prep: days before the goods are ready. Returns what a trip would cost and how long it takes.
export function planTrip(s, { km, space, prep = 0 } = {}) {
  const f = ensureFleet(s); if (!f.trucks.length) return err("You have no trucks. Buy one in Shipping, Fleet.");
  const idle = idleTrucks(s).sort((a, b) => TRUCK[b.type].capacity - TRUCK[a.type].capacity); if (!idle.length) return err("All your trucks are busy or broken down.");
  if (driversFree(s) <= 0) return err("No free driver. Hire a driver in HR.");
  const used = []; let cap = 0, drivers = driversFree(s);
  for (const k of idle) { if (used.length >= drivers) break; used.push(k); cap += TRUCK[k.type].capacity; if (cap >= space) break; }
  const rounds = Math.max(1, Math.ceil(space / cap)), speed = Math.min(...used.map(k => TRUCK[k.type].speed)), oneWay = km / speed, load = D.TRANSPORT.loadDays;
  const days = Math.max(1, Math.ceil(prep + load + oneWay * (2 * rounds - 1) - 1e-9)), back = Math.max(days, Math.ceil(prep + load + oneWay * 2 * rounds - 1e-9));
  const fuel = c(used.reduce((a, k) => a + rounds * 2 * km * TRUCK[k.type].fuelPerKm, 0));
  return { ok: true, trucks: used.map(k => k.id), rounds, days, back, fuel, km, capacity: cap, errors: [] };
}
// Send the trucks. Pays fuel now, wears the trucks, may break one down. Returns the extra days the goods are delayed.
export function dispatch(s, plan, kind) {
  const f = ensureFleet(s); let delay = 0;
  for (const id of plan.trucks) {
    const k = f.trucks.find(x => x.id === id), t = TRUCK[k.type]; k.status = "out"; k.busyUntil = s.day + plan.back; k.km += plan.km * 2 * plan.rounds; k.trips += plan.rounds; f.km += plan.km * 2 * plan.rounds;
    const broke = k.health < D.TRANSPORT.breakdownBelow && streamNext(f) < D.TRANSPORT.breakdownChance;
    k.health = c(Math.max(0, k.health - t.wear * plan.rounds));
    if (broke) {
      const d = D.TRANSPORT.downMin + (streamNext(f) < 0.5 ? 0 : D.TRANSPORT.downMax - D.TRANSPORT.downMin), fee = c(t.serviceCost * D.TRANSPORT.repairMult);
      k.status = "down"; k.downDays = d; k.busyUntil = s.day + plan.back + d; delay = Math.max(delay, d); k.health = D.TRANSPORT.restoreTo - 20;
      payOut(s, "maintenance", fee, `Emergency repair of ${k.name} on the road`, "trepair:" + k.id + ":" + s.day); mailPost(s, { from: "Fleet manager", subject: `${k.name} broke down on the road`, body: `Repair $${fee.toFixed(2)}. The delivery is ${d} day(s) late. Service trucks before health drops below ${D.TRANSPORT.breakdownBelow}%.`, goto: ["shipping", "fleet"], level: "bad" }); log(s, `${k.name} broke down on the road. Repair $${fee.toFixed(2)}. The delivery is ${d} day(s) late.`);
    }
  }
  payOut(s, "delivery", plan.fuel, `Fuel for ${kind}`, "fuel:" + s.day + ":" + f.tripSeq); f.fuelPaid = c(f.fuelPaid + plan.fuel);
  f.trips.push({ id: ++f.tripSeq, day: s.day, kind, km: plan.km, trucks: plan.trucks.slice(), rounds: plan.rounds, fuel: plan.fuel, eta: s.day + plan.days + delay, delay }); if (f.trips.length > D.TRANSPORT.tripLog) f.trips.shift();
  return delay;
}
// Daily: trucks come home, broken trucks are repaired, depreciation is booked.
export function fleetDay(s) {
  const f = ensureFleet(s);
  for (const k of f.trucks) {
    const t = TRUCK[k.type], dep = c(Math.min(k.cost / t.life, k.cost - k.deprec));
    if (dep > 0) { post(s.ledger, s.day, `Depreciation ${k.name}`, [{ acct: "depreciation", dr: dep }, { acct: "acc_deprec", cr: dep }], "tdep:" + k.id + ":" + s.day); k.deprec = c(k.deprec + dep); }
    if (k.status === "down") { k.downDays--; if (k.downDays <= 0 && k.busyUntil <= s.day + 1) { k.status = "idle"; k.downDays = 0; } else if (k.downDays <= 0) k.status = "out"; }
    else if (k.status === "out" && k.busyUntil <= s.day + 1) k.status = "idle";
  }
}
