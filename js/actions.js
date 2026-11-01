// Button and field actions for the module screens. No DOM: takes the game state, the UI state and plain arguments, returns { ok, msg|error }.
// Keeping this apart from main.js means every screen action can be tested in Node.
import * as E from "./engine.js";
import * as D from "./data.js";
import * as F from "./factory.js";
import * as M from "./mrp.js";
import * as B from "./b2b.js";
import * as H from "./hr.js";
import * as K from "./market.js";
import * as Bk from "./bank.js";
import * as Kp from "./kpi.js";

export const newForms = () => ({ vendor: "agro", terms: "cod", rq: {}, bid: {}, mkt: { channel: "social", budget: 500, days: 7, cat: "all" }, loan: { kind: "equipment", amount: 10000, term: 60 }, credit: 10000, w: {}, farea: 250 });
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r = (res, msg) => (res && res.ok ? { ok: true, msg } : { ok: false, error: (res && res.error) || "Not possible." });

// Set a form field by dotted path. Numbers are stored as numbers when numeric is true.
export function setField(f, path, value, numeric = false) {
  const keys = path.split("."), last = keys.pop(); let o = f;
  for (const k of keys) o = o[k] = o[k] || {};
  o[last] = numeric ? num(value) : value; return { ok: true };
}
export const rawLines = f => { const v = F.VENDOR[f.vendor]; return Object.entries(f.rq).map(([rid, qty]) => ({ rid, qty: num(qty) })).filter(l => l.qty > 0 && (!v || v.sells.includes(l.rid))); };

export function act(s, f, name, a = {}) {
  const id = a.id, n = a.id != null && /^\d+$/.test(String(a.id)) ? Number(a.id) : a.id;
  switch (name) {
    // factory
    case "buyMachine": return r(F.buyMachine(s, { type: id }), "Machine bought and its operators hired.");
    case "rentFactory": return r(F.rentFactory(s, f.farea), "Factory space rented.");
    case "setjob": return r(F.setRun(s, { machine: n, juice: a.juice, qty: num(a.qty) }), a.qty > 0 ? "Production run set." : "Production stopped.");
    case "pm": return r(F.preventiveMaintenance(s, n), "Machine serviced.");
    case "prCreate": { const x = F.createPR(s, { vendor: f.vendor, terms: f.terms, lines: rawLines(f) }); return r(x, "Requisition created. Approve it to place the order."); }
    case "poNow": { const x = F.placeRawOrder(s, { vendor: f.vendor, terms: f.terms, lines: rawLines(f) }); if (x.ok) f.rq = {}; return r(x, `Ordered. Arrives day ${x.eta}.`); }
    case "prApprove": return r(F.approvePR(s, n), "Requisition approved and ordered.");
    case "prReject": return r(F.rejectPR(s, n), "Requisition rejected.");
    // MRP
    case "mrpAuto": M.ensureMrp(s).autoPO = !s.mrp.autoPO; return { ok: true, msg: s.mrp.autoPO ? "Auto purchasing is on." : "Auto purchasing is off." };
    case "mrpPlan": M.plan(s); return { ok: true, msg: "Plan refreshed." };
    case "mrpGen": { const x = M.generatePRs(s); return x.length ? { ok: true, msg: `${x.length} requisition${x.length > 1 ? "s" : ""} created.` } : { ok: false, error: "Nothing is short. No requisition needed." }; }
    case "mrpOrder": { const x = M.generatePRs(s, { approve: true }); const bad = x.find(y => y.error); return x.length ? (bad && !x.some(y => y.po) ? { ok: false, error: bad.error } : { ok: true, msg: `${x.filter(y => y.po).length} order(s) placed.` }) : { ok: false, error: "Nothing is short. No order needed." }; }
    // B2B
    case "bid": return r(B.placeBid(s, { tender: n, price: f.bid[n] }), "Bid placed. The result comes when the tender closes.");
    case "unbid": return r(B.withdrawBid(s, n), "Bid withdrawn.");
    case "accept": return r(B.acceptDeal(s, n), "Deal accepted. Deliver it from the Contracts tab.");
    case "deliver": return r(B.deliver(s, n), "Delivered and paid.");
    // HR
    case "hire": return r(H.hire(s, id, 1), "Hired.");
    case "fire": return r(H.fire(s, id, 1), "Let go.");
    case "wage": return r(H.setWageMult(s, a.value), "Wage level set.");
    case "training": return r(H.setTraining(s, a.value), "Training budget set.");
    // marketing
    case "mktStart": return r(K.startCampaign(s, { ...f.mkt }), "Campaign started.");
    case "mktStop": return r(K.stopCampaign(s, n), "Campaign stopped.");
    // e-commerce
    case "ecomOpen": return r(K.openWebstore(s), "The webstore is open.");
    case "ecomCat": { const e = K.ensureEcom(s), set = new Set(e.catalog); set.has(id) ? set.delete(id) : set.add(id); return r(K.setCatalog(s, [...set]), "Catalog updated."); }
    case "ecomPrice": { const e = K.ensureEcom(s), p = E.PRODUCT[id] || F.JUICE[id]; return r(K.setWebPrice(s, id, (e.prices[id] || p.ref) + num(a.dir) * p.step), "Price changed."); }
    case "ecomAds": return r(K.setAdBudget(s, a.value), "Ad budget set.");
    // banking
    case "credDraw": return r(Bk.drawCredit(s, f.credit), "Drawn from the credit line.");
    case "credRepay": return r(Bk.repayCredit(s, f.credit), "Credit line repaid.");
    case "loan": return r(Bk.takeLoan(s, { kind: f.loan.kind, amount: f.loan.amount, termDays: f.loan.kind === "long" ? 365 : f.loan.term }), "Loan paid out.");
    // scoring
    case "weights": return r(Kp.setWeights(s, f.w), "Weights saved.");
    case "weightsReset": f.w = {}; return r(Kp.setWeights(s, Object.fromEntries(D.KPIS.map(k => [k.id, k.weight]))), "Default weights restored.");
  }
  return { ok: false, error: "Unknown action." };
}
