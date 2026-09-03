import { api, getUser } from '../lib/api.js';
import { esc, fmtDate, showToast } from '../lib/dom.js';
import { renderShell, attachShellHandlers } from '../layout.js';

export async function renderCompensation() {
  const root = document.getElementById('root');
  root.innerHTML = renderShell(`<div class="empty-state">Loading compensation tracker&hellip;</div>`);

  let records = [];
  let premisesList = [];
  try {
    const [rres, pres] = await Promise.all([api.get('/api/compensation'), api.get('/api/premises')]);
    records = rres.records;
    premisesList = pres.premises;
  } catch (err) {
    root.innerHTML = renderShell(`<div class="card"><p class="form-error">${esc(err.message)}</p></div>`);
    attachShellHandlers();
    return;
  }

  const premisesById = new Map(premisesList.map((p) => [p.id, p]));
  const user = getUser();
  const canApprove = user && ['district_officer', 'state_admin'].includes(user.role);

  const html = `
    <div class="flex justify-between items-center mb-3">
      <div>
        <h1>Compensation Tracker</h1>
        <p class="text-muted">Status tracking only &mdash; feeds Assam's existing compensation/disbursement workflow. Disbursement itself is out of scope for this pilot.</p>
      </div>
      <button class="btn" id="add-comp-btn">+ Log Compensation Record</button>
    </div>

    <div class="card">
      <table>
        <thead><tr><th>Premises</th><th>District</th><th>Animals Affected</th><th>Status</th><th>Notes</th><th>Logged</th>${canApprove ? '<th>Action</th>' : ''}</tr></thead>
        <tbody>
          ${records.length === 0 ? `<tr><td colspan="7"><div class="empty-state">No compensation records yet.</div></td></tr>` : records.map((r) => {
            const premises = premisesById.get(r.premises_id);
            return `
            <tr>
              <td class="font-semibold">${esc(premises ? premises.name : r.premises_id)}</td>
              <td>${esc(premises ? premises.district : '\u2014')}</td>
              <td>${r.animals_affected_count}</td>
              <td><span class="badge badge-${r.status === 'disbursed' ? 'completed' : r.status === 'approved' ? 'completed' : r.status === 'assessed' ? 'in_progress' : 'open'}">${esc(r.status)}</span></td>
              <td class="text-sm">${esc(r.notes || '')}</td>
              <td class="text-xs">${fmtDate(r.created_at)}</td>
              ${canApprove ? `<td>
                <select data-comp-status="${esc(r.id)}" class="text-xs" style="width:auto; padding:4px 6px;">
                  <option value="reported" ${r.status === 'reported' ? 'selected' : ''}>Reported</option>
                  <option value="assessed" ${r.status === 'assessed' ? 'selected' : ''}>Assessed</option>
                  <option value="approved" ${r.status === 'approved' ? 'selected' : ''}>Approved</option>
                  <option value="disbursed" ${r.status === 'disbursed' ? 'selected' : ''}>Disbursed</option>
                </select>
              </td>` : ''}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div id="add-comp-modal" class="hidden" style="position:fixed; inset:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; z-index:50;">
      <div class="card" style="width:480px; max-width:92vw;">
        <h2>Log Compensation Record</h2>
        <form id="comp-form">
          <div class="field">
            <label>Premises</label>
            <select name="premises_id" required>${premisesList.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.district)})</option>`).join('')}</select>
          </div>
          <div class="field"><label>Animals Affected (culled)</label><input type="number" name="animals_affected_count" min="0" required /></div>
          <div class="field"><label>Notes</label><textarea name="notes" rows="3"></textarea></div>
          <div id="comp-error" class="form-error hidden"></div>
          <div class="flex justify-end gap-2 mt-2">
            <button type="button" class="btn btn-secondary" id="cancel-comp">Cancel</button>
            <button type="submit" class="btn">Log Record</button>
          </div>
        </form>
      </div>
    </div>
  `;

  root.innerHTML = renderShell(html);
  attachShellHandlers();

  document.getElementById('add-comp-btn').addEventListener('click', () => document.getElementById('add-comp-modal').classList.remove('hidden'));
  document.getElementById('cancel-comp').addEventListener('click', () => document.getElementById('add-comp-modal').classList.add('hidden'));
  document.getElementById('comp-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.target).entries());
    try {
      await api.post('/api/compensation', body);
      showToast('Compensation record logged.');
      renderCompensation();
    } catch (err) {
      const errEl = document.getElementById('comp-error');
      errEl.textContent = err.message; errEl.classList.remove('hidden');
    }
  });

  document.querySelectorAll('[data-comp-status]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      try {
        await api.patch(`/api/compensation/${sel.getAttribute('data-comp-status')}/status`, { status: sel.value });
        showToast('Compensation status updated.');
      } catch (err) { showToast(err.message, true); }
    });
  });
}
