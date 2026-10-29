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

Not built yet: street-level maps, multiple stores or cities in one game, a facilitator mode, server-authoritative multiplayer.

## Rivals (v6)
Busy sites have 1 to 4 simulated rival shops (`s.rivals`): name, type (discounter, balanced, premium), price level, quality, stock availability and promotions. Your share of local demand is your attractiveness divided by yours plus all rivals', where attractiveness depends on price against the market, reputation and your stockout rate. Each morning rivals react: they match prices if you undercut them, drift back to their usual level, run 2-day promotions and sometimes run low on stock. Rivals use their own random stream, so game results stay deterministic for a seed. The day report notes share swings of 3 points or more and the likely cause; Planning lists the rivals with their price against yours; rival shops appear on the district map. Neutral start has no rivals.

Limits: rivals are simulated, not real businesses, and do not own money or a ledger. In online rooms each player has their own rivals (same seed, so same start). v5 saves migrate by generating rivals.

## Supplier payment terms (v7)
FreshFarm (net 5 days, +2%) and Metro (net 7 days, +3%) let you order **On terms**: goods arrive now, the invoice sits in a `payables` liability, and cash leaves on the due day from bank then cash. Limits: a credit limit that grows with net worth; an overdue invoice takes a 2% daily late fee and blocks new credit; you can pay early from Procurement; cancelling a processing order reduces the invoice. QuickShip is cash only. The ledger stays balanced and `reconcile` checks invoices against payables. v6 saves migrate with no invoices.

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
