import { api, getUser } from '../lib/api.js';
import { esc, fmtDate, showToast } from '../lib/dom.js';
import { renderShell, attachShellHandlers } from '../layout.js';
import { navigate } from '../router.js';

export async function renderTaskBoard() {
  const root = document.getElementById('root');
  root.innerHTML = renderShell(`<div class="empty-state">Loading task board&hellip;</div>`);

  let tasks = [];
  let users = [];
  try {
    const res = await api.get('/api/tasks');
    tasks = res.tasks;
    const user = getUser();
    if (user && ['state_admin', 'district_officer'].includes(user.role)) {
      const ures = await api.get('/api/users');
      users = ures.users;
    }
  } catch (err) {
    root.innerHTML = renderShell(`<div class="card"><p class="form-error">${esc(err.message)}</p></div>`);
    attachShellHandlers();
    return;
  }

  // Filters
  const districts = [...new Set(tasks.map((t) => t.premises_district).filter(Boolean))];

  const html = `
    <div class="flex justify-between items-center mb-3">
      <div>
        <h1>Field Task Board</h1>
        <p class="text-muted">${tasks.length} total tasks &mdash; auto-generated High/Medium risk premises from contact-tracing, plus manually created tasks.</p>
      </div>
    </div>

    <div class="kanban">
      ${renderColumn('open', 'Open', tasks.filter((t) => t.status === 'open'), users)}
      ${renderColumn('in_progress', 'In Progress', tasks.filter((t) => t.status === 'in_progress'), users)}
      ${renderColumn('completed', 'Completed', tasks.filter((t) => t.status === 'completed'), users)}
    </div>
  `;

  root.innerHTML = renderShell(html);
  attachShellHandlers();

  document.querySelectorAll('[data-task-id]').forEach((cardEl) => {
    cardEl.addEventListener('click', () => navigate(`/tasks/${cardEl.getAttribute('data-task-id')}`));
  });
}

function renderColumn(status, label, list, users) {
  return `
    <div class="kanban-col">
      <div class="kanban-col-header"><span>${label}</span><span class="text-muted">${list.length}</span></div>
      ${list.length === 0 ? '<div class="text-muted text-sm">No tasks</div>' : list.map((t) => `
        <div class="kanban-card priority-${t.priority}" data-task-id="${esc(t.id)}">
          <div class="kc-title">${esc(t.task_type.replace('_', ' ').toUpperCase())} &mdash; ${esc(t.premises_name || 'Unknown premises')}</div>
          <div class="kc-meta">
            <span class="badge badge-${t.priority.toLowerCase()}">${t.priority}</span>
            ${t.due_date ? ` &middot; due ${fmtDate(t.due_date)}` : ''}
            ${t.assignee_name ? ` &middot; ${esc(t.assignee_name)}` : ' &middot; unassigned'}
          </div>
          <div class="kc-meta text-xs">${esc(t.premises_district || '')}</div>
        </div>
      `).join('')}
    </div>`;
}
