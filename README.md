# Economy

Idle economy game. Earn cash, buy businesses, progress saves to Supabase.

## Setup

1. Supabase Dashboard > SQL Editor: run `supabase/schema.sql`.
2. Dashboard > Project Settings > API: copy the **anon public** key into `config.js`.
3. Dashboard > Authentication: for quick testing, turn off "Confirm email".
4. Open `index.html` (or serve with GitHub Pages).

## Security

- Only the anon key goes in the repo. Never commit the database password or `service_role` key.
- Row Level Security limits each player to their own save row.
- Without a key the game still works with a local browser save.
