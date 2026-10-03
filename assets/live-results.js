const liveContent = document.getElementById('live-content');

function normalizeName(name) {
  return name.trim().toLowerCase();
}

async function findRelevantMonth() {
  const { data: openRow, error: openError } = await supabaseClient
    .from('battle_months').select('*').eq('status', 'open')
    .order('month', { ascending: false }).limit(1).maybeSingle();
  if (openError) throw openError;
  if (openRow) return openRow;

  const { data: closedRow, error: closedError } = await supabaseClient
    .from('battle_months').select('*').eq('status', 'closed')
    .order('month', { ascending: false }).limit(1).maybeSingle();
  if (closedError) throw closedError;
  return closedRow || null;
}

function renderLeaderboardRows(ranked) {
  return ranked.map((row) => {
    const badgeClass = row.rank <= 3 ? `rank-badge rank-${row.rank}` : 'rank-badge';
    return `
      <div class="live-rank-row">
        <span class="${badgeClass}">${row.rank}</span>
        <div class="live-rank-info">
          <div class="live-rank-name">${escapeHtml(row.entry.participant_name)} — ${escapeHtml(row.entry.model_name)}</div>
          <div class="muted">${Math.round(row.rating)} rating &middot; ${row.battleCount} battle${row.battleCount === 1 ? '' : 's'}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderPodium(ranked) {
  const medals = ['\u{1F3C6}', '\u{1F948}', '\u{1F949}'];
  const top3 = ranked.slice(0, 3);
  return `
    <div class="podium">
      ${top3.map((row, i) => `
        <div class="podium-place podium-${i + 1}">
          <div class="podium-medal">${medals[i]}</div>
          <div class="podium-name">${escapeHtml(row.entry.participant_name)}</div>
          <div class="muted">${escapeHtml(row.entry.model_name)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

async function renderLive() {
  try {
    const monthRow = await findRelevantMonth();

    if (!monthRow) {
      liveContent.innerHTML = '<p class="muted">No battle voting has run yet.</p>';
      return;
    }

    const [{ data: entries, error: entriesError }, points, { battles, votes }] = await Promise.all([
      supabaseClient.from('entries').select('id, participant_name, model_name').eq('month', monthRow.month),
      fetchSettings(),
      fetchBattleData(monthRow.month),
    ]);
    if (entriesError) throw entriesError;

    const ranked = computeEloRankings(entries, votes, points);
    const totalBattles = battles.length;
    const battlesWithVotes = new Set(votes.map((v) => v.battle_id)).size;
    const progressPct = totalBattles === 0 ? 0 : Math.round((battlesWithVotes / totalBattles) * 100);

    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const currentlyVoting = new Set(
      votes.filter((v) => new Date(v.created_at).getTime() > fiveMinAgo).map((v) => normalizeName(v.voter_name))
    ).size;

    const entriesById = new Map(entries.map((e) => [e.id, e]));
    const recentActivity = votes.slice(-8).reverse().map((v) => {
      const winner = entriesById.get(v.winner_entry_id);
      const loser = entriesById.get(v.loser_entry_id);
      if (!winner || !loser) return '';
      return `<div class="activity-item">⚔️ ${escapeHtml(winner.participant_name)}'s ${escapeHtml(winner.model_name)} defeated ${escapeHtml(loser.participant_name)}'s ${escapeHtml(loser.model_name)}</div>`;
    }).join('');

    const header = `
      <h1>\u{1F4FA} Live Results</h1>
      <h2>${escapeHtml(formatMonthLabel(monthRow.month))} Painting Competition</h2>
      ${monthRow.theme ? `<p class="battle-theme">Theme: ${escapeHtml(monthRow.theme)}</p>` : ''}
    `;

    if (monthRow.status === 'open') {
      liveContent.innerHTML = `
        ${header}
        <div class="live-banner">LIVE — RESULTS MAY CHANGE</div>

        <div class="card">
          <h3>MONTHLY VOTING</h3>
          <p>Battles with a vote: <strong>${battlesWithVotes} / ${totalBattles}</strong></p>
          <div class="live-progress-bar"><div class="live-progress-fill" style="width:${progressPct}%;"></div></div>
          <p class="muted">Voters currently voting: ${currentlyVoting}</p>
        </div>

        <div class="card">
          <h3>Current Leaderboard</h3>
          ${renderLeaderboardRows(ranked)}
        </div>

        <div class="card">
          <h3>Recent Battles</h3>
          ${recentActivity || '<p class="muted">No battles yet.</p>'}
        </div>
      `;
    } else {
      liveContent.innerHTML = `
        ${header}
        <div class="live-banner final">FINAL RESULTS</div>
        ${renderPodium(ranked)}

        <div class="card">
          <h3>Full Standings</h3>
          ${renderLeaderboardRows(ranked)}
        </div>
      `;
    }
  } catch (err) {
    console.error(err);
    liveContent.innerHTML = `<p class="status error">Failed to load live results: ${err.message || err}</p>`;
  }
}

renderLive();
setInterval(renderLive, 15000);

supabaseClient
  .channel('live-results-battle-votes')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'battle_votes' }, () => renderLive())
  .subscribe();
