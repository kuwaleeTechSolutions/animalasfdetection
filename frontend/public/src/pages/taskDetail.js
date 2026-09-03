import { api } from '../lib/api.js';
import { esc, fmtDate, fmtDateTime, showToast } from '../lib/dom.js';
import { renderShell, attachShellHandlers } from '../layout.js';
import { navigate } from '../router.js';

export async function renderTaskDetail(params) {
  const root = document.getElementById('root');
  root.innerHTML = renderShell(`<div class="empty-state">Loading task&hellip;</div>`);

  let task;
  try {
    const res = await api.get(`/api/tasks/${params.id}`);
    task = res.task;
  } catch (err) {
    root.innerHTML = renderShell(`<div class="card"><p class="form-error">${esc(err.message)}</p></div>`);
    attachShellHandlers();
    return;
  }

  const html = `
    <button class="btn btn-secondary btn-sm mb-3" id="back-btn">&larr; Back</button>
    <div class="card" style="max-width: 560px;">
      <h1>${esc(task.task_type.replace('_', ' ').toUpperCase())}</h1>
      <p class="text-muted">${esc(task.premises_name || 'Unknown premises')} &middot; ${esc(task.premises_district || '')}</p>
      <div class="flex gap-2 mb-3">
        <span class="badge badge-${task.priority.toLowerCase()}">${task.priority} priority</span>
        <span class="badge badge-${task.status}">${esc(task.status.replace('_', ' '))}</span>
      </div>
      <p class="text-sm"><strong>Due:</strong> ${task.due_date ? fmtDate(task.due_date) : '\u2014'}</p>
      <p class="text-sm"><strong>Assigned to:</strong> ${esc(task.assignee_name || 'Unassigned')}</p>
      ${task.completed_at ? `<p class="text-sm"><strong>Completed:</strong> ${fmtDateTime(task.completed_at)}</p>` : ''}
      <p class="text-sm"><strong>Notes:</strong><br/>${esc(task.notes || '\u2014')}</p>
      ${task.photo_url ? `<p class="text-sm"><strong>Photo:</strong> ${esc(task.photo_url)}</p>` : ''}

      <hr class="divider" />
      <h3>Update Task</h3>
      <form id="update-form">
        <div class="field">
          <label>Status</label>
          <select name="status">
            <option value="open" ${task.status === 'open' ? 'selected' : ''}>Open</option>
            <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
            <option value="completed" ${task.status === 'completed' ? 'selected' : ''}>Completed</option>
          </select>
        </div>
        <div class="field">
          <label>Field Notes</label>
          <textarea name="notes" rows="3" placeholder="Observations, sample collected, quarantine status, etc.">${esc(task.notes || '')}</textarea>
        </div>
        <div class="field">
          <label>Photo (file upload -- nice-to-have; enter a filename/URL for this pilot)</label>
          <input type="text" name="photo_url" placeholder="e.g. photo_farm_visit_2026-08-21.jpg" />
        </div>
        <div id="update-error" class="form-error hidden"></div>
        <button type="submit" class="btn btn-block">Save Update</button>
      </form>
    </div>
  `;

  root.innerHTML = renderShell(html);
  attachShellHandlers();

  document.getElementById('back-btn').addEventListener('click', () => history.back());
  document.getElementById('update-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.target).entries());
    try {
      await api.patch(`/api/tasks/${task.id}/status`, body);
      showToast('Task updated.');
      renderTaskDetail(params);
    } catch (err) {
      const errEl = document.getElementById('update-error');
      errEl.textContent = err.message; errEl.classList.remove('hidden');
    }
  });
}
