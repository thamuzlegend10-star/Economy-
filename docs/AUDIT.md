# Economy- repository audit (Phase 1)

Date: 2026-11-01. Code: 2,575 lines of plain ES modules in `js/`, 82 tests in `tests/`, browser checks in `tools/`. Save version 15. No build step, no dependencies.

## 1. Architecture

- `engine.js` owns time, the shop, the warehouse, orders, prices, sales and the day close. It calls hooks from the add-on modules: `factoryArrivals`, `b2bDay`, `mrpDay` at day start; `factoryDay`, `hrDay`, `mktDay`, `ecomDay`, `overflowDay`, `bankDay`, `srvDay` at day close.
- Add-on modules (each with its own state under `s.<name>` and, where random, its own seeded stream in `rng.js`): `factory.js` (s.fx), `b2b.js` (s.b2b), `mrp.js` (s.mrp), `hr.js` (s.hr), `market.js` (s.mkt, s.ecom, s.srv), `bank.js` (s.bank), `kpi.js` (s.kpi).
- `ledger.js`: double-entry. Every money movement goes through `post()`. `reconcile()` in the engine checks ledger against stock, machines, payables, loans, escrow.
- UI: `ui.js` (retail, warehouse, shipping, NAV), `screens.js` (new modules), `actions.js` (testable button logic), `main.js` (wiring, dialogs), `scene.js` (canvas: store, warehouse, city).
- Dependency direction: data, ledger, rng at the bottom; engine imports the add-ons and the add-ons import engine helpers (`rnd`, `log`, `distanceKm`, `PRODUCT`) through live ES bindings (cycle, works because nothing runs at import time).

## 2. What works now (verified by tests or browser run)

| Area | State |
|---|---|
| Ledger, statements | Double entry, 30+ accounts, income statement, balance sheet, derived cash flow. |
| Retail | 3 products, demand by district, price elasticity, auto sales, storage by m², rent per m². |
| Warehouse | Separate building, bulk suppliers, send to shop, overflow fee. |
| Procurement | Retail POs (multi-item), raw PR then PO, payment terms, payables. |
| Factory | 2 machine types, BOM juices, health and wear, preventive and emergency maintenance, depreciation, operators auto-hired. |
| MRP | Needs from machine schedule and juice contracts, stock and incoming, EOQ lots, auto PO. |
| B2B | Tenders, rival bidding, fixed deals, delivery, late fines, breach. |
| HR | 5 roles, wage level, training, morale, quits. Effects on retail, factory, transfers, tenders, tickets. |
| Marketing, e-commerce, service, bank, KPI | Working with screens. |
| Scenes | Store, warehouse yard, city. Driven by real deliveries and sales. |

## 3. Gaps against the new prompt

Each item names where the real defect or missing piece is.

### Factory (prompt section 2)
- Missing: factory buildings, construction or acquisition, factory types, factory space. `MACHINES[].space` exists in data and is never used.
- Missing: production queue and progress. A machine has one repeating job; no queue, no multi-day batches.
- Missing: factory operating expenses (rent, utilities). Only wages, maintenance, depreciation.
- Incomplete: finished goods are valued at material cost only. Labour and overhead are expensed straight away, not absorbed into inventory. This understates inventory and COGS.
- Incomplete: worker morale does not affect output; only skill and headcount do.
- Missing: factory scene. No visual for machines, workers, lines.

### Logistics (section 3)
- Missing: company trucks, drivers, fuel, truck maintenance, routes, scheduling, breakdowns, loading time. `CARRIERS` in `data.js` is defined and unused.
- Incomplete: transfers use one fixed fee and one-day trip. No factory-to-warehouse movement: finished juice stays in `fx.fg` and goes only to B2B or web orders.
- The warehouse scene trucks are real (they follow delivery events), but there is no owned fleet.

### HR (section 4)
- Missing: contracts, recruitment cost, payroll schedule (pay is daily only), departments beyond the 5 roles, staffing requirements per department except factory and retail, salary by individual.
- Incomplete: hire and fire change headcount only; no recruitment expense account line and no severance.

### Forecasting and MRP (section 5)
- Missing: historical demand analysis, trend, seasonality beyond the fixed weekday table, competitor analysis feeding forecasts, supplier lead-time forecasting, safety stock as a computed value (it is a fixed 2 days).
- Defect: MRP plans raw materials only. It ignores retail demand, storage capacity and supplier reliability (the vendor choice uses a 0.9 cut-off only).
- Defect: forecast does not drive production. Nothing suggests what to produce.

### Customer service (section 6)
- Defect: CSI is computed in `srvDay` and shown in KPIs but never changes demand. The prompt requires satisfaction to influence demand and performance.
- Missing: complaints as records, response time, retention, loyalty.
- Service staff wages go to the general `wages` account; there is no separate service expense line.

### BI (section 7)
- Existing: 8 KPIs, weighted score, revenue chart, competitor table.
- Missing: gross profit, operating expenses breakdown, inventory turnover, production efficiency, delivery performance, supplier reliability as KPIs; daily comparison; department performance; business warnings; trend lines.

### Accounting (section 8)
- Missing: taxes (account exists, nothing charges it); general ledger view per account; trial balance (only the last 40 entries are listed).
- Incomplete: receivables are used only by web orders. B2B pays cash on delivery, with no credit terms or aging.
- Incomplete: cash flow statement is derived by subtraction, not tracked by category.
- Risk: expense accounts are partly mixed (`delivery` holds retail freight, raw freight and web parcels).

### Market realism (section 9)
- Competitor prices are synthetic waves for display; they do not move demand. `competition` is a fixed share per district.
- No economic fluctuation. Supplier prices drift within a band; customer preference shifts are not modelled.
- Parameters are mostly in `data.js` but several constants live inline in modules (for example retail boost 10%, CSI weights).

### Multiplayer and education (section 10) - conflict
- The current game is single-player. The retail rewrite removed multiplayer, rooms and replay. The Supabase function `verify-match` and tables exist but are not called.
- Nothing exists for facilitator, students, teams, leaderboards. "Preserve multiplayer synchronization" cannot be satisfied, because there is nothing to preserve.
- Rule conflict: server authority needs a deterministic replay of player actions. The engine is deterministic, but actions are not logged.

### Visuals (section 11)
- Exists: store, warehouse, city (canvas, real data).
- Missing: factory scene, transport scene with roads and routes, bank interface visual.

### Rules conflicts to settle
- "No placeholder buttons": the Mail tab is a placeholder (kept earlier because you asked for unspecified sections to be non-working). It needs a decision: build or remove.
- "Do not claim implemented until works": the cash flow statement and market share (modelled rival volume) are approximations and are labelled so.

## 4. Save and compatibility
Saves are versioned (v11 to v15 migrate in `validateSave`). Each new phase adds a migration step. Old saves before v11 are refused.

## 5. Plan

Order follows the prompt's priority list: economics first, then interconnection, then factory and workforce, logistics, finance, visuals, education.

| Step | Work | Tests |
|---|---|---|
| A | Link CSI to demand; move magic numbers to data; add warnings | CSI changes sales; parameters read from data |
| B | Absorb labour and overhead into finished goods cost; factory rent and utilities; factory space for machines; machine morale effect | Inventory value equals ledger; no double count |
| C | Production queue with batches and progress; production suggestions from forecast | Queue runs in order; shortage blocks start |
| D | Forecasting: history, trend, weekday and seasonal factors, safety stock from variance, reorder point; MRP uses it plus storage room and vendor reliability | Forecast error bounds on a seeded run |
| E | Trucks: buy, drivers, fuel, maintenance, breakdowns, routes between supplier, factory, warehouse, shop; factory to warehouse transfer | Delivery time and cost move inventory and ledger |
| F | HR depth: recruitment cost, contracts, payroll schedule, department requirements, service line | Payroll and hiring appear in statements |
| G | Accounting: tax, B2B credit terms and receivables, general ledger and trial balance views | Trial balance sums to zero |
| H | BI dashboard: missing KPIs, charts, warnings | Every figure traces to state |
| I | Scenes: factory, transport, bank | Visual state matches engine state |
| J | Education and multiplayer: needs the decision below | Authoritative replay test |
| K | Final audit report | Full lifecycle test |

## 6. Decisions needed
1. Multiplayer: rebuild it (action log plus server replay using the existing `verify-match`), or keep single-player and build only a local facilitator and scenario mode.
2. Mail tab: build a real inbox (supplier, bank, warning messages from the simulation), or remove it.
