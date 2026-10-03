const monthSelect = document.getElementById('month');
const resultsContainer = document.getElementById('results-container');
const noMonthsMessage = document.getElementById('no-months-message');

function renderResultCard(row, method) {
  const { entry, rank, points } = row;
  const badgeClass = rank && rank <= 3 ? `rank-badge rank-${rank}` : 'rank-badge';
  const badgeLabel = rank ? `#${rank}` : '—';
  const summaryLabel = method === 'battle'
    ? `${Math.round(row.rating)} rating (${row.battleCount} battle${row.battleCount === 1 ? '' : 's'})`
    : (row.avg === null ? 'No votes yet' : `${row.avg.toFixed(2)} avg (${row.voteCount} vote${row.voteCount === 1 ? '' : 's'})`);

  const galleryImgs = row.images.length
    ? row.images.map((img) => `<img src="${escapeHtml(getPhotoUrl(img.storage_path))}" alt="${escapeHtml(entry.model_name)}">`).join('')
    : '<p class="muted" style="padding:16px;">No photo uploaded.</p>';

  const dots = row.images.length > 1
    ? `<div class="gallery-dots">${row.images.map(() => '<span></span>').join('')}</div>`
    : '';

  return `
    <div class="card">
      <div class="entry-header">
        <h3><span class="${badgeClass}">${badgeLabel}</span> ${escapeHtml(entry.model_name)}</h3>
        <span class="muted">by ${escapeHtml(entry.participant_name)}</span>
      </div>
      <div class="gallery">${galleryImgs}</div>
      ${dots}
      <p class="muted" style="margin-top:10px;">${summaryLabel} &middot; ${points} point${points === 1 ? '' : 's'}</p>
    </div>
  `;
}

function wireGalleryDots() {
  document.querySelectorAll('.gallery').forEach((gallery) => {
    const dotsEl = gallery.nextElementSibling;
    if (!dotsEl || !dotsEl.classList.contains('gallery-dots')) return;
    const dots = dotsEl.querySelectorAll('span');
    gallery.addEventListener('scroll', () => {
      const index = Math.round(gallery.scrollLeft / gallery.clientWidth);
      dots.forEach((dot, i) => dot.classList.toggle('active', i === index));
    });
    dots[0]?.classList.add('active');
  });
}

async function loadMonths() {
  const { data, error } = await supabaseClient.from('entries').select('month');
  if (error) throw error;

  const months = [...new Set(data.map((r) => r.month))].sort().reverse();
  if (months.length === 0) {
    noMonthsMessage.style.display = 'block';
    monthSelect.style.display = 'none';
    return;
  }

  for (const key of months) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = formatMonthLabel(key);
    monthSelect.appendChild(option);
  }
  await loadResults(months[0]);
}

async function loadResults(month) {
  resultsContainer.innerHTML = '<p class="muted">Loading results…</p>';

  const [{ data: entries, error: entriesError }, points] = await Promise.all([
    supabaseClient.from('entries').select('id, participant_name, model_name, month').eq('month', month).order('created_at'),
    fetchSettings(),
  ]);
  if (entriesError) throw entriesError;

  if (entries.length === 0) {
    resultsContainer.innerHTML = '<p class="muted">No entries for this month yet.</p>';
    return;
  }

  const entryIds = entries.map((e) => e.id);

  const [{ data: images, error: imagesError }, { method, rows }] = await Promise.all([
    supabaseClient.from('entry_images').select('entry_id, storage_path, position').in('entry_id', entryIds).order('position'),
    rankEntriesForMonth(month, entries, points),
  ]);
  if (imagesError) throw imagesError;

  const imagesByEntry = new Map();
  for (const img of images) {
    if (!imagesByEntry.has(img.entry_id)) imagesByEntry.set(img.entry_id, []);
    imagesByEntry.get(img.entry_id).push(img);
  }

  const rankedRows = rows.map((row) => ({
    ...row,
    images: imagesByEntry.get(row.entry.id) || [],
  }));

  resultsContainer.innerHTML = rankedRows.map((row) => renderResultCard(row, method)).join('');
  wireGalleryDots();
}

monthSelect.addEventListener('change', () => loadResults(monthSelect.value));

loadMonths().catch((err) => {
  console.error(err);
  resultsContainer.innerHTML = `<p class="status error">Failed to load results: ${err.message || err}</p>`;
});
