import { api } from '../lib/api.js';
import { esc, showToast } from '../lib/dom.js';
import { renderShell, attachShellHandlers } from '../layout.js';
import { navigate } from '../router.js';

export async function renderQuickCaseReport() {
  const root = document.getElementById('root');
  root.innerHTML = renderShell(`<div class="empty-state">Loading&hellip;</div>`);

  let premisesList = [];
  try {
    const res = await api.get('/api/premises');
    premisesList = res.premises;
  } catch (err) { showToast(err.message, true); }

  const html = `
    <h1>\u26A1 Quick Case Report</h1>
    <p class="text-muted">Minimal field-friendly form to report a suspected case on the spot.</p>
    <div class="card" style="max-width: 480px;">
      <form id="quick-case-form">
        <div class="field">
          <label>Farm / Premises</label>
          <select name="premises_id" required>
            <option value="">Select&hellip;</option>
            ${premisesList.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.village || p.district)})</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Disease Suspected</label>
          <select name="disease">
            <option value="ASF">African Swine Fever</option>
            <option value="FMD">FMD</option>
            <option value="PPR">PPR</option>
            <option value="AI">Avian Influenza</option>
          </select>
        </div>
        <div class="field">
          <label>What did you observe?</label>
          <textarea name="clinical_notes" rows="4" placeholder="e.g. sudden deaths, high fever, off-feed" required></textarea>
        </div>
        <input type="hidden" name="reported_date" value="${new Date().toISOString().slice(0, 10)}" />
        <input type="hidden" name="status" value="suspected" />
        <div id="quick-case-error" class="form-error hidden"></div>
        <button type="submit" class="btn btn-block">Submit Report</button>
      </form>
    </div>
  `;

  root.innerHTML = renderShell(html);
  attachShellHandlers();

  document.getElementById('quick-case-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.target).entries());
    try {
      const result = await api.post('/api/cases', body);
      showToast(`Case reported. Preliminary contact trace ran in ${result.trace.contactTraceMs.toFixed(0)}ms.`);
      navigate(`/cases/${result.case.id}/contacts`);
    } catch (err) {
      const errEl = document.getElementById('quick-case-error');
      errEl.textContent = err.message; errEl.classList.remove('hidden');
    }
  });
}
