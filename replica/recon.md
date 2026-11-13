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
Retail core: already built in Economy (see features.csv, weighted parity 80.7 percent at the time of the recon, 56 rows). **Re-scored after the gap pass: 93.0 percent** (must 3, should 2, could 1; yes 1, partial 0.5, no 0; rows marked skip left out, the same method that gave 80.7). The gaps listed then (credit rating, multiple stores, per-team KPI targets, demographic marketing, FX) are built, plus facilitator checkpoints, seller stars, client credit, data export, shelf life, OCEAN hiring and service jobs. Still partial: seven stores (three branches, shared stock), accrual mode, seasonality, B2B forecast, delivery quality checks, warehouse rent terms, outsourcing, market intelligence, expiry beyond shop milk, export as files only. Still no: quizzes (not a game feature).

## Honest note
Economy was built from the user's master spec, so parity is measured against the spec plus these public pages, not against hands-on use of MonsoonSIM.
