const monthSelect = document.getElementById('month');
const entriesContainer = document.getElementById('entries-container');
const submitCard = document.getElementById('submit-card');
const noMonthsMessage = document.getElementById('no-months-message');
const statusEl = document.getElementById('status');

let currentEntries = [];

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = type ? `status ${type}` : '';
}

function renderEntryCard(entry, images) {
  const galleryImgs = images.length
    ? images.map((img) => `<img src="${escapeHtml(getPhotoUrl(img.storage_path))}" alt="${escapeHtml(entry.model_name)}">`).join('')
    : '<p class="muted" style="padding:16px;">No photo uploaded.</p>';

  const dots = images.length > 1
    ? `<div class="gallery-dots">${images.map(() => '<span></span>').join('')}</div>`
    : '';

  const scoreButtons = [1, 2, 3, 4, 5].map((n) => `
    <input type="radio" name="score-${entry.id}" id="score-${entry.id}-${n}" value="${n}">
    <label for="score-${entry.id}-${n}">${n}</label>
  `).join('');

  return `
    <div class="card" data-entry-id="${entry.id}">
      <div class="entry-header">
        <h3>${escapeHtml(entry.model_name)}</h3>
        <span class="muted">by ${escapeHtml(entry.participant_name)}</span>
      </div>
      <div class="gallery">${galleryImgs}</div>
      ${dots}
      <div class="score-toggle">${scoreButtons}</div>
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
  await loadEntries(months[0]);
}

async function loadEntries(month) {
  entriesContainer.innerHTML = '<p class="muted">Loading entries…</p>';
  submitCard.style.display = 'none';
  setStatus('', '');

  const { data: entries, error: entriesError } = await supabaseClient
    .from('entries')
    .select('id, participant_name, model_name, month')
    .eq('month', month)
    .order('created_at');
  if (entriesError) throw entriesError;

  currentEntries = entries;

  if (entries.length === 0) {
    entriesContainer.innerHTML = '<p class="muted">No entries for this month yet.</p>';
    return;
  }

  const entryIds = entries.map((e) => e.id);
  const { data: images, error: imagesError } = await supabaseClient
    .from('entry_images')
    .select('entry_id, storage_path, position')
    .in('entry_id', entryIds)
    .order('position');
  if (imagesError) throw imagesError;

  const imagesByEntry = new Map();
  for (const img of images) {
    if (!imagesByEntry.has(img.entry_id)) imagesByEntry.set(img.entry_id, []);
    imagesByEntry.get(img.entry_id).push(img);
  }

  entriesContainer.innerHTML = entries
    .map((entry) => renderEntryCard(entry, imagesByEntry.get(entry.id) || []))
    .join('');

  wireGalleryDots();
  submitCard.style.display = 'block';
}

monthSelect.addEventListener('change', () => loadEntries(monthSelect.value));

document.getElementById('submit-scores-button').addEventListener('click', async () => {
  const voterName = document.getElementById('voter-name').value.trim();
  const month = monthSelect.value;
  const submitButton = document.getElementById('submit-scores-button');

  if (!voterName) {
    setStatus('Please enter your name before submitting.', 'error');
    return;
  }

  const scores = [];
  const missing = [];
  for (const entry of currentEntries) {
    const checked = document.querySelector(`input[name="score-${entry.id}"]:checked`);
    if (!checked) {
      missing.push(entry.model_name);
    } else {
      scores.push({ entry_id: entry.id, score: Number(checked.value) });
    }
  }

  if (missing.length > 0) {
    setStatus(`Please score every model. Missing: ${missing.join(', ')}.`, 'error');
    return;
  }

  submitButton.disabled = true;
  setStatus('Submitting your scores…', 'info');

  try {
    const { data: existing, error: existingError } = await supabaseClient
      .from('ballots')
      .select('id')
      .eq('month', month)
      .ilike('voter_name', voterName.trim());
    if (existingError) throw existingError;

    if (existing.length > 0) {
      setStatus('Looks like you’ve already voted for this month. If you need it corrected, ask the organiser (admin) to fix it.', 'error');
      submitButton.disabled = false;
      return;
    }

    const { data: ballot, error: ballotError } = await supabaseClient
      .from('ballots')
      .insert({ voter_name: voterName, month })
      .select()
      .single();
    if (ballotError) throw ballotError;

    const scoreRows = scores.map((s) => ({ ballot_id: ballot.id, entry_id: s.entry_id, score: s.score }));
    const { error: scoresError } = await supabaseClient.from('ballot_scores').insert(scoreRows);
    if (scoresError) throw scoresError;

    setStatus('Thanks! Your scores have been submitted.', 'success');
    submitButton.disabled = true;
    document.getElementById('voter-name').disabled = true;
    monthSelect.disabled = true;
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      setStatus('Looks like you’ve already voted for this month. If you need it corrected, ask the organiser (admin) to fix it.', 'error');
    } else {
      setStatus(`Something went wrong: ${err.message || err}`, 'error');
    }
    submitButton.disabled = false;
  }
});

loadMonths().catch((err) => {
  console.error(err);
  entriesContainer.innerHTML = `<p class="status error">Failed to load entries: ${err.message || err}</p>`;
});
