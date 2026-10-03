# Warhammer Painting Competition

Static site (no build step) for running a monthly painting competition:
members submit an entry with photos, then vote on each other's entries —
either the classic 1–5 scoring vote or head-to-head **Battle Voting** — with
live monthly results and a running yearly leaderboard. Entries, votes, and
photos all live in Supabase; the site itself is plain HTML/CSS/JS hosted on
GitHub Pages.

## One-time setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com) (or use an
   existing one).
2. Open **SQL Editor** and run the contents of [`sql/schema.sql`](sql/schema.sql).
   This creates the tables, the default points settings, and the Row Level
   Security policies. (If you already ran this once on an existing project,
   `schema.sql` will error on tables that already exist — instead just run
   whichever `sql/migration_*.sql` files you haven't run yet, in order.)
3. Open **Storage** and create a new bucket named `entry-photos`, marked
   **public**.
4. Open **Authentication > Users** and add one user manually (this is the
   admin account) — use a real email you control and a strong password.
5. Open **Authentication > Sign In / Providers** (or **Auth settings**,
   depending on your Supabase version) and **disable "Allow new users to
   sign up"**. This is important: the admin-only edit/delete permissions in
   `schema.sql` are granted to any *authenticated* user, so you don't want
   strangers able to create their own account.
6. Open **Project Settings > API** and copy the **Project URL** and the
   **anon public key**.

### 2. Wire up the site

Edit [`assets/supabase-client.js`](assets/supabase-client.js) and paste in
your Project URL and anon key:

```js
const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...';
```

The anon key is safe to commit/publish — it only grants whatever the RLS
policies in `schema.sql` allow.

### 3. Try it locally

Any static file server works, e.g.:

```
npx serve .
```

then open the printed `localhost` URL.

### 4. Deploy to GitHub Pages

1. Push this repo to GitHub.
2. In the repo's **Settings > Pages**, set the source to the `main` branch,
   root folder.
3. Your site will be live at `https://<your-username>.github.io/<repo-name>/`.

Share `.../submit.html` for entries, `.../vote.html` or `.../battle-vote.html`
for voting each month (see "Battle Voting" below), `.../live-results.html` on
a TV/monitor during a battle-voting event, and `.../results.html` /
`.../leaderboard.html` for the standings.

## How scoring works

- Each voter submits one ballot per month, scoring every entry from 1–5.
- For a given month, entries are ranked by **average score**. Ties share a
  rank (e.g. two entries tied for 1st both get 1st-place points, and the next
  entry is ranked 3rd).
- Points per month: 1st/2nd/3rd place get the configured bonus; everyone else
  who entered gets the participation points. These are **not** stacked (1st
  place does not also get participation points on top).
- The yearly leaderboard sums these points per person across every month,
  grouping entries by name (trimmed, case-insensitive). If a name is
  misspelled differently across months, fix it on the **Admin** page
  (edit each entry's name to match) and the leaderboard will merge
  automatically — nothing is pre-computed or cached.

## Battle Voting

An alternative to the 1–5 scoring vote: a mobile-first head-to-head mini-game
at `battle-vote.html`, with a live TV/monitor screen at `live-results.html`
designed to be left open during the event.

- From **Admin > Battle Voting control**, click **Start battle voting** for
  a month (optionally with a theme, e.g. "Blood & Gore"). This generates a
  balanced schedule of random pairings — around 7 per entry, no pairing
  repeated — and opens voting.
- Share `battle-vote.html` — voters enter their name once (remembered on
  their phone) and tap through battles one at a time, no login needed.
  Multiple people can (and should) vote on the same pairing independently;
  that's how the ranking gets enough signal.
- `live-results.html` updates on its own (via Supabase Realtime, plus a
  15-second refresh as a backup) showing progress, the live leaderboard, and
  a recent-battles feed — voter identities are never shown, only results.
- Ranking uses **Elo**: every vote nudges both entries' ratings; since each
  vote is independent, contradictory results (A beats B, B beats C, C beats
  A) are expected and don't break anything — the accumulated ratings still
  produce a sensible order.
- **Stop battle voting** freezes the ranking as final and switches
  `live-results.html` to a podium view. **Reset** wipes that month's
  battles/votes if something went wrong, so you can start over.
- `results.html` and `leaderboard.html` automatically use whichever
  mechanism a given month actually has data for — no separate setup needed,
  and yearly points work the same way regardless of which vote type was used.

## Admin page

`admin.html` requires logging in with the one Supabase Auth account you
created above. From there you can:

- Edit or delete any entry (also removes its photos and any votes on it).
- Edit a ballot's voter name/month, or any individual score, or delete the
  whole ballot.
- Entries/ballots sharing a very similar name within the same month are
  flagged with ⚠ so you can spot accidental duplicate submissions or
  double votes.
- Edit the points awarded for 1st/2nd/3rd/participation — changes apply
  retroactively to every month's results and the leaderboard, since nothing
  is pre-computed.
