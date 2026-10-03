const nameGate = document.getElementById('name-gate');
const voterNameInput = document.getElementById('voter-name');
const battleApp = document.getElementById('battle-app');
const battleTitle = document.getElementById('battle-title');
const battleTheme = document.getElementById('battle-theme');
const battleProgress = document.getElementById('battle-progress');
const battleProgressFill = document.getElementById('battle-progress-fill');
const statusMessage = document.getElementById('status-message');
const battleArena = document.getElementById('battle-arena');

const NAME_STORAGE_KEY = 'battleVoteVoterName';

function normalizeName(name) {
  return name.trim().toLowerCase();
}

function setStatus(message) {
  if (!message) {
    statusMessage.style.display = 'none';
    return;
  }
  statusMessage.textContent = message;
  statusMessage.style.display = 'block';
}

let state = {
  voterName: '',
  month: null,
  battles: [],
  queue: [],
  entriesById: new Map(),
  imagesByEntry: new Map(),
  totalBattles: 0,
  completedCount: 0,
};

document.getElementById('start-button').addEventListener('click', () => {
  const name = voterNameInput.value.trim();
  if (!name) {
    voterNameInput.focus();
    return;
  }
  localStorage.setItem(NAME_STORAGE_KEY, name);
  beginVoting(name);
});

document.getElementById('change-name-link').addEventListener('click', (event) => {
  event.preventDefault();
  localStorage.removeItem(NAME_STORAGE_KEY);
  battleApp.style.display = 'none';
  nameGate.style.display = 'block';
  voterNameInput.value = '';
  voterNameInput.focus();
});

const savedName = localStorage.getItem(NAME_STORAGE_KEY);
if (savedName) {
  voterNameInput.value = savedName;
  beginVoting(savedName);
}

async function beginVoting(voterName) {
  state.voterName = voterName;
  nameGate.style.display = 'none';
  battleApp.style.display = 'block';
  battleArena.innerHTML = '<p class="muted">Loading the battle…</p>';

  try {
    const { data: openMonth, error: monthError } = await supabaseClient
      .from('battle_months')
      .select('month, status, theme')
      .eq('status', 'open')
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (monthError) throw monthError;

    if (!openMonth) {
      battleTitle.textContent = 'Battle Vote';
      battleProgress.textContent = '';
      battleArena.innerHTML = '';
      setStatus("Battle voting isn't open right now. Check back once the organiser starts this month's battles.");
      return;
    }

    state.month = openMonth.month;
    battleTitle.textContent = `\u{1F3C6} ${formatMonthLabel(openMonth.month)} Painting Competition`;
    battleTheme.textContent = openMonth.theme ? `Theme: ${openMonth.theme}` : '';

    const { data: battles, error: battlesError } = await supabaseClient
      .from('battles')
      .select('id, entry_a_id, entry_b_id')
      .eq('month', state.month);
    if (battlesError) throw battlesError;
    state.battles = battles;
    state.totalBattles = battles.length;

    if (battles.length === 0) {
      battleArena.innerHTML = '';
      setStatus('No battles have been generated for this month yet.');
      return;
    }

    const entryIds = [...new Set(battles.flatMap((b) => [b.entry_a_id, b.entry_b_id]))];
    const [{ data: entries, error: entriesError }, { data: images, error: imagesError }, { data: myVotes, error: votesError }] = await Promise.all([
      supabaseClient.from('entries').select('id, participant_name, model_name').in('id', entryIds),
      supabaseClient.from('entry_images').select('entry_id, storage_path, position').in('entry_id', entryIds).order('position'),
      supabaseClient.from('battle_votes').select('battle_id, voter_name').in('battle_id', battles.map((b) => b.id)),
    ]);
    if (entriesError) throw entriesError;
    if (imagesError) throw imagesError;
    if (votesError) throw votesError;

    state.entriesById = new Map(entries.map((e) => [e.id, e]));
    state.imagesByEntry = new Map();
    for (const img of images) {
      if (!state.imagesByEntry.has(img.entry_id)) state.imagesByEntry.set(img.entry_id, []);
      state.imagesByEntry.get(img.entry_id).push(img);
    }

    const doneBattleIds = new Set(
      myVotes.filter((v) => normalizeName(v.voter_name) === normalizeName(voterName)).map((v) => v.battle_id)
    );
    state.completedCount = doneBattleIds.size;
    state.queue = shuffleArray(battles.filter((b) => !doneBattleIds.has(b.id)));

    renderNextBattle();
  } catch (err) {
    console.error(err);
    battleArena.innerHTML = '';
    setStatus(`Something went wrong: ${err.message || err}`);
  }
}

function updateProgress() {
  const current = Math.min(state.completedCount + 1, state.totalBattles);
  battleProgress.textContent = state.queue.length > 0
    ? `Battle ${current} of ${state.totalBattles}`
    : `All ${state.totalBattles} battles done!`;
  const pct = state.totalBattles === 0 ? 0 : (state.completedCount / state.totalBattles) * 100;
  battleProgressFill.style.width = `${pct}%`;
}

function renderGallery(entry) {
  const images = state.imagesByEntry.get(entry.id) || [];
  const imgs = images.length
    ? images.map((img) => `<img src="${escapeHtml(getPhotoUrl(img.storage_path))}" alt="${escapeHtml(entry.model_name)}">`).join('')
    : '<p class="muted" style="padding:16px;">No photo uploaded.</p>';
  const dots = images.length > 1
    ? `<div class="gallery-dots">${images.map(() => '<span></span>').join('')}</div>`
    : '';
  return `<div class="gallery">${imgs}</div>${dots}`;
}

function wireGalleryDots(scope) {
  scope.querySelectorAll('.gallery').forEach((gallery) => {
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

function renderNextBattle() {
  updateProgress();

  if (state.queue.length === 0) {
    battleArena.innerHTML = `
      <div class="card battle-complete">
        <h2>\u{1F389} You've completed this month's voting!</h2>
        <p class="muted">You judged ${state.totalBattles} battle${state.totalBattles === 1 ? '' : 's'}. Thanks for voting!</p>
      </div>
    `;
    return;
  }

  const battle = state.queue[0];
  const entryA = state.entriesById.get(battle.entry_a_id);
  const entryB = state.entriesById.get(battle.entry_b_id);
  const sides = shuffleArray([entryA, entryB]);

  battleArena.innerHTML = `
    <div class="battle-pair">
      ${sides.map((entry, i) => `
        <div class="card battle-card" data-entry-id="${entry.id}" data-slot="${i}">
          ${renderGallery(entry)}
          <div class="battle-card-info">
            <div class="battle-card-model">${escapeHtml(entry.model_name)}</div>
            <div class="muted">by ${escapeHtml(entry.participant_name)}</div>
          </div>
        </div>
        ${i === 0 ? '<div class="battle-vs">VS</div>' : ''}
      `).join('')}
    </div>
  `;

  wireGalleryDots(battleArena);

  battleArena.querySelectorAll('.battle-card').forEach((card) => {
    card.addEventListener('click', () => castVote(battle, card.dataset.entryId, card));
  });
}

async function castVote(battle, winnerEntryId, cardEl) {
  battleArena.querySelectorAll('.battle-card').forEach((c) => { c.style.pointerEvents = 'none'; });
  cardEl.classList.add('battle-card-chosen');

  try {
    const { error } = await supabaseClient
      .from('battle_votes')
      .insert({ battle_id: battle.id, voter_name: state.voterName, winner_entry_id: winnerEntryId });
    if (error && error.code !== '23505') throw error;
  } catch (err) {
    console.error(err);
    setStatus(`Couldn't record that vote: ${err.message || err}. Moving on anyway.`);
  }

  state.queue.shift();
  state.completedCount++;
  renderNextBattle();
}
