-- Warhammer Painting Competition — Supabase schema
-- Run this once in the Supabase project's SQL editor (Database > SQL Editor).
--
-- IMPORTANT MANUAL STEP (not doable from SQL): in Authentication > Providers,
-- disable "Allow new users to sign up" after creating the one admin account,
-- so the admin-only RLS policies below (which just check for "authenticated")
-- can't be bypassed by a stranger creating their own account.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table entries (
  id uuid primary key default gen_random_uuid(),
  participant_name text not null,
  month text not null,                -- e.g. '2026-01'
  model_name text not null,
  created_at timestamptz not null default now()
);

create table entry_images (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  storage_path text not null,
  position int not null default 0
);

create table ballots (
  id uuid primary key default gen_random_uuid(),
  voter_name text not null,
  month text not null,
  created_at timestamptz not null default now()
);

-- One ballot per person per month, case/whitespace-insensitive.
create unique index ballots_voter_month_unique
  on ballots (lower(trim(voter_name)), month);

create table ballot_scores (
  id uuid primary key default gen_random_uuid(),
  ballot_id uuid not null references ballots(id) on delete cascade,
  entry_id uuid not null references entries(id) on delete cascade,
  score int not null check (score between 1 and 5),
  unique (ballot_id, entry_id)
);

create table settings (
  key text primary key,
  value numeric not null
);

insert into settings (key, value) values
  ('points_first', 10),
  ('points_second', 7),
  ('points_third', 5),
  ('points_participation', 2);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table entries enable row level security;
alter table entry_images enable row level security;
alter table ballots enable row level security;
alter table ballot_scores enable row level security;
alter table settings enable row level security;

-- entries: anyone can submit and read; only the logged-in admin can edit/delete
create policy "entries_public_select" on entries for select using (true);
create policy "entries_public_insert" on entries for insert with check (true);
create policy "entries_admin_update" on entries for update using (auth.role() = 'authenticated');
create policy "entries_admin_delete" on entries for delete using (auth.role() = 'authenticated');

-- entry_images: same pattern
create policy "entry_images_public_select" on entry_images for select using (true);
create policy "entry_images_public_insert" on entry_images for insert with check (true);
create policy "entry_images_admin_update" on entry_images for update using (auth.role() = 'authenticated');
create policy "entry_images_admin_delete" on entry_images for delete using (auth.role() = 'authenticated');

-- ballots: anyone can vote and read; only admin can edit/delete
create policy "ballots_public_select" on ballots for select using (true);
create policy "ballots_public_insert" on ballots for insert with check (true);
create policy "ballots_admin_update" on ballots for update using (auth.role() = 'authenticated');
create policy "ballots_admin_delete" on ballots for delete using (auth.role() = 'authenticated');

-- ballot_scores: same pattern
create policy "ballot_scores_public_select" on ballot_scores for select using (true);
create policy "ballot_scores_public_insert" on ballot_scores for insert with check (true);
create policy "ballot_scores_admin_update" on ballot_scores for update using (auth.role() = 'authenticated');
create policy "ballot_scores_admin_delete" on ballot_scores for delete using (auth.role() = 'authenticated');

-- settings: anyone can read (needed to show points on results pages); only admin can write
create policy "settings_public_select" on settings for select using (true);
create policy "settings_admin_insert" on settings for insert with check (auth.role() = 'authenticated');
create policy "settings_admin_update" on settings for update using (auth.role() = 'authenticated');
create policy "settings_admin_delete" on settings for delete using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- Storage bucket for entry photos
-- ---------------------------------------------------------------------------
-- Create the bucket itself in the dashboard (Storage > New bucket):
--   name: entry-photos
--   public: yes (so the site can display images via public URLs)
--
-- Then run these policies (Storage > Policies, or here since storage.objects
-- is a normal table you can add policies to via SQL):

create policy "entry_photos_public_read"
  on storage.objects for select
  using (bucket_id = 'entry-photos');

create policy "entry_photos_public_upload"
  on storage.objects for insert
  with check (bucket_id = 'entry-photos');

create policy "entry_photos_admin_update"
  on storage.objects for update
  using (bucket_id = 'entry-photos' and auth.role() = 'authenticated');

create policy "entry_photos_admin_delete"
  on storage.objects for delete
  using (bucket_id = 'entry-photos' and auth.role() = 'authenticated');
