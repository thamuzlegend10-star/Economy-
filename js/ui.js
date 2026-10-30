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
export function store(s) {
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
  return `<div class="card shoptbl"><div class="shophead"><b>My shop</b><small>${esc(E.siteLabel(s.location))} · ${num(s.area)} m²</small></div>
    <table class="tbl fixed"><thead><tr><th></th><th>Unit sold</th><th>Sales ($)</th><th>COGS ($)</th><th>Unit remain</th><th>Price ($)</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h2>Set prices</h2><div class="prod">${ctl}</div>
    <small class="muted">Higher prices earn more per unit but fewer customers buy. Lower prices bring more buyers for less profit each. Sales only happen while there is stock.</small>`;
}

// Rent more space dialog body.
export function spaceForm(s, extra) {
  const q = E.spaceQuote(s, extra), room = D.AREA.max - s.area;
  const opts = D.SPACE_STEPS.filter(n => n <= room).map(n => `<option value="${n}" ${n === extra ? "selected" : ""}>+${n} m²</option>`).join("");
  if (!opts) return `<div class="err">Your shop is already at the ${D.AREA.max} m² limit.</div><div class="po-actions"><button class="ghost" id="spCancel" type="button">Close</button></div>`;
  return `<label class="fld"><span>Add space</span><select id="spExtra">${opts}</select></label>
    <div class="quote">
      <div class="ln"><span>Now</span><b>${num(s.area)} m² · ${money2(E.dailyRent(s.location, s.area))} / day</b></div>
      <div class="ln"><span>Price</span><b>${money2(q.rate)} / m² / day</b></div>
      <div class="ln tot"><span>After</span><b>${num(q.newArea)} m²</b></div>
      <div class="ln"><span>Rent per day</span><b>${money2(q.newRent)} (+${money2(q.extraRent)})</b></div>
      <div class="ln"><span>Storage</span><b>${num(q.newCapacity)} (+${num(q.addedCapacity)})</b></div></div>
    ${q.errors.map(e => `<div class="err">${esc(e)}</div>`).join("")}
    <small class="note">The new space is yours right away. Rent for it is charged at the end of every day from now on, and a bigger shop attracts more customers.</small>
    <div class="po-actions"><button class="ghost" id="spCancel" type="button">Cancel</button><button id="spSubmit" type="button" ${q.ok ? "" : "disabled"}>Rent +${q.extra} m²</button></div>`;
}

export function buy(s, ui) {
  const open = s.orders.length;
  return `<div class="card"><b>Procurement</b><p class="muted">Raise a purchase order: pick a supplier, then a quantity for each of the three products. All items in one order ship together and pay one shipping fee. You see the total and the delivery day before you submit.</p>
    <button class="big" id="poOpen">New purchase order</button>
    <small class="note">${open ? `${open} shipment${open > 1 ? "s" : ""} on the way. See Deliveries.` : "No shipments on the way."}</small></div>`;
}

// The purchase order form shown in the order dialog: one supplier, one quantity list per product, a live quote, Submit.
export function orderForm(s, b) {
  const sp = E.SUPPLIER[b.sup];
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(label)}</option>`;
  const sups = D.SUPPLIERS.map(x => { const km = E.distanceKm(s.location, x), days = Math.max(1, Math.ceil(km / x.speed + x.prep)); return opt(x.id, `${x.name} · ${num(km)} km · ${dayWord(days)}`, b.sup); }).join("");
  const lines = D.PRODUCTS.map(p => ({ pid: p.id, qty: b.qty[p.id] || 0 }));
  const q = E.quoteMulti(s, b.sup, lines);
  const rows = D.PRODUCTS.map(p => {
    const n = b.qty[p.id] || 0, custom = n > 0 && !D.QTY_CHOICES.includes(n);
    const cur = custom ? "custom" : n;
    const list = opt(0, "None", cur) + D.QTY_CHOICES.map(v => opt(v, num(v) + " units", cur)).join("") + opt("custom", "Custom amount...", cur);
    return `<div class="poline"><div class="poname"><b><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</b><small>${money2(E.unitCost(s, sp, p.id))} each</small></div>
      <select id="poQty-${p.id}" data-pid="${p.id}" aria-label="Quantity of ${esc(p.name)}">${list}</select>
      ${custom ? `<input id="poCustom-${p.id}" data-pid="${p.id}" type="number" min="1" max="${D.MAX_QTY}" step="1" inputmode="numeric" value="${n}" aria-label="Custom quantity of ${esc(p.name)}">` : ""}</div>`;
  }).join("");
  const sum = q.error ? `<div class="muted small">${esc(q.error)}</div>` : `<div class="quote">
      ${q.lines.map(l => `<div class="ln"><span>${esc(E.PRODUCT[l.pid].name)} ${num(l.qty)} × ${money2(l.unit)}${l.discount ? ` (bulk −${Math.round(l.discount * 100)}%)` : ""}</span><b>${money2(l.goods)}</b></div>`).join("")}
      <div class="ln"><span>Goods</span><b>${money2(q.goods)}</b></div>
      <div class="ln"><span>Shipping (${num(q.km)} km, one fee)</span><b>${money2(q.ship)}</b></div>
      <div class="ln tot"><span>Total, paid now</span><b>${money2(q.total)}</b></div>
      <div class="ln"><span>Estimated delivery</span><b>${dayWord(q.days)}, day ${q.eta}</b></div>
      <div class="ln"><span>Storage needed</span><b>${num(q.space)} of ${num(Math.max(0, E.spaceFree(s)))} free</b></div></div>
    ${q.errors.map(e => `<div class="err">${esc(e)}</div>`).join("")}
    <small class="note">Bulk discounts per product: 10,000+ units −3%, 30,000+ −6%, 75,000+ −10%, 125,000+ −13%.${sp.reliability < 1 ? ` ${esc(sp.name)} is late about ${Math.round((1 - sp.reliability) * 100)}% of the time.` : ""}</small>`;
  return `<label class="fld"><span>Ship to</span><select id="poShip" disabled><option>My shop · ${esc(E.siteLabel(s.location))} · ${num(s.area)} m²</option></select></label>
    <label class="fld"><span>Supplier</span><select id="poSup">${sups}</select></label>
    <div class="fld"><span>Items and quantity</span>${rows}</div>
    ${sum}
    <div class="po-actions"><button class="ghost" id="poCancel" type="button">Cancel</button><button id="poSubmit" type="button" ${q.ok ? "" : "disabled"}>Submit${q.total ? " · " + money2(q.total) : ""}</button></div>`;
}

export function ship(s, ui = {}) {
  const tab = ui.shipTab === "tx" ? "tx" : "co";
  const sub = `<div class="subtabs" role="tablist"><button class="${tab === "co" ? "on" : ""}" data-shiptab="co" role="tab">Transport Company</button><button class="${tab === "tx" ? "on" : ""}" data-shiptab="tx" role="tab">Transactions</button></div>`;
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
    return `<tr><td>#${o.id}</td><td>${esc(E.PRODUCT[o.pid].name)}</td><td>${num(o.qty)}</td><td>${esc(E.SUPPLIER[o.sup].name)}</td><td><span class="tag ${cls}">${st}</span></td><td>Day ${o.eta} (${o.eta <= s.day ? "today" : "in " + dayWord(o.eta - s.day)})</td><td>${money2(o.goods + o.ship)}</td></tr>`;
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
