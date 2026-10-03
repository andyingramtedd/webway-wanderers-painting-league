-- Migration: adds a per-month "voting open/closed" switch.
-- Run this once in the SQL Editor on your EXISTING Supabase project
-- (you already ran sql/schema.sql once — this just adds the new bit on top).

create table month_locks (
  month text primary key,
  voting_open boolean not null default false
);

alter table month_locks enable row level security;

create policy "month_locks_public_select" on month_locks for select using (true);
create policy "month_locks_admin_insert" on month_locks for insert with check (auth.role() = 'authenticated');
create policy "month_locks_admin_update" on month_locks for update using (auth.role() = 'authenticated');
create policy "month_locks_admin_delete" on month_locks for delete using (auth.role() = 'authenticated');

-- Replace the old "anyone can vote anytime" rule with one that checks
-- whether voting has been opened for that month.
drop policy "ballots_public_insert" on ballots;

create policy "ballots_public_insert" on ballots for insert with check (
  exists (select 1 from month_locks ml where ml.month = ballots.month and ml.voting_open = true)
);
