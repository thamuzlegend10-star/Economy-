# Final audit (Phase 8)

Checked against every section of the master prompt. Status words: **Done** (works, tested), **Partial** (works but narrower than the prompt), **Missing** (not built).
Evidence: 205 tests pass (`npm test`), including a 60 day full-lifecycle run (`tests/lifecycle.test.js`) that reconciles the books and checks the trial balance after every day, proves determinism, and reloads a mid-game save. Browser audits (`tools/e2e-loop.mjs`, `tools/audit-scrollbars.mjs`) are clean at five viewport sizes.
Save format is v22. Saves from v11 on migrate step by step. Older saves are refused.

## 2. Factory and manufacturing

> **Retired by the game's author.** The factory, its machines and the juice shelf are switched off in every new game and every loaded save: no tab, no menu choice, no hiring row. The engine code is kept only so old saves load and its tests still run (the test runner sets `ECONOMY_LEGACY_FACTORY`). The rows below describe that dormant code, not what a player can use.
| Requirement | Status | Notes |
|---|---|---|
| Multiple factory types and facilities, construction or acquisition | **Partial** | Two sites: the main plant and a cheaper annex (80% rent per m², haulage cost per machine per day, needs the main plant for storage). Two machine classes (standard, high-speed). Still one product line (juice) and rented, not built or bought. |
| Capacity and space, machine purchase, machine capacity | Done | Machines need floor space and operators; four machine types. |
| Raw storage, BOM, finished goods | Done | Raw stock per material, bill of materials per juice, finished bottles. |
| Scheduling, queue, progress | Done | Up to 5 batches per machine, days left and bottles done are shown. |
| Production cost, factory expenses | Done | Wages, rent and utilities are absorbed into the cost of goods made. |
| Depreciation, preventive and emergency maintenance, breakdowns, efficiency | Done | Straight-line depreciation on the ledger; health drives breakdown chance. |
| Workforce: hired through HR, requirements, capacity loss, salaries, skill, training, morale | Done | Short crews cut output; skill and morale scale it. |
| Hiring and dismissal reach the statements | Done | Recruitment fee and severance are booked to Wages. |
| Visual factory | **Done** | Machines run, idle or show broken; tanks and bottle stock show real levels; one operator is drawn per machine up to the real crew size, and a loading dock shows a truck while purchase orders are open. Also drawn from real HR counts: cashiers and shelf staff in the shop, handlers in the warehouse, a teller and coin flow in the bank. |

## 3. Logistics
| Requirement | Status | Notes |
|---|---|---|
| Own trucks, purchase, capacity, maintenance, fuel, drivers and wages | Done | Van and box truck; service restores health; drivers are an HR role. |
| Delivery scheduling, delays, breakdowns | Done | Multiple rounds when the load is bigger than one truck; a breakdown delays the delivery and costs an emergency repair. |
| Warehouse to shop, supplier to shop or warehouse, supplier to factory | Done | Choose "My own trucks" on orders, raw orders and transfers. |
| Factory to shop transport of juice | Done | Factory, Juice to shop: pick bottles, choose your own trucks or a hired carrier. Goods go through goods-in-transit and arrive on the shop shelf after the trip. Raw materials and factory goods already count against warehouse space, so no separate factory-to-warehouse move was added. |
| Juice sold in the shop | Done | Juice has its own shelf, price and demand (price, location, rivals, economy, satisfaction). Cost of goods follows the bottles. A juice draws shoppers only after you stock it once. |
| Delivery routes, loading and unloading | **Partial** | Distance sets time and fuel. Loading time depends on cargo and warehouse handlers, there are 2 dock bays and a trip that finds both busy queues (shown in the fleet screen and the trip log). Still no drawn route map. |
| Trucks tied to real deliveries | Done | The city and yard scenes draw trucks from real orders and the real fleet. |

## 4. Human resources
| Requirement | Status | Notes |
|---|---|---|
| Recruitment, dismissal, contracts, departments, salary, competency, training, morale, turnover, staffing needs, productivity, expenses | Done | Six departments; permanent and temp contracts (temps cost 25% more, never quit). |
| **Payroll schedules** | **Done** | Non-factory wages accrue daily to an "Accrued wages" liability and are paid on a chosen payday (daily, weekly, every 2 weeks, monthly). Short cash on payday goes to overdraft and costs morale. Factory crew wages are still booked daily as production cost. |
| Individual employees | **Partial** | Every head has a name and start day (quits name the person). Skill and wage are still per role, not per person. |
| Roles not interchangeable | Done | Each department has its own effect. |

## 5. Forecasting and planning
| Requirement | Status | Notes |
|---|---|---|
| History, forecast, weekday seasonality, trend, inventory forecast, raw demand, safety stock, reorder point, EOQ, lead-time forecast, purchase advice, production planning | Done | Advice buttons place real orders and queue real batches. |
| Considers stock, incoming, planned production, B2B contracts, supplier reliability, storage | Done | In `mrp.js` and `forecast.js`. |
| Longer seasons, competitor analysis feeding the forecast | **Partial** | The forecast now reads the known rival price wave and any running or announced demand and rival events, compared with their average over the history window (clamped to 0.6x-1.5x). The game itself has no yearly seasons, so there is no season to forecast; only the weekday pattern, trend, rivals and events. |

## 6. Customer service
| Requirement | Status | Notes |
|---|---|---|
| Satisfaction, tickets, service capacity, staff skill, demand effect, service cost | Done | Satisfaction moves shop demand, so the loop closes. |
| Response time, retention and loyalty as separate measures, complaint types | **Done** | Response time (queue over daily clearing capacity), loyalty (slow average of satisfaction), retention (lowered by stock-outs and low satisfaction) and complaints sorted by cause (general, late delivery, out of stock) are shown in Marketing. These are modelled measures, not tracked individual shoppers. |

## 7. Business intelligence
| Requirement | Status | Notes |
|---|---|---|
| Revenue, net and gross profit, operating costs, cash flow, assets, liabilities, ROA, market share, satisfaction, morale, turnover, factory efficiency, delivery and supplier performance, overall score | Done | Data Explorer: Scoring, Dashboard, Forecast, Competitors; Finance: Statements, Ledger. Figures read from the ledger and counters. |
| Charts, daily comparison, warnings, financial reports | Done | 60 day line chart, revenue and cost bars, warnings card. |
| Department performance, trends | **Done** | Profit and loss per department (shop, web, B2B, factory, marketing, people, logistics, finance, general), tallied from every ledger line by entry reference, with a 7-day vs previous-7-day trend arrow. Departments are assigned by reference prefix, so rent and storage fees sit under General. |
| Market share | Approximation | Uses a modelled rival volume; labelled as such. |

## 8. Accounting
| Requirement | Status | Notes |
|---|---|---|
| Payables, receivables (aging), inventory valuation, COGS, labour, payroll, transport, maintenance, depreciation, loans, interest, opex, revenue, tax | Done | Double entry on every posting; reconcile cross-checks stock, machinery, trucks, payables, receivables, tax and credit. |
| Income statement, balance sheet, trial balance | Done | |
| Cash flow statement | **Done** | Direct method, tallied exactly on every posting: received from customers, paid to suppliers, wages, tax, other operating, investing, financing. Saves from before v25 start from an estimate. |
| General ledger | **Done** | The latest 1,500 entries are kept in full and up to 14,000 older ones as compact rows, paged in the Ledger tab. Beyond that, the oldest are dropped from the list (balances and cash-flow totals still include them). |
| Tax | **Done** | Flat rate on taxable profit, losses carried forward, with two allowances: 10% of machine cost and +50% of training spend. Still one rate, no tax brackets or VAT. |

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
| Team name, results, ranking | Done (local) | Result files handed in, loaded and ranked, with a per-team report. |
| Difficulty, per-team end report, learning analytics | **Done (local)** | Easy/Normal/Hard sets shopper numbers (+10%/-10%) and random-event chance (x0.6/x1.5), also chosen by the host in a live room. Each team can download an HTML end report (scorecard, department P&L, cash flow, customers; prints to PDF). The facilitator loads result files and sees class average, median, weakest measures, bankruptcies, loss makers and plain-language hints. |
| Student roster management, server-authoritative validation | **Missing** | Live rooms exist, but scores are reported by each player's own device and there is no server of ours to check them, so a modified client can lie. Result files can also be edited. A real fix needs a server that runs the simulation, which this static site does not have. There is no student account or roster system either. |

## 11. Visual simulation
| Area | Status | Notes |
|---|---|---|
| Retail | Done | Store, shelves with real stock, shoppers for real sales and missed sales, cashiers and shelf staff drawn from the real retail headcount, self-checkout when you hire nobody. |
| Warehouse | Done | Racks, real stock, forklift, trucks for real deliveries, handlers drawn from the real headcount. |
| Factory, Transport, Bank | Done | Factory operators, dock and truck (section 2); bank shows vault, credit, loans, tax, a teller and coins flying when cash really moves. |
| Performance | Done | 60 frames per second in every scene (headless Chromium, 90 frame sample). 60 days of simulation run in about 20 ms. |

## 12. Department interconnection
Verified end to end by the lifecycle test: marketing lifts demand, forecasts read sales history, MRP plans materials, purchase requisitions become orders, suppliers or your trucks deliver, factory crews make bottles, bottles sell through B2B (on credit) and the web store (through escrow), service satisfaction moves demand, every step is in the ledger, tax is assessed, and the dashboard reads it back. Juice now flows factory, truck, shop shelf, sale, ledger, and production advice counts the shop's juice demand.

## Bugs found and fixed during the work
Batch tail trickle, stale raw quantities after a vendor change, machines breaking down on the day they were bought, MRP header overflow at 320 px, factory tanks hidden behind the scene tabs, old cached CSS showing scrollbars. No open bugs are known.

## Known limitations
- A careless script that accepts every B2B deal without stock pays large breach penalties and goes bankrupt. That is by design, not a bug. The lifecycle script only takes deals it can fill and survives 60 days without loans.
- Progress is local to one browser. There is no cloud save.

## Suggested next work, in priority order
1. A server that runs the simulation and checks scores (needs your decision; fixes cheating and gives rosters).
2. A second product line for the factory (juice only today), per-person skill and wage, a drawn delivery route map, built or bought factories.

## 10. Multiplayer and education
| Requirement | Status | Notes |
|---|---|---|
| Facilitator controls, scenarios, event injection | Done (local) | Four scenarios plus live events. |
| Team name, results, ranking | Done (local) | Result files handed in, loaded and ranked, with a per-team report. |
| Difficulty, per-team end report, learning analytics | **Done (local)** | Easy/Normal/Hard sets shopper numbers (+10%/-10%) and random-event chance (x0.6/x1.5), also chosen by the host in a live room. Each team can download an HTML end report (scorecard, department P&L, cash flow, customers; prints to PDF). The facilitator loads result files and sees class average, median, weakest measures, bankruptcies, loss makers and plain-language hints. |
| Student roster management, server-authoritative validation | **Missing** | Live rooms exist, but scores are reported by each player's own device and there is no server of ours to check them, so a modified client can lie. Result files can also be edited. A real fix needs a server that runs the simulation, which this static site does not have. There is no student account or roster system either. |

## 11. Visual simulation
| Area | Status | Notes |
|---|---|---|
| Retail | Done | Store, shelves with real stock, shoppers for real sales and missed sales, cashiers and shelf staff drawn from the real retail headcount, self-checkout when you hire nobody. |
| Warehouse | Done | Racks, real stock, forklift, trucks for real deliveries, handlers drawn from the real headcount. |
| Factory, Transport, Bank | Done | Factory operators, dock and truck (section 2); bank shows vault, credit, loans, tax, a teller and coins flying when cash really moves. |
| Performance | Done | 60 frames per second in every scene (headless Chromium, 90 frame sample). 60 days of simulation run in about 20 ms. |

## 12. Department interconnection
Verified end to end by the lifecycle test: marketing lifts demand, forecasts read sales history, MRP plans materials, purchase requisitions become orders, suppliers or your trucks deliver, factory crews make bottles, bottles sell through B2B (on credit) and the web store (through escrow), service satisfaction moves demand, every step is in the ledger, tax is assessed, and the dashboard reads it back. Juice now flows factory, truck, shop shelf, sale, ledger, and production advice counts the shop's juice demand.

## Bugs found and fixed during the work
Batch tail trickle, stale raw quantities after a vendor change, machines breaking down on the day they were bought, MRP header overflow at 320 px, factory tanks hidden behind the scene tabs, old cached CSS showing scrollbars. No open bugs are known.

## Known limitations
- A careless script that accepts every B2B deal without stock pays large breach penalties and goes bankrupt. That is by design, not a bug. The lifecycle script only takes deals it can fill and survives 60 days without loans.
- Progress is local to one browser. There is no cloud save.

## Suggested next work, in priority order
1. Payroll schedule, multiple factory sites.
2. Drawn workers and cashiers.
3. A real multiplayer server with action replay (needs your decision).

## 10. Live play (Step N)

- **What it is:** menu → Play with friends. One player hosts a 6-digit room, friends join with the code. The host picks days, seconds per day, capital and scenario and presses Start; every device starts the same seeded game together after a 5 s countdown. Same seed means the same market for everyone (tested: two devices produce byte-identical saves).
- **Transport:** Supabase Realtime Broadcast + Presence (no tables, nothing stored). Logic is in `js/live.js`, separate from the transport, so it is tested with an in-memory bus (`tests/live.test.js`, 15 tests: lobby, start sync, host-only start and events, forged messages ignored, late joiners turned away, ranking, spoofed score ids, bad values, leaving, transport failure).
- **Browser check:** two real browser pages played a full room against a stub of the Supabase client (BroadcastChannel): lobby, start, same settings, event from host reaches guest, leaderboard, no pause, no page errors.
- **Not verified:** the real Supabase network connection. The sandbox cannot reach supabase.co, so the first real room is the first real test. If joining fails, the player sees "Could not connect to the room".
- **Honest limits:** each player's shop runs on their own device, so scores are reported by the client and a determined cheater could edit theirs. Mitigations: scores use fixed default KPI weights, values are range-checked, a player can only post their own card. Closing a tab pauses that player's shop (browser throttling); leaving keeps their last score on the board. No reconnect after a refresh: a refreshed player continues solo.
- **Tests:** 205 passing. Overflow audit clean at 5 viewports; no visible scrollbars.

## 11. MonsoonSIM gap pass

- **Added:** credit rating AAA to DDD (late payday or overdrawn days in the last 30; worse rating means dearer loans and overdraft), seller star rating on the Web store (needs 8 orders; poor delivery cuts web conversion by up to 20%), and ROE, debt to equity, current and quick ratio on Statements.
- **Tests:** 219 passing (`tests/credit.test.js`, `tests/rating.test.js`). Morph and scrollbar checks clean.
- **Honest limits:** rating curve and star-to-conversion effect are my own model, not MonsoonSIM's hidden numbers. Parity is measured against the public spec, not hands-on use. Still missing from the original recon list: nothing on the feature table except the items marked partial.

- **Facilitator checkpoints:** the host can stop every device now, or set an automatic stop every 5 to 20 days in the room settings. Players see a waiting message; the host presses Continue (Mail, Facilitator). The Continue message carries the day, so a checkpoint a slow player has not reached yet is skipped for them. Logic in `js/live.js`, tested in `tests/live.test.js`. **Not verified:** a real two-browser room over Supabase (sandbox cannot reach it). Each device still keeps its own clock, so a stopped player's day count can differ by a few seconds from the host's.

- **Branch shops:** up to 3 extra outlets in other places (Branches tab under More). Each has a one-time fit-out (booked as equipment), daily rent and staff scaled by the place, and sells from the main shop's stock at the main shop's prices, after the main shop has sold for the day. Moving stock costs a small fee per unit. All money goes through the ledger and the reconcile check passes. Logic in `js/branch.js`, tests in `tests/branch.test.js` (224 tests in all). **Simplified on purpose:** branches have no own stock, staff roster, prices or walking customers; sales are settled once a day like the web store. Old saves load (branches default to none).

- **Client credit ratings (B2B):** each buyer has a score (AAA to DDD) that drifts daily on its own random stream, rises 2 points when it pays and falls 25 when it does not. The chance an invoice is never paid comes from the score (about 1 percent per 10 points below 100). The B2B market shows each buyer's rating and every tender card shows the expected unpaid share; you get a Credit desk mail when a buyer you are owed money by is downgraded. Tests in `tests/clientcredit.test.js` (228 in all). **Limit:** the player cannot yet demand prepayment or buy credit insurance; the rating is information and risk only. Rating bands and drift size are my own model.

- **KPI targets:** a team can set a target for any of the eight KPIs (Insights, Score) or pick Easy, Standard or Hard. The screen shows progress to target (capped at 100) and a target score. In a live room the host picks a level; it is applied to every player and locked. Targets never change the normal score or the live board, so they cannot be used to raise a rank. Tests in `tests/targets.test.js` (232 in all). **Limit:** a locked set is locked only in the client, like the other live-room scores. Preset values are my own, not MonsoonSIM's.

- **Currency and central bank:** an exchange index (1.00 neutral, range 0.80 to 1.25) multiplies the price of every supplier except the Local Co-op; a central bank rate (0.5 to 9 percent, starts at 3) pulls the index toward a level (higher rate means lower index) and scales the bank's charges on overdraft, credit and new loans. Insights, Currency shows both, a 7-day outlook with an 80 percent band, and a chart. Own random stream, so the shop's dice are untouched. Tests in `tests/currency.test.js` (238 in all), including a calibration test: over 60 seeds about 80 percent of next-week index values land inside the stated band. **Limits:** your money stays in dollars (no second currency on the books); the outlook assumes the policy rate holds; the effect sizes are my own model. One existing test (`tests/ops.test.js`, overdraft interest) now includes the policy factor.

- **Demographic marketing:** a campaign can now be aimed at everyone, seniors, adults or juniors. Each product category has a buyer mix (food mostly adults, electronics mostly juniors); each channel suits some groups better (radio seniors, social and influencers juniors, search adults). Awareness per category is the mix-weighted reach, so a well-matched campaign lifts demand about 1.5 to 2 times as hard as an unfocused one and a mismatched one much less. The Marketing screen shows awareness per age group. Unfocused campaigns and old saves behave exactly as before. Tests in `tests/demographics.test.js` (242 in all). **Limit:** the age mix, channel affinities and focus strength are my own numbers; demand itself is not split by age, only the awareness lift is.
