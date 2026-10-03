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
