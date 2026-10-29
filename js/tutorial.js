// Guided tutorial: a short card that walks a new player through the first day.
// Action steps wait for the player to really do the thing (checked against game state).
import * as E from "./engine.js";

const KEY = "economy-tutorial-v3";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = o => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* storage blocked */ } };

export function createTutorial({ getState, ui, world, setPaused }) {
  const card = document.getElementById("tutCard");
  let idx = -1, active = false, hl = null, ctx = {}, advancing = false;

  const steps = [
    { title: "Welcome to Economy", pause: true,
      body: "You run a corner shop. Buy goods from suppliers, put them on shelves, and customers pay you. One business day lasts about four minutes (08:00 to 20:00). Your goal: make a steady <b>net profit</b> (the top bar shows it) and grow your wealth. This short tour shows you how." },
    { title: "Your dashboard", target: "#hud", pause: true,
      body: "<b>Cash</b> is money in the till: sales land here. <b>Bank</b> pays suppliers and bills. <b>Debt</b> is loans and overdraft. <b>Net worth</b> is everything you own minus debt, the number that really matters. <b>Happiness</b> decides how many customers visit." },
    { title: "Your business district", target: ".stage-card", pause: true,
      body: "Trucks come from the <b>Supplier Depot</b>, goods wait in the <b>Warehouse</b>, customers visit the <b>Corner Shop</b>, and the <b>Bank</b> holds your money. Click any building to open its tools. Drag to pan, scroll to zoom. The tabs above show inside views." },
    { title: "Order stock", target: "#manage [data-panel=procure]", pause: false, openPanel: "procure", action: "Place your first order",
      body: "Your shelves hold very little. Open <b>Procurement</b>, pick a supplier, type quantities (try 15 each of Apple, Bread, Milk and Water) and press <b>Place order</b>. You pay the goods plus a delivery fee.",
      enter: s => ({}), done: s => s.orders.length > 0 || s.doneOrders.length > 0 },
    { title: "Watch the delivery", target: ".ctrl", pause: false, scene: "district", action: "Wait for the truck to unload", closePanel: true,
      body: "A truck drives from the Supplier Depot to your Warehouse and workers unload it. Goods only count as stock after unloading. Use <b>2x</b> or <b>4x</b> speed to wait faster.",
      done: s => s.doneOrders.length > 0 },
    { title: "Fill the shelves", target: "#manage [data-panel=store]", pause: false, openPanel: "store", action: "Move goods to the shelves",
      body: "Goods in the warehouse <b>cannot be sold</b>. In <b>Store</b>, press <b>Restock</b> on a product to move it to the shelf. Better: set an <b>Auto target</b> (for example 12) and stockers refill it for you.",
      enter: s => ({ base: E.shelfUsed(s) }), done: (s, c) => s.tasks.length > 0 || E.shelfUsed(s) >= (c.base || 0) + 10 },
    { title: "Set smart prices", target: "#manage [data-panel=store]", pause: true, openPanel: "store",
      body: "Every product has a price in <b>Store</b>. Customers expect a fair price, and the default is about 12% above it. Higher price means more profit per sale but more customers walk away. Watch the <b>margin</b> column." },
    { title: "Watch your customers", target: "#scenes [data-scene=shop]", pause: false, scene: "shop", closePanel: true,
      body: "Customers walk in, browse, queue and pay. <b>Empty shelves</b> lose sales and <b>long queues</b> make people leave. Both lower happiness, and happy shops get more visitors." },
    { title: "Plan ahead", target: "#manage [data-panel=plan]", pause: true, openPanel: "plan",
      body: "<b>Planning</b> shows how many customers to expect, how many <b>days your stock will last</b>, and lets you book a <b>campaign</b> or set a daily <b>budget</b>. Supplier prices change daily, so check them in Procurement before big orders. The day report shows how close the forecast was." },
    { title: "End of day", target: "#hTime", pause: true, scene: "district",
      body: "At 20:00 the shop closes. <b>Rent, utilities, wages</b> and loan payments are charged, then a report explains why profit changed. Keep enough money in the bank for these bills, or an overdraft with 1% daily interest kicks in." },
    { title: "Grow your business", target: "#manage [data-panel=upgrades]", pause: true,
      body: "Long queues? Buy a <b>Checkout counter</b> (Upgrades) or hire a <b>Cashier</b> (Staff). Need cash? The <b>Bank</b> offers loans: borrow to grow, not to survive. Check <b>Alerts</b> on the right for problems." },
    { title: "You are ready", pause: true, last: true,
      body: "<b>Standard</b> mode ends after your chosen number of days with a score. <b>Infinite</b> mode never ends. Every panel has a tips box, and <b>How to play</b> in the menu explains everything again. Good luck!" },
  ];

  function clearHl() { if (hl) hl.classList.remove("tut-hl"); hl = null; }
  function setHl(sel) {
    clearHl(); if (!sel || ui.isOpen()) return;   // a floating highlight would sit on top of an open panel
    const el = document.querySelector(sel);
    if (el) { el.classList.add("tut-hl"); hl = el; }
  }

  function render() {
    const st = steps[idx], s = getState();
    document.body.classList.add("tut-on"); card.hidden = false;
    if (st.closePanel && ui.isOpen()) ui.close();
    if (st.scene) world.setScene(st.scene);
    if (st.openPanel) ui.open(st.openPanel);
    ctx = st.enter && s ? st.enter(s) : {};
    setPaused(!!st.pause);
    setHl(st.target);
    const prog = steps.map((_, i) => `<i class="${i < idx ? "d" : i === idx ? "n" : ""}"></i>`).join("");
    card.innerHTML = `<div class="tut-top"><div class="tut-prog">${prog}</div><button class="ghost mini" data-t="skip">Skip tutorial</button></div>
      <h3>${st.title}</h3><p>${st.body}</p>
      ${st.action ? `<div class="tut-task" id="tutTask"><span class="tut-dot"></span>${st.action}</div>` : ""}
      <div class="tut-actions">
        ${idx > 0 ? '<button class="ghost" data-t="back">Back</button>' : "<span></span>"}
        ${st.done ? '<button class="ghost" data-t="next">Skip this step</button>' : `<button class="primary" data-t="next">${st.last ? "Finish" : "Next"}</button>`}
      </div>`;
    write({ ...read(), step: idx, done: false });
  }

  function go(i) {
    advancing = false;
    if (i >= steps.length) return finish(true);
    idx = Math.max(0, i); active = true; render();
  }
  function finish(completed) {
    active = false; idx = -1; clearHl(); card.hidden = true;
    document.body.classList.remove("tut-on");
    setPaused(false);
    write({ done: true, completed: !!completed });
  }

  card.addEventListener("click", e => {
    const b = e.target.closest("[data-t]"); if (!b) return;
    if (b.dataset.t === "next") go(idx + 1);
    else if (b.dataset.t === "back") go(idx - 1);
    else if (b.dataset.t === "skip") finish(false);
  });

  return {
    start() { go(0); },
    // Called every frame or so: advances action steps once the task is done.
    update() {
      if (!active || advancing) return;
      const st = steps[idx], s = getState();
      if (st.done && s && st.done(s, ctx)) {
        advancing = true;
        const t = document.getElementById("tutTask"); if (t) t.classList.add("ok");
        setTimeout(() => { if (active && steps[idx] === st) go(idx + 1); }, 900);
      }
    },
    stop() { if (active) finish(false); },
    isActive: () => active,
    // Resume an unfinished tutorial after a page reload.
    resume() { const r = read(); if (!r.done && Number.isInteger(r.step) && r.step >= 0 && r.step < steps.length && getState()) go(r.step); },
    hasFinished: () => !!read().done,
  };
}
