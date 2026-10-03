const loginForm = document.getElementById('login-form');
const loginStatus = document.getElementById('login-status');
const dashboard = document.getElementById('admin-dashboard');
const entriesContainer = document.getElementById('entries-admin-container');
const ballotsContainer = document.getElementById('ballots-admin-container');
const votingControlContainer = document.getElementById('voting-control-container');
const battleControlContainer = document.getElementById('battle-control-container');
const settingsStatus = document.getElementById('settings-status');

function setStatus(el, message, type) {
  el.textContent = message;
  el.className = type ? `status ${type}` : '';
}

function normalizeName(name) {
  return name.trim().toLowerCase();
}

// Small edit-distance check so near-identical names (typos) get flagged.
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function findSimilarGroups(items, getName, getMonth) {
  // Returns a Set of item ids that share a month with another item whose
  // normalized name is identical or within edit-distance 2.
  const flagged = new Set();
  const byMonth = new Map();
  for (const item of items) {
    const month = getMonth(item);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(item);
  }
  for (const group of byMonth.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = normalizeName(getName(group[i]));
        const b = normalizeName(getName(group[j]));
        if (a === b || levenshtein(a, b) <= 2) {
          flagged.add(group[i].id);
          flagged.add(group[j].id);
        }
      }
    }
  }
  return flagged;
}

let state = {
  entries: [],
  imagesByEntry: new Map(),
  ballots: [],
  scoresByBallot: new Map(),
  entriesById: new Map(),
  monthLocks: new Map(),
  battleMonths: new Map(),
  battleCounts: new Map(),
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = document.getElementById('admin-email').value.trim();
  const password = document.getElementById('admin-password').value;
  setStatus(loginStatus, 'Logging in…', 'info');
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    setStatus(loginStatus, error.message, 'error');
    return;
  }
  setStatus(loginStatus, '', '');
});

document.getElementById('logout-button').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
});

supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (session) {
    loginForm.style.display = 'none';
    dashboard.style.display = 'block';
    loadAll().catch((err) => console.error(err));
  } else {
    loginForm.style.display = 'block';
    dashboard.style.display = 'none';
  }
});

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------

async function loadAll() {
  const [{ data: entries, error: entriesError }, { data: images, error: imagesError },
    { data: ballots, error: ballotsError }, { data: scores, error: scoresError },
    { data: locks, error: locksError },
    { data: battleMonths, error: battleMonthsError },
    { data: battles, error: battlesError },
    { data: battleVotes, error: battleVotesError },
    settings] = await Promise.all([
    supabaseClient.from('entries').select('*').order('month', { ascending: false }).order('created_at'),
    supabaseClient.from('entry_images').select('*').order('position'),
    supabaseClient.from('ballots').select('*').order('month', { ascending: false }).order('created_at'),
    supabaseClient.from('ballot_scores').select('*'),
    supabaseClient.from('month_locks').select('*'),
    supabaseClient.from('battle_months').select('*'),
    supabaseClient.from('battles').select('id, month'),
    supabaseClient.from('battle_votes').select('id, battle_id'),
    fetchSettings(),
  ]);
  if (entriesError) throw entriesError;
  if (imagesError) throw imagesError;
  if (ballotsError) throw ballotsError;
  if (scoresError) throw scoresError;
  if (locksError) throw locksError;
  if (battleMonthsError) throw battleMonthsError;
  if (battlesError) throw battlesError;
  if (battleVotesError) throw battleVotesError;

  state.entries = entries;
  state.entriesById = new Map(entries.map((e) => [e.id, e]));
  state.imagesByEntry = new Map();
  for (const img of images) {
    if (!state.imagesByEntry.has(img.entry_id)) state.imagesByEntry.set(img.entry_id, []);
    state.imagesByEntry.get(img.entry_id).push(img);
  }
  state.ballots = ballots;
  state.scoresByBallot = new Map();
  for (const s of scores) {
    if (!state.scoresByBallot.has(s.ballot_id)) state.scoresByBallot.set(s.ballot_id, []);
    state.scoresByBallot.get(s.ballot_id).push(s);
  }
  state.monthLocks = new Map(locks.map((l) => [l.month, l.voting_open]));

  state.battleMonths = new Map(battleMonths.map((bm) => [bm.month, bm]));
  const battleMonthById = new Map(battles.map((b) => [b.id, b.month]));
  state.battleCounts = new Map();
  for (const b of battles) {
    const counts = state.battleCounts.get(b.month) || { battles: 0, votes: 0 };
    counts.battles++;
    state.battleCounts.set(b.month, counts);
  }
  for (const v of battleVotes) {
    const month = battleMonthById.get(v.battle_id);
    if (!month) continue;
    const counts = state.battleCounts.get(month) || { battles: 0, votes: 0 };
    counts.votes++;
    state.battleCounts.set(month, counts);
  }

  for (const key of ['points_first', 'points_second', 'points_third', 'points_participation']) {
    document.getElementById(key).value = settings[key];
  }

  renderVotingControl();
  renderBattleControl();
  renderEntries();
  renderBallots();
}

// ---------------------------------------------------------------------------
// Battle Voting control
// ---------------------------------------------------------------------------

function renderBattleControl() {
  const months = [...new Set(state.entries.map((e) => e.month))].sort().reverse();

  if (months.length === 0) {
    battleControlContainer.innerHTML = '<p class="muted">No entries yet.</p>';
    return;
  }

  const rows = months.map((month) => {
    const bm = state.battleMonths.get(month);
    const counts = state.battleCounts.get(month) || { battles: 0, votes: 0 };
    let statusLabel;
    let actionCell;

    if (!bm) {
      statusLabel = 'Not started';
      actionCell = `
        <input type="text" id="theme-${month}" placeholder="Theme (optional)" style="width:140px;display:inline-block;margin-right:6px;">
        <button data-action="start-battle" data-month="${month}">Start battle voting</button>
      `;
    } else if (bm.status === 'open') {
      statusLabel = `Open · ${counts.battles} battles · ${counts.votes} votes cast`;
      actionCell = `<button data-action="stop-battle" data-month="${month}">Stop voting</button>`;
    } else {
      statusLabel = `Closed (final) · ${counts.battles} battles · ${counts.votes} votes cast`;
      actionCell = `<button data-action="reset-battle" data-month="${month}">Reset</button>`;
    }

    return `
      <tr>
        <td>${escapeHtml(formatMonthLabel(month))}</td>
        <td>${statusLabel}</td>
        <td class="admin-actions">${actionCell}</td>
      </tr>
    `;
  }).join('');

  battleControlContainer.innerHTML = `
    <table>
      <thead><tr><th>Month</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

battleControlContainer.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const month = button.dataset.month;

  if (button.dataset.action === 'start-battle') {
    const monthEntries = state.entries.filter((e) => e.month === month);
    if (monthEntries.length < 2) {
      alert('Need at least 2 entries in this month to start battle voting.');
      return;
    }
    const themeInput = document.getElementById(`theme-${month}`);
    const theme = themeInput ? themeInput.value.trim() : '';
    const pairs = generateBattlePairings(monthEntries.map((e) => e.id), 7);
    try {
      const { error: bmError } = await supabaseClient
        .from('battle_months')
        .upsert({ month, status: 'open', theme: theme || null }, { onConflict: 'month' });
      if (bmError) throw bmError;

      const battleRows = pairs.map(([a, b]) => ({ month, entry_a_id: a, entry_b_id: b }));
      const { error: battlesInsertError } = await supabaseClient.from('battles').insert(battleRows);
      if (battlesInsertError) throw battlesInsertError;

      await loadAll();
    } catch (err) {
      alert(err.message || String(err));
    }
  } else if (button.dataset.action === 'stop-battle') {
    if (!confirm(`Stop battle voting for ${formatMonthLabel(month)}? This locks in the final ranking.`)) return;
    const { error } = await supabaseClient.from('battle_months').update({ status: 'closed' }).eq('month', month);
    if (error) { alert(error.message); return; }
    await loadAll();
  } else if (button.dataset.action === 'reset-battle') {
    if (!confirm(`Reset battle voting for ${formatMonthLabel(month)}? This deletes all battles and votes for this month so you can start over.`)) return;
    try {
      const { error: deleteBattlesError } = await supabaseClient.from('battles').delete().eq('month', month);
      if (deleteBattlesError) throw deleteBattlesError;
      const { error: deleteMonthError } = await supabaseClient.from('battle_months').delete().eq('month', month);
      if (deleteMonthError) throw deleteMonthError;
      await loadAll();
    } catch (err) {
      alert(err.message || String(err));
    }
  }
});

// ---------------------------------------------------------------------------
// Voting control
// ---------------------------------------------------------------------------

function renderVotingControl() {
  const months = [...new Set(state.entries.map((e) => e.month))].sort().reverse();

  if (months.length === 0) {
    votingControlContainer.innerHTML = '<p class="muted">No entries yet.</p>';
    return;
  }

  const rows = months.map((month) => {
    const open = state.monthLocks.get(month) || false;
    return `
      <tr>
        <td>${escapeHtml(formatMonthLabel(month))}</td>
        <td>${open ? 'Open' : 'Locked'}</td>
        <td class="admin-actions">
          <button data-action="toggle-voting" data-month="${month}" data-open="${open}">
            ${open ? 'Lock voting' : 'Open voting'}
          </button>
        </td>
      </tr>
    `;
  }).join('');

  votingControlContainer.innerHTML = `
    <table>
      <thead><tr><th>Month</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

votingControlContainer.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action="toggle-voting"]');
  if (!button) return;
  const month = button.dataset.month;
  const nextOpen = button.dataset.open !== 'true';
  const { error } = await supabaseClient
    .from('month_locks')
    .upsert({ month, voting_open: nextOpen }, { onConflict: 'month' });
  if (error) { alert(error.message); return; }
  await loadAll();
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

document.getElementById('save-settings-button').addEventListener('click', async () => {
  setStatus(settingsStatus, 'Saving…', 'info');
  try {
    const updates = ['points_first', 'points_second', 'points_third', 'points_participation'].map((key) => {
      const value = Number(document.getElementById(key).value);
      if (!Number.isFinite(value)) throw new Error(`${key} must be a number`);
      return supabaseClient.from('settings').update({ value }).eq('key', key);
    });
    const results = await Promise.all(updates);
    for (const r of results) if (r.error) throw r.error;
    setStatus(settingsStatus, 'Points settings saved.', 'success');
  } catch (err) {
    setStatus(settingsStatus, err.message || String(err), 'error');
  }
});

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

function renderEntries() {
  const flagged = findSimilarGroups(state.entries, (e) => e.participant_name, (e) => e.month);

  if (state.entries.length === 0) {
    entriesContainer.innerHTML = '<p class="muted">No entries yet.</p>';
    return;
  }

  const rows = state.entries.map((entry) => {
    const photoCount = (state.imagesByEntry.get(entry.id) || []).length;
    const flag = flagged.has(entry.id) ? '<span class="flag">⚠</span> ' : '';
    return `
      <tr data-entry-row="${entry.id}">
        <td>${flag}${escapeHtml(formatMonthLabel(entry.month))}</td>
        <td>${escapeHtml(entry.participant_name)}</td>
        <td>${escapeHtml(entry.model_name)}</td>
        <td>${photoCount}</td>
        <td class="admin-actions">
          <button data-action="edit-entry" data-id="${entry.id}">Edit</button>
          <button data-action="delete-entry" data-id="${entry.id}">Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  entriesContainer.innerHTML = `
    <table>
      <thead><tr><th>Month</th><th>Name</th><th>Model</th><th>Photos</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

entriesContainer.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const entry = state.entriesById.get(button.dataset.id);
  if (!entry) return;

  if (button.dataset.action === 'edit-entry') {
    const row = document.querySelector(`tr[data-entry-row="${entry.id}"]`);
    row.innerHTML = `
      <td><input type="text" id="edit-month-${entry.id}" value="${escapeHtml(entry.month)}" style="width:90px;"></td>
      <td><input type="text" id="edit-name-${entry.id}" value="${escapeHtml(entry.participant_name)}"></td>
      <td><input type="text" id="edit-model-${entry.id}" value="${escapeHtml(entry.model_name)}"></td>
      <td>${(state.imagesByEntry.get(entry.id) || []).length}</td>
      <td class="admin-actions">
        <button data-action="save-entry" data-id="${entry.id}">Save</button>
        <button data-action="cancel-entry" data-id="${entry.id}">Cancel</button>
      </td>
    `;
  } else if (button.dataset.action === 'cancel-entry') {
    renderEntries();
  } else if (button.dataset.action === 'save-entry') {
    const month = document.getElementById(`edit-month-${entry.id}`).value.trim();
    const participant_name = document.getElementById(`edit-name-${entry.id}`).value.trim();
    const model_name = document.getElementById(`edit-model-${entry.id}`).value.trim();
    const { error } = await supabaseClient.from('entries').update({ month, participant_name, model_name }).eq('id', entry.id);
    if (error) { alert(error.message); return; }
    await loadAll();
  } else if (button.dataset.action === 'delete-entry') {
    if (!confirm(`Delete "${entry.model_name}" by ${entry.participant_name}? This also deletes its photos and any votes cast on it.`)) return;
    const images = state.imagesByEntry.get(entry.id) || [];
    if (images.length > 0) {
      await supabaseClient.storage.from(PHOTO_BUCKET).remove(images.map((i) => i.storage_path));
    }
    const { error } = await supabaseClient.from('entries').delete().eq('id', entry.id);
    if (error) { alert(error.message); return; }
    await loadAll();
  }
});

// ---------------------------------------------------------------------------
// Ballots
// ---------------------------------------------------------------------------

function renderBallots() {
  const flagged = findSimilarGroups(state.ballots, (b) => b.voter_name, (b) => b.month);

  if (state.ballots.length === 0) {
    ballotsContainer.innerHTML = '<p class="muted">No ballots yet.</p>';
    return;
  }

  const rows = state.ballots.map((ballot) => {
    const scores = state.scoresByBallot.get(ballot.id) || [];
    const summary = scores.map((s) => {
      const e = state.entriesById.get(s.entry_id);
      return `${e ? escapeHtml(e.model_name) : 'unknown'}: ${s.score}`;
    }).join(', ');
    const flag = flagged.has(ballot.id) ? '<span class="flag">⚠</span> ' : '';
    return `
      <tr data-ballot-row="${ballot.id}">
        <td>${escapeHtml(formatMonthLabel(ballot.month))}</td>
        <td>${flag}${escapeHtml(ballot.voter_name)}</td>
        <td class="muted">${summary}</td>
        <td class="admin-actions">
          <button data-action="edit-ballot" data-id="${ballot.id}">Edit</button>
          <button data-action="delete-ballot" data-id="${ballot.id}">Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  ballotsContainer.innerHTML = `
    <table>
      <thead><tr><th>Month</th><th>Voter</th><th>Scores</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

ballotsContainer.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const ballot = state.ballots.find((b) => b.id === button.dataset.id);
  if (!ballot) return;

  if (button.dataset.action === 'edit-ballot') {
    const row = document.querySelector(`tr[data-ballot-row="${ballot.id}"]`);
    const scores = state.scoresByBallot.get(ballot.id) || [];
    const scoreInputs = scores.map((s) => {
      const e = state.entriesById.get(s.entry_id);
      return `
        <div>${e ? escapeHtml(e.model_name) : 'unknown'}:
          <input type="text" inputmode="numeric" style="width:48px;display:inline-block;" id="score-${s.id}" value="${s.score}">
        </div>
      `;
    }).join('');
    row.innerHTML = `
      <td><input type="text" id="edit-ballot-month-${ballot.id}" value="${escapeHtml(ballot.month)}" style="width:90px;"></td>
      <td><input type="text" id="edit-ballot-name-${ballot.id}" value="${escapeHtml(ballot.voter_name)}"></td>
      <td>${scoreInputs}</td>
      <td class="admin-actions">
        <button data-action="save-ballot" data-id="${ballot.id}">Save</button>
        <button data-action="cancel-ballot" data-id="${ballot.id}">Cancel</button>
      </td>
    `;
  } else if (button.dataset.action === 'cancel-ballot') {
    renderBallots();
  } else if (button.dataset.action === 'save-ballot') {
    const month = document.getElementById(`edit-ballot-month-${ballot.id}`).value.trim();
    const voter_name = document.getElementById(`edit-ballot-name-${ballot.id}`).value.trim();
    try {
      const { error: ballotError } = await supabaseClient.from('ballots').update({ month, voter_name }).eq('id', ballot.id);
      if (ballotError) throw ballotError;

      const scores = state.scoresByBallot.get(ballot.id) || [];
      for (const s of scores) {
        const value = Number(document.getElementById(`score-${s.id}`).value);
        if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error('Scores must be whole numbers from 1 to 5.');
        if (value !== s.score) {
          const { error } = await supabaseClient.from('ballot_scores').update({ score: value }).eq('id', s.id);
          if (error) throw error;
        }
      }
      await loadAll();
    } catch (err) {
      alert(err.message || String(err));
    }
  } else if (button.dataset.action === 'delete-ballot') {
    if (!confirm(`Delete ${ballot.voter_name}'s ballot for ${formatMonthLabel(ballot.month)}?`)) return;
    const { error } = await supabaseClient.from('ballots').delete().eq('id', ballot.id);
    if (error) { alert(error.message); return; }
    await loadAll();
  }
});
