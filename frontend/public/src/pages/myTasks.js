import { api } from '../lib/api.js';
import { esc, fmtDate, showToast } from '../lib/dom.js';
import { renderShell, attachShellHandlers } from '../layout.js';
import { navigate } from '../router.js';

export async function renderMyTasks() {
  const root = document.getElementById('root');
  root.innerHTML = renderShell(`<div class="empty-state">Loading your tasks&hellip;</div>`);

  let tasks = [];
  try {
    const res = await api.get('/api/tasks?mine=true');
    tasks = res.tasks;
  } catch (err) {
    root.innerHTML = renderShell(`<div class="card"><p class="form-error">${esc(err.message)}</p></div>`);
    attachShellHandlers();
    return;
  }

  tasks.sort((a, b) => {
    const order = { open: 0, in_progress: 1, completed: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return (a.due_date || '').localeCompare(b.due_date || '');
  });

  const html = `
    <h1>\uD83D\uDCF1 My Tasks</h1>
    <p class="text-muted">Assigned field tasks, sorted by status then due date. Tap a task to update status, add notes, or attach a photo.</p>

    ${tasks.length === 0 ? '<div class="card"><div class="empty-state">No tasks currently assigned to you.</div></div>' : tasks.map((t) => `
      <div class="card mb-2" data-task-id="${esc(t.id)}" style="cursor:pointer; border-left: 4px solid ${t.priority === 'High' ? '#c0392b' : t.priority === 'Medium' ? '#d68910' : '#2e86c1'};">
        <div class="flex justify-between items-center">
          <div>
            <div class="font-bold">${esc(t.task_type.replace('_', ' ').toUpperCase())} &mdash; ${esc(t.premises_name || 'Unknown')}</div>
            <div class="text-sm text-muted">${esc(t.premises_district || '')}${t.premises_village ? ' &middot; ' + esc(t.premises_village) : ''}</div>
          </div>
          <div class="text-right">
            <span class="badge badge-${t.priority.toLowerCase()}">${t.priority}</span>
            <div class="text-xs text-muted mt-1">${t.due_date ? 'Due ' + fmtDate(t.due_date) : ''}</div>
          </div>
        </div>
        <div class="mt-2"><span class="badge badge-${t.status}">${esc(t.status.replace('_', ' '))}</span></div>
      </div>
    `).join('')}
  `;

  root.innerHTML = renderShell(html);
  attachShellHandlers();

  document.querySelectorAll('[data-task-id]').forEach((cardEl) => {
    cardEl.addEventListener('click', () => navigate(`/tasks/${cardEl.getAttribute('data-task-id')}`));
  });
}
