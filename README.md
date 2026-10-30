# Economy

2D business simulation. Run a corner shop inside a small business district: order stock from suppliers, receive truck deliveries in the warehouse, fill shelves, serve customers, hire staff, use the bank, and read daily reports built from a double-entry ledger.

## Learning the game
A guided tutorial starts with every new game (replay it from the menu). Every panel has a collapsible tips box, and **How to play** in the menu explains goals, the daily loop, money, staff and tips.

## Planning loop (v4)
Decisions connect from demand to the books:
- **Forecast**: Planning shows expected customers for 3 days as a range (weekday, reputation, booked campaigns). Random events and daily variation are not in it; each day report compares forecast with actual traffic and shows accuracy.
- **Stock plan**: expected units per product and days of cover (stock plus incoming) turn the forecast into buying decisions. Low cover also raises an alert.
- **Campaigns**: Flyers, Local radio, Social ads. Paid up front from the bank or cash (booked as a marketing expense), they start after a delay and lift customer traffic for a few days. This replaces the old always-on marketing level.
- **Supplier terms**: each supplier's price drifts daily around its normal price (shown as a percentage on the Procurement cards), and your own on-time record per supplier is tracked.
- **Budgets**: an optional daily revenue target and expense limit. Reports show variance and whether the budget was met; the final report summarizes forecast accuracy, budget days met and service level.

Save version is 4. Version 3 saves are migrated on load (marketing level dropped, new fields get neutral defaults); older versions are rejected with a message. Multiplayer: all players run the same engine, so campaigns and budgets are validated by the same `validateSave` the host already uses. Players on different versions cannot be compared, because the host rejects saves from another version.

## Locations (v5)
A data-driven catalog (`js/locations.js`) of 9 sites plus a neutral start: Indonesia (Medan central market area and residential suburb, Pematangsiantar town centre, Central Jakarta, Denpasar), Singapore, Kuala Lumpur, Tokyo and New York City. Pick one in **New game > Choose on globe** (rotate, zoom, search, Country > Region > City > District, side-by-side comparison) or as the host in an online room.

The location is used by the real simulation: customer volume and rival pressure, rent, wages and utilities, supplier delivery fee, delivery time and which suppliers deliver, per-category demand, purchasing power and price sensitivity. The pre-game estimate and suitability score use the same coefficients, and show a range plus their assumptions.

Data honesty: country, region, city names and coordinates are real; **districts are simulated** and **every coefficient is a game-balancing estimate, not a statistic**. Game money stays in dollars (the currency field is informational). The globe is a schematic with coarse hand-made coastlines and works offline; there is no map service.

Not built yet: street-level maps, a live authoritative game server.

## Rivals (v6)
Busy sites have 1 to 4 simulated rival shops (`s.rivals`): name, type (discounter, balanced, premium), price level, quality, stock availability and promotions. Your share of local demand is your attractiveness divided by yours plus all rivals', where attractiveness depends on price against the market, reputation and your stockout rate. Each morning rivals react: they match prices if you undercut them, drift back to their usual level, run 2-day promotions and sometimes run low on stock. Rivals use their own random stream, so game results stay deterministic for a seed. The day report notes share swings of 3 points or more and the likely cause; Planning lists the rivals with their price against yours; rival shops appear on the district map. Neutral start has no rivals.

Limits: rivals are simulated, not real businesses, and do not own money or a ledger. In online rooms each player has their own rivals (same seed, so same start). v5 saves migrate by generating rivals.

## Supplier payment terms (v7)
FreshFarm (net 5 days, +2%) and Metro (net 7 days, +3%) let you order **On terms**: goods arrive now, the invoice sits in a `payables` liability, and cash leaves on the due day from bank then cash. Limits: a credit limit that grows with net worth; an overdue invoice takes a 2% daily late fee and blocks new credit; you can pay early from Procurement; cancelling a processing order reduces the invoice. QuickShip is cash only. The ledger stays balanced and `reconcile` checks invoices against payables. v6 saves migrate with no invoices.

## Branches (v8)
Up to 2 branches in other districts, from day 5 with $1,200 net worth (`openBranch`, `transferStock`, `setBranchStaff`, `closeBranch`). A branch has its own location coefficients, rivals, reputation, rent (80% of a full shop), utilities and 1 to 3 cashiers (45 customers a day each). It is simulated once a day in `closeDay`: demand from the same model as the main shop, limited by cashier capacity and by stock sent from the warehouse (paid transfer fee, instant). Sales, cost of goods, rent, utilities and wages post to the shared ledger; `reconcile` counts branch stock. The fit-out ($300 + $400 x the site's rent factor) is kept as equipment and written off on closing, when stock returns to the warehouse as space allows.

Limits: branches are not walkable scenes (the map still shows the main district), share prices and suppliers with the main shop, have no manager, transfers are instant, and in online rooms each player's branches are their own. Saves from v7 migrate with no branches.

## Scenarios and facilitator tools (v9)
**Scenarios** (`js/scenarios.js`, pure data): four ready-made Standard-mode challenges (Grand opening, Supply crunch, Price war, Cash squeeze). A scenario fixes difficulty, capital, days and site, replaces random events with scripted shocks on set days (rain, festival, supplier delay, price rise, repair, rival promotion), and judges goals at the end (net worth growth, service rate, no overdraft or overdue invoice, reputation, market share, customers). The Goals panel shows live progress; the final report shows goals met or missed and a short discussion point.

**Debrief export:** the final report offers a text debrief (setup, result, goals, scripted events, daily results, decisions, discussion point) and a CSV of daily results, both built in the browser (`js/debrief.js`).

**Facilitator in online rooms:** the host can choose a scenario in the lobby (it fixes the setup for everyone, and the host checks a final save was played in that scenario) and, during a match, send an event (rain, festival, supplier delay, price rise, repair, rival promotion) to all players. It is queued and applied at the start of each player's next day. Result rows show goals met out of total.

Limits: the room is still friendly play, so injected events and scenario play are not enforced or verified beyond the final-save checks (a modified client can ignore them). There is no teacher dashboard, no per-student login and no live pausing. Scenario thresholds were checked only with simple bots (idle fails, a basic stock-up bot clears most goals), not with real players. Saves from v8 migrate with no scenario.

## Reports
- **Net profit in the top bar:** the HUD tile now shows cumulative net profit (all income minus all costs, from the ledger). Net worth stays on the balance sheet and in the score.
- **Cash flow statement** (day report and Finance > Cash flow): customer receipts, supplier payments, rent/wages/other costs, interest, tax (operating), upgrades and fit-outs (investing), loans and overdraft (financing). It adds up to the change in cash + bank and is tested on every day of a game with loans, terms, upgrades and a branch. Overdraft-funded costs move no cash, so they are not in it.
- **Sales and margin by product** in the day report (main shop only).
- **Finance > Market:** share per day, who takes the demand (you vs each rival), the three factors behind your share (reputation, price, availability) and a price what-if. The day report shows the day's market share.
Limits: reports from games saved before this version have no cash-flow breakdown for the day in progress; branch sales are in the totals but not in the product table.

## Verified matches (v10)
Online matches are now checked by **deterministic replay** instead of trusting the final save. The simulation runs in fixed 0.05 s steps, so a match is a pure function of its setup, the shared seed, the step count and the player's commands. Every online match is recorded (`cmdlog`: step number, command, arguments for each successful command), and when a player finishes, the host re-plays that log from the seed (`js/replay.js`) and requires the **exact same final state** (random stream, ledger balances, day, history length). The official score is computed from the replayed game, never from numbers the player sent. Editing the save, the log, the seed, the settings or removing or adding a command is rejected, and result rows say "Replay verified". `node tools/verify-match.mjs <config.json> <final-save.json>` runs the same check from the command line, so a server function can run it too.

What this does and does not give you:
- It stops edited saves, fake balances, skipped costs and invented commands. A replay takes tens of milliseconds.
- It does not stop a player using a script or another tool to play well, or taking as long as they like in a paused game. Rules are enforced; the person is not.
- The host's browser still does the replay in the app. A deployable server check now exists (below); the app does not call it yet, so a malicious host can still lie until that is wired in.
- Facilitator events are part of the log but the host does not require that every event was applied.
- Saves from v9 or earlier carry no log, so they cannot be verified (new matches always start with one).

### Server verification (Supabase Edge Function)
`server/verify-match.js` is the same replay check behind an HTTP handler. It has two actions: `register` (host stores a room's settings and a hashed secret; first write wins) and `submit` (a player sends a final save; the function replays it and stores the result in `match_results`; first valid result per player wins, 20 results per room max). Tables and row-level security are in `supabase/schema.sql` (public read of results, no anonymous writes). Only the function writes, using the service-role key from its own environment. Never put that key in this repo.

Deploy with the Supabase CLI, from the repo root:
```
supabase link --project-ref <your-project-ref>
supabase functions deploy verify-match --no-verify-jwt
```
The CLI bundles `supabase/functions/verify-match/index.ts` and the engine files it imports. Smoke test: finish a short match, POST the save, then read `match_results`. `node tools/verify-match.mjs config.json save.json` runs the same check locally.

Limits: tested here against a fake database and a Deno shim, not a live Supabase project. A room code can be registered first by anyone (squatting). Scripts are not stopped. The game client does not call the function yet.

## Modes
- **Standard**: fixed number of days, then a score and final report.
- **Infinite**: no end date, milestones and upgrades, recoverable bankruptcy.
- **Online multiplayer**: planned for the next phase (Supabase Realtime).

## Run
Modules need a web server (not `file://`):

    python3 -m http.server 8000     # then open http://localhost:8000

Tests: `npm test` (Node 20+, no dependencies).
Balance check: `node tools/balance.mjs` plays 30 days with simple bots on every difficulty and prints outcomes.

## Saving
Progress is saved in this browser only (localStorage, plus export/import of a save file from the menu). There is no database save. Supabase is used only for the online multiplayer channel; put the **publishable** key in `config.js`.

## Security
- Never commit the database password, a `service_role` / `sb_secret_` key, or Metered credentials.
- `.env*` files are git-ignored. Real secrets belong in a server or host secret manager.

## Layout
`js/engine.js` rules and commands, `js/ledger.js` double-entry books, `js/data.js` tunable data, `js/world.js` + `js/art.js` canvas world, `js/ui.js` panels and reports, `js/main.js` app wiring, `js/cloud.js` Supabase client for multiplayer, `js/tutorial.js` guided tour, `js/sound.js` synthesized sound effects.

## Online multiplayer

Menu -> **Online multiplayer**. One player creates a room (six-digit code), friends join with the code, the host picks days / difficulty / capital and presses Start. Everyone gets the same settings and seed and runs their own shop at their own pace; a live scoreboard shows each player's day and net worth, and the host publishes the final ranking.

- Transport: Supabase Realtime (broadcast + presence) using only the public key. If Supabase is unavailable the game falls back to a **local test mode** (BroadcastChannel, tabs of one browser).
- Rules: the host (earliest joiner; promoted automatically if they leave) validates each player's final save (format, ledger reconciles, same settings, finished) and computes the score. Late joiners are rejected; dropped players can rejoin within 90 s. Join attempts are rate limited.
- **Friendly play only.** This mode is NOT secure. Channels are public to anyone who guesses a 6-digit code, message senders and join times are supplied by the client, so anyone in (or guessing into) a room can pretend to be the host, and a crafted save can claim a score that was never played. Incoming data is validated and escaped, which stops broken or malicious *content*, but it does not stop impersonation or cheating. Do not use it for prizes or rankings. A server-authoritative design is described in [docs/MULTIPLAYER-SECURITY.md](docs/MULTIPLAYER-SECURITY.md); it is not built yet.
- Dev: add `?fast=N` to the URL to speed up simulation (used by tests). `npm test` runs engine + multiplayer tests.
