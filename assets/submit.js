const monthSelect = document.getElementById('month');
for (const key of generateMonthOptions(6, 1)) {
  const option = document.createElement('option');
  option.value = key;
  option.textContent = formatMonthLabel(key);
  if (key === currentMonthKey()) option.selected = true;
  monthSelect.appendChild(option);
}

const form = document.getElementById('submit-form');
const submitButton = document.getElementById('submit-button');
const statusEl = document.getElementById('status');

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = type ? `status ${type}` : '';
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const participantName = document.getElementById('participant-name').value.trim();
  const month = monthSelect.value;
  const modelName = document.getElementById('model-name').value.trim();
  const files = Array.from(document.getElementById('photos').files);

  if (!participantName || !modelName || files.length === 0) {
    setStatus('Please fill in your name, model name, and at least one photo.', 'error');
    return;
  }

  submitButton.disabled = true;
  setStatus('Submitting your entry…', 'info');

  try {
    const { data: entry, error: entryError } = await supabaseClient
      .from('entries')
      .insert({ participant_name: participantName, month, model_name: modelName })
      .select()
      .single();

    if (entryError) throw entryError;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const storagePath = `${entry.id}/${Date.now()}-${i}-${sanitizeFileName(file.name)}`;

      const { error: uploadError } = await supabaseClient.storage
        .from(PHOTO_BUCKET)
        .upload(storagePath, file);
      if (uploadError) throw uploadError;

      const { error: imageError } = await supabaseClient
        .from('entry_images')
        .insert({ entry_id: entry.id, storage_path: storagePath, position: i });
      if (imageError) throw imageError;
    }

    setStatus(`Entry submitted! Good luck, ${participantName}.`, 'success');
    form.reset();
    monthSelect.value = month;
  } catch (err) {
    console.error(err);
    setStatus(`Something went wrong: ${err.message || err}`, 'error');
  } finally {
    submitButton.disabled = false;
  }
});
