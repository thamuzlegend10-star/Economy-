-- Run once in Supabase Dashboard > SQL Editor.
create table if not exists public.game_saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.game_saves enable row level security;

create policy "read own save" on public.game_saves
  for select using (auth.uid() = user_id);

create policy "insert own save" on public.game_saves
  for insert with check (auth.uid() = user_id);

create policy "update own save" on public.game_saves
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Required: let signed-in users reach the table (RLS still limits rows).
grant usage on schema public to anon, authenticated;
grant select, insert, update on public.game_saves to authenticated;

-- Verified matches (v10). Only the verify-match Edge Function writes, using the service-role key.
create table if not exists public.match_rooms (
  code text primary key,
  config jsonb not null,
  host_hash text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.match_results (
  code text not null,
  player_id text not null,
  name text not null,
  score integer not null,
  rating text not null,
  net_worth numeric not null,
  goals_met integer not null default 0,
  goals_total integer not null default 0,
  bankrupt boolean not null default false,
  verified_at timestamptz not null default now(),
  primary key (code, player_id)
);
alter table public.match_rooms enable row level security;
alter table public.match_results enable row level security;
create policy "results are public" on public.match_results for select using (true);
-- no policies on match_rooms and no anon write policies: the browser cannot read rooms or write anything.
