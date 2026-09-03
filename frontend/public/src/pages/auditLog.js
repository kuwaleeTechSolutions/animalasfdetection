import { api } from '../lib/api.js';
import { esc, fmtDateTime } from '../lib/dom.js';
import { renderShell, attachShellHandlers } from '../layout.js';

export async function renderAuditLog() {
  const root = document.getElementById('root');
  root.innerHTML = renderShell(`<div class="empty-state">Loading audit log&hellip;</div>`);

  let entries = [];
  try {
    const res = await api.get('/api/audit-log');
    entries = res.entries;
  } catch (err) {
    root.innerHTML = renderShell(`<div class="card"><p class="form-error">${esc(err.message)}</p></div>`);
    attachShellHandlers();
    return;
  }

  const html = `
    <h1>\uD83D\uDCDC Audit Log</h1>
    <p class="text-muted">Every create/update/delete action across the platform is logged here for oversight, per spec &sect;10 (Security &amp; Audit).</p>
    <div class="card">
      <table>
        <thead><tr><th>Timestamp</th><th>Action</th><th>Entity</th><th>User</th><th>Details</th></tr></thead>
        <tbody>
          ${entries.length === 0 ? '<tr><td colspan="5"><div class="empty-state">No audit entries yet.</div></td></tr>' : entries.map((e) => `
            <tr>
              <td class="text-xs">${fmtDateTime(e.timestamp)}</td>
              <td><span class="badge badge-open">${esc(e.action)}</span></td>
              <td class="text-sm">${esc(e.entity_type)}${e.entity_id ? `<div class="text-xs text-muted">${esc(e.entity_id)}</div>` : ''}</td>
              <td class="text-xs">${esc(e.user_id || 'system')}</td>
              <td class="text-xs" style="max-width:280px; overflow-wrap:break-word;">${esc(e.details_json || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  root.innerHTML = renderShell(html);
  attachShellHandlers();
}
