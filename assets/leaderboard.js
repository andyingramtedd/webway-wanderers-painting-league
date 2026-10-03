const container = document.getElementById('leaderboard-container');

function normalizeName(name) {
  return name.trim().toLowerCase();
}

async function loadLeaderboard() {
  container.innerHTML = '<p class="muted">Crunching the numbers…</p>';

  const [{ data: entries, error: entriesError }, { data: scores, error: scoresError }, points] = await Promise.all([
    supabaseClient.from('entries').select('id, participant_name, month'),
    supabaseClient.from('ballot_scores').select('entry_id, score, ballots!inner(month)'),
    fetchSettings(),
  ]);
  if (entriesError) throw entriesError;
  if (scoresError) throw scoresError;

  if (entries.length === 0) {
    container.innerHTML = '<p class="muted">No entries yet.</p>';
    return;
  }

  const scoresByEntry = new Map();
  for (const row of scores) {
    if (!scoresByEntry.has(row.entry_id)) scoresByEntry.set(row.entry_id, []);
    scoresByEntry.get(row.entry_id).push(row.score);
  }

  const entriesByMonth = new Map();
  for (const entry of entries) {
    if (!entriesByMonth.has(entry.month)) entriesByMonth.set(entry.month, []);
    entriesByMonth.get(entry.month).push(entry);
  }

  const standings = new Map(); // normalizedName -> { displayName, totalPoints, monthsEntered }

  for (const [month, monthEntries] of entriesByMonth) {
    const ranked = rankEntries(monthEntries, scoresByEntry, points);
    for (const row of ranked) {
      const key = normalizeName(row.entry.participant_name);
      if (!standings.has(key)) {
        standings.set(key, { displayName: row.entry.participant_name.trim(), totalPoints: 0, monthsEntered: 0 });
      }
      const standing = standings.get(key);
      standing.totalPoints += row.points;
      standing.monthsEntered += 1;
    }
  }

  const rows = [...standings.values()].sort((a, b) => b.totalPoints - a.totalPoints);

  const tableRows = rows.map((row, i) => {
    const badgeClass = i < 3 ? `rank-badge rank-${i + 1}` : 'rank-badge';
    return `
      <tr>
        <td><span class="${badgeClass}">${i + 1}</span></td>
        <td>${escapeHtml(row.displayName)}</td>
        <td>${row.monthsEntered}</td>
        <td><strong>${row.totalPoints}</strong></td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table>
      <thead>
        <tr><th>Rank</th><th>Name</th><th>Months entered</th><th>Points</th></tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
    <p class="muted" style="margin-top:12px;">If your name appears more than once, ask the organiser to tidy it up on the admin page so your points merge together.</p>
  `;
}

loadLeaderboard().catch((err) => {
  console.error(err);
  container.innerHTML = `<p class="status error">Failed to load leaderboard: ${err.message || err}</p>`;
});
