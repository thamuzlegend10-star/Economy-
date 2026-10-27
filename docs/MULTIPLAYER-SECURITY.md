# Multiplayer security: current state and a server-authoritative design

## Current state (not fixed, by design)
The online mode is for **friendly play only**. Browser code cannot make it cheat-proof.

What is wrong and why browser code cannot fix it:

- **Public channels.** A room is a public Supabase Realtime channel named after a 6-digit code. Anyone who knows or guesses a code (900,000 possibilities) can join the channel and send messages.
- **Client-supplied identity.** The `from` field of every message and the `joinedAt` value in presence metadata are set by the sender. Anyone can claim any id and any join time.
- **Host election trusts `joinedAt`.** The "host" is the player with the smallest `joinedAt`. A forged `joinedAt` of 0 takes the host seat, so that client can send `start`, `verdict`, `end` and `kick` messages that other clients accept.
- **The host verifies saves, but saves are client-made.** The host checks the format, that the ledger reconciles, and that the settings match. A crafted save that is self-consistent can still reach a high score without being played.
- **Rate limits are client-side.** The join limit lives in the joining client and can be skipped.

What the code does today (and what it does not claim): incoming messages are rebuilt field by field, ratings and numbers are clamped, names and notes are cleaned, and every value is escaped before it is shown. That stops script injection and malformed data. It does **not** stop impersonation or cheating.

## Server-authoritative design (not implemented)

### Principles
1. The browser never decides who is host, who is in a room, or what a score is.
2. The server owns room state. Clients send **commands**, the server decides.
3. Scores come from a re-simulation on the server, not from a client save.

### Tables (Postgres, Supabase)
- `rooms(id uuid pk, code text unique, host_id uuid references auth.users, config jsonb, seed bigint, phase text check (phase in ('lobby','playing','finished')), created_at, started_at, finished_at)`
- `room_members(room_id, user_id, name text, ready bool, joined_at timestamptz default now(), left_at, primary key (room_id, user_id))`
- `room_commands(room_id, user_id, seq int, day int, cmd jsonb, created_at, primary key (room_id, user_id, seq))` : the player's logged commands (order, set price, hire, ...).
- `room_results(room_id, user_id, score int, rating text, net_worth numeric, verified bool, note text, primary key (room_id, user_id))`

Players sign in with Supabase anonymous auth, so `auth.uid()` is a real, unforgeable identity.

### Row Level Security
- `rooms`: select only for members (`exists(select 1 from room_members m where m.room_id = rooms.id and m.user_id = auth.uid())`). No direct insert/update/delete from clients.
- `room_members`: members can read the members of their own room. Insert/update/delete only through RPC.
- `room_commands`: a member may insert rows for themselves only (`user_id = auth.uid()`), only while `phase = 'playing'`, with `seq` strictly increasing. No update/delete.
- `room_results`: read for members once `phase = 'finished'`. Written only by the server function.

### Server-owned operations (Postgres functions or one Edge Function)
- `create_room(name, config)`: generates the code and seed with a CSPRNG, sets `host_id = auth.uid()`.
- `join_room(code, name)`: rate limited per user and per IP; rejects when the room is `playing` or full; adds a `room_members` row.
- `set_config`, `kick`, `start_room`: allowed only when `auth.uid() = host_id`. `start_room` fixes the member list and the seed.
- Host handover: a function that, when the host's `left_at` is set or a heartbeat is missing for N seconds, picks the member with the smallest **server** `joined_at`.
- `submit_final(room_id)`: the server loads the member's `room_commands`, **re-simulates** the game with the shared engine (`js/engine.js` is pure and already runs in Node/Deno), checks each command is legal at that point, and computes the score. The client never sends a score or a save. Pure-JS engine plus a seeded RNG make this feasible; commands must be applied at the simulated times they were issued.
- Finish rule: when every member has a result, or a deadline passes, the server sets `phase = 'finished'` and ranks.

### Realtime
- Use **private channels** (Realtime Authorization): a policy on `realtime.messages` allows a user to receive/send on topic `room:<room_id>` only if they are a member. Clients may send **presence and progress** only. State changes (start, verdict, end, kick) are written to tables by the server and delivered with Postgres Changes, so no client can forge them.

### Room codes and join secrets
- Lengthen the code (for example 8 characters from a 32-letter alphabet, about 40 bits) or add a short join secret that the host shows. Treat the code as a password: rate limit failed joins per IP and per user, and expire unused lobbies after about 30 minutes.

### Rate limits
- Per user: room creation (for example 5 per hour), joins, command inserts per second.
- Per IP: join attempts (Edge Function or a gateway, since Postgres does not see IPs).

### Rollout order
1. Anonymous auth + `rooms`/`room_members` + RPCs + private channels (stops impersonation and forged host messages).
2. Command log + server re-simulation (stops forged saves).
3. Rate limits and longer codes.

Step 1 alone removes the cheapest attacks. Step 2 is the work that makes scores trustworthy.
