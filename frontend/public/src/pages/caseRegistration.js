import { api } from '../lib/api.js';
import { esc, showToast } from '../lib/dom.js';
import { renderShell, attachShellHandlers } from '../layout.js';
import { navigate } from '../router.js';

export async function renderCaseRegistration() {
  const root = document.getElementById('root');
  root.innerHTML = renderShell(`<div class="empty-state">Loading&hellip;</div>`);

  let premisesList = [];
  try {
    const res = await api.get('/api/premises');
    premisesList = res.premises;
  } catch (err) {
    showToast(err.message, true);
  }

  const html = `
    <h1>Report / Register Disease Case</h1>
    <p class="text-muted">Creating or confirming a case automatically triggers the contact-tracing engine &mdash; connected premises, risk scores, and field tasks are generated within seconds.</p>

    <div class="card" style="max-width: 640px;">
      <form id="case-form">
        <div class="field">
          <label>Premises</label>
          <select name="premises_id" required>
            <option value="">Select a farm/premises&hellip;</option>
            ${premisesList.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} &mdash; ${esc(p.village || '')}, ${esc(p.district)}</option>`).join('')}
          </select>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Disease</label>
            <select name="disease">
              <option value="ASF">African Swine Fever (ASF)</option>
              <option value="FMD">Foot-and-Mouth Disease (FMD)</option>
              <option value="PPR">PPR</option>
              <option value="AI">Avian Influenza (AI)</option>
            </select>
          </div>
          <div class="field">
            <label>Status</label>
            <select name="status">
              <option value="suspected">Suspected</option>
              <option value="lab_confirmed">Lab Confirmed</option>
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Reported Date</label>
            <input type="date" name="reported_date" required value="${new Date().toISOString().slice(0, 10)}" />
          </div>
          <div class="field">
            <label>Lab Result Date (if confirmed)</label>
            <input type="date" name="lab_result_date" />
          </div>
        </div>
        <div class="field">
          <label>Clinical Notes</label>
          <textarea name="clinical_notes" rows="3" placeholder="Symptoms observed, mortality, sample details, etc."></textarea>
        </div>
        <div id="case-error" class="form-error hidden"></div>
        <button type="submit" class="btn">Submit &amp; Run Contact Trace</button>
      </form>
    </div>
  `;

  root.innerHTML = renderShell(html);
  attachShellHandlers();

  document.getElementById('case-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const body = Object.fromEntries(fd.entries());
    if (!body.lab_result_date) delete body.lab_result_date;
    const errorEl = document.getElementById('case-error');
    errorEl.classList.add('hidden');
    try {
      const result = await api.post('/api/cases', body);
      showToast(`Case created. Contact trace found ${result.trace.connectedPremisesIds.length} connected premises in ${result.trace.contactTraceMs.toFixed(0)}ms.`);
      navigate(`/cases/${result.case.id}/contacts`);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  });
}
