# MonsoonSIM recon map

Scope: the retail core loop of MonsoonSIM (web business simulation), compared with our own game Economy. Clean-room: this file records what the product does, not its code, copy, art or data. No logins, no scraping, no network or source inspection.

## Sources
| source | url | gave |
| --- | --- | --- |
| Product description | https://www.monsoonsim.com/monsoonsim_product_description.html | module list, mechanics, roles, KPIs, session flow |
| v11 documentation (public PDF) | https://www.monsoonsim.com/depo/doc/v11_doc.pdf | per-module rules and parameters |
| Business world at a glance | https://monsoonsim.com/news/902086/the-monsoonsim-business-world-at-a-glance | departments, facilitator and robot roles |
| Master spec supplied by the user | MONSOONSIM_MASTER_SPEC_AND_PROMPT.txt | the 13 modules as the user wants them |
| User screenshots of the game | attached by the user, kept out of the repo | layout reference only |

The pages do not describe most individual screens, so the screen list below is partly inferred (marked as guess).

## Core loop
Rent a store, buy stock from vendors, set prices, staff the departments, sell to shoppers (and B2B and web buyers), watch finance and KPIs, repeat daily until the session ends. Score is a KPI matrix, not only net worth.

## Screens (S)
| id | screen | purpose | states |
| --- | --- | --- | --- |
| S01 | Dashboard / home | what needs attention, key numbers | new game, warnings, day close |
| S02 | Retail: stores and rental | rent store by location with population data | no store, rented |
| S03 | Retail: pricing and sales | price per product, transactions | stockout, overflow |
| S04 | Procurement | vendor list, purchase requisitions, approvals | pending, late, damaged |
| S05 | Warehouse and logistics | storage, auto-replenish, carriers | full, overflow |
| S06 | B2B | straight deals and bids, sales orders | open bid, won, late |
| S07 | E-commerce Web Market | listings, escrow, seller rating | cancelled order |
| S08 | Marketing | media choice, investment, demographics (guess) | none running |
| S09 | Finance | statements, loans, overdraft, journal, credit rating | overdrawn, delinquent |
| S10 | HCM | recruit, train, transfer, dismiss, staff index | low staff index |
| S11 | Forecast | demand, B2B, FX, central bank rate | |
| S12 | Production, MRP, Maintenance | BOM, machines, requisitions, work orders | broken machine |
| S13 | Service management | RFQs, quotes, scheduling | |
| S14 | BI and reports | sales analysis, integrated report | |
| S15 | Facilitator console | set modules, pace, KPI targets, robots, events | paused |
| S16 | News strip and top bar | day, cash, notifications (guess) | |

## Flows (F)
- F01 Start a retail business: S02 rent store -> S04 purchase stock -> S05 receive -> S03 set price -> sales appear. Needs approval steps in the original.
- F02 Win a B2B bid: S06 open bids -> price bid -> lowest wins -> sales order -> ship before due date or pay penalty.
- F03 Run short of cash: S09 overdraft draws, interest accrues daily, delinquent payments retry, rating falls, bankruptcy at the facilitator limit.
- F04 Staff a department: S10 recruit -> competency grows 10% daily -> staff index feeds sales, allocation speed, campaign effect.
- F05 Facilitator round: S15 configure -> run -> inject event -> debrief with scoring matrix.

## Components
Top bar with day/cash pills, news ticker, department tab row, sub-tab strip, blue-header panels, striped data tables, side finance panel, approval queue (guess), rating badges (AAA to DDD, 0-5 stars), traffic-light maintenance sensors, toasts, dialogs.

## Inferred data model (confidence)
Store(location, rent, capacity), Product(price, elasticity, cost), Vendor(lead time, reliability, terms, currency) high. PurchaseRequisition -> PurchaseOrder -> Delivery high. SalesOrder(due, penalty, client rating) high. Employee(department, competency, wage), StaffIndex derived high. Loan, Overdraft, CreditRating high. KpiTarget, ScoringMatrix medium. OCEAN traits per employee medium.

## Cannot be cloned
Certified facilitator training, quiz content and micro courses, real class hosting, the vendor's data sets, their art and wording, investor/underwriter roles (certified).

## Size
Retail core: already built in Economy (see features.csv, weighted parity 80.7 percent at the time of the recon, 56 rows). **Re-scored after the gap pass: 93.0 percent (94.9 percent after the seasonality and B2B forecast rows)** (must 3, should 2, could 1; yes 1, partial 0.5, no 0; rows marked skip left out, the same method that gave 80.7). **Final re-score after the second research pass: 95.3 percent over 63 scored rows (54 yes, 8 partial, 1 no, 4 skip left out; unweighted 92.1 percent).** Remaining partial or no rows: accrual mode, seven stores, fulfil by outsource, full market intelligence, live data export, quizzes, expiry beyond shop milk, per-module complexity, B2B minimum bidders. The gaps listed then (credit rating, multiple stores, per-team KPI targets, demographic marketing, FX) are built, plus facilitator checkpoints, seller stars, client credit, data export, shelf life, OCEAN hiring and service jobs. Still partial: seven stores (three branches, shared stock), accrual mode, delivery quality checks, warehouse rent terms, outsourcing, market intelligence, expiry beyond shop milk, export as files only. Still no: quizzes (not a game feature).

## Honest note
Economy was built from the user's master spec, so parity is measured against the spec plus these public pages, not against hands-on use of MonsoonSIM.

## Research pass 2 (public web, read 15 Nov 2026)
Read at human speed, public pages only, no login. The public site has no in-game screenshots (the app is behind a login), so there are no new files in `replica/screens/`. Everything below is from text.

### Added sources
| source | url | gave |
| --- | --- | --- |
| Retail (RTL) module page | https://www.monsoonsim.com/news/1061484/retail-rtl-module | the six retail menus, purchase options, approvals, FMCG rules, QC |
| Marketing (MKT) module page | https://www.monsoonsim.com/news/1061493/marketing-mkt-module | media vs consumer type, report subscription, facilitator settings |
| Warehouse and logistics page | https://www.monsoonsim.com/news/1061494/warehouse-logistics-whs-module | rent terms, close rules, trigger-point replenishment, shipping |
| Wholesale (B2B) page | https://www.monsoonsim.com/news/1061497/wholesales-b2b-module | straight deals, bids, tie rule, minimum bidders, pickup or delivery |
| Forecast (FCS) page | https://www.monsoonsim.com/news/1061492/forecast-fcs-module | what each forecast shows, per location or per team demand |
| HCM page | https://www.monsoonsim.com/news/1062247/human-capital-management-hcm-module | staff index formula, 10 percent a day competency growth, fees |
| Facilitator step-by-step | https://www.monsoonsim.com/news/1225120/first-game-first-confidence-a-step-by-step-guide-for-new-monsoonsim-facilitators | game setup order, step-through mode, scoring matrix example |
| Facilitator guide | https://www.monsoonsim.com/news/908839/mastering-monsoonsim-a-step-by-step-guide-to-facilitating-an-engaging-business-simulation-game | facilitator screens, player types, run controls |
| Play-style tips | https://www.monsoonsim.com/news/3365/optimizing-gameplay-strategies-for-running-monsoonsim-games-effectively | monitoring tools, KPIs, pitfalls |
| FAQ | https://www.monsoonsim.com/guide.html?stage=MSIM_FAQ | game length, day length, configurable items |
| Retail competition page | https://www.monsoonsim.com/news/1248000/monsoonsim-business-competition-2025-retail-edition-information-page | registration flow only; no rules or numbers |
| Not reachable | fandom wiki Retail page, ACM paper | the fetch failed, nothing used |

### Learner screens named by the public pages
Retail has six menus: Location, Procurement, Store, Retail Sales and Price, Transaction, Forecast (if on). A magnifying-glass menu opens the data explorer (for example operating expenses by staff). Warehouse has a Move Stock menu. Finance has journals, statements, loans and overdraft. Marketing and HR are described by actions, not screens. Pages do not give layouts.

### Facilitator screens and flow
Member login, Active Guide (module menu plus an AI help chat), Game I Facilitate (list and "New Game"), Game Server (status bar with currency, game days and time settings, module icons below), Module Configuration (module picker plus a settings panel), Team Creation (typed or auto-numbered names), Game Admin (registration link). Setup order: name the game and locale, pick modules, set each module's parameters, create teams, optionally add robot or virtual players, confirm Day 0, share the link. Run controls: Initialise, Stop, Run, Step, Step One Day. Monitoring: learner activity graph, transaction counts by team, player and department, cash and net profit graphs, live transactions.

### Rules found that our game does not have yet
- Retail purchase options: Immediate, Future-dated, and Blanket (staggered) delivery.
- Retail rent has a contract length and Manage Rental rules (a long contract cannot change size mid-term; daily contracts carry no discount).
- Step-through mode: advance one day at a time, and re-initialise to Day 0.
- Bankruptcy after a configurable number of delinquent days (up to 50). Ours is fixed at 3 overdraft days.
- Per-module complexity (beginner, intermediate, advanced) and showing or hiding concepts.
- Price elasticity is a per-product setting the facilitator chooses (high or low).
- B2B: minimum bidders (bid cancelled if too few), customer pickup versus company delivery as a switch.
- Marketing: daily market-intelligence subscription fee; media-to-consumer fit set or random at start.
- FMCG store has a display area and a back room, and batches move between them.
- Facilitator monitor: activity and transaction counts per team.

### Rules we already match (checked against these pages)
Staff index as headcount times competency with a 10 percent a day rise in a new department; price and marketing splitting demand with rivals; overflow fees; QC pays only for good units; warehouse close only when empty; trigger-point replenishment; straight deals and lowest-price bids; client credit AAA to DDD; seller stars; OCEAN fit; demand forecasts; scoring matrix with KPI targets.

### Honest limit
Public pages describe features and rules, not numbers. Prices, rates, fees and screen layouts are not published, so any figure in our game is our own model.

