// HTML builders for each tab. Pure functions of the engine state: no game rules live here.
import * as E from "./engine.js";
import * as D from "./data.js";
import { getLocation } from "./locations.js";

export const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const money = n => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
export const money2 = n => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = n => Math.round(n).toLocaleString("en-US");
const pct = n => Math.round(n * 100) + "%";
const signCls = n => (n < 0 ? "neg" : n > 0 ? "pos" : "");
const stat = (label, value, sub = "", cls = "") => `<div class="stat"><small>${label}</small><b class="${cls}">${value}</b>${sub ? `<small class="sub">${sub}</small>` : ""}</div>`;
const dayWord = n => (n === 1 ? "1 day" : n + " days");

// ---------- navigation: main tabs and sub tabs (the layout of a business-sim control room) ----------
const ICON = {
  finance: '<text x="8" y="12.5" text-anchor="middle" font-size="13" font-weight="700" fill="currentColor" stroke="none">$</text>',
  retail: '<path d="M2 6l1-3h10l1 3v1H2zM3 7v6h10V7M7 13v-3h2v3"/>',
  warehouse: '<path d="M1 7l7-4 7 4v6H1zM5 13V9h6v4"/>',
  shipping: '<path d="M1 4h8v7H1zM9 6h3l2 2v3H9z"/><circle cx="4" cy="12" r="1.2"/><circle cx="11.5" cy="12" r="1.2"/>',
  b2b: '<path d="M2 9h5v4H2zM9 9h5v4H9zM5.5 4h5v4h-5z"/>',
  mail: '<path d="M1 3h14v10H1zM1 3l7 6 7-6"/>',
  data: '<circle cx="7" cy="7" r="4"/><path d="M10 10l4 4"/>',
  info: '<circle cx="8" cy="8" r="6"/><path d="M8 7v4M8 5v.01"/>',
};
export const NAV = [
  { id: "finance", label: "Finance", subs: [["overview", "Overview"], ["reports", "Reports"]] },
  { id: "retail", label: "Retail", subs: [["location", "Location"], ["procurement", "Procurement"], ["store", "Store"], ["price", "Retail Sales & Price"], ["tx", "Transactions"]] },
  { id: "warehouse", label: "Warehouse", subs: [["stock", "Stock & Storage"], ["procure", "Bulk Procurement"], ["send", "Send to Retail"], ["b2b", "Send to B2B"]] },
  { id: "shipping", label: "Shipping", subs: [["co", "Transport Company"], ["tx", "Transactions"]] },
  { id: "b2b", label: "B2B", subs: [] },
  { id: "mail", label: "Mail", subs: [], iconOnly: true },
  { id: "data", label: "Data Explorer", subs: [] },
  { id: "info", label: "Info", subs: [], iconOnly: true, action: true },
];
const svg = id => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${ICON[id]}</svg>`;
export function navHtml(ui) {
  const main = NAV.map(n => `<button data-main="${n.id}" class="${ui.main === n.id ? "on" : ""}" ${n.iconOnly ? `aria-label="${n.label}"` : ""}>${svg(n.id)}${n.iconOnly ? "" : `<span>${n.label}</span>`}</button>`).join("");
  const cur = NAV.find(n => n.id === ui.main), subs = cur ? cur.subs : [];
  const sub = subs.length > 1 ? subs.map(([id, label]) => `<button data-sub="${id}" class="${ui.sub[ui.main] === id ? "on" : ""}">${label}</button>`).join("") : "";
  return { main, sub };
}
export const soon = (title, text) => `<div class="card soon"><div class="soon-head">${esc(title)}</div><p>${esc(text)}</p><p class="muted small">This section is not working yet. Its rules will be added later.</p>
  <div class="soon-ghost" aria-hidden="true"><button disabled>Action</button><button class="ghost" disabled>Action</button></div></div>`;

export function location(s) {
  const L = getLocation(s.location), d = E.dashboard(s), info = E.siteInfo(s.location, s.area);
  return `<div class="card"><div class="shophead"><b>Location &amp; Rental</b><small>${esc(L.name)}</small></div>
    <div class="kv1"><div><span>Place</span><b>${esc(L.city)}, ${esc(L.country)}</b></div><div><span>Area rented</span><b>${num(s.area)} m²</b></div>
      <div><span>Rent</span><b>${money2(E.rentPerM2(s.location))} / m² / day</b></div><div><span>Rent per day</span><b>${money2(E.dailyRent(s.location, s.area))}</b></div>
      <div><span>Storage capacity</span><b>${num(d.capacity)} space</b></div><div><span>Storage used</span><b>${pct(d.utilization)}</b></div>
      <div><span>Competition</span><b>${Math.round(L.competition * 100)}% of demand</b></div><div><span>Sales per day (est.)</span><b>${money(info.revenue)}</b></div></div>
    <button id="spOpen">Rent more space</button>
    <small class="muted">The shop stays in this district for the whole game. ${esc(L.provenance)}</small></div>`;
}

export function transactions(s) {
  const rows = [...s.ledger.entries].reverse().slice(0, 40).map(e => `<tr><td>${e.day}</td><td class="l">${esc(e.memo)}</td><td>${money2(e.lines.reduce((a, l) => a + (l.dr || 0), 0))}</td></tr>`).join("");
  return `<div class="card scroll"><table class="tbl"><thead><tr><th>Day</th><th class="l">Entry</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table></div><small class="muted">The latest 40 entries of the books. Every sale, purchase and payment is one balanced entry.</small>`;
}

export function warehouse(s, sub = "stock") {
  const w = E.dashboard(s).wh;
  if (sub === "b2b") return soon("Send to B2B", "Selling warehouse stock to other businesses will be here. Sending goods out of the warehouse costs a shipping fee, the same as sending them to your shop.");
  if (!w.rented) return `<div class="card"><b>Warehouse</b><p class="muted">A warehouse is a separate building, much bigger than the shop and cheaper per m². It has its own bulk suppliers. Goods you buy there can be sent to your shop, or later to B2B. Every send costs a shipping fee.</p>
    <div class="kv1"><div><span>Rent</span><b>${money2(E.whRentPerM2(s.location))} / m² / day</b></div><div><span>Size</span><b>${num(D.WH.minArea)} to ${num(D.WH.maxArea)} m²</b></div><div><span>Storage per m²</span><b>${num(D.WH.spacePerM2)}</b></div></div>
    <button class="big" id="whRentOpen">Rent a warehouse</button></div>`;
  const warn = w.used / w.capacity > 0.9 ? "full" : w.used / w.capacity > 0.7 ? "warn" : "";
  if (sub === "procure") {
    const cards = D.WH_SUPPLIERS.map(x => { const km = E.distanceKm(s.location, x), days = Math.max(1, Math.ceil(km / x.speed + x.prep)), L = getLocation(s.location);
      return `<div class="card tco"><div class="tco-head">Bulk supplier</div><h4>${esc(x.name)}</h4><small class="muted">${esc(x.desc)}</small>
        <div class="kv1"><div><span>Price level</span><b>×${x.price.toFixed(2)} of retail cost</b></div><div><span>Minimum order</span><b>${num(D.WH.minQty)} units / product</b></div><div><span>Trip fee</span><b>${money2(x.fee * L.logistics)} / trip</b></div>
        <div><span>Shipping fee</span><b>${money2(x.rate * L.logistics * 1000)} / km / 1,000 space</b></div><div><span>Distance travel</span><b>${num(x.speed)} km / day</b></div><div><span>Distance to my warehouse</span><b>${num(km)} km</b></div>
        <div><span>Delivery time</span><b>${dayWord(days)}</b></div><div><span>Reliability</span><b>${pct(x.reliability)} on time</b></div></div>
        <button data-whsup="${x.id}">Order from here</button></div>`; }).join("");
    return `<div class="card"><b>Bulk procurement</b><p class="muted">Raise a bulk purchase order for the warehouse: at least ${num(D.WH.minQty)} units of each product you pick, up to ${num(D.WH.maxQty)}. Bigger orders get bigger discounts.</p><button class="big" id="whPoOpen">New bulk purchase order</button>
      <small class="note">Space free in the warehouse: ${num(Math.max(0, E.whFree(s)))}.</small></div><div class="tcos">${cards}</div>`;
  }
  if (sub === "send") return `<div class="card"><b>Send to Retail</b><p class="muted">Move goods from the warehouse to your shop. It arrives the next day. Cost: a trip fee of ${money2(D.TRANSFER.fee)} plus ${money2(D.TRANSFER.rate * 1000)} per 1,000 space moved. The shop must have free space.</p>
    <div class="kv1"><div><span>Free space in the shop</span><b>${num(Math.max(0, E.spaceFree(s)))}</b></div><div><span>Goods in the warehouse</span><b>${num(w.units)} units</b></div></div>
    <button class="big" id="trOpen" ${w.units ? "" : "disabled"}>Send goods to the shop</button>${w.units ? "" : '<small class="note">The warehouse is empty. Buy stock first in Bulk procurement.</small>'}</div>`;
  const rows = D.PRODUCTS.map(p => `<tr><td><span class="dot" style="background:${p.color}"></span> ${esc(p.name)}</td><td>${num(s.wh.qty[p.id])}</td><td>${money(s.wh.val[p.id])}</td><td>${num(s.wh.qty[p.id] * p.space)}</td></tr>`).join("");
  return `<div class="card"><b>Warehouse storage: ${pct(w.capacity ? w.used / w.capacity : 0)} used</b><div class="meter ${warn}"><i style="width:${Math.min(100, w.capacity ? w.used / w.capacity * 100 : 0)}%"></i></div>
    <small>${num(w.used)} of ${num(w.capacity)} space used in ${num(w.area)} m². ${num(w.incoming)} more is reserved for deliveries on the way. Rent ${money2(E.whRent(s))} per day.</small><button class="ghost" id="whRentOpen">Rent more warehouse space</button></div>
    <div class="card scroll"><table class="tbl"><thead><tr><th>Product</th><th>In warehouse</th><th>Value</th><th>Space used</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Send-to-shop dialog body. tr = { qty: {pid: n} }.
export function transferForm(s, tr) {
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(label)}</option>`;
  const lines = D.PRODUCTS.map(p => ({ pid: p.id, qty: tr.qty[p.id] || 0 }));
  const q = E.quoteTransfer(s, lines);
  const rows = D.PRODUCTS.map(p => {
    const have = s.wh.qty[p.id], n = tr.qty[p.id] || 0, picks = [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000].filter(v => v < have);
    const cur = n === have && have > 0 ? "all" : n;
    const list = opt(0, "None", cur) + picks.map(v => opt(v, num(v) + " units", cur)).join("") + (have > 0 ? opt("all", `All (${num(have)})`, cur) : "");
    return `<div class="poline"><div class="poname"><b><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</b><small>in warehouse ${num(have)}</small></div><select id="trQty-${p.id}" data-pid="${p.id}" ${have ? "" : "disabled"} aria-label="Quantity of ${esc(p.name)} to send">${list}</select></div>`;
  }).join("");
  const sum = q.error ? `<div class="muted small">${esc(q.error)}</div>` : `<div class="quote">
      ${q.lines.map(l => `<div class="ln"><span>${esc(E.PRODUCT[l.pid].name)} ${num(l.qty)}</span><b>${money2(l.fee)}</b></div>`).join("")}
      <div class="ln"><span>Trip fee</span><b>${money2(D.TRANSFER.fee)}</b></div>
      <div class="ln tot"><span>Shipping fee, paid now</span><b>${money2(q.fee)}</b></div>
      <div class="ln"><span>Arrives</span><b>${dayWord(q.days)}, day ${q.eta}</b></div>
      <div class="ln"><span>Shop space needed</span><b>${num(q.space)} of ${num(Math.max(0, E.spaceFree(s)))} free</b></div></div>
    ${q.errors.map(e => `<div class="err">${esc(e)}</div>`).join("")}`;
  return `<label class="fld"><span>From</span><select disabled><option>My warehouse · ${num(s.wh.area)} m²</option></select></label>
    <label class="fld"><span>To</span><select disabled><option>My shop · ${num(s.area)} m²</option></select></label>
    <div class="fld"><span>Items and quantity</span>${rows}</div>${sum}
    <div class="po-actions"><button class="ghost" id="trCancel" type="button">Cancel</button><button id="trSubmit" type="button" ${q.ok ? "" : "disabled"}>Send${q.fee ? " · " + money2(q.fee) : ""}</button></div>`;
}

export function dashboard(s) {
  const d = E.dashboard(s), warn = d.utilization > 0.9 ? "full" : d.utilization > 0.7 ? "warn" : "";
  const prods = D.PRODUCTS.map(p => `<tr><td><span class="dot" style="background:${p.color}"></span> ${esc(p.name)}</td><td>${num(s.qty[p.id])}</td><td>${money(s.val[p.id])}</td><td>${num(s.stats.prod[p.id].units)}</td></tr>`).join("");
  const lr = s.lastReport;
  return `<div class="grid">
    ${stat("Cash", money2(d.cash), d.overdraft ? `Overdraft ${money2(d.overdraft)}` : "")}
    ${stat("Net profit", money2(d.netProfit), "revenue minus all expenses", signCls(d.netProfit))}
    ${stat("Total revenue", money2(d.revenue))}
    ${stat("Total expenses", money2(d.expenses), "goods sold, rent, shipping")}
    ${stat("Inventory", num(d.inventoryUnits) + " units", money2(d.inventoryValue) + " at cost")}
    ${stat("Products sold", num(d.unitsSold), "units, all days")}
    ${stat("Pending deliveries", d.pending, num(d.pendingUnits) + " units on the way")}
    ${stat("Rent per day", money2(E.dailyRent(s.location, s.area)), `${s.area} m² at ${money2(E.rentPerM2(s.location))}`)}
  </div>
  <div class="card"><b>Storage: ${pct(d.utilization)} used</b><div class="meter ${warn}"><i style="width:${Math.min(100, d.utilization * 100)}%"></i></div>
    <small>${num(d.used)} of ${num(d.capacity)} space used. ${num(d.incoming)} more is reserved for deliveries on the way. Free to order: ${num(Math.max(0, E.spaceFree(s)))}.</small>
    <button class="ghost" id="spOpen">Rent more space</button></div>
  <div class="card scroll"><table class="tbl"><thead><tr><th>Product</th><th>In stock</th><th>Value</th><th>Sold</th></tr></thead><tbody>${prods}</tbody></table></div>
  ${lr ? `<div class="card"><b>Last day (day ${lr.day})</b><div class="kv"><div><span>Revenue</span><b>${money2(lr.revenue)}</b></div><div><span>Net</span><b class="${signCls(lr.net)}">${money2(lr.net)}</b></div>
    <div><span>Units sold</span><b>${num(Object.values(lr.units).reduce((a, b) => a + b, 0))}</b></div><div><span>Missed (no stock)</span><b>${num(Object.values(lr.lost).reduce((a, b) => a + b, 0))}</b></div></div></div>` : ""}`;
}

const kfmt = n => { const a = Math.abs(n); return (n < 0 ? "-" : "") + (a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M" : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "k" : Math.round(a).toLocaleString("en-US")); };
export function store(s, part = "both") {
  const rows = D.PRODUCTS.map(p => { const st = s.stats.prod[p.id];
    return `<tr><th scope="row"><span class="dot" style="background:${p.color}"></span>${esc(p.name.split(" ")[0])}</th><td>${kfmt(st.units)}</td><td>${kfmt(st.rev)}</td><td>${kfmt(st.cogs)}</td><td class="${s.qty[p.id] < 1 ? "neg" : ""}">${kfmt(s.qty[p.id])}</td><td><b>${s.prices[p.id].toFixed(2)}</b></td></tr>`; }).join("");
  const ctl = D.PRODUCTS.map(p => {
    const m = E.margin(s, p.id), b = E.priceBounds(p), out = s.qty[p.id] < 1;
    return `<div class="card"><h4><span class="dot" style="background:${p.color}"></span>${esc(p.name)} ${out ? '<span class="tag bad">out of stock</span>' : ""}</h4>
      <div class="price"><button data-price="${p.id}" data-dir="-1" aria-label="Lower ${esc(p.name)} price" ${s.prices[p.id] <= b.min ? "disabled" : ""}>-</button><output>${money2(s.prices[p.id])}</output><button data-price="${p.id}" data-dir="1" aria-label="Raise ${esc(p.name)} price" ${s.prices[p.id] >= b.max ? "disabled" : ""}>+</button></div>
      <small class="center">Each press: ${money2(p.step)}. Allowed ${money2(b.min)} to ${money2(b.max)}.</small>
      <div class="kv"><div><span>Cost (avg)</span><b>${money2(m.avgCost)}</b></div><div><span>Profit per unit</span><b class="${signCls(m.unit)}">${money2(m.unit)} (${pct(m.pct)})</b></div>
        <div><span>Demand today (est.)</span><b>${num(E.expectedDemand(s, p.id))}</b></div><div><span>Missed sales</span><b>${num(s.stats.prod[p.id].lost)}</b></div></div></div>`;
  }).join("");
  const table = `<div class="card shoptbl"><div class="shophead"><b>My shop</b><small>${esc(E.siteLabel(s.location))} · ${num(s.area)} m²</small></div>
    <table class="tbl fixed"><thead><tr><th></th><th>Unit sold</th><th>Sales ($)</th><th>COGS ($)</th><th>Unit remain</th><th>Price ($)</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const prices = `<div class="prod">${ctl}</div><small class="muted">Higher prices earn more per unit but fewer customers buy. Lower prices bring more buyers for less profit each. Sales only happen while there is stock.</small>`;
  return part === "table" ? table : part === "prices" ? prices : table + `<h2>Set prices</h2>` + prices;
}

// Rent more space dialog body.
export function spaceForm(s, extra, mode = "shop") {
  const wh = mode === "wh", cur = wh ? s.wh.area : s.area, max = wh ? D.WH.maxArea : D.AREA.max, room = max - cur;
  const q = wh ? E.whRentQuote(s, extra) : E.spaceQuote(s, extra), label = wh ? "warehouse" : "shop";
  const steps = (wh ? D.WH.areaSteps : D.SPACE_STEPS).filter(n => n <= room);
  const opts = steps.map(n => `<option value="${n}" ${n === extra ? "selected" : ""}>${wh && !cur ? "" : "+"}${n} m²</option>`).join("");
  if (!opts) return `<div class="err">Your ${label} is already at the ${num(max)} m² limit.</div><div class="po-actions"><button class="ghost" id="spCancel" type="button">Close</button></div>`;
  const now = wh ? E.whRent(s) : E.dailyRent(s.location, s.area), cap = wh ? D.WH.spacePerM2 : D.SPACE_PER_M2;
  return `<label class="fld"><span>${wh && !cur ? "Warehouse size" : "Add space"}</span><select id="spExtra">${opts}</select></label>
    <div class="quote">
      <div class="ln"><span>Now</span><b>${cur ? `${num(cur)} m² · ${money2(now)} / day` : "No warehouse yet"}</b></div>
      <div class="ln"><span>Price</span><b>${money2(q.rate)} / m² / day</b></div>
      <div class="ln tot"><span>After</span><b>${num(q.newArea)} m²</b></div>
      <div class="ln"><span>Rent per day</span><b>${money2(q.newRent)} (+${money2(q.extraRent)})</b></div>
      <div class="ln"><span>Storage</span><b>${num(q.newCapacity)} (+${num(q.addedCapacity)})</b></div>
      <div class="ln"><span>Storage per m²</span><b>${num(cap)}</b></div></div>
    ${q.errors.map(e => `<div class="err">${esc(e)}</div>`).join("")}
    <small class="note">${wh ? "The warehouse is a separate, bigger building. Rent is charged at the end of every day. Goods bought from bulk suppliers arrive here, then you send them to the shop (or later to B2B) for a shipping fee." : "The new space is yours right away. Rent for it is charged at the end of every day from now on, and a bigger shop attracts more customers."}</small>
    <div class="po-actions"><button class="ghost" id="spCancel" type="button">Cancel</button><button id="spSubmit" type="button" ${q.ok ? "" : "disabled"}>${wh && !cur ? "Rent warehouse" : "Rent +" + q.extra + " m²"}</button></div>`;
}

export function buy(s, ui) {
  const open = s.orders.length;
  return `<div class="card"><b>Procurement</b><p class="muted">Raise a purchase order: pick a supplier, then a quantity for each of the three products. All items in one order ship together and pay one shipping fee. You see the total and the delivery day before you submit.</p>
    <button class="big" id="poOpen">New purchase order</button>
    <small class="note">${open ? `${open} shipment${open > 1 ? "s" : ""} on the way. See Deliveries.` : "No shipments on the way."}</small></div>`;
}

// The purchase order form shown in the order dialog: one supplier, one quantity list per product, a live quote, Submit.
export function orderForm(s, b) {
  const wh = b.mode === "wh", sp = E.SUPPLIER[b.sup], list0 = wh ? D.WH_SUPPLIERS : D.SUPPLIERS, choices = wh ? D.WH_QTY : D.QTY_CHOICES, maxQ = wh ? D.WH.maxQty : D.MAX_QTY;
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(label)}</option>`;
  const sups = list0.map(x => { const km = E.distanceKm(s.location, x), days = Math.max(1, Math.ceil(km / x.speed + x.prep)); return opt(x.id, `${x.name} · ${num(km)} km · ${dayWord(days)}`, b.sup); }).join("");
  const lines = D.PRODUCTS.map(p => ({ pid: p.id, qty: b.qty[p.id] || 0 }));
  const q = E.quoteMulti(s, b.sup, lines, wh ? "wh" : "retail");
  const rows = D.PRODUCTS.map(p => {
    const n = b.qty[p.id] || 0, custom = n > 0 && !choices.includes(n);
    const cur = custom ? "custom" : n;
    const list = opt(0, "None", cur) + choices.map(v => opt(v, num(v) + " units", cur)).join("") + opt("custom", "Custom amount...", cur);
    return `<div class="poline"><div class="poname"><b><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</b><small>${money2(E.unitCost(s, sp, p.id))} each</small></div>
      <select id="poQty-${p.id}" data-pid="${p.id}" aria-label="Quantity of ${esc(p.name)}">${list}</select>
      ${custom ? `<input id="poCustom-${p.id}" data-pid="${p.id}" type="number" min="${wh ? D.WH.minQty : 1}" max="${maxQ}" step="1" inputmode="numeric" value="${n}" aria-label="Custom quantity of ${esc(p.name)}">` : ""}</div>`;
  }).join("");
  const sum = q.error ? `<div class="muted small">${esc(q.error)}</div>` : `<div class="quote">
      ${q.lines.map(l => `<div class="ln"><span>${esc(E.PRODUCT[l.pid].name)} ${num(l.qty)} × ${money2(l.unit)}${l.discount ? ` (bulk −${Math.round(l.discount * 100)}%)` : ""}</span><b>${money2(l.goods)}</b></div>`).join("")}
      <div class="ln"><span>Goods</span><b>${money2(q.goods)}</b></div>
      <div class="ln"><span>Shipping (${num(q.km)} km, one fee)</span><b>${money2(q.ship)}</b></div>
      <div class="ln tot"><span>Total, paid now</span><b>${money2(q.total)}</b></div>
      <div class="ln"><span>Estimated delivery</span><b>${dayWord(q.days)}, day ${q.eta}</b></div>
      <div class="ln"><span>Storage needed</span><b>${num(q.space)} of ${num(Math.max(0, wh ? E.whFree(s) : E.spaceFree(s)))} free</b></div></div>
    ${q.errors.map(e => `<div class="err">${esc(e)}</div>`).join("")}
    <small class="note">${wh ? "Bulk discounts per product: 25,000+ units −4%, 50,000+ −8%, 100,000+ −12%, 200,000+ −16%, 500,000+ −20%. At least 25,000 of each product you order." : "Bulk discounts per product: 10,000+ units −3%, 30,000+ −6%, 75,000+ −10%, 125,000+ −13%."}${sp.reliability < 1 ? ` ${esc(sp.name)} is late about ${Math.round((1 - sp.reliability) * 100)}% of the time.` : ""}</small>`;
  return `<label class="fld"><span>Ship to</span><select id="poShip" disabled><option>${wh ? `My warehouse · ${num(s.wh.area)} m²` : `My shop · ${esc(E.siteLabel(s.location))} · ${num(s.area)} m²`}</option></select></label>
    <label class="fld"><span>Supplier</span><select id="poSup">${sups}</select></label>
    <div class="fld"><span>Items and quantity</span>${rows}</div>
    ${sum}
    <div class="po-actions"><button class="ghost" id="poCancel" type="button">Cancel</button><button id="poSubmit" type="button" ${q.ok ? "" : "disabled"}>Submit${q.total ? " · " + money2(q.total) : ""}</button></div>`;
}

export function ship(s, ui = {}) {
  const tab = ui.sub && ui.sub.shipping === "tx" ? "tx" : "co", sub = "";
  if (tab === "co") {
    const cards = D.SUPPLIERS.map(x => {
      const km = E.distanceKm(s.location, x), days = Math.max(1, Math.ceil(km / x.speed + x.prep)), fee = x.fee * getLocation(s.location).logistics, rate = x.rate * getLocation(s.location).logistics;
      return `<div class="card tco"><div class="tco-head">Transport Company</div><h4>${esc(x.name)}</h4><small class="muted">${esc(x.desc)}</small>
        <div class="kv1"><div><span>Trip fee</span><b>${money2(fee)} / trip</b></div><div><span>Shipping fee</span><b>${money2(rate * 1000)} / km / 1,000 space</b></div>
        <div><span>Distance travel</span><b>${num(x.speed)} km / day</b></div><div><span>Distance to my shop</span><b>${num(km)} km</b></div>
        <div><span>Delivery time</span><b>${dayWord(days)}</b></div><div><span>Reliability</span><b>${pct(x.reliability)} on time</b></div></div>
        <button data-posup="${x.id}">Order from here</button></div>`;
    }).join("");
    return sub + `<div class="tcos">${cards}</div><small class="muted">Each supplier delivers with its own trucks. Cost of an order = one trip fee + shipping fee × distance × space the goods take. The fastest delivery is one day.</small>`;
  }
  const rows = [...s.orders].sort((a, b) => a.eta - b.eta).map(o => {
    const st = E.orderStatus(s, o), cls = st === "Delayed" ? "warn" : st === "Arriving today" ? "ok" : "info";
    return `<tr><td>#${o.id}</td><td>${esc(E.PRODUCT[o.pid].name)}</td><td>${num(o.qty)}</td><td>${o.kind === "transfer" ? "Warehouse → Shop" : esc(E.SUPPLIER[o.sup].name) + (o.dest === "wh" ? " → Warehouse" : "")}</td><td><span class="tag ${cls}">${st}</span></td><td>Day ${o.eta} (${o.eta <= s.day ? "today" : "in " + dayWord(o.eta - s.day)})</td><td>${money2(o.goods + o.ship)}</td></tr>`;
  }).join("");
  const recent = s.log.filter(l => /^Delivery/.test(l.text)).slice(-6).reverse().map(l => `<div><small>Day ${l.day}</small> ${esc(l.text)}</div>`).join("");
  return sub + `<div class="card scroll">${rows ? `<table class="tbl"><thead><tr><th>Order</th><th>Product</th><th>Units</th><th>Supplier</th><th>Status</th><th>Arrives</th><th>Paid</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="muted">No shipments on the way. Open Procurement to order stock. The fastest delivery takes 1 day.</p>`}</div>
    <div class="card"><b>Delivered recently</b>${recent || '<small class="muted">Nothing has arrived yet.</small>'}<small class="muted">Deliveries go straight into inventory and are for sale at once.</small></div>`;
}

export function chart(s) {
  const h = s.history.slice(-30); if (!h.length) return "";
  const max = Math.max(1, ...h.map(x => Math.abs(x.net)));
  return `<div class="chart" role="img" aria-label="Net profit per day">${h.map(x => `<div class="col"><i class="${x.net < 0 ? "neg" : ""}" style="height:${Math.max(3, Math.abs(x.net) / max * 100)}%"></i><small>${x.day}</small></div>`).join("")}</div>`;
}
export function reports(s) {
  const h = [...s.history].reverse();
  const tot = s.history.reduce((a, x) => ({ rev: a.rev + x.revenue, cogs: a.cogs + x.cogs, ship: a.ship + x.shipping, rent: a.rent + x.rent, net: a.net + x.net }), { rev: 0, cogs: 0, ship: 0, rent: 0, net: 0 });
  const rows = h.map(x => `<tr><td>${x.day}</td><td>${money(x.revenue)}</td><td>${money(x.cogs)}</td><td>${money(x.shipping)}</td><td>${money(x.rent)}</td><td class="${signCls(x.net)}">${money(x.net)}</td><td>${num(Object.values(x.units).reduce((a, b) => a + b, 0))}</td><td>${num(Object.values(x.lost).reduce((a, b) => a + b, 0))}</td></tr>`).join("");
  return `<div class="card"><b>Net profit per day</b>${s.history.length ? chart(s) : '<small class="muted">The first day report appears when day 1 ends.</small>'}</div>
    <div class="card scroll"><table class="tbl"><thead><tr><th>Day</th><th>Revenue</th><th>Goods</th><th>Shipping</th><th>Rent</th><th>Net</th><th>Sold</th><th>Missed</th></tr></thead><tbody>${rows}</tbody>
    ${s.history.length ? `<tfoot><tr><td>Total</td><td>${money(tot.rev)}</td><td>${money(tot.cogs)}</td><td>${money(tot.ship)}</td><td>${money(tot.rent)}</td><td class="${signCls(tot.net)}">${money(tot.net)}</td><td></td><td></td></tr></tfoot>` : ""}</table></div>
    <small class="muted">Goods = cost of the units sold. Stock you bought but have not sold is not an expense yet: it sits in inventory.</small>`;
}

export function finalReport(s) {
  const r = E.finalReport(s), bust = r.reason === "bankrupt";
  const rows = r.rows.map(x => `<tr><td>${esc(x.name)}</td><td>${num(x.units)}</td><td>${money(x.revenue)}</td><td>${money(x.cogs)}</td><td>${money(x.shipping)}</td><td class="${signCls(x.profit)}">${money(x.profit)}</td><td>${num(x.left)}</td></tr>`).join("");
  return `<h2>${bust ? "Bankrupt" : "Final business report"}</h2>
    <div class="grade">${r.rating}<small>${bust ? "Rent went unpaid for three days." : `${s.days} days in ${esc(E.siteLabel(s.location))}`}</small></div>
    <div class="grid">${stat("Total revenue", money(r.revenue))}${stat("Total expenses", money(r.expenses), `rent ${money(r.rent)} · shipping ${money(r.shipping)}`)}${stat("Net profit", money(r.netProfit), "", signCls(r.netProfit))}${stat("Cash", money(r.cash))}
      ${stat("Remaining inventory", num(r.inventoryUnits) + " units", money(r.inventoryValue) + " at cost")}${stat("Products sold", num(r.unitsSold))}${stat("Net worth", money(r.netWorth), "cash + inventory − debt")}${stat("Most profitable", r.best ? esc(r.best.name) : "none", r.best ? money(r.best.profit) + " profit" : "")}</div>
    <div class="scroll" style="margin-top:10px"><table class="tbl"><thead><tr><th>Product</th><th>Sold</th><th>Revenue</th><th>Goods</th><th>Shipping</th><th>Profit</th><th>Left</th></tr></thead><tbody>${rows}</tbody></table></div>
    <small class="muted">Product profit = revenue − cost of goods − shipping. Rent is shared by the whole shop, so it is not split by product.</small>`;
}

export const HELP = `<h4>The goal</h4><p>Rent a shop, buy stock, set prices, and finish the chosen number of days with the most profit.</p>
<h4>Location and size</h4><p>Pick a place on the map. Each place has its own customers, rent per m² and competition. The m² you rent sets how much stock you can hold, and you pay rent every day.</p>
<h4>Three products</h4><ul><li>Instant noodles: many sales, small margin.</li><li>Fresh milk: steady sales, takes twice the space.</li><li>Earbuds: few sales, big margin, little space.</li></ul>
<h4>Buying</h4><p>In Procurement, raise a purchase order: pick a supplier, then a quantity for each of the three products from the list. You see the total, the bulk discounts and the delivery time before you submit. Suppliers never run out. They differ in price, distance, shipping and reliability. The fastest delivery is one day.</p>
<h4>Deliveries and sales</h4><p>Trucks bring goods on their arrival day, and the goods go into inventory by themselves. Customers buy automatically while stock lasts. There is no shelf work and there are no staff.</p>
<h4>Prices</h4><p>In Store, use - and + to change each price. Too high and fewer people buy. Too low and you earn little per unit.</p>
<h4>Time</h4><p>One day lasts the number of real seconds you chose. The timer runs by itself. Use Pause if you need a break. If rent cannot be paid from cash, it becomes an overdraft, and three days of overdraft ends the game.</p>`;
