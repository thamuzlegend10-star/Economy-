// Management panels, reports and dialogs. Every button calls an engine command or is disabled with a reason.
import * as D from "./data.js";
import * as E from "./engine.js";
import { balance, round2 } from "./ledger.js";

export const money = n => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money0 = n => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString();
const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
const stars = n => "★".repeat(n) + "☆".repeat(5 - n);
const bar = (v, max, cls = "") => `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, 100 * v / (max || 1)))}%"></i></div>`;


// Short "how this works" boxes shown at the top of each panel (collapsible, remembered).
const TIPS = {
  store: ["Your shop floor", "Only goods on <b>shelves</b> can be sold. Press <b>Restock</b> to move goods from the warehouse, or set an <b>Auto target</b> so stockers refill shelves when they drop below half. Customers expect a fair price: a little above is fine, far above and they skip the item."],
  procure: ["Buying stock", "Pick a supplier, type quantities, then <b>Place order</b>. A truck brings the goods to your warehouse. You pay goods plus a delivery fee now, or choose <b>On terms</b> to pay the invoice a few days later for a small markup (limited by a credit limit; late invoices cost 2% a day and block more credit). Cheap suppliers are slow, QuickShip is fast but pricey, and big orders earn a bulk discount. Mind your warehouse space."],
  inventory: ["Your goods", "See what you own in the warehouse and on shelves, what is on the way, and what it is worth. <b>Out</b> and <b>Low shelf</b> mean lost sales, <b>Overstock</b> means cash tied up in goods."],
  staff: ["Your team", "Hire to remove bottlenecks: <b>cashiers</b> speed up checkout, <b>stockers</b> fill shelves, <b>warehouse workers</b> unload trucks, <b>managers</b> raise happiness. Wages are charged every closing, so hire only when profit can carry them."],
  bank: ["Banking", "Sales land in the till as cash. Bills are paid from the bank first, then cash, then an <b>overdraft</b> (1% a day). <b>Loans</b> give cash now and are repaid daily with interest. Borrow to grow, not to survive."],
  finance: ["Your books", "Every number comes from a double-entry ledger. <b>Today</b> is live, <b>History</b> shows past days. Net worth = cash + bank + inventory + equipment - debt."],
  upgrades: ["Investments", "Permanent upgrades. A <b>Checkout counter</b> adds a lane and is the usual first buy when customers leave from long queues. Shelves and racks add space. Signage is cosmetic."],
  plan: ["Planning", "Plan before you buy. The <b>forecast</b> estimates customers for the next days from your reputation, the weekday and booked campaigns. It is a range, not a promise: random events and daily variation are not in it, and the day report shows how close it was. <b>Days of cover</b> tells you how long your stock lasts at the expected demand. <b>Campaigns</b> cost money now and bring customers later. A <b>budget</b> is a daily target: the report shows where you beat it or missed it and why."],
  goals: ["Milestones", "Goals show your progress. In Standard mode your final score comes from wealth growth, cash health, low debt, happiness, stock management and expansion."],
};
const tipState = (() => { try { return JSON.parse(localStorage.getItem("economy-tips")) || {}; } catch { return {}; } })();

export const PANELS = [
  ["store", "Store"], ["procure", "Procurement"], ["inventory", "Inventory"], ["staff", "Staff"],
  ["plan", "Planning"], ["bank", "Bank"], ["finance", "Finance"], ["upgrades", "Upgrades"], ["goals", "Goals"],
];

export function createUI(ctx) {
  const { getState, onChange, toast, world } = ctx;
  const root = document.getElementById("panel"), body = document.getElementById("panelBody"), tabs = document.getElementById("panelTabs");
  const view = { panel: null, supplier: "metro", cart: {}, pay: "bank", invQ: "", invCat: "all", finTab: "today", amount: "" };

  // ---------- helpers ----------
  const S = () => getState();
  const run = (res, okMsg) => {
    if (!res.ok) toast(res.error, "err"); else { if (okMsg) toast(okMsg, "ok"); }
    onChange(); refresh(); return res;
  };
  const pName = id => E.product(id).name;
  const stockStatus = (s, p) => {
    const st = s.stock[p.id], inc = E.incomingOf(s, p.id);
    if (st.wh + st.shelf === 0) return inc ? ["Incoming", "info"] : ["Out", "bad"];
    if (st.shelf < 4) return ["Low shelf", "warn"];
    if (st.wh + st.shelf > 120) return ["Overstock", "warn"];
    return ["OK", "ok"];
  };

  // ---------- open / close ----------
  function open(panel) {
    if (!PANELS.some(p => p[0] === panel)) return;
    if (view.panel !== panel) lastHtml = "";
    view.panel = panel;
    root.hidden = false; document.body.classList.add("modal-open");
    tabs.innerHTML = PANELS.map(([id, name]) => `<button class="tab ${id === panel ? "on" : ""}" data-act="tab" data-id="${id}">${name}</button>`).join("");
    refresh();
    body.focus({ preventScroll: true });
  }
  function close() { root.hidden = true; view.panel = null; document.body.classList.remove("modal-open"); }
  const isOpen = () => !root.hidden;

  let lastHtml = "", lastPanel = null;
  function refresh() {
    if (!isOpen() || !view.panel) return;
    const s = S(); if (!s) return;
    // remember the scroll position of the sheet AND of every inner scroll box (e.g. the product table)
    const scroll = body.scrollTop, inner = [...body.querySelectorAll(".scroll")].map(e => e.scrollTop);
    tabs.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.id === view.panel));
    const tp = TIPS[view.panel];
    const tipHtml = tp ? `<details class="tip" data-tip="${view.panel}" ${tipState[view.panel] === false ? "" : "open"}><summary>${tp[0]}: how it works</summary><p>${tp[1]}</p></details>` : "";
    const html = tipHtml + ({ store, procure, inventory, staff, plan, bank, finance, upgrades, goals })[view.panel](s);
    if (html === lastHtml && lastPanel === view.panel) return;        // nothing changed: leave the DOM and the scroll position alone
    lastHtml = html; lastPanel = view.panel;
    body.innerHTML = html;
    body.scrollTop = scroll;
    body.querySelectorAll(".scroll").forEach((e, i) => { if (inner[i]) e.scrollTop = inner[i]; });
  }
  // live refresh while open, but never while the player is typing
  // ...and never while the player is scrolling or pressing a button (a rebuild would cancel the scroll or swallow the click)
  let pressing = false, lastScroll = 0;
  body.addEventListener("pointerdown", () => { pressing = true; });
  window.addEventListener("pointerup", () => { setTimeout(() => { pressing = false; }, 0); });
  window.addEventListener("pointercancel", () => { pressing = false; });
  body.addEventListener("scroll", () => { lastScroll = performance.now(); }, true);
  body.addEventListener("wheel", () => { lastScroll = performance.now(); }, { passive: true });
  setInterval(() => {
    if (!isOpen() || pressing || performance.now() - lastScroll < 800) return;
    if (document.activeElement && document.activeElement.matches("input,select")) return;
    refresh();
  }, 1000);

  // ---------- STORE ----------
  function store(s) {
    const rows = D.PRODUCTS.map(p => {
      const un = E.isUnlocked(s, p.id), st = s.stock[p.id];
      if (!un) return `<tr class="locked"><td>${esc(p.name)}</td><td colspan="8" class="muted">Unlocks on day ${p.unlockDay}</td></tr>`;
      const cost = E.avgCost(s, p.id) || E.unitCost(s, E.supplier("metro"), p.id), price = s.prices[p.id], margin = price > 0 ? (price - cost) / price : 0;
      const fair = p.ref, hint = price > fair * 1.15 ? `<span class="tag warn">above fair ${money(fair)}</span>` : price < cost ? `<span class="tag bad">below cost</span>` : `<span class="tag ok">fair ${money(fair)}</span>`;
      const room = Math.max(0, E.shelfCap(s) - E.shelfUsed(s) - E.pendingRestock(s));
      const can = Math.min(st.wh - s.tasks.filter(t => t.pid === p.id).reduce((a, t) => a + t.qty - t.done, 0), room);
      const btn = n => `<button class="mini" data-act="restock" data-id="${p.id}" data-n="${n}" ${can < n ? `disabled title="${st.wh < n ? "Not enough in the warehouse" : "Shelves are full"}"` : ""}>+${n}</button>`;
      return `<tr>
        <td><b>${esc(p.name)}</b><div class="muted">${D.CATEGORIES[p.cat].name}</div></td>
        <td><input class="price" type="number" min="0.1" step="0.1" value="${price.toFixed(2)}" data-act="price" data-id="${p.id}" aria-label="Price for ${esc(p.name)}"><div>${hint}</div></td>
        <td>${money(cost)}</td><td class="${margin < 0.1 ? "neg" : ""}">${Math.round(margin * 100)}%</td>
        <td><b>${st.shelf}</b></td><td>${st.wh}</td><td>${s.today.units[p.id] || 0}</td>
        <td class="nowrap">${btn(5)} ${btn(10)} ${btn(Math.max(1, Math.min(can, 40)))}</td>
        <td><input class="tgt" type="number" min="0" max="200" step="5" value="${s.shelfTarget[p.id]}" data-act="target" data-id="${p.id}" aria-label="Auto restock target for ${esc(p.name)}"></td></tr>`;
    }).join("");
    return `<h3>Store management</h3>
      <p class="muted">Customers compare your price with a fair market price. Above ~15% over fair, fewer buy. Shelf space: <b>${E.shelfUsed(s)}</b> / ${E.shelfCap(s)} (+${E.pendingRestock(s)} queued). Restocking moves goods from the warehouse using your stockers. Auto target refills when the shelf drops below half.</p>
      <div class="scroll"><table class="tbl tbl-store"><thead><tr><th>Product</th><th>Price</th><th>Avg cost</th><th>Margin</th><th>Shelf</th><th>Warehouse</th><th>Sold today</th><th>Restock</th><th>Auto target</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="row gap"><div class="note">Expected customers today: <b>${Math.round(E.expectedCustomers(s))}</b>. Reputation <b>${Math.round(s.rep)}</b>/100 and satisfaction <b>${Math.round(s.sat)}</b>/100 raise or lower this. Plan campaigns and see the forecast in <button class="mini" data-act="tab" data-id="plan">Planning</button>.</div></div>`;
  }

  // ---------- PROCUREMENT ----------
  function cartSummary(s) {
    const sup = E.supplier(view.supplier);
    const lines = Object.entries(view.cart).filter(([, q]) => q > 0).map(([pid, qty]) => ({ pid, qty }));
    const units = lines.reduce((a, l) => a + l.qty, 0);
    const mk = view.pay === "terms" && sup.terms ? 1 + sup.terms.markup : 1;
    const priced = lines.map(l => ({ ...l, unit: round2(E.unitCost(s, sup, l.pid, units) * mk) }));
    const goods = round2(priced.reduce((a, l) => a + l.unit * l.qty, 0));
    return { sup, lines, units, goods, fee: lines.length ? E.supFee(s, sup) : 0, total: round2(goods + (lines.length ? E.supFee(s, sup) : 0)) };
  }
  function cover(s, pid, un) {
    if (!un) return "-";
    const d = E.unitDemand(s)[pid] || 0, have = s.stock[pid].wh + s.stock[pid].shelf + E.incomingOf(s, pid);
    if (d <= 0) return "-";
    const days = have / d;
    return `<span class="${days < 1 ? "neg" : ""}" title="Units on hand and on the way, divided by the expected units sold per day">${days.toFixed(1)}d</span>`;
  }
  function priceTag(s, x) {
    const i = s.supIdx[x.id], pct = Math.round((i - 1) * 100), rec = s.supRec[x.id];
    const cls = pct <= -3 ? "ok" : pct >= 3 ? "warn" : "info";
    return `<small><span class="tag ${cls}" title="Today's price against this supplier's normal price. It drifts a little every day.">price today ${pct > 0 ? "+" : ""}${pct}%${pct <= -3 ? " (good time to buy)" : pct >= 3 ? " (expensive)" : ""}</span>${rec.n ? ` · your orders: ${rec.n - rec.late} of ${rec.n} on time` : ""}</small>`;
  }
  function procure(s) {
    const c = cartSummary(s), sup = c.sup;
    const cards = D.SUPPLIERS.map(x => `<button class="sup ${x.id === sup.id ? "on" : ""}" data-act="supplier" data-id="${x.id}">
        <b>${esc(x.name)}</b><span>${esc(x.desc)}</span>
        <small>${x.terms ? `Terms: net ${x.terms.days} days, +${Math.round(x.terms.markup * 100)}% · ` : "Cash only · "}Delivery ~${Math.round(E.supLead(s, x))}s · fee ${money0(E.supFee(s, x))} · ${Math.round(x.reliability * 100)}% on time · cost ×${x.mult}${x.bulkOff ? ` · ${Math.round(x.bulkOff * 100)}% off at ${x.bulkAt}+` : ""}</small>
        ${priceTag(s, x)}${E.supplierAvailable(s, x) ? "" : `<small><span class="tag bad">Does not deliver to ${esc(E.locOf(s).city)}</span></small>`}</button>`).join("");
    const items = D.PRODUCTS.filter(p => sup.cats.includes(p.cat)).map(p => {
      const un = E.isUnlocked(s, p.id), unit = round2(E.unitCost(s, sup, p.id, c.units) * (view.pay === "terms" && sup.terms ? 1 + sup.terms.markup : 1)), q = view.cart[p.id] || 0;
      const ev = s.events.active.find(e => e.id === "market" && e.pid === p.id);
      return `<tr class="${un ? "" : "locked"}"><td><b>${esc(p.name)}</b> ${ev ? '<span class="tag warn">+25% market</span>' : ""}</td><td>${money(unit)}</td><td>${s.stock[p.id].wh + s.stock[p.id].shelf}</td><td>${E.incomingOf(s, p.id)}</td><td>${cover(s, p.id, un)}</td>
        <td>${un ? `<input class="qty" type="number" min="0" max="999" step="1" value="${q}" data-act="cart" data-id="${p.id}" aria-label="Quantity of ${esc(p.name)}">` : `<span class="muted">day ${p.unlockDay}</span>`}</td></tr>`;
    }).join("");
    const free = E.whCap(s) - E.whUsed(s) - E.incomingUnits(s);
    const eta = c.lines.length ? `~${Math.round(E.supLead(s, sup))}s${s.events.active.some(e => e.id === "delay" && e.sup === sup.id) ? " (+60% supplier delay)" : ""}` : "-";
    let block = "";
    if (c.lines.length) {
      if (!E.supplierAvailable(s, sup)) block = `${sup.name} does not deliver to ${E.locOf(s).city}.`;
      else if (c.units < sup.minUnits) block = `${sup.name} needs at least ${sup.minUnits} units.`;
      else if (c.units > free) block = `Warehouse has only ${free} free slots.`;
      else if (view.pay === "terms") block = !sup.terms ? `${sup.name} does not offer payment terms.` : E.termsCheck(s, c.total) || "";
      else if (balance(s.ledger, view.pay) < c.total) block = `Not enough ${view.pay === "bank" ? "bank balance" : "cash"} (${money(balance(s.ledger, view.pay))}).`;
    } else block = "Add products to your order.";
    const orders = s.orders.map(o => {
      const f = o.status === "processing" || o.status === "en route" || o.status === "arriving" ? o.t / o.lead : 1;
      return `<div class="order"><div><b>#${o.id}</b> ${esc(E.supplier(o.supplier).name)} · ${o.units} units · ${money(o.total)} ${o.delayed ? '<span class="tag warn">delayed</span>' : ""}</div>
        <div class="muted">${o.status === "dock-wait" ? "waiting for a free dock" : o.status}</div>${bar(f, 1)}
        ${o.status === "processing" ? `<button class="mini" data-act="cancel" data-id="${o.id}">Cancel (fee not refunded)</button>` : ""}</div>`;
    }).join("") || `<p class="muted">No orders on the way.</p>`;
    const inv = s.invoices.map(v => {
      const left = v.due - s.day, late = v.late > 0 || left < 0;
      return `<div class="order"><div><b>Invoice #${v.id}</b> ${esc(E.supplier(v.supplier).name)} · ${money(v.amount)} ${late ? '<span class="tag bad">overdue</span>' : `<span class="tag info">due in ${left} day${left === 1 ? "" : "s"}</span>`}</div>
        <button class="mini" data-act="payinv" data-id="${v.id}">Pay now</button></div>`;
    }).join("");
    const done = s.doneOrders.slice(-4).reverse().map(o => `<div class="muted">#${o.id} ${esc(E.supplier(o.supplier).name)}: ${o.units} units received on day ${o.day}</div>`).join("");
    return `<h3>Procurement</h3>
      <div class="sups">${cards}</div>
      <div class="split"><div><div class="scroll"><table class="tbl"><thead><tr><th>Product</th><th>Unit cost</th><th>Have</th><th>Incoming</th><th>Cover</th><th>Order</th></tr></thead><tbody>${items}</tbody></table></div></div>
      <div class="sum"><h4>Order summary</h4>
        <div class="kv"><span>Units</span><b>${c.units}</b></div><div class="kv"><span>Goods</span><b>${money(c.goods)}</b></div>
        <div class="kv"><span>Delivery fee</span><b>${money(c.fee)}</b></div><div class="kv tot"><span>Total</span><b>${money(c.total)}</b></div>
        <div class="kv"><span>Estimated arrival</span><b>${eta}</b></div>
        <label class="field">Pay from<select data-act="pay"><option value="bank" ${view.pay === "bank" ? "selected" : ""}>Bank (${money(s.derived.bank)})</option><option value="cash" ${view.pay === "cash" ? "selected" : ""}>Cash (${money(s.derived.cash)})</option>${sup.terms ? `<option value="terms" ${view.pay === "terms" ? "selected" : ""}>On terms: pay in ${sup.terms.days} days (+${Math.round(sup.terms.markup * 100)}%)</option>` : ""}</select></label>
        <button class="primary" data-act="order" ${block ? `disabled title="${esc(block)}"` : ""}>Place order</button>${block ? `<div class="muted small">${esc(block)}</div>` : ""}
        <button class="ghost" data-act="clearcart">Clear</button></div></div>
      ${inv ? `<h4>Supplier invoices (owed ${money(E.invoicesOwed(s))} of ${money0(E.supplierCreditLimit(s))} limit)</h4>${inv}` : ""}
      <h4>Orders in progress</h4>${orders}${done ? "<h4>Recently received</h4>" + done : ""}`;
  }

  // ---------- PLANNING ----------
  function plan(s) {
    const fc = E.forecast(s, 3), dem = E.unitDemand(s), nextDay = s.phase === "report" ? s.day + 1 : s.day;
    const fcRows = fc.map((f, i) => `<tr><td>Day ${f.day}${i === 0 ? (s.phase === "report" ? " (next)" : " (today)") : ""}</td><td><b>${f.expected}</b></td><td>${f.low} to ${f.high}</td><td>${f.campaign ? '<span class="tag ok">campaign running</span>' : ""}</td></tr>`).join("");
    const acc = s.stats.fcDays ? `Average accuracy so far: <b>${Math.round(100 * (1 - s.stats.fcErr / s.stats.fcDays))}%</b> over ${s.stats.fcDays} days.` : "Accuracy appears after your first closed day.";
    const prodRows = D.PRODUCTS.filter(p => E.isUnlocked(s, p.id)).map(p => {
      const d = dem[p.id] || 0, have = s.stock[p.id].wh + s.stock[p.id].shelf, inc = E.incomingOf(s, p.id), days = d > 0 ? (have + inc) / d : null;
      const need = Math.max(0, Math.ceil(d * 2 - have - inc));
      return `<tr><td><b>${esc(p.name)}</b></td><td>~${d.toFixed(1)}</td><td>${have}</td><td>${inc}</td><td class="${days != null && days < 1 ? "neg" : ""}">${days == null ? "-" : days.toFixed(1)}</td><td>${need ? "+" + need : "ok"}</td></tr>`;
    }).join("");
    const active = s.campaigns.map(c => {
      const end = c.start + c.days - 1, state = nextDay < c.start ? `starts day ${c.start}` : `running until day ${end}`;
      return `<li><b>${esc(c.name)}</b>: +${Math.round(c.lift * 100)}% customers, ${state}.</li>`;
    }).join("") || `<li class="muted">No campaigns booked.</li>`;
    const camp = D.CAMPAIGNS.map(c => {
      const booked = s.campaigns.some(x => x.kind === c.id), funds = Math.max(balance(s.ledger, "bank"), balance(s.ledger, "cash")), full = s.campaigns.length >= D.MAX_CAMPAIGNS;
      const why = booked ? "Already booked" : full ? "Too many campaigns" : funds < c.cost ? `Need ${money0(c.cost)}` : "";
      return `<div class="upg"><b>${esc(c.name)}</b> <span class="tag info">${money0(c.cost)}</span><div class="muted">${esc(c.desc)}</div>
        <div class="muted small">+${Math.round(c.lift * 100)}% customers for ${c.days} day${c.days > 1 ? "s" : ""}${c.delay ? `, starts after ${c.delay} day${c.delay > 1 ? "s" : ""}` : ", starts right away"}. Paid now from the bank.</div>
        <button data-act="campaign" data-id="${c.id}" ${why ? `disabled title="${esc(why)}"` : ""}>${booked ? "Booked" : "Book for " + money0(c.cost)}</button></div>`;
    }).join("");
    const mine = E.priceIndex(s), sh = Math.round(100 * E.marketShare(s));
    const rivalRows = s.rivals.map(r => {
      const pr = r.price * (r.promo > 0 ? 0.9 : 1), diff = Math.round((pr / mine - 1) * 100);
      return `<tr><td><b>${esc(r.name)}</b></td><td>${E.RIVAL_KIND[r.kind].label}</td><td class="${diff < 0 ? "neg" : ""}">${diff === 0 ? "same" : (diff > 0 ? "+" : "") + diff + "%"}</td><td>${r.promo > 0 ? '<span class="tag warn">Promo</span>' : r.avail < 1 ? '<span class="tag">Low stock</span>' : "Normal"}</td></tr>`;
    }).join("");
    const market = s.rivals.length ? `<h4>Market and rivals</h4>
      <p>Your estimated share of local demand: <b>${sh}%</b>. Rivals are simulated shops. Price is shown against yours (negative means they are cheaper).</p>
      <div class="scroll"><table class="tbl"><thead><tr><th>Rival</th><th>Type</th><th>Price vs yours</th><th>Today</th></tr></thead><tbody>${rivalRows}</tbody></table></div>
      <p class="muted small">Share rises with better prices, reputation and full shelves. Rivals cut prices when you undercut them, and run short promotions.</p>` : `<h4>Market and rivals</h4><p class="muted small">This site has no simulated rivals, so you have the whole local market.</p>`;
    const b = s.budget;
    return `<h3>Planning</h3>
      <h4>Customer forecast</h4>
      <div class="scroll"><table class="tbl"><thead><tr><th>Day</th><th>Expected</th><th>Likely range</th><th></th></tr></thead><tbody>${fcRows}</tbody></table></div>
      <p class="muted small">${acc} The forecast knows the weekday, your reputation and booked campaigns. It does not know random events or normal day-to-day variation.</p>
      ${market}
      <h4>Stock plan</h4>
      <div class="scroll"><table class="tbl"><thead><tr><th>Product</th><th>Expected sales/day</th><th>On hand</th><th>Incoming</th><th>Days of cover</th><th>To order (2 days)</th></tr></thead><tbody>${prodRows}</tbody></table></div>
      <p class="muted small">A rough guide from the forecast, your prices and the share of items customers buy. Orders take time to arrive, so order before the cover runs out.</p>
      <h4>Campaigns</h4><div class="cards up">${camp}</div><ul class="check">${active}</ul>
      <h4>Daily budget</h4>
      <div class="row gap wrap"><label class="field">Revenue target<input id="budRev" type="number" min="0" step="10" value="${b.revenue || ""}" placeholder="none" data-act="budget"></label>
      <label class="field">Expense limit<input id="budExp" type="number" min="0" step="10" value="${b.expenses || ""}" placeholder="none" data-act="budget"></label></div>
      <p class="muted small">Leave empty for no budget. Each report shows actual against budget. Expenses include rent, wages, utilities, marketing and interest; the cost of goods is not in them.</p>`;
  }

  // ---------- INVENTORY ----------
  function inventory(s) {
    const q = view.invQ.toLowerCase();
    const rows = D.PRODUCTS.filter(p => E.isUnlocked(s, p.id) && (view.invCat === "all" || p.cat === view.invCat) && p.name.toLowerCase().includes(q)).map(p => {
      const st = s.stock[p.id], inc = E.incomingOf(s, p.id), [label, cls] = stockStatus(s, p);
      return `<tr><td><b>${esc(p.name)}</b></td><td>${D.CATEGORIES[p.cat].name}</td><td>${st.wh}</td><td>${st.shelf}</td><td>${inc}</td><td>${st.wh + st.shelf}</td><td>${money(E.avgCost(s, p.id))}</td><td>${money(s.val[p.id])}</td><td><span class="tag ${cls}">${label}</span></td></tr>`;
    }).join("") || `<tr><td colspan="9" class="muted">No products match.</td></tr>`;
    const sug = D.PRODUCTS.filter(p => E.isUnlocked(s, p.id) && s.stock[p.id].shelf + s.stock[p.id].wh < 12 && !E.incomingOf(s, p.id)).map(p => `<span class="tag warn">${esc(p.name)}: reorder</span>`).join(" ");
    const cats = ['<option value="all">All categories</option>'].concat(Object.entries(D.CATEGORIES).map(([id, c]) => `<option value="${id}" ${view.invCat === id ? "selected" : ""}>${c.name}</option>`)).join("");
    return `<h3>Inventory</h3>
      <div class="caps"><div><span>Warehouse</span><b>${E.whUsed(s)} / ${E.whCap(s)}</b> (+${E.incomingUnits(s)} incoming)${bar(E.whUsed(s) + E.incomingUnits(s), E.whCap(s), E.whUsed(s) / E.whCap(s) > 0.85 ? "bad" : "")}</div>
      <div><span>Shelves</span><b>${E.shelfUsed(s)} / ${E.shelfCap(s)}</b> (+${E.pendingRestock(s)} queued)${bar(E.shelfUsed(s), E.shelfCap(s))}</div></div>
      <div class="row gap"><input id="invq" type="search" placeholder="Search products" value="${esc(view.invQ)}" data-act="invq" aria-label="Search products"><select data-act="invcat" aria-label="Category">${cats}</select></div>
      <div class="scroll"><table class="tbl"><thead><tr><th>Product</th><th>Category</th><th>Warehouse</th><th>Shelf</th><th>Incoming</th><th>Total</th><th>Avg cost</th><th>Value</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p>Inventory value (at cost): <b>${money(s.derived.inventory)}</b>. In transit: <b>${money(s.derived.transit)}</b>.</p>${sug ? `<p>Reorder suggestions: ${sug}</p>` : ""}`;
  }

  // ---------- STAFF ----------
  function staff(s) {
    const roster = s.staff.map(x => `<tr><td><b>${esc(x.name)}</b></td><td>${D.ROLES[x.role].name}</td><td class="stars">${stars(x.skill)}</td><td>${money(x.wage)}/day</td><td><button class="mini bad" data-act="fire" data-id="${x.id}">Let go</button></td></tr>`).join("") || `<tr><td colspan="5" class="muted">No employees yet. You run the till and shelves yourself, slowly.</td></tr>`;
    const full = s.staff.length >= D.MAX_STAFF;
    const cands = s.candidates.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${D.ROLES[c.role].name}<div class="muted">${D.ROLES[c.role].desc}</div></td><td class="stars">${stars(c.skill)}</td><td>${money(c.wage)}/day</td><td><button class="mini" data-act="hire" data-id="${c.id}" ${full ? 'disabled title="Team is full"' : ""}>Hire</button></td></tr>`).join("");
    const eff = [
      `Checkout lanes: <b>${E.laneCount(s)}</b> of ${1 + s.upgrades.counter}`,
      `Restock speed: <b>${(0.5 + s.staff.filter(x => x.role === "stocker").reduce((a, x) => a + 0.6 * (0.7 + 0.15 * x.skill), 0)).toFixed(1)}</b> units/s`,
      `Wages per day: <b>${money(E.wagesPerDay(s))}</b>`,
    ].join(" · ");
    return `<h3>Staff</h3><p class="muted">${eff}. Team ${s.staff.length}/${D.MAX_STAFF}. New candidates appear every 3 days.</p>
      <h4>Your team</h4><div class="scroll"><table class="tbl"><thead><tr><th>Name</th><th>Role</th><th>Skill</th><th>Wage</th><th></th></tr></thead><tbody>${roster}</tbody></table></div>
      <h4>Candidates</h4><div class="scroll"><table class="tbl"><thead><tr><th>Name</th><th>Role</th><th>Skill</th><th>Wage</th><th></th></tr></thead><tbody>${cands || '<tr><td colspan="5" class="muted">No candidates right now.</td></tr>'}</tbody></table></div>`;
  }

  // ---------- BANK ----------
  function bank(s) {
    const d = s.derived;
    const offers = D.LOANS.map(l => {
      const t = E.loanTerms(l), why = E.loanEligibility(s, l);
      return `<div class="loan"><b>${esc(l.name)}</b> ${money0(l.principal)}<div class="muted">${(l.dailyRate * 100).toFixed(1)}%/day on balance · ${l.days} daily installments of ${money(t.installment)}</div>
        <div class="muted">Fee ${money(t.fee)} (paid now) · interest about ${money(t.interest)} · <b>total cost ${money(t.totalCost)}</b> · you receive ${money(t.net)}</div>
        <button class="mini" data-act="loan" data-id="${l.id}" ${why ? `disabled title="${esc(why)}"` : ""}>Borrow</button>${why ? ` <span class="muted small">${esc(why)}</span>` : ""}</div>`;
    }).join("");
    const active = s.loans.map(l => `<div class="loan"><b>${esc(l.name)}</b>: ${money(l.remaining)} left · installment ${money(l.installment)}/day · interest ${(l.dailyRate * 100).toFixed(1)}%/day
        <div class="row gap"><input class="qty wide" type="number" min="1" step="1" placeholder="Amount" id="rep${l.id}" aria-label="Repay amount"><button class="mini" data-act="repay" data-id="${l.id}">Repay</button><button class="mini" data-act="repayall" data-id="${l.id}">Repay all</button></div></div>`).join("") || `<p class="muted">No active loans.</p>`;
    const entries = s.ledger.entries.filter(e => e.lines.some(l => l.acct === "bank")).slice(-14).reverse().map(e => {
      const l = e.lines.find(x => x.acct === "bank"), amt = (l.dr || 0) - (l.cr || 0);
      return `<tr><td>${e.day}</td><td>${esc(e.memo)}</td><td class="${amt < 0 ? "neg" : "pos"}">${amt < 0 ? "-" : "+"}${money(Math.abs(amt))}</td></tr>`;
    }).join("");
    const od = d.overdraft;
    return `<h3>Bank</h3>
      <div class="cards"><div class="stat"><small>Cash on hand</small><b>${money(d.cash)}</b></div><div class="stat"><small>Bank balance</small><b>${money(d.bank)}</b></div>
        <div class="stat"><small>Loans</small><b>${money(d.loans)}</b></div><div class="stat ${od ? "badc" : ""}"><small>Overdraft</small><b>${money(od)}</b></div>
        <div class="stat"><small>Credit limit</small><b>${money0(E.creditLimit(s))}</b></div></div>
      <div class="row gap"><label class="field">Amount<input class="qty wide" id="bankamt" type="number" min="0.01" step="0.01" value="${esc(view.amount)}" data-act="amount"></label>
        <button data-act="deposit">Deposit cash</button><button data-act="withdraw" class="ghost">Withdraw to cash</button>
        <label class="check"><input type="checkbox" data-act="autodep" ${s.autoDeposit ? "checked" : ""}> Auto-deposit till at closing (keep $100)</label></div>
      <p class="muted">Customers pay into the till. Purchases and bills use the bank first, then cash. If both run out, an overdraft covers bills at ${D.OVERDRAFT_RATE * 100}% interest per day.</p>
      ${od > 0 ? `<div class="alert bad">Overdraft ${money(od)}. ${s.distressDays ? `Distress day ${s.distressDays}.` : ""} <button class="mini" data-act="restructure" ${s.day - s.lastBailoutDay < 10 ? 'disabled title="Once every 10 days"' : ""}>Restructure into a rescue loan</button> <span class="muted small">(${(D.RESCUE_RATE * 100).toFixed(1)}%/day, 40 days, -8 reputation)</span></div>` : ""}
      <h4>Loan offers</h4>${offers}<h4>Your loans</h4>${active}
      <h4>Recent bank transactions</h4><div class="scroll"><table class="tbl"><thead><tr><th>Day</th><th>Description</th><th>Amount</th></tr></thead><tbody>${entries || '<tr><td colspan="3" class="muted">Nothing yet.</td></tr>'}</tbody></table></div>`;
  }

  // ---------- FINANCE ----------
  const ACCT_ORDER = ["cash", "bank", "inventory", "transit", "equipment", "loan", "overdraft", "payables", "capital", "sales", "cogs", "rent", "utilities", "wages", "interest", "tax", "marketing", "delivery", "fees", "repairs"];
  function finance(s) {
    const tabsHtml = [["today", "Today"], ["last", "Last day report"], ["sheet", "Balance sheet"], ["ledger", "Ledger audit"], ["history", "History"], ["upcoming", "Upcoming charges"]]
      .map(([id, n]) => `<button class="tab small ${view.finTab === id ? "on" : ""}" data-act="fintab" data-id="${id}">${n}</button>`).join("");
    let inner = "";
    const rec = E.reconcile(s);
    if (view.finTab === "today") {
      const t = E.liveToday(s);
      inner = `<div class="cards"><div class="stat"><small>Revenue so far</small><b>${money(t.revenue)}</b></div><div class="stat"><small>Cost of goods</small><b>${money(t.cogs)}</b></div><div class="stat"><small>Gross profit</small><b>${money(t.gross)}</b></div><div class="stat"><small>Customers</small><b>${t.customers}</b></div></div>
        <p class="muted">Rent, wages, utilities, interest and other costs are charged once, at closing. Lost today: ${t.lost.stockout} to empty shelves, ${t.lost.price} to price, ${t.lost.patience} to waiting.</p>` + unitsTable(s, t.units);
    } else if (view.finTab === "last") inner = s.lastReport ? reportHtml(s, s.lastReport) : `<p class="muted">Finish a day to see the first report.</p>`;
    else if (view.finTab === "sheet") {
      const d = s.derived;
      const row = (n, v, c = "") => `<tr class="${c}"><td>${n}</td><td class="num">${money(v)}</td></tr>`;
      inner = `<div class="split"><table class="tbl"><thead><tr><th colspan="2">Assets</th></tr></thead><tbody>${row("Cash on hand", d.cash)}${row("Bank balance", d.bank)}${row("Inventory (at cost)", d.inventory)}${row("Goods in transit", d.transit)}${row("Equipment & upgrades", d.equipment)}${row("Total assets", d.assets, "tot")}</tbody></table>
        <table class="tbl"><thead><tr><th colspan="2">Liabilities and equity</th></tr></thead><tbody>${row("Bank loans", d.loans)}${row("Overdraft", d.overdraft)}${row("Supplier invoices", d.payables)}${row("Net worth (equity)", d.netWorth, "tot")}${row("Liabilities + equity", d.debt + d.payables + d.netWorth, "tot")}</tbody></table></div>
        <p class="muted">Upgrades are kept at cost (no depreciation). Net worth = assets minus debt. Starting net worth was ${money(s.startNetWorth)}.</p>`;
    } else if (view.finTab === "ledger") {
      const rows = s.ledger.entries.slice(-40).reverse().map(e => `<tr><td>${e.id}</td><td>${e.day}</td><td>${esc(e.memo)}</td><td>${e.lines.map(l => `${l.dr ? "Dr" : "Cr"} ${E.product ? "" : ""}${esc(ACCT_NAME(l.acct))} ${money(l.dr || l.cr)}`).join("<br>")}</td></tr>`).join("");
      inner = `<p class="muted">Every money movement is a balanced double entry. Showing the latest 40 of ${s.ledger.seq} (${s.ledger.archived} older entries are archived into the account totals).</p><div class="scroll tall"><table class="tbl"><thead><tr><th>#</th><th>Day</th><th>Memo</th><th>Lines</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } else if (view.finTab === "history") {
      const h = s.history.slice(-30);
      const max = Math.max(1, ...h.map(x => Math.abs(x.net)));
      inner = h.length ? `<div class="chart">${h.map(x => `<div class="col" title="Day ${x.day}: profit ${money(x.net)}, revenue ${money(x.revenue)}"><i class="${x.net < 0 ? "neg" : ""}" style="height:${Math.max(3, 100 * Math.abs(x.net) / max)}%"></i><small>${x.day}</small></div>`).join("")}</div>
        <p class="muted">Net profit per day (last ${h.length}). Archived earlier: ${s.archive.days} days, revenue ${money(s.archive.revenue)}, profit ${money(s.archive.profit)}.</p>
        <div class="scroll"><table class="tbl"><thead><tr><th>Day</th><th>Customers</th><th>Revenue</th><th>Net profit</th><th>Net worth</th></tr></thead><tbody>${h.slice().reverse().map(x => `<tr><td>${x.day}</td><td>${x.customers}</td><td>${money(x.revenue)}</td><td class="${x.net < 0 ? "neg" : "pos"}">${money(x.net)}</td><td>${money(x.netWorth)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No finished days yet.</p>`;
    } else {
      inner = `<table class="tbl"><thead><tr><th>Charge at closing</th><th>Amount</th></tr></thead><tbody>${E.upcomingCharges(s).map(c => `<tr><td>${esc(c.label)}</td><td class="num">${c.amount == null ? "10% of profit" : money(c.amount)}</td></tr>`).join("")}</tbody></table>
        <p class="muted">Bills are paid from the bank, then cash, then overdraft. Available now: ${money(s.derived.liquid)}.</p>`;
    }
    return `<h3>Finance</h3><div class="row gap wrap">${tabsHtml}<span class="tag ${rec.ok ? "ok" : "bad"}" title="${esc(rec.problems.join(" "))}">Books ${rec.ok ? "reconciled" : "MISMATCH"}</span></div>${inner}`;
  }
  const ACCT_NAME = a => ({ cash: "Cash", bank: "Bank", inventory: "Inventory", transit: "In transit", equipment: "Equipment", loan: "Loans", overdraft: "Overdraft", payables: "Supplier invoices", capital: "Capital", sales: "Sales", cogs: "COGS", rent: "Rent", utilities: "Utilities", wages: "Wages", interest: "Interest", tax: "Tax", marketing: "Marketing", delivery: "Delivery fees", fees: "Bank fees", repairs: "Repairs" }[a] || a);
  function unitsTable(s, units) {
    const rows = Object.entries(units).sort((a, b) => b[1] - a[1]).map(([pid, n]) => `<tr><td>${esc(pName(pid))}</td><td>${n}</td><td>${money(n * s.prices[pid])}</td></tr>`).join("");
    return rows ? `<h4>Sales by product</h4><table class="tbl"><thead><tr><th>Product</th><th>Units</th><th>Revenue</th></tr></thead><tbody>${rows}</tbody></table>` : "";
  }
  function budgetTable(r) {
    const b = r.budget, row = (n, bud, act, v) => `<tr><td>${n}</td><td class="num">${money(bud)}</td><td class="num">${money(act)}</td><td class="num ${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : ""}${money(v)}</td></tr>`;
    return `<table class="tbl"><thead><tr><th>Budget</th><th>Target</th><th>Actual</th><th>Variance</th></tr></thead><tbody>${b.revVar != null ? row("Revenue", b.revenue, r.revenue, b.revVar) : ""}${b.expVar != null ? row("Expenses", b.expenses, r.expenses, b.expVar) : ""}</tbody></table><p class="muted small">Positive variance is good: more revenue or lower expenses than planned.</p>`;
  }
  function reportHtml(s, r) {
    const ex = Object.entries(r.opex).filter(([, v]) => v > 0).map(([k, v]) => `<tr><td>${esc(ACCT_NAME(k))}</td><td class="num">-${money(v)}</td></tr>`).join("");
    const chg = r.charges.map(c => `<div class="muted small">${esc(c.label)}: ${money(c.amount)}${c.over ? ` <span class="neg">(${money(c.over)} on overdraft)</span>` : ""}${c.principal ? " (principal)" : ""}</div>`).join("");
    return `<div class="split"><table class="tbl"><thead><tr><th colspan="2">Income statement - day ${r.day}</th></tr></thead><tbody>
        <tr><td>Revenue</td><td class="num">${money(r.revenue)}</td></tr><tr><td>Cost of goods sold</td><td class="num">-${money(r.cogs)}</td></tr><tr class="tot"><td>Gross profit</td><td class="num">${money(r.gross)}</td></tr>${ex}
        <tr class="tot"><td>Net profit</td><td class="num ${r.net < 0 ? "neg" : "pos"}">${money(r.net)}</td></tr></tbody></table>
      <table class="tbl"><thead><tr><th colspan="2">Cash flow</th></tr></thead><tbody><tr><td>Opening cash + bank</td><td class="num">${money(r.openLiquid)}</td></tr>
        <tr><td>Closing cash + bank</td><td class="num">${money(r.closeLiquid)}</td></tr><tr class="tot"><td>Change</td><td class="num ${r.closeLiquid - r.openLiquid < 0 ? "neg" : "pos"}">${money(r.closeLiquid - r.openLiquid)}</td></tr></tbody></table></div>
      <div class="cards"><div class="stat"><small>Customers</small><b>${r.customers}</b></div><div class="stat"><small>Served</small><b>${r.served}</b></div><div class="stat"><small>Avg wait</small><b>${r.avgWait}s</b></div><div class="stat"><small>Satisfaction</small><b>${Math.round(r.sat)}</b></div></div>
      ${r.forecast ? `<div class="cards"><div class="stat"><small>Forecast</small><b>${r.forecast.expected}</b></div><div class="stat"><small>Actual</small><b>${r.forecast.actual}</b></div><div class="stat"><small>Accuracy</small><b>${Math.round(r.forecast.accuracy * 100)}%</b></div>${r.budget ? `<div class="stat"><small>Budget</small><b>${r.budget.hit ? "met" : "missed"}</b></div>` : ""}</div>` : ""}
      ${r.budget ? budgetTable(r) : ""}
      <h4>Why did it change?</h4><ul class="why">${(r.notes.length ? r.notes : ["A steady day."]).map(n => `<li>${esc(n)}</li>`).join("")}</ul>
      ${chg ? "<h4>Charges at closing</h4>" + chg : ""}${unitsTable(s, r.units)}<p class="muted small">Books ${r.reconciled ? "reconciled" : "did not reconcile"}.</p>`;
  }

  // ---------- UPGRADES ----------
  function upgrades(s) {
    return `<h3>Upgrades</h3><p class="muted">Upgrades change the shop, warehouse and map. They are paid once and kept as equipment on your balance sheet.</p><div class="cards up">${D.UPGRADES.map(u => {
      const lvl = s.upgrades[u.id], maxed = lvl >= u.max, cost = u.costs[lvl], can = !maxed && s.derived.liquid >= cost && (balance(s.ledger, "bank") >= cost || balance(s.ledger, "cash") >= cost);
      return `<div class="upg"><b>${u.name}</b> <span class="tag ${u.cosmetic ? "info" : "ok"}">${u.cosmetic ? "cosmetic" : "gameplay"}</span><div class="lvl">${Array.from({ length: u.max }, (_, i) => `<i class="${i < lvl ? "on" : ""}"></i>`).join("")}</div>
        <div class="muted">${u.effect}</div>${maxed ? '<div class="tag ok">Maxed</div>' : `<button data-act="upgrade" data-id="${u.id}" ${can ? "" : `disabled title="${s.derived.liquid < cost ? "Need " + money0(cost) : "Funds are split between bank and cash: deposit first"}"`}>Buy for ${money0(cost)}</button>`}</div>`;
    }).join("")}</div>`;
  }

  // ---------- GOALS ----------
  function goals(s) {
    const sc = E.score(s);
    const steps = objectives(s);
    const ms = D.MILESTONES.map(m => `<li class="${s.milestones.includes(m.id) ? "done" : ""}">${s.milestones.includes(m.id) ? "✓" : "○"} ${esc(m.name)}</li>`).join("");
    const mode = s.mode === "standard" ? `Standard mode: day <b>${s.day}</b> of ${s.dayLimit}. Score is shown below and finalized after day ${s.dayLimit}.` : `Infinite mode: no end date. Costs rise slowly with inflation, so keep growing.`;
    return `<h3>Goals</h3><p>${mode}</p><div class="split"><div><h4>Getting started</h4><ul class="check">${steps.map(x => `<li class="${x.done ? "done" : ""}">${x.done ? "✓" : "○"} ${esc(x.text)}</li>`).join("")}</ul><h4>Milestones</h4><ul class="check">${ms}</ul></div>
      <div><h4>Score preview: ${sc.total} (${sc.rating})</h4>${sc.parts.map(p => `<div class="kv"><span>${p.name} (${p.w}%)</span><b>${Math.round(p.v * 100)}%</b></div>${bar(p.v, 1)}`).join("")}
      <p class="muted small">Score rewards growth, a healthy cash cushion, low debt, happy customers, few empty shelves and expansion. No single strategy is required.</p></div></div>`;
  }
  function objectives(s) {
    return [
      { text: "Order stock from a supplier (Procurement)", done: s.doneOrders.length > 0 || s.orders.length > 0 },
      { text: "Receive your first delivery", done: s.doneOrders.length > 0 },
      { text: "Put 25+ units on your shelves (Store > Restock)", done: E.shelfUsed(s) >= 25 || s.day > 1 },
      { text: "Make your first sale", done: s.stats.totalSales > 0 },
      { text: "Finish day 1 and read the report", done: s.day > 1 },
      { text: "Check the forecast in Planning and book a campaign", done: s.campaigns.length > 0 || s.decisions.some(d => d.includes("campaign")) },
      { text: "Buy an upgrade or hire your first employee", done: Object.values(s.upgrades).some(v => v) || s.staff.length > 0 },
    ];
  }

  // ---------- event handling ----------
  const bodyEl = body;
  bodyEl.addEventListener("click", e => {
    const t = e.target.closest("[data-act]"); if (!t || t.tagName === "INPUT" || t.tagName === "SELECT") return;
    const s = S(), id = t.dataset.id;
    switch (t.dataset.act) {
      case "restock": run(E.restock(s, id, Number(t.dataset.n))); break;
      case "supplier": view.supplier = id; view.cart = {}; if (view.pay === "terms" && !E.supplier(id).terms) view.pay = "bank"; refresh(); break;
      case "clearcart": view.cart = {}; refresh(); break;
      case "order": {
        const c = cartSummary(s);
        if (c.total > 250 && !confirm(`Place this order for ${money(c.total)}?`)) break;
        const r = run(E.placeOrder(s, { supplier: view.supplier, lines: c.lines, pay: view.pay, cmdId: uid() }));
        if (r.ok) { view.cart = {}; toast(`Order #${r.id} placed. Truck arrives in about ${Math.round(r.lead)}s.`, "ok"); ctx.world.flash(`-${money0(c.total)}`, "#ff9f9f"); refresh(); }
        break;
      }
      case "cancel": run(E.cancelOrder(s, Number(id)), "Order cancelled. Goods refunded."); break;
      case "fire": if (confirm("Let this employee go?")) run(E.fire(s, Number(id))); break;
      case "hire": run(E.hire(s, Number(id)), "Hired."); break;
      case "deposit": { const r = run(E.deposit(s, Number(view.amount), uid())); if (r.ok) ctx.world.flash(`Deposited ${money0(Number(view.amount))}`); break; }
      case "withdraw": run(E.withdraw(s, Number(view.amount), uid())); break;
      case "loan": {
        const def = D.LOANS.find(l => l.id === id), tm = E.loanTerms(def);
        if (!confirm(`Borrow ${money0(def.principal)}? Total cost about ${money(tm.totalCost)} (interest + fee). You repay ${money(tm.installment)} per day.`)) break;
        if (run(E.takeLoan(s, id, uid()), "Loan approved.").ok) ctx.world.flash(`+${money0(def.principal)}`);
        break;
      }
      case "repay": { const v = Number(document.getElementById("rep" + id)?.value); run(E.repayLoan(s, Number(id), v, uid()), "Repayment made."); break; }
      case "payinv": run(E.payInvoice(s, Number(id), uid()), "Invoice paid."); break;
      case "repayall": { const l = s.loans.find(x => x.id === Number(id)); if (l) run(E.repayLoan(s, l.id, l.remaining, uid()), "Loan repaid."); break; }
      case "restructure": if (confirm("Convert your overdraft into a 40-day rescue loan at 0.8%/day? Reputation drops by 8.")) run(E.restructureDebt(s, uid()), "Debt restructured."); break;
      case "upgrade": {
        const u = D.UPGRADES.find(x => x.id === id), cost = u.costs[s.upgrades[id]];
        if (cost >= 300 && !confirm(`Buy ${u.name} for ${money0(cost)}?`)) break;
        run(E.buyUpgrade(s, id, uid()), "Upgrade built.");
        break;
      }
      case "campaign": run(E.launchCampaign(s, id, uid()), "Campaign booked."); break;
      case "tab": open(id); break;
      case "fintab": view.finTab = id; refresh(); break;
    }
  });
  bodyEl.addEventListener("change", e => {
    const t = e.target, s = S(); if (!t.dataset.act) return;
    switch (t.dataset.act) {
      case "price": { const r = E.setPrice(s, t.dataset.id, Number(t.value)); if (!r.ok) toast(r.error, "err"); onChange(); refresh(); break; }
      case "target": run(E.setShelfTarget(s, t.dataset.id, Math.round(Number(t.value)))); break;
      case "budget": {
        const v = id => { const el = bodyEl.querySelector(id); return el && el.value !== "" ? Number(el.value) : 0; };
        run(E.setBudget(s, { revenue: v("#budRev"), expenses: v("#budExp") }), "Budget saved."); break;
      }
      case "cart": view.cart[t.dataset.id] = Math.max(0, Math.min(999, Math.floor(Number(t.value) || 0))); refresh(); break;
      case "pay": view.pay = t.value; refresh(); break;
      case "invcat": view.invCat = t.value; refresh(); break;
      case "autodep": run(E.setAutoDeposit(s, t.checked)); break;
    }
  });
  bodyEl.addEventListener("input", e => {
    const t = e.target;
    if (t.dataset.act === "amount") view.amount = t.value;
    if (t.dataset.act === "invq") { view.invQ = t.value; const pos = t.selectionStart; refresh(); const n = document.getElementById("invq"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
  });
  body.addEventListener("toggle", e => {
    const d = e.target; if (!d.matches || !d.matches("details.tip")) return;
    tipState[d.dataset.tip] = d.open; try { localStorage.setItem("economy-tips", JSON.stringify(tipState)); } catch { /* blocked */ }
  }, true);
  root.addEventListener("click", e => { if (e.target === root || e.target.closest("[data-close]")) close(); });
  tabs.addEventListener("click", e => { const t = e.target.closest("[data-act=tab]"); if (t) open(t.dataset.id); });

  // ---------- dialogs: day report & final ----------
  function dayReport(s, onNext) {
    const dlg = document.getElementById("dayDlg");
    const r = s.lastReport;
    document.getElementById("dayBody").innerHTML = `<h2>Day ${r.day} report</h2>${reportHtml(s, r)}`;
    const btn = document.getElementById("dayNext");
    btn.textContent = s.ended ? "See final results" : `Start day ${s.day + 1}`;
    btn.onclick = () => { dlg.close(); onNext(); };
    if (!dlg.open) dlg.showModal();
  }
  function finalReport(s, handlers) {
    const f = s.ended, dlg = document.getElementById("finalDlg");
    const kv = (a, b) => `<div class="kv"><span>${a}</span><b>${b}</b></div>`;
    document.getElementById("finalBody").innerHTML = `<h2>${f.reason === "completed" ? "Final results" : "Bankrupt"}</h2>
      <div class="grade">${f.score.rating}<small>${f.score.total} / 100</small></div>
      <p>${f.reason === "completed" ? `You ran the shop for ${f.day} days.` : `Overdraft stayed above your limit for 3 days on day ${f.day}.`}</p>
      <div class="split"><div>${kv("Starting net worth", money(f.startNetWorth))}${kv("Ending net worth", money(f.endNetWorth))}${kv("Cash + bank", money(f.cash))}${kv("Inventory", money(f.inventory))}${kv("Debt", money(f.debt))}${kv("Total assets", money(f.assets))}${kv("Total revenue", money(f.revenue))}${kv("Total expenses", money(f.expenses))}${kv("Total profit", money(f.profit))}</div>
      <div>${f.score.parts.map(p => `${kv(p.name, Math.round(p.v * 100) + "%")}${bar(p.v, 1)}`).join("")}</div></div>
      ${f.planning ? `<h4>Planning and service</h4><div class="split"><div>${kv("Forecast accuracy", f.planning.forecastAccuracy == null ? "-" : Math.round(f.planning.forecastAccuracy * 100) + "%")}${kv("Budget days met", f.planning.budgetDays ? `${f.planning.budgetHit} of ${f.planning.budgetDays}` : "no budget set")}</div><div>${kv("Customers served by stock", f.planning.serviceRate == null ? "-" : Math.round(f.planning.serviceRate * 100) + "%")}${kv("Best day profit", money(f.planning.bestDay))}</div></div>` : ""}
      <h4>Key decisions</h4><ul class="why">${f.decisions.map(d => `<li>${esc(d)}</li>`).join("") || "<li>None recorded.</li>"}</ul>`;
    document.getElementById("finalContinue").hidden = f.reason !== "completed";
    document.getElementById("finalContinue").onclick = () => { dlg.close(); handlers.cont(); };
    document.getElementById("finalAgain").onclick = () => { dlg.close(); handlers.again(); };
    if (!dlg.open) dlg.showModal();
  }

  return { open, close, isOpen, refresh, dayReport, finalReport, objectives, PANELS };
}
