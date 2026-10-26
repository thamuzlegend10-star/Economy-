# Economy

2D business simulation. Run a corner shop inside a small business district: order stock from suppliers, receive truck deliveries in the warehouse, fill shelves, serve customers, hire staff, use the bank, and read daily reports built from a double-entry ledger.

## Learning the game
A guided tutorial starts with every new game (replay it from the menu). Every panel has a collapsible tips box, and **How to play** in the menu explains goals, the daily loop, money, staff and tips.

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
- **Limits (be honest):** this is host-checked, not server-authoritative. Channels are public to anyone who guesses a code, and a carefully crafted, self-consistent save could still cheat. Treat it as friendly competition, not ranked play. A real anti-cheat needs a server that simulates the game.
- Dev: add `?fast=N` to the URL to speed up simulation (used by tests). `npm test` runs engine + multiplayer tests.
