// Run: node test/engine.test.js
const assert = require('assert');
const E = require('../js/engine.js');
const D = require('../js/data.js');

let passed = 0;
function t(name, fn) { try { fn(); passed++; console.log('ok   ' + name); } catch (e) { console.error('FAIL ' + name + '\n  ' + e.stack); process.exitCode = 1; } }

// Headless play of one day. Customers are served instantly.
function playDay(s, bot) {
  if (bot) bot(s);
  assert.ok(E.openShop(s).ok);
  let guard = 0;
  while (s.phase === 'open' || s.phase === 'closing') {
    const evs = E.tick(s, 0.5);
    for (const e of evs) if (e.type === 'customer' && !e.cust.leave) E.checkout(s, e.cust);
    if (s.phase === 'closing') break;
    assert.ok(++guard < 5000, 'day did not end');
  }
  const r = E.finishDay(s);
  assert.ok(r.ok, r.error);
  return r.report;
}
// Simple strategy: keep stock flowing, hire stocker once affordable, bank spare cash.
function bot(s) {
  if (!s.staff.stocker && E.funds(s) > 30000) E.setStocker(s, true);
  const want = D.PRODUCTS.filter(p => s.unlocked[p.id]);
  for (const p of want) {
    const sup = (p.category === 'food' || p.category === 'drinks') ? 'fresh' : 'bulk';
    const inv = s.inv[p.id];
    if (inv.wh + inv.shelf < 10) E.placeOrder(s, sup, [{ pid: p.id, qty: 12 }]);
  }
  if (s.bal.cash > 20000) E.deposit(s, s.bal.cash - 10000);
  E.fillShelves(s);
  // let deliveries land before opening
  for (let i = 0; i < 40; i++) E.tick(s, 0.5);
  E.fillShelves(s);
}

t('new game opens balanced', () => {
  const s = E.newGame({ seed: 1 });
  assert.ok(E.reconcile(s).ok);
  assert.strictEqual(E.funds(s), 100000);
  assert.strictEqual(s.phase, 'planning');
});

t('order: pays goods plus delivery fee, arrives after delivery time', () => {
  const s = E.newGame({ seed: 2 });
  const before = E.funds(s);
  const q = E.quoteOrder(s, 'fresh', [{ pid: 'apple', qty: 5 }]);
  assert.ok(q.ok);
  assert.strictEqual(q.total, 5 * 100 + 200);
  const r = E.placeOrder(s, 'fresh', [{ pid: 'apple', qty: 5 }], 'c1');
  assert.ok(r.ok);
  assert.strictEqual(E.funds(s), before - 700);
  assert.strictEqual(s.inv.apple.wh, 0, 'goods are not sellable before delivery');
  assert.ok(E.reconcile(s).ok);
  for (let i = 0; i < 20; i++) E.tick(s, 0.25);   // 5 seconds
  assert.strictEqual(s.inv.apple.wh, 5);
  assert.ok(E.reconcile(s).ok);
});

t('order: idempotency key blocks duplicate purchase', () => {
  const s = E.newGame({ seed: 3 });
  const a = E.placeOrder(s, 'fresh', [{ pid: 'bread', qty: 5 }], 'same');
  const f = E.funds(s);
  const b = E.placeOrder(s, 'fresh', [{ pid: 'bread', qty: 5 }], 'same');
  assert.ok(a.ok); assert.ok(!b.ok && b.duplicate);
  assert.strictEqual(E.funds(s), f);
});

t('order: rejects bad input', () => {
  const s = E.newGame({ seed: 4 });
  assert.ok(!E.quoteOrder(s, 'fresh', [{ pid: 'soap', qty: 5 }]).ok, 'locked product');
  assert.ok(!E.quoteOrder(s, 'fresh', [{ pid: 'apple', qty: 1 }]).ok, 'below minimum');
  assert.ok(!E.quoteOrder(s, 'fresh', [{ pid: 'apple', qty: 500 }]).ok, 'warehouse full');
  assert.ok(!E.quoteOrder(s, 'nope', [{ pid: 'apple', qty: 5 }]).ok);
  assert.ok(!E.placeOrder(s, 'fresh', [{ pid: 'apple', qty: -5 }]).ok);
});

t('sale: ledger stays balanced, stock and cash change', () => {
  const s = E.newGame({ seed: 5 });
  const cash = s.bal.cash;
  const r = E.checkout(s, { id: 1, wants: 'apple', qty: 2, done: false });
  assert.ok(r.ok);
  assert.strictEqual(s.bal.cash, cash + 600);
  assert.strictEqual(s.inv.apple.shelf, 4);
  assert.ok(E.reconcile(s).ok);
  const c = { id: 2, wants: 'apple', qty: 1, done: false };
  E.checkout(s, c);
  assert.ok(E.checkout(s, c).duplicate, 'same customer cannot pay twice');
});

t('stockout: customer takes alternative or leaves and is counted', () => {
  const s = E.newGame({ seed: 6 });
  s.inv.milk.shelf = 0; s.inv.milk.value = 0; s.bal.inventory = s.inv.apple.value + s.inv.bread.value; s.bal.capital = -(100000 + s.bal.inventory);
  const r = E.checkout(s, { id: 9, wants: 'milk', qty: 1, done: false });
  assert.ok(!r.ok && r.reason === 'stockout');
  assert.strictEqual(s.today.miss.stockout.milk, 1);
  s.inv.bread.shelf = 0; s.inv.apple.shelf = 3;
  const r2 = E.checkout(s, { id: 10, wants: 'bread', qty: 1, done: false });
  assert.ok(r2.ok && r2.alt && r2.pid === 'apple');
});

t('bank: deposit and withdraw validate amounts and balances', () => {
  const s = E.newGame({ seed: 7 });
  assert.ok(!E.deposit(s, -5).ok);
  assert.ok(!E.deposit(s, 0).ok);
  assert.ok(!E.deposit(s, s.bal.cash + 1).ok);
  assert.ok(E.deposit(s, 1000, 'd1').ok);
  assert.ok(E.deposit(s, 1000, 'd1').duplicate);
  assert.ok(!E.withdraw(s, s.bal.bank + 1).ok);
  assert.ok(E.withdraw(s, 500).ok);
  assert.ok(E.reconcile(s).ok);
});

t('loan: shows full cost, adds cash and debt, repays over time', () => {
  const s = E.newGame({ seed: 8, diff: 'hard' });
  const nw0 = E.netWorth(s);
  const sc = E.loanSchedule(50000, 0.015, 12, 0.02);
  assert.ok(sc.totalRepay > 50000);
  assert.ok(!E.takeLoan(s, 'growth').ok, 'needs net worth');
  assert.ok(!E.takeLoan(s, 'recovery').ok, 'only in distress');
  const r = E.takeLoan(s, 'starter', 'l1');
  assert.ok(r.ok);
  assert.ok(E.takeLoan(s, 'starter', 'l1').duplicate);
  assert.ok(!E.takeLoan(s, 'starter', 'l2').ok, 'one of each');
  assert.strictEqual(-s.bal.loans, 50000);
  assert.strictEqual(E.netWorth(s), nw0 - sc.fee);
  for (let i = 0; i < 12; i++) { playDay(s); E.advanceDay(s); }
  assert.strictEqual(s.loans.length, 0, 'loan repaid');
  assert.ok(E.reconcile(s).ok);
});

t('shortfall becomes payables, not negative cash', () => {
  const s = E.newGame({ seed: 9, diff: 'hard' });
  s.bal.capital += s.bal.cash + s.bal.bank; s.bal.cash = 0; s.bal.bank = 0;   // broke
  E.startDay(s);                                  // refresh the day snapshot after the edit
  E.openShop(s); E.closeEarly(s);                 // no customers, only fixed costs
  const rep = E.finishDay(s).report;
  assert.ok(s.bal.payables < 0, 'unpaid rent becomes payables');
  assert.ok(s.bal.cash >= 0 && s.bal.bank >= 0);
  assert.ok(rep.reconcile, rep.errors.join());
});

t('price limits and demand effect', () => {
  const s = E.newGame({ seed: 10 });
  assert.ok(!E.setPrice(s, 'apple', 10).ok);
  assert.ok(!E.setPrice(s, 'apple', 99999).ok);
  assert.ok(E.setPrice(s, 'apple', 250).ok);
  const high = E.newGame({ seed: 11 }); E.setPrice(high, 'apple', 800); E.setPrice(high, 'bread', 1400); E.setPrice(high, 'milk', 2400);
  let left = 0, n = 0;
  for (let i = 0; i < 400; i++) { const c = (E.tick(high, 1), null); }
  const h2 = E.newGame({ seed: 12 }); E.setPrice(h2, 'apple', 800); E.setPrice(h2, 'bread', 1400); E.setPrice(h2, 'milk', 2400);
  E.openShop(h2);
  for (let i = 0; i < 200; i++) for (const e of E.tick(h2, 0.5)) if (e.type === 'customer') { n++; if (e.cust.leave === 'expensive') left++; }
  assert.ok(left / n > 0.6, 'very high prices drive customers away (' + left + '/' + n + ')');
});

t('standard mode: 30 days finishes with a score and balanced books', () => {
  const s = E.newGame({ seed: 123, mode: 'standard', diff: 'normal' });
  for (let d = 1; d <= 30; d++) {
    const rep = playDay(s, bot);
    assert.ok(rep.reconcile, `day ${d}: ${rep.errors.join()}`);
    assert.strictEqual(rep.balance.netWorth - rep.cash.close * 0, rep.balance.netWorth);
    const r = E.advanceDay(s); assert.ok(r.ok);
  }
  assert.strictEqual(s.phase, 'final');
  assert.ok(s.final.total >= 0 && s.final.total <= 100);
  assert.ok(['S', 'A', 'B', 'C', 'D'].includes(s.final.rating));
  console.log('     score', s.final.total, s.final.rating, 'net worth', E.fmtMoney(s.final.netWorth));
  assert.ok(E.continueAsInfinite(s).ok);
  assert.strictEqual(s.mode, 'infinite');
});

t('infinite mode: 150 days stays bounded and balanced', () => {
  const s = E.newGame({ seed: 77, mode: 'infinite' });
  for (let d = 1; d <= 150; d++) { const rep = playDay(s, bot); assert.ok(rep.reconcile, `day ${d}: ${rep.errors.join()}`); E.advanceDay(s); }
  assert.ok(s.history.length <= D.C.HISTORY_CAP);
  assert.ok(s.journal.length <= D.C.JOURNAL_CAP);
  assert.ok(s.orderLog.length <= D.C.LOG_CAP);
  assert.ok(s.archive.days >= 90);
  assert.ok(JSON.stringify(s).length < 600000, 'save stays small');
});

t('deterministic: same seed and commands give same result', () => {
  const run = () => { const s = E.newGame({ seed: 555 }); for (let d = 0; d < 5; d++) { playDay(s, bot); E.advanceDay(s); } return JSON.stringify([s.bal, s.history.map(h => h.revenue)]); };
  assert.strictEqual(run(), run());
});

t('upgrades and flyers charge once and respect limits', () => {
  const s = E.newGame({ seed: 20, diff: 'easy' });
  const f = E.funds(s);
  assert.ok(E.buyUpgrade(s, 'shelf').ok);
  assert.strictEqual(f - E.funds(s), 4000);
  assert.strictEqual(E.shelfCap(s), 18);
  assert.ok(E.buyFlyers(s).ok); assert.ok(!E.buyFlyers(s).ok);
  for (let i = 0; i < 5; i++) E.buyUpgrade(s, 'sign');
  assert.strictEqual(s.up.sign, 3);
  assert.ok(E.reconcile(s).ok);
});

console.log(`\n${passed} tests passed`);
