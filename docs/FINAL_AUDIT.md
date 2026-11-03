# Final audit (Phase 8)

Checked against every section of the master prompt. Status words: **Done** (works, tested), **Partial** (works but narrower than the prompt), **Missing** (not built).
Evidence: 156 tests pass (`npm test`), including a 60 day full-lifecycle run (`tests/lifecycle.test.js`) that reconciles the books and checks the trial balance after every day, proves determinism, and reloads a mid-game save. Browser audits (`tools/e2e-loop.mjs`, `tools/audit-scrollbars.mjs`) are clean at five viewport sizes.
Save format is v22. Saves from v11 on migrate step by step. Older saves are refused.

## 2. Factory and manufacturing
| Requirement | Status | Notes |
|---|---|---|
| Multiple factory types and facilities, construction or acquisition | **Partial** | One factory building that you rent and grow in m². No second site, no different factory types. |
| Capacity and space, machine purchase, machine capacity | Done | Machines need floor space and operators; four machine types. |
| Raw storage, BOM, finished goods | Done | Raw stock per material, bill of materials per juice, finished bottles. |
| Scheduling, queue, progress | Done | Up to 5 batches per machine, days left and bottles done are shown. |
| Production cost, factory expenses | Done | Wages, rent and utilities are absorbed into the cost of goods made. |
| Depreciation, preventive and emergency maintenance, breakdowns, efficiency | Done | Straight-line depreciation on the ledger; health drives breakdown chance. |
| Workforce: hired through HR, requirements, capacity loss, salaries, skill, training, morale | Done | Short crews cut output; skill and morale scale it. |
| Hiring and dismissal reach the statements | Done | Recruitment fee and severance are booked to Wages. |
| Visual factory | **Partial** | Machines run, idle or show broken; tanks and bottle stock show real levels; a crew count is shown. **No workers are drawn, no loading dock and no trucks in the factory scene.** |

## 3. Logistics
| Requirement | Status | Notes |
|---|---|---|
| Own trucks, purchase, capacity, maintenance, fuel, drivers and wages | Done | Van and box truck; service restores health; drivers are an HR role. |
| Delivery scheduling, delays, breakdowns | Done | Multiple rounds when the load is bigger than one truck; a breakdown delays the delivery and costs an emergency repair. |
| Warehouse to shop, supplier to shop or warehouse, supplier to factory | Done | Choose "My own trucks" on orders, raw orders and transfers. |
| Factory to shop transport of juice | Done | Factory, Juice to shop: pick bottles, choose your own trucks or a hired carrier. Goods go through goods-in-transit and arrive on the shop shelf after the trip. Raw materials and factory goods already count against warehouse space, so no separate factory-to-warehouse move was added. |
| Juice sold in the shop | Done | Juice has its own shelf, price and demand (price, location, rivals, economy, satisfaction). Cost of goods follows the bottles. A juice draws shoppers only after you stock it once. |
| Delivery routes, loading and unloading | **Partial** | Distance sets time and fuel. Loading is a fixed quarter day. No route map and no dock queue. |
| Trucks tied to real deliveries | Done | The city and yard scenes draw trucks from real orders and the real fleet. |

## 4. Human resources
| Requirement | Status | Notes |
|---|---|---|
| Recruitment, dismissal, contracts, departments, salary, competency, training, morale, turnover, staffing needs, productivity, expenses | Done | Six departments; permanent and temp contracts (temps cost 25% more, never quit). |
| **Payroll schedules** | **Missing** | Wages are paid every day. No weekly or monthly payday. |
| Individual employees | **Partial** | Staff are headcount plus an average skill per department, not named people. |
| Roles not interchangeable | Done | Each department has its own effect. |

## 5. Forecasting and planning
| Requirement | Status | Notes |
|---|---|---|
| History, forecast, weekday seasonality, trend, inventory forecast, raw demand, safety stock, reorder point, EOQ, lead-time forecast, purchase advice, production planning | Done | Advice buttons place real orders and queue real batches. |
| Considers stock, incoming, planned production, B2B contracts, supplier reliability, storage | Done | In `mrp.js` and `forecast.js`. |
| Longer seasons, competitor analysis feeding the forecast | **Partial** | Only a weekday pattern and trend. Competitor prices are shown but do not feed the forecast. |

## 6. Customer service
| Requirement | Status | Notes |
|---|---|---|
| Satisfaction, tickets, service capacity, staff skill, demand effect, service cost | Done | Satisfaction moves shop demand, so the loop closes. |
| Response time, retention and loyalty as separate measures, complaint types | **Partial** | The ticket backlog stands in for response time, and satisfaction stands in for loyalty. |

## 7. Business intelligence
| Requirement | Status | Notes |
|---|---|---|
| Revenue, net and gross profit, operating costs, cash flow, assets, liabilities, ROA, market share, satisfaction, morale, turnover, factory efficiency, delivery and supplier performance, overall score | Done | Data Explorer: Scoring, Dashboard, Forecast, Competitors; Finance: Statements, Ledger. Figures read from the ledger and counters. |
| Charts, daily comparison, warnings, financial reports | Done | 60 day line chart, revenue and cost bars, warnings card. |
| Department performance, trends | **Partial** | Shown through KPIs and operation tables, not a profit and loss per department. No trend arrows. |
| Market share | Approximation | Uses a modelled rival volume; labelled as such. |

## 8. Accounting
| Requirement | Status | Notes |
|---|---|---|
| Payables, receivables (aging), inventory valuation, COGS, labour, payroll, transport, maintenance, depreciation, loans, interest, opex, revenue, tax | Done | Double entry on every posting; reconcile cross-checks stock, machinery, trucks, payables, receivables, tax and credit. |
| Income statement, balance sheet, trial balance | Done | |
| Cash flow statement | **Partial** | Operating cash is the remainder after investing and financing. |
| General ledger | **Partial** | Shows the latest 1,500 entries, as the save keeps only those. |
| Tax | **Partial** | Flat rate on cumulative profit, losses carried forward. No deductions. |

## 9. Market and economic realism
| Requirement | Status | Notes |
|---|---|---|
| Location costs and demand, elasticity, supplier reliability, supplier price drift | Done | Locations differ in rent, demand, price power, competition, logistics. |
| Competitor pricing and market competition | Done | Three rival shops move in waves. Shoppers compare your price with what they expect, which blends the local reference and the rival average. More competition in a district makes rivals count more. A scenario can start a rival price cut. (`economy.js`) |
| Economic fluctuation | Done | Consumer confidence (about ±12%) and a price level for supplier and vendor prices drift and return to normal. Mail announces large moves. |
| Consumer preferences | Done | Taste for each product category drifts within ±15%. |
| Parameters in config | Done for this module | Rates and bounds are in `D.MARKET`. Some older constants stay inline. |

## 10. Multiplayer and education
| Requirement | Status | Notes |
|---|---|---|
| Facilitator controls, scenarios, event injection | Done (local) | Four scenarios plus live events. |
| Team name, results, ranking | Partial | Result files handed in, loaded and ranked. |
| Student and team management, live multiplayer, server-authoritative validation, difficulty, learning analytics, per-team end reports | **Missing** | The game is single-player and local. There is no server round trip, so nothing is validated by a server. Reason: the earlier retail rewrite removed multiplayer; rebuilding it needs a server design you have not chosen yet. |

## 11. Visual simulation
| Area | Status | Notes |
|---|---|---|
| Retail | Partial | Store, shelves with real stock, shoppers for real sales and missed sales, self-checkout. No cashiers or staff drawn. |
| Warehouse | Partial | Racks, real stock, forklift, trucks for real deliveries. No workers drawn. |
| Factory, Transport, Bank | Partial | See sections 2 and 3. Bank shows vault, credit, loans and tax but no transaction animation. |
| Performance | Done | 60 frames per second in every scene (headless Chromium, 90 frame sample). 60 days of simulation run in about 20 ms. |

## 12. Department interconnection
Verified end to end by the lifecycle test: marketing lifts demand, forecasts read sales history, MRP plans materials, purchase requisitions become orders, suppliers or your trucks deliver, factory crews make bottles, bottles sell through B2B (on credit) and the web store (through escrow), service satisfaction moves demand, every step is in the ledger, tax is assessed, and the dashboard reads it back. Juice now flows factory, truck, shop shelf, sale, ledger, and production advice counts the shop's juice demand.

## Bugs found and fixed during the work
Batch tail trickle, stale raw quantities after a vendor change, machines breaking down on the day they were bought, MRP header overflow at 320 px, factory tanks hidden behind the scene tabs, old cached CSS showing scrollbars. No open bugs are known.

## Known limitations
- A careless script that accepts every B2B deal without stock pays large breach penalties and goes bankrupt. That is by design, not a bug. The lifecycle script only takes deals it can fill and survives 60 days without loans.
- Progress is local to one browser. There is no cloud save.
- Rotate the database password, secret keys and Metered credentials that were pasted in chat earlier.

## Suggested next work, in priority order
1. Payroll schedule, multiple factory sites.
2. Drawn workers and cashiers.
3. A real multiplayer server with action replay (needs your decision).
