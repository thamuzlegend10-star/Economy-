// Market intelligence: a paid subscription that shows what the rival shops charge.
// Without it the rival price tables are locked. With it you pay a small fee each day. Games started before this existed (no s.intelFee) see the prices for free.
import { post, round2 } from "./ledger.js";
import { log } from "./engine.js";

const c = round2, err = error => ({ ok: false, error }), ok = (o = {}) => ({ ok: true, ...o });
export const INTEL = { fee: 15 };
export const ensureIntel = s => (s.intel = s.intel || { on: false, since: 0, paid: 0, days: 0 });
export const intelNeeded = s => !!s.intelFee;
// True when the rival prices may be shown.
export const intelActive = s => !intelNeeded(s) || ensureIntel(s).on;
export function subscribe(s) {
  if (s.ended) return err("The game is over."); if (!intelNeeded(s)) return err("This game shows rival prices for free.");
  const k = ensureIntel(s); if (k.on) return err("You already subscribe.");
  k.on = true; k.since = s.day; log(s, `Subscribed to market intelligence. It costs $${INTEL.fee} a day.`); return ok();
}
export function unsubscribe(s) {
  const k = ensureIntel(s); if (!k.on) return err("You do not subscribe."); k.on = false; log(s, "Cancelled market intelligence."); return ok();
}
// Each night: the day's fee. Paid from cash even if that overdraws, like other running costs.
export function intelDay(s) {
  if (!intelNeeded(s)) return; const k = ensureIntel(s); if (!k.on) return;
  post(s.ledger, s.day, "Market intelligence subscription", [{ acct: "marketing", dr: INTEL.fee }, { acct: "cash", cr: INTEL.fee }], "mkt:intel:" + s.day);
  k.paid = c(k.paid + INTEL.fee); k.days++;
}
