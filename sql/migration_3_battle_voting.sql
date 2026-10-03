-- Migration: adds Battle Voting (head-to-head pairwise voting with Elo
-- ranking), alongside the existing 1-5 scoring vote. Run this once in the
-- SQL Editor on your existing Supabase project.

create table battle_months (
  month text primary key,
  status text not null default 'closed' check (status in ('closed', 'open')),
  theme text,
  created_at timestamptz not null default now()
);

create table battles (
  id uuid primary key default gen_random_uuid(),
  month text not null,
  entry_a_id uuid not null references entries(id) on delete cascade,
  entry_b_id uuid not null references entries(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index battles_unique_pair on battles (month, entry_a_id, entry_b_id);

create table battle_votes (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid not null references battles(id) on delete cascade,
  voter_name text not null,
  winner_entry_id uuid not null references entries(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index battle_votes_voter_unique
  on battle_votes (battle_id, lower(trim(voter_name)));

alter table battle_months enable row level security;
alter table battles enable row level security;
alter table battle_votes enable row level security;

-- battle_months: anyone can read; only admin starts/stops/resets
create policy "battle_months_public_select" on battle_months for select using (true);
create policy "battle_months_admin_insert" on battle_months for insert with check (auth.role() = 'authenticated');
create policy "battle_months_admin_update" on battle_months for update using (auth.role() = 'authenticated');
create policy "battle_months_admin_delete" on battle_months for delete using (auth.role() = 'authenticated');

-- battles: anyone can read the schedule; only admin generates/resets it
create policy "battles_public_select" on battles for select using (true);
create policy "battles_admin_insert" on battles for insert with check (auth.role() = 'authenticated');
create policy "battles_admin_delete" on battles for delete using (auth.role() = 'authenticated');

-- battle_votes: anyone can read (needed for live Elo + activity feed) and
-- vote, but only while that month's battle voting is open; only admin can
-- edit/delete for corrections
create policy "battle_votes_public_select" on battle_votes for select using (true);
create policy "battle_votes_public_insert" on battle_votes for insert with check (
  exists (
    select 1 from battles b
    join battle_months bm on bm.month = b.month
    where b.id = battle_votes.battle_id and bm.status = 'open'
  )
);
create policy "battle_votes_admin_update" on battle_votes for update using (auth.role() = 'authenticated');
create policy "battle_votes_admin_delete" on battle_votes for delete using (auth.role() = 'authenticated');

-- Realtime: let the live results page subscribe to new votes as they land.
alter publication supabase_realtime add table battle_votes;
