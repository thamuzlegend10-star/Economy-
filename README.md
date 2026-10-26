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

## Cloud save (optional)
1. Supabase SQL Editor: run `supabase/schema.sql` (table, RLS policies, grants).
2. Put your **publishable** key in `config.js`. It is public by design.
3. Authentication: turn off "Confirm email" while testing.

## Security
- Never commit the database password, a `service_role` / `sb_secret_` key, or Metered credentials.
- `.env*` files are git-ignored. Real secrets belong in a server or host secret manager.
- Row Level Security limits each player to their own save row.

## Layout
`js/engine.js` rules and commands, `js/ledger.js` double-entry books, `js/data.js` tunable data, `js/world.js` + `js/art.js` canvas world, `js/ui.js` panels and reports, `js/main.js` app wiring, `js/cloud.js` Supabase save, `js/tutorial.js` guided tour, `js/sound.js` synthesized sound effects.
