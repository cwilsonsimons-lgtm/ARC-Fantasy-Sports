-- One-time setup for accounts + cloud sync in 1stPrototype.html.
-- Run it once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- One row per account holding the app's whole saved state (the fantasy store and
-- Arc Markets). Row-level security means a signed-in user can only ever read or
-- write their own row; the publishable key in the page cannot see anyone else's.

create table if not exists public.app_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "read own state" on public.app_state;
drop policy if exists "insert own state" on public.app_state;
drop policy if exists "update own state" on public.app_state;

create policy "read own state" on public.app_state
  for select to authenticated using (auth.uid() = user_id);
create policy "insert own state" on public.app_state
  for insert to authenticated with check (auth.uid() = user_id);
create policy "update own state" on public.app_state
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on public.app_state to authenticated;
