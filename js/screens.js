// Screens for the extra modules: factory, purchasing, MRP, B2B, HR, marketing, e-commerce, bank, statements and scoring.
// Pure functions of the game state and the form state. Buttons carry data-act; fields carry data-f. See actions.js.
import * as E from "./engine.js";
import * as D from "./data.js";
import * as F from "./factory.js";
import * as Fl from "./fleet.js";
import * as M from "./mrp.js";
import * as B from "./b2b.js";
import * as H from "./hr.js";
import * as K from "./market.js";
import * as Bk from "./bank.js";
import * as Kp from "./kpi.js";
import { balance, totals, ACCOUNTS, OPEX, round2 } from "./ledger.js";
import { esc, money, money2, num } from "./ui.js";
import { rawLines } from "./actions.js";
import * as Fc from "./forecast.js";
import * as Ac from "./accounting.js";
import * as Bi from "./bi.js";
import * as Ml from "./mail.js";
import * as Sn from "./scenario.js";

const pct = n => Math.round(n * 100) + "%", dec = (n, d = 1) => Number(n).toFixed(d);
const cls = n => (n < 0 ? "neg" : n > 0 ? "pos" : "");
const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(label)}</option>`;
const sel = (path, options, cur, numeric = true, extra = "") => `<select data-f="${path}" ${numeric ? 'data-num="1"' : ""} ${extra}>${options.map(([v, l]) => opt(v, l, cur)).join("")}</select>`;
const btn = (act, label, { id, dis, ghost, mini = true, arg = "" } = {}) => `<button class="${ghost ? "ghost " : ""}${mini ? "mini" : ""}" data-act="${act}" ${id != null ? `data-id="${esc(id)}"` : ""} ${arg} ${dis ? "disabled" : ""}>${label}</button>`;
const kv = rows => `<div class="kv1">${rows.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join("")}</div>`;
const head = (title, sub = "") => `<div class="shophead"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`;
const chip = (t, k = "") => `<span class="chip ${k}">${esc(t)}</span>`;
const meter = (v, warn) => `<div class="meter ${warn || ""}"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div>`;
const itemName = id => (E.PRODUCT[id] || F.JUICE[id] || { name: id }).name;
const stat = (label, value, sub = "", c = "") => `<div class="stat"><small>${label}</small><b class="${c}">${value}</b>${sub ? `<small class="sub">${sub}</small>` : ""}</div>`;

// ================= FACTORY =================
export function factoryMachines(s, f = { farea: 250, q: { juice: "apple", qty: 1000 } }) {
  const fx = F.ensureFactory(s), jq = [0, 25, 50, 75, 100];
  const types = D.MACHINES.map(t => { const q = F.quoteMachine(s, t.id);
    return `<div class="card">${head(t.name, `${num(t.perDay)} bottles / day`)}${kv([["Price + setup", money(t.price + t.setup)], ["Depreciation", money2((t.price + t.setup) / t.life) + " / day"], ["Operators needed", t.operators], ["Wear", dec(t.wear) + " health / day"], ["Service", money(t.pmCost)]])}
      ${btn("buyMachine", "Buy machine", { id: t.id, dis: !q.ok, mini: false })}${q.ok ? "" : `<small class="note warnc">${esc(q.errors[0])}</small>`}</div>`; }).join("");
  const own = fx.machines.map(m => { const t = F.MACHINE[m.type], j = m.job ? m.job.juice : "", pc = m.job ? Math.round(m.job.qty / t.perDay * 100) : 0, st = m.status;
    return `<div class="card"><div class="shophead"><b>${esc(m.name)}</b>${chip(st, st === "running" ? "ok" : st === "broken" ? "bad" : "")}</div>
      <small>Health ${dec(m.health, 0)}% · efficiency ${pct(F.machineEfficiency(m))}${m.downDays ? ` · down ${m.downDays} more day${m.downDays > 1 ? "s" : ""}` : ""}</small>${meter(m.health, m.health < 30 ? "full" : m.health < 60 ? "warn" : "")}
      <div class="two"><label class="fld"><span>Makes</span><select id="mj-${m.id}-juice" data-mj="${m.id}"><option value="">Nothing</option>${D.JUICES.map(x => opt(x.id, x.name, j)).join("")}</select></label>
        <label class="fld"><span>Share of capacity</span><select id="mj-${m.id}-qty" data-mj="${m.id}">${jq.map(x => opt(x, x + "%", pc)).join("")}</select></label></div>
      <div class="row">${btn("pm", `Service · ${money(t.pmCost)}`, { id: m.id, ghost: true, dis: m.downDays > 0 })}<small class="muted">Stops about ${Math.round(t.pmDays * 24)} h, restores health</small></div>
      ${queueHtml(s, m, f)}</div>`; }).join("");
  const fg = D.JUICES.map(j => `<tr><td class="l"><span class="dot" style="background:${j.color}"></span> ${esc(j.name.replace(" (1 L)", ""))}</td><td>${num((fx.today && fx.today.made[j.id]) || 0)}</td><td>${num(fx.fg.qty[j.id])}</td><td>${fx.fg.qty[j.id] ? money2(fx.fg.val[j.id] / fx.fg.qty[j.id]) : "-"}</td></tr>`).join("");
  const cw = H.crew(s);
  const fa = F.ensureFactory(s).area, room = D.FACTORY.maxArea - fa;
  const building = `<div class="card">${head("Factory building", fa ? num(fa) + " m²" : "not rented")}${kv([["Rent", `${money2(F.factoryRentPerM2(s))} / m² / day`], ["Utilities", `${money2(D.FACTORY.utilitiesPerM2)} / m² / day`], ["Floor space used", `${num(F.machineSpace(s))} of ${num(fa)} m²`], ["Running cost", money2(F.factoryRent(s) + F.factoryUtilities(s)) + " / day"]])}
      <div class="row">${sel("farea", D.FACTORY.areaSteps.filter(x => x <= room || !room).map(x => [x, x + " m²"]), f.farea)}${btn("rentFactory", fa ? "Rent more" : "Rent factory", { dis: room <= 0, mini: false })}</div>
      <small class="muted">Machines need floor space. Wages, rent and utilities of a day that made goods are added to the cost of those goods. On an idle day they are an expense.</small></div>`;
  return `${building}<div class="card">${head("Factory", "Bottles juice from raw materials")}<small class="muted">Each bottle needs the recipe's raw materials. Machines lose health as they run. Below ${D.MAINT.breakdownBelow}% they can break down: emergency repair costs ${D.MAINT.emergencyMult}× and the line stops 1 to 2 days. Operators come with the machine; with too few, output drops.</small>
      ${kv([["Operators", `${num(s.hr.staff.factory.n)} of ${num(H.operatorsNeeded(s))}`], ["Crew output", pct(cw.out)], ["Goods in storage", num(F.fgSpace(s)) + " space"]])}</div>
    ${own || `<div class="card"><small class="muted">You have no machines yet. Buy one below.</small></div>`}
    <div class="card scroll"><table class="tbl fixed"><thead><tr><th class="l">Juice</th><th>Made today</th><th>In stock</th><th>Cost each</th></tr></thead><tbody>${fg}</tbody></table></div>
    <div class="tcos">${types}</div>`;
}

function queueHtml(s, m, f) {
  const q = m.queue || [], rows = q.map((b, i) => `<div class="qrow"><div class="row"><b>${i === 0 ? "Now" : "#" + (i + 1)}: ${num(b.qty)} ${esc(F.JUICE[b.juice].name.replace(" (1 L)", ""))}</b>${btn("qdrop", "Remove", { id: m.id, ghost: true, arg: `data-batch="${b.id}"` })}</div>${meter(b.done / b.qty * 100)}<small class="muted">${num(b.done)} of ${num(b.qty)} made</small></div>`).join("");
  return `<div class="qbox"><small class="muted">Production queue${q.length ? ` · about ${F.batchDaysLeft(s, m)} day(s) of work` : " · empty, the standing run above is used"}</small>${rows}
    <div class="row">${sel("q.juice", D.JUICES.map(j => [j.id, j.name.replace(" (1 L)", "")]), f.q.juice, false)}${sel("q.qty", [500, 1000, 3000, 5000, 10000].map(x => [x, num(x)]), f.q.qty)}${btn("qadd", "Queue batch", { id: m.id, dis: q.length >= F.QUEUE_MAX })}</div></div>`;
}
export function factoryRaw(s, f) {
  const fx = F.ensureFactory(s), v = F.VENDOR[f.vendor], inc = F.rawIncoming(s), per = M.demandPerDay(s);
  const stockRows = D.RAW.map(r => `<tr><td class="l"><span class="dot" style="background:${r.color}"></span> ${esc(r.name)}</td><td>${num(fx.raw.qty[r.id])} ${r.unit}</td><td>${num(inc[r.id])}</td><td>${per[r.id] ? num(per[r.id]) : "-"}</td></tr>`).join("");
  const qtys = [[0, "None"], ...[100, 500, 1000, 5000, 10000, 50000].map(x => [x, num(x)])];
  const lines = v.sells.map(rid => `<div class="poline"><div class="poname"><b>${esc(F.RAWM[rid].name)}</b><small>${money2(F.RAWM[rid].cost * v.price)} per ${F.RAWM[rid].unit}</small></div>${sel("rq." + rid, qtys, f.rq[rid] || 0)}</div>`).join("");
  const ls = rawLines(f).filter(l => v.sells.includes(l.rid)), q = ls.length ? F.quoteRaw(s, { vendor: f.vendor, terms: f.terms, carrier: f.carrier, lines: ls }) : null;
  const sum = !q ? `<small class="muted">Choose a quantity for at least one material.</small>` : q.error ? `<div class="err">${esc(q.error)}</div>` : `<div class="quote">${q.lines.map(l => `<div class="ln"><span>${esc(F.RAWM[l.rid].name)} ${num(l.qty)}</span><b>${money2(l.goods)}</b></div>`).join("")}
      <div class="ln"><span>Freight, paid now</span><b>${money2(q.ship)}</b></div><div class="ln tot"><span>Goods ${q.dueDays ? `(pay on day ${s.day + q.dueDays + 0})` : "(pay now)"}</span><b>${money2(q.goods)}</b></div>
      <div class="ln"><span>Arrives</span><b>day ${q.eta}</b></div></div>${q.errors.map(e => `<div class="err">${esc(e)}</div>`).join("")}`;
  const prs = fx.prs.slice(-6).reverse().map(p => `<div class="kv1"><div><span>Requisition #${p.id} · ${esc(F.VENDOR[p.spec.vendor].name)}</span><b>${money(p.estimate)} · ${p.status}</b></div></div>${p.status === "pending" ? `<div class="row">${btn("prApprove", "Approve", { id: p.id })}${btn("prReject", "Reject", { id: p.id, ghost: true })}</div>` : ""}`).join("");
  const pos = fx.pos.map(p => `<div class="kv1"><div><span>Order #${p.id} · ${esc(F.VENDOR[p.vendor].name)} · ${F.TERM[p.terms].name}</span><b>arrives day ${p.eta}${p.delayed ? " (late)" : ""}</b></div></div>`).join("");
  const due = fx.payables.map(p => `<div class="kv1"><div><span>Invoice for order #${p.po}</span><b>${money2(p.amount)} due day ${p.due}</b></div></div>`).join("");
  return `<div class="card">${head("Raw materials", "Stored in your warehouse")}<div class="scroll"><table class="tbl fixed"><thead><tr><th class="l">Material</th><th>In stock</th><th>On the way</th><th>Need / day</th></tr></thead><tbody>${stockRows}</tbody></table></div></div>
    <div class="card">${head("Raw purchase", "Requisition, then order")}
      <label class="fld"><span>Vendor</span>${sel("vendor", D.RAW_VENDORS.map(x => [x.id, `${x.name} · ${pct(x.reliability)} on time`]), f.vendor, false)}</label>
      <label class="fld"><span>Payment terms</span>${sel("terms", D.TERMS.map(t => [t.id, t.name + (t.price > 1 ? ` · +${dec((t.price - 1) * 100)}% price` : "")]), f.terms, false)}</label>
      <label class="fld"><span>Carrier</span>${sel("carrier", [["hired", "Vendor delivery"], ["own", `My own trucks (${Fl.ensureFleet(s).trucks.length})`]], f.carrier || "hired", false)}</label>${lines}${sum}<div class="row">${btn("prCreate", "Create requisition", { ghost: true, dis: !q || !!q.error, mini: false })}${btn("poNow", "Order now", { dis: !q || !!q.error || !q.ok, mini: false })}</div></div>
    ${prs || pos || due ? `<div class="card">${head("Open items")}${prs}${pos}${due}</div>` : ""}`;
}

export function factoryMrp(s) {
  const m = M.ensureMrp(s), p = M.plan(s), any = p.rows.some(r => r.qty > 0), mach = F.ensureFactory(s).machines.length;
  const rows = p.rows.map(r => `<tr><td class="l">${esc(F.RAWM[r.rid].name)}</td><td>${num(r.perDay)}</td><td>${num(r.onHand + r.incoming)}</td><td>${r.ss ? num(r.ss) : "-"}</td><td class="${r.qty ? "warnc" : ""}">${r.qty ? num(r.qty) : "-"}${r.limited ? "*" : ""}</td></tr>`).join("");
  return `<div class="card">${head("Material requirements planning", `${D.MRP.horizonDays} days ahead`)}<small class="muted">Adds up what your machines will use and what your B2B contracts still need, subtracts stock and orders on the way, and suggests lot sizes from the best vendor. Safety stock covers late deliveries. * means the warehouse has no room for more.</small>
    <div class="row">${btn("mrpAuto", m.autoPO ? "Auto purchasing: ON" : "Auto purchasing: OFF", { ghost: !m.autoPO })}<small class="muted">Orders on Net 7 terms each morning</small></div></div>
    <div class="card scroll"><table class="tbl fixed"><thead><tr><th class="l">Material</th><th>Use / day</th><th>Have + coming</th><th>Safety</th><th>Suggest</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${mach ? "" : `<small class="note warnc">Buy a machine and set a production run first. Then the plan has something to plan for.</small>`}
    <div class="row">${btn("mrpPlan", "Refresh plan", { ghost: true, mini: false })}${btn("mrpGen", "Make requisitions", { ghost: true, dis: !any, mini: false })}${btn("mrpOrder", "Order all", { dis: !any, mini: false })}</div>`;
}

// ================= B2B =================
const buyer = id => (D.B2B.buyers.find(b => b.id === id) || { name: id }).name;
export function b2bMarket(s, f) {
  const b = B.ensureB2B(s);
  const card = t => { const have = B.available(s, t.pid), isFixed = t.kind === "fixed", cur = t.bid;
    return `<div class="card">${head(buyer(t.buyer), isFixed ? "Fixed deal" : "Tender")}<b>${num(t.qty)} × ${esc(itemName(t.pid))}</b>
      ${kv([[isFixed ? "Fixed price" : "Ceiling price", money2(isFixed ? t.price : t.ceiling) + " each"], ["Deliver by", "day " + t.due], [isFixed ? "Offer ends" : "Bids close", "day " + t.closes], ["Late penalty", pct(t.penalty)], ["Stock you could ship", num(have)]])}
      ${isFixed ? `<div class="row">${btn("accept", `Accept · ${money(t.qty * t.price)}`, { id: t.id, mini: false })}</div>` :
        `<div class="row"><input type="number" inputmode="decimal" step="0.01" min="0.01" max="${t.ceiling}" placeholder="Your price" value="${cur ?? f.bid[t.id] ?? ""}" data-f="bid.${t.id}" data-num="1" aria-label="Your bid per unit">${btn("bid", cur != null ? "Change bid" : "Place bid", { id: t.id })}${cur != null ? btn("unbid", "Withdraw", { id: t.id, ghost: true }) : ""}</div>${cur != null ? `<small class="note">Your bid: ${money2(cur)} each</small>` : ""}`}</div>`; };
  return `<div class="card">${head("B2B market", "Institutional buyers")}${kv([["Reputation", dec(b.rep, 0) + " / 100"], ["On-time record", b.ontime + b.late ? pct(B.reliabilityOf(b)) : "no history"], ["Tenders won / lost", `${b.won} / ${b.lost}`], ["Sales team edge", "+" + dec(H.salesEdge(s) * 100) + " pts"]])}
      <small class="muted">Winner is chosen on price, reputation and delivery record. A sales team helps. Bids close ${D.B2B.openDays} days after a tender opens.</small></div>
    ${b.open.length ? b.open.map(card).join("") : `<div class="card"><small class="muted">No open tenders right now. New ones appear most days.</small></div>`}`;
}
export function b2bContracts(s) {
  const b = B.ensureB2B(s);
  const act = b.active.map(k => { const q = B.quoteDelivery(s, k.id), late = s.day > k.due;
    return `<div class="card">${head(buyer(k.buyer), late ? `${k.lateDays} day(s) late` : "Contract")}<b>${num(k.qty)} × ${esc(itemName(k.pid))}</b>${kv([["Price", money2(k.price) + " each"], ["Worth", money(k.qty * k.price)], ["Deliver by", "day " + k.due], ["Stock", `${num(B.available(s, k.pid))} ${E.PRODUCT[k.pid] ? "in warehouse" : "at factory"}`]])}
      ${late ? `<small class="note warnc">Fined ${money2(k.fined)} so far. Cancelled after 5 days late.</small>` : ""}${q.ok ? "" : `<small class="muted">${esc(q.errors[0])}</small>`}${btn("deliver", `Deliver · ${money(q.value || k.qty * k.price)}`, { id: k.id, dis: !q.ok, mini: false })}</div>`; }).join("");
  const hist = b.history.slice(-10).reverse().map(h => `<tr><td>${h.day}</td><td class="l">${esc(buyer(h.buyer).split(" ")[0])}</td><td class="l">${esc(h.result)}</td><td>${h.revenue ? money(h.revenue) : h.penaltyPaid ? "-" + money(h.penaltyPaid) : "-"}</td></tr>`).join("");
  return `${act || `<div class="card"><small class="muted">No contracts yet. Win a tender or accept a fixed deal in the market.</small></div>`}
    ${hist ? `<div class="card scroll"><table class="tbl fixed"><thead><tr><th>Day</th><th class="l">Buyer</th><th class="l">Result</th><th>Money</th></tr></thead><tbody>${hist}</tbody></table></div>` : ""}`;
}

// ================= HR =================
export function hrScreen(s, f = {}) {
  const h = H.ensureHr(s), pay = H.dailyPayroll(s), td = f.tempDays || 14;
  const rows = D.HR_ROLES.map(r => { const st = h.staff[r.id], need = H.needOf(s, r.id), tmp = H.tempN(s, r.id), cost = H.wageOf(s, r.id) * (st.n + tmp * D.HR.tempPremium), gap = need ? st.n - need : 0;
    return `<div class="card"><div class="shophead"><b>${esc(r.name)}</b><small>${money2(H.wageOf(s, r.id))} / person / day</small></div><small class="muted">${esc(r.note)}</small>
      <div class="row"><b class="bigno">${st.n}</b><small class="muted">${need ? `need ${need}${gap < 0 ? ` · short ${-gap}` : ""}` : "no fixed need"}${tmp ? ` · ${tmp} temp` : ""} · skill ${dec(st.skill, 2)} · ${money(cost)} / day</small></div>
      <div class="row">${btn("hire", `Hire +1 · fee ${money(H.recruitFee(s, r.id))}`, { id: r.id })}${btn("hireTemp", `Temp +1 (${td} d)`, { id: r.id, ghost: true })}${btn("fire", `Let go -1 · ${money(H.wageOf(s, r.id) * D.HR.severanceDays)}`, { id: r.id, ghost: true, dis: !H.permN(s, r.id) })}</div></div>`; }).join("");
  const w = D.HR.wageMult, t = D.HR.trainingBudget, wopts = [0.6, 0.8, 1, 1.2, 1.4, 1.6].map(x => [x, `×${x.toFixed(1)}${x === 1 ? " (normal)" : ""}`]), topts = [0, 100, 250, 500, 1000, 2000].map(x => [x, x ? money(x) + " / day" : "None"]);
  const temps = h.temps.map(x => `<div class="kv1"><div><span>${x.n} temp ${esc(H.ROLE[x.role].name.toLowerCase())}</span><b>ends day ${x.until}</b></div></div>`).join("");
  return `<div class="card">${head("People", `${num(H.headcount(s))} staff · payroll ${money(pay)} / day`)}${kv([["Morale", dec(h.morale, 0) + "%"], ["Quit so far", h.quits], ["Paid so far", money(h.paidTotal)], ["Recruitment paid", money(h.recruitPaid)], ["Severance paid", money(h.severancePaid)]])}${meter(h.morale, h.morale < 40 ? "full" : h.morale < 60 ? "warn" : "")}
      <div class="two"><label class="fld"><span>Wage level</span><select data-hrf="wage">${wopts.map(([v, l]) => opt(v, l, h.wageMult)).join("")}</select></label>
      <label class="fld"><span>Training budget</span><select data-hrf="training">${topts.map(([v, l]) => opt(v, l, h.training)).join("")}</select></label></div>
      <label class="fld"><span>Temp contract length</span>${sel("tempDays", D.HR.tempDays.map(x => [x, x + " days"]), td)}</label>
      <small class="muted">Hiring costs ${D.HR.recruitDays} days of wage. Letting someone go costs ${D.HR.severanceDays} days of wage. Temps cost ${Math.round(D.HR.tempPremium * 100)}% more, never quit, and leave when the contract ends. Shop staff add up to 10% sales, handlers cut transfer fees, sales reps help in tenders, service staff clear tickets, operators run machines, drivers drive your trucks.</small></div>${temps ? `<div class="card">${head("Temp contracts")}${temps}</div>` : ""}${rows}`;
}

// ================= MARKETING =================
export function marketing(s, f) {
  const m = K.ensureMkt(s), cats = [["all", "All products"], ["food", "Food"], ["drinks", "Drinks"], ["electronics", "Electronics"]], ch = D.MKT_CHANNELS.find(c => c.id === f.mkt.channel);
  const aw = ["food", "drinks", "electronics"].map(c => `<div class="kv1"><div><span>${c[0].toUpperCase() + c.slice(1)} awareness</span><b>${dec(K.awareness(s, c), 0)} / 100 · demand ×${dec(K.demandLift(s, c), 2)}</b></div></div>${meter(K.awareness(s, c))}`).join("");
  const list = m.campaigns.map(k => `<div class="kv1"><div><span>#${k.id} ${esc(D.MKT_CHANNELS.find(c => c.id === k.channel).name)} · ${esc(k.cat)}</span><b>${k.left ? `${k.left} d left · ${money(k.daily)}/d` : "ended, fading"}</b></div></div>${k.left ? `<div class="row">${btn("mktStop", "Stop", { id: k.id, ghost: true })}</div>` : ""}`).join("");
  return `<div class="card">${head("Awareness", "Fades a little every day")}${aw}</div>
    <div class="card">${head("New campaign")}<label class="fld"><span>Channel</span>${sel("mkt.channel", D.MKT_CHANNELS.map(c => [c.id, `${c.name} · ${c.note}`]), f.mkt.channel, false)}</label>
      <div class="two"><label class="fld"><span>Total budget</span>${sel("mkt.budget", [100, 250, 500, 1000, 2500, 5000, 10000].map(x => [x, money(x)]), f.mkt.budget)}</label>
      <label class="fld"><span>Days</span>${sel("mkt.days", [1, 3, 7, 14, 21, 30].map(x => [x, x + " d"]), f.mkt.days)}</label></div>
      <label class="fld"><span>Target</span>${sel("mkt.cat", cats, f.mkt.cat, false)}</label>
      <small class="muted">${esc(ch.name)}: minimum ${money(ch.minBudget)}, memory fades ${pct(ch.decay)} a day. Awareness lifts shopper numbers and makes them less price-sensitive. Spend is paid daily.</small>${btn("mktStart", `Start · ${money(f.mkt.budget)}`, { mini: false })}</div>
    ${list ? `<div class="card">${head("Campaigns")}${list}</div>` : ""}`;
}

// ================= E-COMMERCE =================
export function ecom(s) {
  const e = K.ensureEcom(s);
  if (!e.active) return `<div class="card">${head("Webstore")}<p class="muted">Sell online from your warehouse and factory stock. Customers pay into escrow. The money is yours after the parcel arrives. You pay a setup fee of ${money(D.ECOM.setupFee)}, hosting ${money(D.ECOM.hostingPerDay)} a day, ${dec(D.ECOM.gatewayRate * 100)}% gateway fee, and pick, pack and parcel costs per order.</p>${btn("ecomOpen", `Open the webstore · ${money(D.ECOM.setupFee)}`, { mini: false, dis: balance(s.ledger, "cash") < D.ECOM.setupFee })}</div>`;
  const all = [...D.PRODUCTS, ...D.JUICES], rows = all.map(p => { const on = e.catalog.includes(p.id), price = e.prices[p.id] || p.ref * 1.1, st = E.PRODUCT[p.id] ? s.wh.qty[p.id] : s.fx.fg.qty[p.id];
    return `<div class="card"><div class="shophead"><b>${esc(p.name)}</b><small>stock ${num(st)}</small></div><div class="row">${btn("ecomCat", on ? "In catalog" : "Add", { id: p.id, ghost: !on })}${on ? `${btn("ecomPrice", "-", { id: p.id, ghost: true, arg: 'data-dir="-1"' })}<b>${money2(price)}</b>${btn("ecomPrice", "+", { id: p.id, ghost: true, arg: 'data-dir="1"' })}` : `<small class="muted">Ref ${money2(p.ref)}</small>`}</div></div>`; }).join("");
  return `<div class="card">${head("Webstore", "Open")}${kv([["Visitors / day (est.)", num(K.webTraffic(s))], ["Orders so far", num(e.stats.orders)], ["Units sold", num(e.stats.units)], ["Missed (no stock)", num(e.stats.lost)], ["Money in escrow", money2(balance(s.ledger, "escrow"))], ["Released to you", money2(balance(s.ledger, "sales_ecom"))]])}
      <label class="fld"><span>Pay-per-click ad budget</span><select data-ecf="ads">${[0, 50, 100, 250, 500, 1000, 2500].map(x => opt(x, x ? money(x) + " / day" : "None", e.adBudget)).join("")}</select></label>
      <small class="muted">Each ${money2(D.ECOM.cpc)} buys a visitor. Fewer than ${D.ECOM.baseConversion * 100}% of visitors buy, and fewer at high prices.</small></div>${rows}`;
}

// ================= BANK =================
export function bank(s, f) {
  const b = Bk.ensureBank(s), od = balance(s.ledger, "overdraft"), cap = Bk.loanCap(s, f.loan.kind), room = Bk.creditRoom(s);
  const loans = b.loans.map(l => `<div class="kv1"><div><span>Loan #${l.id} · ${l.kind}</span><b>${money(l.balance)} · ${l.left} d left</b></div></div>`).join("");
  return `<div class="card">${head("Bank", "Interest is charged every day")}${kv([["Overdraft", money2(od)], ["Overdraft interest", dec(D.BANK.overdraft.rate * 100, 3) + "% / day"], ["Credit line", `${money2(b.credit.bal)} of ${money(D.BANK.credit.limit)}`], ["Interest paid so far", money2(b.interestPaid)]])}
      <small class="muted">An overdraft for three days in a row ends the game. Repay it from sales.</small></div>
    <div class="card">${head("Credit line", `${D.BANK.credit.termDays} days, ${dec(D.BANK.credit.rate * 100, 3)}% / day`)}
      <label class="fld"><span>Amount</span>${sel("credit", [1000, 5000, 10000, 20000, 40000, 60000].map(x => [x, money(x)]), f.credit)}</label>
      <div class="row">${btn("credDraw", "Draw", { dis: f.credit > room, mini: false })}${btn("credRepay", "Repay", { ghost: true, dis: !b.credit.bal, mini: false })}</div><small class="muted">Room left: ${money(room)}. Anything unpaid after ${D.BANK.credit.termDays} days moves to the overdraft.</small></div>
    <div class="card">${head("Loans")}<label class="fld"><span>Type</span>${sel("loan.kind", [["equipment", `Equipment · up to 80% of machinery`], ["long", `Long-term · from ${money(D.BANK.longTerm.minAmount)}`]], f.loan.kind, false)}</label>
      <div class="two"><label class="fld"><span>Amount</span>${sel("loan.amount", [5000, 10000, 20000, 30000, 50000, 100000].map(x => [x, money(x)]), f.loan.amount)}</label>
      <label class="fld"><span>Term</span>${f.loan.kind === "long" ? `<select disabled><option>365 d</option></select>` : sel("loan.term", D.BANK.equipment.termsDays.map(x => [x, x + " d"]), f.loan.term)}</label></div>
      <small class="muted">The bank will lend you ${money(cap)} of this kind. Repaid in equal daily parts plus interest on what is left.</small>${btn("loan", "Take loan", { dis: f.loan.amount > cap, mini: false })}${loans}</div>`;
}

// ================= STATEMENTS =================
export function statements(s) {
  const L = s.ledger, b = a => balance(L, a), t = totals(L);
  const nz = (a, label) => (Math.abs(b(a)) > 0.004 ? `<tr><td class="l">${label || ACCOUNTS[a].name}</td><td>${money2(b(a))}</td></tr>` : "");
  const rev = ["sales", "sales_b2b", "sales_ecom"].map(a => nz(a)).join(""), exp = ["cogs", ...OPEX].map(a => nz(a)).join(""), net = round2(t.revenue - t.costs);
  const assets = ["cash", "receivables", "inventory", "inv_raw", "inv_fg", "transit", "machinery", "acc_deprec"].map(a => nz(a)).join(""), liab = ["overdraft", "payables", "tax_payable", "credit", "longdebt", "escrow"].map(a => nz(a)).join("");
  const machGross = b("machinery"), financing = round2(b("capital") - openingGift(s) + b("overdraft") + b("credit") + b("longdebt")), investing = -machGross, cash = b("cash"), operating = round2(cash - financing - investing);
  const tbl = (title, rows, foot) => `<div class="card scroll"><b>${title}</b><table class="tbl fixed"><tbody>${rows}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ""}</table></div>`;
  return tbl("Income statement", `<tr><td class="l"><b>Revenue</b></td><td></td></tr>${rev}<tr><td class="l"><b>Expenses</b></td><td></td></tr>${exp}`, `<tr><td class="l">Net profit</td><td class="${cls(net)}">${money2(net)}</td></tr>`)
    + tbl("Balance sheet", `<tr><td class="l"><b>Assets</b></td><td></td></tr>${assets}<tr><td class="l"><b>Liabilities</b></td><td></td></tr>${liab}<tr><td class="l">Owner capital</td><td>${money2(b("capital"))}</td></tr><tr><td class="l">Profit kept</td><td>${money2(net)}</td></tr>`,
      `<tr><td class="l">Assets / Liabilities + Equity</td><td>${money(t.assets)} / ${money(t.liabilities + t.equity)}</td></tr>`)
    + tbl("Statement of cash flows", `<tr><td class="l">Operating</td><td class="${cls(operating)}">${money2(operating)}</td></tr><tr><td class="l">Investing (machines)</td><td class="${cls(investing)}">${money2(investing)}</td></tr><tr><td class="l">Financing (capital, loans, overdraft)</td><td>${money2(financing)}</td></tr>`, `<tr><td class="l">Cash on hand</td><td>${money2(cash)}</td></tr>`)
    + `<small class="muted">Operating cash flow is what is left after investing and financing explain the rest of the cash. Opening stock was a gift from the owner, so it is not counted as cash capital. Return on assets ${dec(Kp.kpis(s).roa)}%, quick ratio ${dec(quick(s), 2)}.</small>`;
}
const openingGift = s => round2(s.startNetWorth - s.capital);
const quick = s => { const L = s.ledger, b = a => balance(L, a), cur = b("overdraft") + b("payables") + b("tax_payable") + b("credit") + b("escrow"); return cur > 0 ? (b("cash") + b("receivables")) / cur : 99; };

// Warning list. Each row jumps to the tab that fixes it.
export function warningsCard(s) {
  const w = Kp.warnings(s); if (!w.length) return "";
  return `<div class="card">${head("Warnings", w.length + " to look at")}${w.map(x => `<div class="warnrow ${x.level}"><span>${esc(x.text)}</span><button class="mini ghost" data-goto="${x.where[0]}" data-gsub="${x.where[1]}">Open</button></div>`).join("")}</div>`;
}
// ================= SCORING & DATA =================
export function scoring(s, f) {
  const sb = Kp.scoreboard(s), w = Kp.ensureKpi(s).weights;
  const fmt = (r) => r.unit === "$" ? money(r.value) : r.unit === "x" ? dec(r.value, 2) + "×" : dec(r.value, 1) + (r.unit === "%" ? "%" : "");
  const rows = sb.rows.map(r => `<tr><td class="l">${esc(r.name)}</td><td>${fmt(r)}</td><td>${dec(r.score, 0)}</td><td>${dec(r.points, 1)}</td></tr>`).join("");
  const inputs = D.KPIS.map(k => `<label class="fld"><span>${esc(k.name)}</span>${sel("w." + k.id, [0, 5, 10, 15, 20, 25, 30, 40, 50].map(x => [x, x + "%"]), f.w[k.id] != null ? f.w[k.id] : Math.round(w[k.id] * 100))}</label>`).join("");
  return `${warningsCard(s)}<div class="card">${head("Score", "Weighted KPIs")}<div class="gradebig">${dec(sb.total, 1)}<small>out of 100</small></div></div>
    <div class="card scroll"><table class="tbl fixed"><thead><tr><th class="l">KPI</th><th>Value</th><th>Score</th><th>Points</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="card">${head("Weights", "Set what matters; they are re-balanced to 100%")}<div class="two">${inputs}</div><div class="row">${btn("weights", "Apply weights", { mini: false })}${btn("weightsReset", "Defaults", { ghost: true, mini: false })}</div></div>`;
}
export function competitors(s) {
  const rows = Kp.competitorPrices(s).map(r => `<tr><td class="l">${esc(r.name)}</td><td>${money2(r.you)}</td>${r.rivals.map(x => `<td class="${r.you > x * 1.05 ? "warnc" : ""}">${money2(x)}</td>`).join("")}</tr>`).join("");
  const nets = s.history.slice(-30), max = Math.max(1, ...nets.map(h => h.revenue));
  const chartRev = nets.length ? `<div class="chart" role="img" aria-label="Revenue per day">${nets.map(h => `<div class="col"><i style="height:${Math.max(3, h.revenue / max * 100)}%"></i><small>${h.day}</small></div>`).join("")}</div>` : `<small class="muted">The first day report appears when day 1 ends.</small>`;
  return `<div class="card scroll"><b>Competitor prices</b><table class="tbl fixed"><thead><tr><th class="l">Product</th><th>You</th><th>Rival A</th><th>Rival B</th><th>Rival C</th></tr></thead><tbody>${rows}</tbody></table></div>
    <small class="muted">Amber means a rival is cheaper than you by more than 5%.</small><div class="card"><b>Revenue per day</b>${chartRev}</div>`;
}

export function forecast(s) {
  const per = D.PRODUCTS.map(p => { const a = Fc.retailAdvice(s, p.id), sp = D.SUPPLIERS.find(x => x.id === a.supplier), tr = a.trend / Math.max(1, a.level) * 100;
    return `<div class="card"><div class="shophead"><b><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</b><small>${a.basis === "history" ? "from sales history" : "from the demand model (few days of history)"}</small></div>
      ${kv([["Forecast / day (next 7)", num(a.perDay)], ["Trend", (tr >= 0 ? "+" : "") + dec(tr, 1) + "% / day"], ["Accuracy (1 day ahead)", a.error == null ? "not enough days" : pct(Math.max(0, 1 - a.error))], ["Stock + on the way", num(a.position)], ["Days of cover", a.daysCover == null ? "-" : dec(a.daysCover, 1)],
        ["Lead time (quoted / expected)", `${a.lead} / ${dec(a.leadExp, 1)} d`], ["Safety stock", num(a.ss)], ["Reorder point", num(a.rop)]])}
      <div class="row">${btn("advBuy", a.qty ? `Order ${num(a.qty)} from ${esc(sp.name.split(" ")[0])}` : "No order needed", { id: p.id, dis: !a.qty, mini: false })}</div>${a.limited ? `<small class="note warnc">The shop has no room for the full amount.</small>` : ""}</div>`; }).join("");
  const jc = D.JUICES.map(j => { const a = Fc.juiceAdvice(s, j.id); return `<div class="card"><div class="shophead"><b><span class="dot" style="background:${j.color}"></span>${esc(j.name.replace(" (1 L)", ""))}</b><small>production advice</small></div>
      ${kv([["Contracts to fill", num(a.contracts)], ["Web sales / day", num(a.webPerDay)], ["In stock + queued", `${num(a.fg)} + ${num(a.queued)}`], ["Still needed", num(a.qty)]])}
      <div class="row">${btn("advMake", a.qty ? `Queue ${num(a.qty)} bottles` : "Enough planned", { id: j.id, dis: !a.qty || !s.fx.machines.length, mini: false })}</div></div>`; }).join("");
  const cp = Kp.competitorPrices(s).map(r => { const avg = r.rivals.reduce((x, y) => x + y, 0) / r.rivals.length; return `<div class="kv1"><div><span>${esc(r.name)}: you vs rivals</span><b class="${r.you > avg * 1.05 ? "warnc" : ""}">${money2(r.you)} vs ${money2(avg)}</b></div></div>`; }).join("");
  return `<div class="card">${head("Forecast", "Built from your real sales")}<small class="muted">Demand is the units sold plus the units customers wanted but could not buy. The weekday pattern is removed, a trend is fitted, and the pattern is put back. Safety stock covers demand noise and late suppliers. The advice counts stock, deliveries on the way and free space.</small>${cp}</div>${per}${jc}`;
}

// ================= LEDGER: trial balance, tax, receivables, journal =================
export function ledgerScreen(s, f = {}) {
  const tb = Ac.trialBalance(s), ag = Ac.agingReceivables(s), tx = s.tax, gl = f.gl || "all", b2 = s.b2b;
  const tbRows = tb.rows.map(r => `<tr><td class="l">${esc(r.name)}</td><td>${r.dr ? money2(r.dr) : ""}</td><td>${r.cr ? money2(r.cr) : ""}</td></tr>`).join("");
  const accts = [["all", "All accounts"], ...Object.keys(ACCOUNTS).map(k => [k, ACCOUNTS[k].name])];
  const jr = Ac.journal(s, gl).map(e => `<div class="kv1"><div><span>#${e.id} · day ${e.day} · ${esc(e.memo)}</span><b>${e.lines.map(l => `${esc(ACCOUNTS[l.acct].name)} ${l.dr ? "Dr " + money2(l.dr) : "Cr " + money2(l.cr)}`).join(" · ")}</b></div></div>`).join("");
  const inv = ag.rows.map(x => `<div class="kv1"><div><span>#${x.id} ${esc(D.B2B.buyers.find(y => y.id === x.buyer).name)}</span><b>${money2(x.amount)} · due day ${x.due}</b></div></div>`).join("");
  return `<div class="card scroll"><b>Trial balance</b><table class="tbl fixed"><thead><tr><th class="l">Account</th><th>Debit</th><th>Credit</th></tr></thead><tbody>${tbRows}</tbody><tfoot><tr><td class="l">Total ${tb.balanced ? "(balanced)" : "(OUT OF BALANCE)"}</td><td>${money2(tb.dr)}</td><td>${money2(tb.cr)}</td></tr></tfoot></table></div>
    <div class="card">${head("Income tax", `${pct(D.TAX.rate)} of profit, every ${D.TAX.periodDays} days`)}${kv([["Profit before tax", money2(Ac.profitBeforeTax(s))], ["Tax assessed so far", money2(tx.assessed)], ["Tax paid so far", money2(tx.paid)], ["Tax payable now", money2(Ac.taxOwed(s))], ["Next assessment", "day " + (Math.floor(s.day / D.TAX.periodDays) + 1) * D.TAX.periodDays]])}<small class="muted">Losses carry forward and tax is never refunded. It is due ${D.TAX.dueDays} days after assessment.</small></div>
    <div class="card">${head("Receivables", "Money customers owe you")}${kv([["B2B invoices open", money2(ag.total)], ["Web orders in escrow", money2(ag.web)], ["Collected so far", money2(b2.collected || 0)], ["Written off as bad debt", money2(b2.badDebt || 0)]])}${inv || `<small class="muted">No open B2B invoices. B2B buyers pay on credit terms (5 to 21 days) after delivery, and a few never pay.</small>`}</div>
    <div class="card"><b>General ledger</b><label class="fld"><span>Account</span>${sel("gl", accts, gl, false)}</label>${jr || `<small class="muted">Nothing posted to this account yet.</small>`}<small class="muted">Shows the latest entries only.</small></div>`;
}

// ================= BI DASHBOARD =================
// Plain SVG line chart: one line per series, shared day axis, min and max labelled. Colours come from the theme variables.
function lineChart(series, days, label) {
  if (days.length < 2) return `<small class="muted">Charts appear after two day reports.</small>`;
  const W = 320, H = 120, P = 6, all = series.flatMap(x => x.values), lo = Math.min(0, ...all), hi = Math.max(1, ...all), X = i => P + (W - 2 * P) * i / (days.length - 1), Y = v => H - P - (H - 2 * P) * (v - lo) / (hi - lo || 1);
  const lines = series.map(x => `<polyline fill="none" stroke="${x.color}" stroke-width="2" stroke-linejoin="round" points="${x.values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}"/>`).join("");
  const zero = lo < 0 ? `<line x1="${P}" x2="${W - P}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="var(--px-hi)" stroke-dasharray="3 3"/>` : "";
  return `<svg class="lchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${zero}${lines}</svg>
    <div class="legend">${series.map(x => `<span><i style="background:${x.color}"></i>${esc(x.name)}</span>`).join("")}<small class="muted">days ${days[0]} to ${days[days.length - 1]} · high ${money(hi)} · low ${money(lo)}</small></div>`;
}
const hbars = (rows, colors = ["var(--mint)", "var(--blue)", "var(--brass)", "var(--coral)"]) => { const tot = rows.reduce((a, r) => a + r.v, 0) || 1; return rows.map((r, i) => `<div class="hbar"><span>${esc(r.name)}</span><div class="meter"><i style="width:${(r.v / tot * 100).toFixed(1)}%;background:${colors[i % colors.length]}"></i></div><b>${money(r.v)} · ${Math.round(r.v / tot * 100)}%</b></div>`).join(""); };
export function biScreen(s) {
  const m = Bi.bi(s), na = "-", p = v => v == null ? na : dec(v, 1) + "%";
  const ser = m.series, days = ser.map(x => x.day);
  const sup = m.suppliers.map(x => `<tr><td class="l">${esc(x.name)}</td><td>${x.n}</td><td>${x.late}</td><td class="${x.onTime < 85 ? "warnc" : ""}">${dec(x.onTime, 0)}%</td></tr>`).join("");
  return `${warningsCard(s)}<div class="card">${head("Profit and loss", "Since day 1")}${kv([["Revenue", money(m.revenue)], ["Cost of goods", money(m.cogs)], ["Gross profit", money(m.gross)], ["Gross margin", p(m.grossMargin)], ["Operating costs", money(m.opEx)], ["Net profit", money(m.net)], ["Net margin", p(m.netMargin)]])}</div>
    <div class="card">${head("Operations")}${kv([["Inventory value", money(m.inventory)], ["Inventory turnover / year", m.turnoverYear ? dec(m.turnoverYear, 1) + "×" : na], ["Days of stock on hand", m.daysOfStock == null ? na : dec(m.daysOfStock, 0)], ["Factory utilisation", m.prodEff == null ? "no machines yet" : p(m.prodEff)], ["Bottles made / capacity", m.capUnits ? `${num(m.madeUnits)} / ${num(m.capUnits)}` : na], ["B2B delivered on time", m.b2bDone ? `${p(m.b2bOnTime)} of ${m.b2bDone}` : "no contracts done"], ["Supplier deliveries on time", m.supplierOrders ? `${p(m.supplierOnTime)} of ${m.supplierOrders}` : "none yet"]])}<small class="muted">Utilisation is bottles made divided by what every machine could make at full speed, so idle days, breakdowns and missing materials all lower it.</small></div>
    <div class="card">${head("Revenue, profit and cash", "Last 60 days")}${lineChart([{ name: "Revenue", color: "var(--mint)", values: ser.map(x => x.revenue) }, { name: "Net profit", color: "var(--brass)", values: ser.map(x => x.net) }, { name: "Cash", color: "var(--blue)", values: ser.map(x => x.cash) }], days, "Revenue, net profit and cash per day")}</div>
    <div class="card">${head("Where the money comes from")}${m.revenue > 0 ? hbars(m.channels.filter(x => x.v > 0)) : `<small class="muted">No sales yet.</small>`}</div>
    <div class="card">${head("Where the money goes")}${m.costMix.length ? hbars(m.costMix, ["var(--coral)", "var(--brass)", "var(--blue)", "var(--mint)"]) : `<small class="muted">No costs yet.</small>`}</div>
    <div class="card scroll"><b>Supplier reliability</b>${sup ? `<table class="tbl fixed"><thead><tr><th class="l">Supplier</th><th>Orders</th><th>Late</th><th>On time</th></tr></thead><tbody>${sup}</tbody></table>` : `<small class="muted">Reliability shows once deliveries arrive.</small>`}</div>`;
}

// ================= MAIL AND FACILITATOR =================
export function mailScreen(s) {
  const m = Ml.ensureMail(s), items = [...m.items].reverse();
  const rows = items.map(x => `<div class="card mailrow ${x.read ? "read" : "new"} ${x.level}"><div class="shophead"><b>${esc(x.subject)}</b><small>day ${x.day} · ${esc(x.from)}</small></div><p class="small">${esc(x.body)}</p>
    <div class="row">${x.goto ? `<button class="mini" data-goto="${x.goto[0]}" data-gsub="${x.goto[1]}">Open</button>` : ""}${x.read ? "" : btn("mailRead", "Mark read", { id: x.id, ghost: true })}</div></div>`).join("");
  return `<div class="card">${head("Inbox", `${Ml.unread(s)} unread of ${items.length}`)}<div class="row">${btn("mailAll", "Mark all read", { ghost: true, dis: !Ml.unread(s) })}${btn("mailClear", "Clear inbox", { ghost: true, dis: !items.length })}</div><small class="muted">Messages come from real events: late deliveries, breakdowns, contracts, the bank, the tax office and scenario events.</small></div>${rows || `<div class="card"><small class="muted">No messages yet. They arrive as things happen in your business.</small></div>`}`;
}
export function facilitatorScreen(s, f, results = []) {
  const sc = Sn.ensureScn(s), def = Sn.SCENARIO[sc.id], act = Sn.activeEvents(s), ev = f.ev || { kind: "demand", mult: 1.2, days: 7, title: "" };
  const evs = act.map(e => `<div class="kv1"><div><span>${esc(e.title)}</span><b>${e.kind} ×${e.mult.toFixed(2)} · until day ${e.until}</b></div></div><div class="row">${btn("evStop", "End now", { id: e.id, ghost: true })}</div>`).join("");
  const rk = Sn.rank(results), mine = Sn.resultCard(s, Kp.scoreboard(s).total, f.team);
  const table = rk.length ? `<div class="scroll"><table class="tbl fixed"><thead><tr><th>#</th><th class="l">Team</th><th>Score</th><th>Net worth</th><th>Profit</th></tr></thead><tbody>${rk.map(r => `<tr><td>${r.place}</td><td class="l">${esc(r.name)}</td><td>${dec(r.score, 1)}</td><td>${money(r.netWorth)}</td><td class="${r.netProfit >= 0 ? "" : "warnc"}">${money(r.netProfit)}</td></tr>`).join("")}</tbody></table></div>` : `<small class="muted">No results loaded yet.</small>`;
  return `<div class="card">${head("Scenario", def ? def.name : "Free play")}<small class="muted">${esc(def ? def.desc : "")}</small>${def && def.events.length ? `<small class="muted">Scripted: ${def.events.map(e => `day ${e.day} ${esc(e.title)}`).join(" · ")}</small>` : ""}${evs || `<small class="muted">No event is active right now.</small>`}</div>
    <div class="card">${head("Announce an event", "The facilitator's lever")}
      <div class="two"><label class="fld"><span>Type</span>${sel("ev.kind", [["demand", "Demand"], ["cost", "Prices"], ["delay", "Delays"]], ev.kind, false)}</label><label class="fld"><span>Length</span>${sel("ev.days", [1, 3, 5, 7, 10, 14, 21, 30].map(x => [x, x + " d"]), ev.days)}</label></div>
      ${ev.kind === "delay" ? "" : `<label class="fld"><span>Strength</span>${sel("ev.mult", [0.5, 0.6, 0.7, 0.8, 0.9, 1.1, 1.2, 1.3, 1.5, 2].map(x => [x, "×" + x.toFixed(1)]), ev.mult)}</label>`}
      <label class="fld"><span>Headline</span><input data-f="ev.title" value="${esc(ev.title || "")}" maxlength="60" placeholder="e.g. Heatwave"></label>${btn("evGo", "Announce", { mini: false })}<small class="muted">Players get it in Mail. It really changes their numbers.</small></div>
    <div class="card">${head("Results", "Local, no server")}<label class="fld"><span>Team name</span><input data-f="team" value="${esc(f.team || "")}" maxlength="30" placeholder="Your team"></label>
      <div class="row"><button class="mini" data-resexport="1">Save my result</button><button class="mini ghost" data-respick="1">Load results to rank</button>${rk.length ? `<button class="mini ghost" data-resclear="1">Clear</button>` : ""}</div>
      <small class="muted">Now: score ${dec(mine.score, 1)}, net worth ${money(mine.netWorth)}. Teams save a result file and hand it in. The facilitator loads them all here.</small>${table}</div>`;
}
