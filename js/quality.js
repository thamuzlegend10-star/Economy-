// Delivery quality checks and damaged goods.
// A supplier delivery can arrive with some units damaged. How often, and how badly, follows the supplier's reliability: a poor supplier ships more broken
// boxes. Each delivery draws from its own random stream, so this never moves the other dice in the game.
// With inspection ON (a small fee per delivery) the damaged units are set aside and held as a claim. You can send them back for a credit, or write them
// off. A claim left open for a few days lapses and is written off. With inspection OFF there is no fee, but the damage is only found when the stock is put
// out, and that loss cannot be claimed.
// Only games started with this feature have it (s.qcOn), so older saves play as before.
import { post, round2 } from "./ledger.js";
import { streamNext, seedFrom } from "./rng.js";
import { SUPPLIER } from "./engine.js";
import { mailPost } from "./mail.js";

const c = round2, err = error => ({ ok: false, error }), ok = (o = {}) => ({ ok: true, ...o });
export const QC = { fee: 25, claimDays: 3, chanceMult: 2, minShare: 0.05, maxShare: 0.2, keep: 40 };
export const newQc = seed => ({ rng: seedFrom(seed, 0x9c1e), inspect: true, seq: 0, lots: [], stat: {}, fees: 0, claimed: 0, refunded: 0, lost: 0, lostUnclaimable: 0, log: [] });
export const ensureQc = s => (s.qc = s.qc || newQc(s.seed));
const statOf = (k, sup) => (k.stat[sup] = k.stat[sup] || { deliveries: 0, bad: 0, units: 0, badUnits: 0 });
// Chance a delivery has damage, and the share of units hit when it does.
export const damageChance = sup => Math.min(0.5, Math.max(0, 1 - (SUPPLIER[sup] ? SUPPLIER[sup].reliability : 1)) * QC.chanceMult);
export const expectedRate = sup => damageChance(sup) * (QC.minShare + QC.maxShare) / 2;
// The part of the price the supplier gives back when you return damaged goods. Better suppliers are fairer about it.
export const recoverShare = sup => Math.min(1, Math.max(0.4, 0.5 + ((SUPPLIER[sup] ? SUPPLIER[sup].reliability : 0.8) - 0.8) * 2.5));
export const toggleInspect = (s, on) => { if (!s.qcOn) return err("This game has no quality checks."); ensureQc(s).inspect = !!on; return ok(); };

// Called as a supplier order arrives. Returns what to book: units and value that did not arrive in good shape.
export function screen(s, o) {
  if (!s.qcOn || o.kind === "transfer" || !SUPPLIER[o.sup]) return null;
  const k = ensureQc(s), st = statOf(k, o.sup); st.deliveries++; st.units += o.qty;
  const hit = streamNext(k) < damageChance(o.sup), share = QC.minShare + streamNext(k) * (QC.maxShare - QC.minShare);
  if (!hit) return { units: 0, value: 0, inspect: k.inspect };
  const units = Math.min(o.qty, Math.max(1, Math.round(o.qty * share))), value = units >= o.qty ? o.goods : c(o.goods * units / o.qty);
  st.bad++; st.badUnits += units;
  return { units, value, inspect: k.inspect };
}
export const inspectionFee = s => (s.qcOn && ensureQc(s).inspect ? QC.fee : 0);

// Books the arrival. Called from the engine; returns the units and value that go into stock.
export function receive(s, o, dst) {
  const dm = screen(s, o), k = s.qcOn ? ensureQc(s) : null;
  let units = 0, value = 0;
  if (k && k.inspect) { post(s.ledger, s.day, `Quality check, delivery #${o.id}`, [{ acct: "delivery", dr: QC.fee }, { acct: "cash", cr: QC.fee }], "deliv:qcfee:" + o.id); k.fees = c(k.fees + QC.fee); }
  if (dm && dm.units > 0) { units = dm.units; value = dm.value; }
  const goodValue = c(o.goods - value);
  const lines = [{ acct: "inventory", dr: goodValue }, { acct: "transit", cr: o.goods }];
  if (value > 0) lines.splice(1, 0, k.inspect ? { acct: "claims", dr: value } : { acct: "shrinkage", dr: value });
  post(s.ledger, s.day, `Delivery #${o.id} from ${SUPPLIER[o.sup].name}${o.dest === "wh" ? " to the warehouse" : ""}`, lines.filter(l => (l.dr || l.cr) > 0), "order:" + o.id);
  if (units > 0) {
    const name = o.pname || o.pid;
    if (k.inspect) {
      k.lots.push({ id: ++k.seq, order: o.id, sup: o.sup, pid: o.pid, qty: units, value, day: s.day });
      mailPost(s, { from: SUPPLIER[o.sup].name, subject: `Damaged goods in order #${o.id}`, body: `${units} units of ${name} arrived broken, worth ${value.toFixed(2)} dollars. They are held apart. Send them back within ${QC.claimDays} days for a credit, or write them off.`, goto: ["retail", "quality"] });
    } else {
      k.lost = c(k.lost + value); k.lostUnclaimable = c(k.lostUnclaimable + value);
      mailPost(s, { from: "Shelf staff", subject: `Broken stock found from order #${o.id}`, body: `${units} units of ${name} were broken when put out, worth ${value.toFixed(2)} dollars. You did not inspect this delivery, so the supplier will not take them back.`, goto: ["retail", "quality"] });
    }
  }
  return { qty: o.qty - units, value: goodValue, damaged: units };
}

export const openLots = s => (s.qcOn ? ensureQc(s).lots.slice() : []);
function closeLot(s, lot, memo, lines, ref) { const k = ensureQc(s); post(s.ledger, s.day, memo, lines, ref); k.lots = k.lots.filter(x => x.id !== lot.id); k.log.unshift({ day: s.day, ...lot }); if (k.log.length > QC.keep) k.log.length = QC.keep; }
export function claim(s, id) {
  const k = ensureQc(s), lot = k.lots.find(x => x.id === Number(id)); if (!lot) return err("That claim is no longer open.");
  const back = c(lot.value * recoverShare(lot.sup)), rest = c(lot.value - back);
  closeLot(s, { ...lot, how: "returned", back }, `Returned damaged goods (order #${lot.order}) to ${SUPPLIER[lot.sup].name}`, [{ acct: "cash", dr: back }, ...(rest > 0 ? [{ acct: "shrinkage", dr: rest }] : []), { acct: "claims", cr: lot.value }].filter(l => (l.dr || l.cr) > 0), "deliv:qcclaim:" + lot.id);
  k.claimed += lot.qty; k.refunded = c(k.refunded + back); k.lost = c(k.lost + rest); return ok({ back, rest });
}
export function writeOff(s, id, how = "written off") {
  const k = ensureQc(s), lot = k.lots.find(x => x.id === Number(id)); if (!lot) return err("That claim is no longer open.");
  closeLot(s, { ...lot, how, back: 0 }, `Damaged goods ${how} (order #${lot.order})`, [{ acct: "shrinkage", dr: lot.value }, { acct: "claims", cr: lot.value }], "deliv:qcloss:" + lot.id);
  k.lost = c(k.lost + lot.value); return ok({ value: lot.value });
}
// Each night: claims past their window lapse.
export function qcDay(s) {
  if (!s.qcOn) return; const k = ensureQc(s);
  for (const lot of k.lots.slice()) if (s.day - lot.day >= QC.claimDays) writeOff(s, lot.id, "lapsed");
}
export const summary = s => { const k = ensureQc(s); return { inspect: k.inspect, open: k.lots.length, openValue: c(k.lots.reduce((a, l) => a + l.value, 0)), fees: k.fees, claimed: k.claimed, refunded: k.refunded, lost: k.lost }; };
export const supplierRows = s => Object.entries(ensureQc(s).stat).map(([id, v]) => ({ id, name: SUPPLIER[id] ? SUPPLIER[id].name : id, ...v, rate: v.units ? v.badUnits / v.units : 0, expected: expectedRate(id), recover: recoverShare(id) })).sort((a, b) => b.rate - a.rate);
