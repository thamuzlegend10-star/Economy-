// Button and field actions for the module screens. No DOM: takes the game state, the UI state and plain arguments, returns { ok, msg|error }.
// Keeping this apart from main.js means every screen action can be tested in Node.
import * as E from "./engine.js";
import * as D from "./data.js";
import * as F from "./factory.js";
import * as M from "./mrp.js";
import * as B from "./b2b.js";
import * as H from "./hr.js";
import * as St from "./stock.js";
import * as Qc from "./quality.js";
import * as Sv from "./services.js";
import * as Br from "./branch.js";
import * as K from "./market.js";
import * as Bk from "./bank.js";
import * as Kp from "./kpi.js";
import * as Fc from "./forecast.js";
import * as Fl from "./fleet.js";
import * as Ml from "./mail.js";
import * as Js from "./juiceshop.js";
import * as Sn from "./scenario.js";

export const newForms = () => ({ fsite: "main", vendor: "agro", terms: "cod", rq: {}, bid: {}, br: { location: "", area: 80 }, tg: {}, iv: "retail", sq: {}, mkt: { channel: "social", budget: 500, days: 7, cat: "all", demo: "all" }, loan: { kind: "equipment", amount: 10000, term: 60 }, credit: 10000, w: {}, farea: 250, jm: {}, jcarrier: "hired", ev: { kind: "demand", mult: 1.2, days: 7, title: "" }, team: "", carrier: "hired", tempDays: 14, gl: "all", q: { juice: "apple", qty: 1000 } });
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
    case "buyMachine": return r(F.buyMachine(s, { type: id, site: f.fsite }), "Machine bought and its operators hired.");
    case "rentFactory": return r(F.rentFactory(s, f.farea, f.fsite), "Factory space rented.");
    case "qadd": return r(F.queueBatch(s, { machine: n, juice: f.q.juice, qty: f.q.qty }), "Batch queued.");
    case "qdrop": return r(F.dropBatch(s, { machine: n, id: a.batch }), "Batch removed.");
    case "advBuy": { const x = Fc.retailAdvice(s, id); if (!x.qty) return { ok: false, error: "No purchase is advised for this product right now." }; const o = E.placeOrders(s, { supplier: x.supplier, lines: [{ pid: id, qty: x.qty }] }); return r(o, `Ordered ${x.qty.toLocaleString("en-US")}. Arrives day ${o.eta}.`); }
    case "advMake": { const x = Fc.juiceAdvice(s, id); if (!x.qty) return { ok: false, error: "No production is advised for this juice right now." }; const ms = s.fx.machines.slice().sort((p, q) => F.batchDaysLeft(s, p) - F.batchDaysLeft(s, q)); if (!ms.length) return { ok: false, error: "Buy a machine first." }; return r(F.queueBatch(s, { machine: ms[0].id, juice: id, qty: x.qty }), `Queued ${x.qty.toLocaleString("en-US")} on ${ms[0].name}.`); }
    case "setjob": return r(F.setRun(s, { machine: n, juice: a.juice, qty: num(a.qty) }), a.qty > 0 ? "Production run set." : "Production stopped.");
    case "pm": return r(F.preventiveMaintenance(s, n), "Machine serviced.");
    case "prCreate": { const x = F.createPR(s, { vendor: f.vendor, terms: f.terms, carrier: f.carrier, lines: rawLines(f) }); return r(x, "Requisition created. Approve it to place the order."); }
    case "poNow": { const x = F.placeRawOrder(s, { vendor: f.vendor, terms: f.terms, carrier: f.carrier, lines: rawLines(f) }); if (x.ok) f.rq = {}; return r(x, `Ordered. Arrives day ${x.eta}.`); }
    case "prApprove": return r(F.approvePR(s, n), "Requisition approved and ordered.");
    case "prReject": return r(F.rejectPR(s, n), "Requisition rejected.");
    case "buyTruck": return r(Fl.buyTruck(s, { type: id }), "Truck bought. Hire a driver in HR.");
    case "svcTruck": return r(Fl.serviceTruck(s, n), "Truck serviced.");
    case "jprice": return r(Js.adjustJuicePrice(s, id, num(a.dir)), "Price changed.");
    case "jmove": { const x = Js.moveJuice(s, { carrier: f.jcarrier, lines: D.JUICES.map(j => ({ jid: j.id, qty: num(f.jm[j.id]) })) }); if (x.ok) f.jm = {}; return r(x, `Sent to the shop. Arrives day ${x.eta}.`); }
    case "mailRead": return r(Ml.markRead(s, id), "Marked read.");
    case "mailAll": return r(Ml.markRead(s, "all"), "All marked as read.");
    case "mailClear": return r(Ml.clearMail(s), "Inbox cleared.");
    case "evGo": return r(Sn.inject(s, f.ev), "Event announced to the players.");
    case "evStop": return r(Sn.stopEvent(s, n), "Event stopped.");
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
    case "hire": return r(H.hire(s, id, 1), "Hired. Recruitment fee paid.");
    case "hirePick": { const [role, idx] = String(id).split(":"); const x = H.hireCandidate(s, role, idx); return r(x, x.ok ? `Hired ${x.name}. Recruitment fee paid.` : ""); }
    case "hireTemp": return r(H.hire(s, id, 1, "temp", Number(f.tempDays) || 14), "Temp hired for the contract period.");
    case "fire": return r(H.fire(s, id, 1), "Let go.");
    case "wage": return r(H.setWageMult(s, a.value), "Wage level set.");
    case "payday": return r(H.setPayday(s, a.value), "Payday set.");
    case "training": return r(H.setTraining(s, a.value), "Training budget set.");
    // marketing
    case "mktStart": return r(K.startCampaign(s, { ...f.mkt }), "Campaign started.");
    case "mktStop": return r(K.stopCampaign(s, n), "Campaign stopped.");
    case "qcInspect": return r(Qc.toggleInspect(s, String(id) === "1"), String(id) === "1" ? "Inspection on." : "Inspection off.");
    case "qcClaim": { const x = Qc.claim(s, id); return r(x, x.ok ? `Sent back. Credit ${x.back.toFixed(2)} dollars.` : ""); }
    case "qcWriteOff": return r(Qc.writeOff(s, id), "Written off.");
    case "stockTake": { const x = St.stockTake(s); return r(x, x.ok ? (x.found.length ? `Counted: ${x.total.toFixed(2)} dollars of stock was missing.` : "Counted: nothing missing.") : ""); }
    case "svcQuote": { const rq = Sv.ensureSvc(s).rfqs.find(x => x.id === Number(id)); if (!rq) return r(null); const m = Number((f.sq || {})[id]) || 100; const x = Sv.sendQuote(s, id, Sv.marketPrice(rq) * m / 100); return r(x, x.ok ? `Quote sent. Chance to win about ${Math.round(x.chance * 100)}%. The client answers tomorrow.` : ""); }
    case "svcUp": return r(Sv.moveJob(s, id, -1), "");
    case "svcDown": return r(Sv.moveJob(s, id, 1), "");
    case "svcSort": return r(Sv.sortByDeadline(s), "Ordered by deadline.");
    // branch shops
    case "branchOpen": return r(Br.openBranch(s, { location: f.br.location && Br.sites(s).some(x => x.id === f.br.location) ? f.br.location : Br.defaultSite(s), area: f.br.area }), "Branch opened.");
    case "branchClose": return r(Br.closeBranch(s, n), "Branch closed.");
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
    case "glPage": f.glp = Math.max(0, (f.glp || 0) + num(a.dir)); return { ok: true, msg: "" };
    case "targets": return r(Kp.setTargets(s, f.tg || {}), "Targets saved.");
    case "targetsClear": f.tg = {}; return r(Kp.setTargets(s, {}), "Targets cleared.");
    case "targetsPreset": { const p = Kp.presetTargets(s, id); if (!p) return r(null); f.tg = { ...p }; return r(Kp.setTargets(s, p), "Targets set."); }
    case "weightsReset": f.w = {}; return r(Kp.setWeights(s, Object.fromEntries(D.KPIS.map(k => [k.id, k.weight]))), "Default weights restored.");
  }
  return { ok: false, error: "Unknown action." };
}
