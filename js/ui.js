// HTML builders for each tab. Pure functions of the engine state: no game rules live here.
import * as E from "./engine.js";
import * as D from "./data.js";

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
    <small>${num(d.used)} of ${num(d.capacity)} space used. ${num(d.incoming)} more is reserved for deliveries on the way. Free to order: ${num(Math.max(0, E.spaceFree(s)))}.</small></div>
  <div class="card scroll"><table class="tbl"><thead><tr><th>Product</th><th>In stock</th><th>Value</th><th>Sold</th></tr></thead><tbody>${prods}</tbody></table></div>
  ${lr ? `<div class="card"><b>Last day (day ${lr.day})</b><div class="kv"><div><span>Revenue</span><b>${money2(lr.revenue)}</b></div><div><span>Net</span><b class="${signCls(lr.net)}">${money2(lr.net)}</b></div>
    <div><span>Units sold</span><b>${num(Object.values(lr.units).reduce((a, b) => a + b, 0))}</b></div><div><span>Missed (no stock)</span><b>${num(Object.values(lr.lost).reduce((a, b) => a + b, 0))}</b></div></div></div>` : ""}`;
}

export function store(s) {
  return `<div class="prod">${D.PRODUCTS.map(p => {
    const m = E.margin(s, p.id), b = E.priceBounds(p), st = s.stats.prod[p.id], out = s.qty[p.id] < 1;
    return `<div class="card"><h4><span class="dot" style="background:${p.color}"></span>${esc(p.name)} ${out ? '<span class="tag bad">out of stock</span>' : ""}</h4><small>${esc(p.note)}</small>
      <div class="price"><button data-price="${p.id}" data-dir="-1" aria-label="Lower ${esc(p.name)} price" ${s.prices[p.id] <= b.min ? "disabled" : ""}>-</button><output>${money2(s.prices[p.id])}</output><button data-price="${p.id}" data-dir="1" aria-label="Raise ${esc(p.name)} price" ${s.prices[p.id] >= b.max ? "disabled" : ""}>+</button></div>
      <small class="center">Each press changes the price by ${money2(p.step)}. Allowed: ${money2(b.min)} to ${money2(b.max)}.</small>
      <div class="kv"><div><span>Purchase cost (avg)</span><b>${money2(m.avgCost)}</b></div><div><span>Profit per unit</span><b class="${signCls(m.unit)}">${money2(m.unit)} (${pct(m.pct)})</b></div>
        <div><span>In stock</span><b>${num(s.qty[p.id])}</b></div><div><span>Units sold</span><b>${num(st.units)}</b></div>
        <div><span>Demand today (est.)</span><b>${num(E.expectedDemand(s, p.id))}</b></div><div><span>Missed sales</span><b>${num(st.lost)}</b></div></div></div>`;
  }).join("")}</div><small class="muted">Higher prices earn more per unit but fewer customers buy. Lower prices bring more buyers for less profit each. Sales only happen while there is stock.</small>`;
}

export function buy(s, ui) {
  const b = ui.buy, sp = E.SUPPLIER[b.sup], p = E.PRODUCT[b.pid], q = E.quote(s, b.sup, b.pid, b.qty);
  const sups = D.SUPPLIERS.map(x => {
    const km = E.distanceKm(s.location, x), days = Math.max(1, Math.ceil(km / x.speed + x.prep));
    return `<button class="sup ${x.id === b.sup ? "on" : ""}" data-sup="${x.id}"><b>${esc(x.name)}</b><small>${esc(x.desc)}</small><small>${num(km)} km · delivery ${dayWord(days)} · reliability ${pct(x.reliability)}</small><small>Price ×${(x.price * s.supIdx[x.id]).toFixed(2)} · shipping from ${money2(x.fee)}</small></button>`;
  }).join("");
  const prods = D.PRODUCTS.map(x => `<button class="pbtn ${x.id === b.pid ? "on" : ""}" data-pid="${x.id}"><b>${esc(x.name)}</b><small>${money2(E.unitCost(s, sp, x.id))} each</small><small>stock ${num(s.supStock[b.sup][x.id])}</small></button>`).join("");
  const qty = D.QTY_CHOICES.map(n => `<button class="ghost ${n === b.qty ? "on" : ""}" data-qty="${n}">${num(n)}</button>`).join("");
  let quote;
  if (q.error) quote = `<div class="err">${esc(q.error)}</div>`;
  else quote = `<div class="quote">
      <div class="ln"><span>Quantity</span><b>${num(q.qty)} ${esc(p.name)}</b></div>
      <div class="ln"><span>Unit price${q.discount ? ` (bulk −${Math.round(q.discount * 100)}%)` : ""}</span><b>${money2(q.unit)}</b></div>
      <div class="ln"><span>Goods</span><b>${money2(q.goods)}</b></div>
      <div class="ln"><span>Shipping (${num(q.km)} km)</span><b>${money2(q.ship)}</b></div>
      <div class="ln tot"><span>Total</span><b>${money2(q.total)}</b></div>
      <div class="ln"><span>Estimated delivery</span><b>${dayWord(q.days)} → day ${q.eta}</b></div>
      <div class="ln"><span>Storage this needs</span><b>${num(q.space)} of ${num(Math.max(0, E.spaceFree(s)))} free</b></div>
      <div class="ln"><span>Supplier stock</span><b>${num(q.stock)}</b></div></div>
    ${q.errors.map(e => `<div class="err">${esc(e)}</div>`).join("")}
    ${q.ok ? `<small class="note">Bulk discounts: 10,000+ units −3%, 30,000+ −6%, 75,000+ −10%, 125,000+ −13%. ${sp.reliability < 1 ? `${sp.name} is late about ${Math.round((1 - sp.reliability) * 100)}% of the time.` : ""}</small>` : ""}`;
  return `<div class="card"><b>1. Supplier</b><div class="sups">${sups}</div></div>
    <div class="card"><b>2. Product</b><div class="pbtns">${prods}</div></div>
    <div class="card"><b>3. Quantity</b><div class="qty">${qty}</div>
      <div class="row"><input id="qCustom" type="number" min="1" max="${D.MAX_QTY}" step="1" inputmode="numeric" placeholder="Custom amount" value="${D.QTY_CHOICES.includes(b.qty) ? "" : b.qty}" aria-label="Custom quantity"><button class="ghost" id="qSet">Use amount</button></div></div>
    <div class="card"><b>4. Check and confirm</b>${quote}<button class="big" id="bConfirm" ${q.ok ? "" : "disabled"}>Confirm order${q.total ? " · " + money2(q.total) : ""}</button></div>`;
}

export function ship(s) {
  const rows = [...s.orders].sort((a, b) => a.eta - b.eta).map(o => {
    const st = E.orderStatus(s, o), cls = st === "Delayed" ? "warn" : st === "Arriving today" ? "ok" : "info";
    return `<tr><td>#${o.id}</td><td>${esc(E.PRODUCT[o.pid].name)}</td><td>${num(o.qty)}</td><td>${esc(E.SUPPLIER[o.sup].name)}</td><td><span class="tag ${cls}">${st}</span></td><td>Day ${o.eta} (${o.eta <= s.day ? "today" : "in " + dayWord(o.eta - s.day)})</td><td>${money2(o.goods + o.ship)}</td></tr>`;
  }).join("");
  const recent = s.log.filter(l => /^Delivery/.test(l.text)).slice(-6).reverse().map(l => `<div><small>Day ${l.day}</small> ${esc(l.text)}</div>`).join("");
  return `<div class="card scroll">${rows ? `<table class="tbl"><thead><tr><th>Order</th><th>Product</th><th>Units</th><th>Supplier</th><th>Status</th><th>Arrives</th><th>Paid</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="muted">No shipments on the way. Open the Buy tab to order stock. The fastest delivery takes one day.</p>`}</div>
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
<h4>Buying</h4><p>In Buy, pick a supplier, a product and a quantity. You see the total, the bulk discount and the delivery time before you confirm. Suppliers differ in price, stock, distance, shipping and reliability. The fastest delivery is one day.</p>
<h4>Deliveries and sales</h4><p>Trucks bring goods on their arrival day, and the goods go into inventory by themselves. Customers buy automatically while stock lasts. There is no shelf work and there are no staff.</p>
<h4>Prices</h4><p>In Store, use - and + to change each price. Too high and fewer people buy. Too low and you earn little per unit.</p>
<h4>Time</h4><p>One day lasts the number of real seconds you chose. The timer runs by itself. Use Pause if you need a break. If rent cannot be paid from cash, it becomes an overdraft, and three days of overdraft ends the game.</p>`;
