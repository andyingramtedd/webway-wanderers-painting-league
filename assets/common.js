const PHOTO_BUCKET = 'entry-photos';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

// Generates 'YYYY-MM' keys, most recent first, from `monthsAhead` in the
// future back to `monthsBehind` in the past.
function generateMonthOptions(monthsBehind = 6, monthsAhead = 1) {
  const now = new Date();
  const options = [];
  for (let offset = monthsAhead; offset >= -monthsBehind; offset--) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    options.push(key);
  }
  return options;
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

function getPhotoUrl(storagePath) {
  return supabaseClient.storage.from(PHOTO_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

async function isVotingOpen(month) {
  const { data, error } = await supabaseClient
    .from('month_locks')
    .select('voting_open')
    .eq('month', month)
    .maybeSingle();
  if (error) throw error;
  return data ? data.voting_open : false;
}

async function fetchSettings() {
  const { data, error } = await supabaseClient.from('settings').select('key, value');
  if (error) throw error;
  const settings = {};
  for (const row of data) settings[row.key] = Number(row.value);
  return settings;
}

function shuffleArray(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Ranks entries by average score (standard competition ranking: ties share a
// rank and the next rank skips, e.g. 1, 2, 2, 4) and assigns points.
// `scoresByEntry` is a Map of entry_id -> array of numeric scores.
function rankEntries(entries, scoresByEntry, points) {
  const rows = entries.map((entry) => {
    const scores = scoresByEntry.get(entry.id) || [];
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    return { entry, avg, voteCount: scores.length, rank: null, points: 0 };
  });

  rows.sort((a, b) => {
    if (a.avg === null && b.avg === null) return 0;
    if (a.avg === null) return 1;
    if (b.avg === null) return -1;
    return b.avg - a.avg;
  });

  let rank = 0;
  let prevAvg = null;
  let seen = 0;
  for (const row of rows) {
    if (row.avg === null) continue;
    seen++;
    if (row.avg !== prevAvg) {
      rank = seen;
      prevAvg = row.avg;
    }
    row.rank = rank;
  }

  for (const row of rows) {
    if (row.rank === 1) row.points = points.points_first;
    else if (row.rank === 2) row.points = points.points_second;
    else if (row.rank === 3) row.points = points.points_third;
    else row.points = points.points_participation;
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Battle Voting: pairing generation + Elo ranking
// ---------------------------------------------------------------------------

// Greedily builds a balanced set of unique pairs so every entry gets
// roughly `avgPerEntry` comparisons, without ever repeating a pairing.
function generateBattlePairings(entryIds, avgPerEntry = 7) {
  const ids = [...entryIds];
  const n = ids.length;
  if (n < 2) return [];

  const maxPossible = (n * (n - 1)) / 2;
  const target = Math.min(maxPossible, Math.round((n * avgPerEntry) / 2));

  const degree = new Map(ids.map((id) => [id, 0]));
  const used = new Set();
  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const pairs = [];

  let attempts = 0;
  const maxAttempts = target * 50 + 1000;

  while (pairs.length < target && attempts < maxAttempts) {
    attempts++;
    const ordered = shuffleArray(ids).sort((a, b) => degree.get(a) - degree.get(b));
    const a = ordered[0];
    const b = ordered.slice(1).find((candidate) => !used.has(pairKey(a, candidate)));
    if (!b) continue;

    used.add(pairKey(a, b));
    degree.set(a, degree.get(a) + 1);
    degree.set(b, degree.get(b) + 1);
    pairs.push(a < b ? [a, b] : [b, a]);
  }

  return pairs;
}

// Fetches a month's battle schedule and every vote cast on it, normalized to
// include the losing entry id (battle_votes only stores the winner).
async function fetchBattleData(month) {
  const { data: battles, error: battlesError } = await supabaseClient
    .from('battles')
    .select('id, entry_a_id, entry_b_id')
    .eq('month', month);
  if (battlesError) throw battlesError;
  if (battles.length === 0) return { battles: [], votes: [] };

  const battleById = new Map(battles.map((b) => [b.id, b]));
  const { data: rawVotes, error: votesError } = await supabaseClient
    .from('battle_votes')
    .select('id, battle_id, voter_name, winner_entry_id, created_at')
    .in('battle_id', battles.map((b) => b.id))
    .order('created_at');
  if (votesError) throw votesError;

  const votes = rawVotes.map((v) => {
    const battle = battleById.get(v.battle_id);
    const loser_entry_id = battle.entry_a_id === v.winner_entry_id ? battle.entry_b_id : battle.entry_a_id;
    return { ...v, loser_entry_id };
  });

  return { battles, votes };
}

// Replays votes (oldest first) through standard Elo. Every vote is an
// independent judgment, so cycles (A beats B, B beats C, C beats A) are
// expected and don't need to be "resolved" — the accumulated ratings
// produce a sensible overall order regardless.
function computeEloRankings(entries, votes, points, { startRating = 1000, kFactor = 32 } = {}) {
  const ratings = new Map(entries.map((e) => [e.id, startRating]));
  const battleCount = new Map(entries.map((e) => [e.id, 0]));

  for (const v of votes) {
    if (!ratings.has(v.winner_entry_id) || !ratings.has(v.loser_entry_id)) continue;
    const winnerRating = ratings.get(v.winner_entry_id);
    const loserRating = ratings.get(v.loser_entry_id);
    const expectedWinner = 1 / (1 + 10 ** ((loserRating - winnerRating) / 400));
    ratings.set(v.winner_entry_id, winnerRating + kFactor * (1 - expectedWinner));
    ratings.set(v.loser_entry_id, loserRating + kFactor * (expectedWinner - 1));
    battleCount.set(v.winner_entry_id, battleCount.get(v.winner_entry_id) + 1);
    battleCount.set(v.loser_entry_id, battleCount.get(v.loser_entry_id) + 1);
  }

  const rows = entries.map((entry) => ({
    entry,
    rating: ratings.get(entry.id),
    battleCount: battleCount.get(entry.id) || 0,
    rank: null,
    points: 0,
  }));

  rows.sort((a, b) => b.rating - a.rating);
  rows.forEach((row, i) => { row.rank = i + 1; });

  for (const row of rows) {
    if (row.rank === 1) row.points = points.points_first;
    else if (row.rank === 2) row.points = points.points_second;
    else if (row.rank === 3) row.points = points.points_third;
    else row.points = points.points_participation;
  }

  return rows;
}

// Picks whichever voting mechanism a month actually has data for (Battle
// Voting takes priority if present) and returns a ranked, pointed list in
// a common shape: { method: 'battle'|'classic', rows }.
async function rankEntriesForMonth(month, entries, points) {
  const { votes } = await fetchBattleData(month);
  if (votes.length > 0) {
    return { method: 'battle', rows: computeEloRankings(entries, votes, points) };
  }

  const { data: scores, error } = await supabaseClient
    .from('ballot_scores')
    .select('entry_id, score, ballots!inner(month)')
    .eq('ballots.month', month);
  if (error) throw error;

  const scoresByEntry = new Map();
  for (const row of scores) {
    if (!scoresByEntry.has(row.entry_id)) scoresByEntry.set(row.entry_id, []);
    scoresByEntry.get(row.entry_id).push(row.score);
  }

  return { method: 'classic', rows: rankEntries(entries, scoresByEntry, points) };
}
