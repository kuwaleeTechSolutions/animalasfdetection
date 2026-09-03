import { api } from '../lib/api.js';
import { esc, showToast } from '../lib/dom.js';
import { renderShell, attachShellHandlers } from '../layout.js';

export async function renderQuickMovementLog() {
  const root = document.getElementById('root');
  root.innerHTML = renderShell(`<div class="empty-state">Loading&hellip;</div>`);

  let premisesList = [];
  try {
    const res = await api.get('/api/premises');
    premisesList = res.premises;
  } catch (err) { showToast(err.message, true); }

  const premisesOptions = premisesList.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.village || p.district)})</option>`).join('');

  const html = `
    <h1>\uD83D\uDE9A Quick Movement Log</h1>
    <p class="text-muted">Log an animal or batch movement between two registered locations (farm, market, or vet visit).</p>
    <div class="card" style="max-width: 480px;">
      <form id="quick-movement-form">
        <div class="field">
          <label>From Premises</label>
          <select name="from_premises_id" required><option value="">Select&hellip;</option>${premisesOptions}</select>
        </div>
        <div class="field">
          <label>To Premises</label>
          <select name="to_premises_id" required><option value="">Select&hellip;</option>${premisesOptions}</select>
        </div>
        <div class="field">
          <label>Animal / Batch (at "From" premises)</label>
          <select name="animal_id"><option value="">Loading once "From" is selected&hellip;</option></select>
        </div>
        <div class="field">
          <label>Movement Date</label>
          <input type="date" name="event_date" required value="${new Date().toISOString().slice(0, 10)}" />
        </div>
        <div class="field">
          <label>Transport Vehicle Registration No. (optional)</label>
          <input type="text" name="vehicle_registration_number" placeholder="e.g. AS-06-PIG-1001" />
        </div>
        <div class="field">
          <label>Notes</label>
          <textarea name="notes" rows="2" placeholder="e.g. piglet sale, market trip"></textarea>
        </div>
        <div id="quick-movement-error" class="form-error hidden"></div>
        <button type="submit" class="btn btn-block">Log Movement</button>
      </form>
    </div>
  `;

  root.innerHTML = renderShell(html);
  attachShellHandlers();

  const fromSelect = document.querySelector('select[name="from_premises_id"]');
  const animalSelect = document.querySelector('select[name="animal_id"]');
  fromSelect.addEventListener('change', async () => {
    if (!fromSelect.value) { animalSelect.innerHTML = '<option value="">Select a "From" premises first</option>'; return; }
    try {
      const res = await api.get(`/api/premises/${fromSelect.value}/animals`);
      if (res.animals.length === 0) {
        animalSelect.innerHTML = '<option value="">No animals registered at this premises &mdash; register one first</option>';
      } else {
        animalSelect.innerHTML = res.animals.map((a) => `<option value="${esc(a.id)}">${esc(a.tag_id || a.id.slice(0, 12))} &mdash; ${esc(a.species)} (batch of ${a.batch_size})</option>`).join('');
      }
    } catch (err) { showToast(err.message, true); }
  });

  document.getElementById('quick-movement-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.target).entries());
    if (!body.vehicle_registration_number) delete body.vehicle_registration_number;
    if (!body.animal_id) {
      const errEl = document.getElementById('quick-movement-error');
      errEl.textContent = 'Please select an animal/batch (select a "From" premises first to populate this list).';
      errEl.classList.remove('hidden');
      return;
    }
    try {
      await api.post('/api/movements', body);
      showToast('Movement logged successfully.');
      ev.target.reset();
    } catch (err) {
      const errEl = document.getElementById('quick-movement-error');
      errEl.textContent = err.message; errEl.classList.remove('hidden');
    }
  });
}
