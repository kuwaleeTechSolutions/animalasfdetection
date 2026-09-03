import { api } from '../lib/api.js';
import { esc, fmtDate, fmtDateTime, fmtDuration, showToast } from '../lib/dom.js';
import { renderShell, attachShellHandlers } from '../layout.js';
import { renderMap } from '../lib/map.js';
import { navigate } from '../router.js';

const PATHWAY_LABELS = {
  animal_movement: 'Animal Movement', transport_vehicle: 'Shared Vehicle', market: 'Shared Market',
  veterinary_visit: 'Vet Visit', nearby_farm: 'Nearby Farm', previous_farm: 'Previous Farm (trace-back)',
  destination_farm: 'Destination Farm (trace-forward)',
};

export async function renderContactTrace(params) {
  const root = document.getElementById('root');
  root.innerHTML = renderShell(`<div class="empty-state">Loading contact-trace results&hellip;</div>`);

  let data;
  try {
    data = await api.get(`/api/cases/${params.id}/contacts`);
  } catch (err) {
    root.innerHTML = renderShell(`<div class="card"><p class="form-error">${esc(err.message)}</p></div>`);
    attachShellHandlers();
    return;
  }

  const { case: c, indexPremises, connectedPremises, traceRun } = data;
  const highCount = connectedPremises.filter((p) => p.risk?.level === 'High').length;
  const medCount = connectedPremises.filter((p) => p.risk?.level === 'Medium').length;
  const lowCount = connectedPremises.filter((p) => p.risk?.level === 'Low').length;

  const html = `
    <div class="flex justify-between items-center mb-3">
      <div>
        <h1>Contact-Trace Results</h1>
        <p class="text-muted">
          Case: <strong>${esc(c.disease)}</strong> at <strong>${esc(indexPremises.name)}</strong> (${esc(indexPremises.district)})
          &mdash; <span class="badge badge-${c.status}">${esc(c.status.replace('_', ' '))}</span>
        </p>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-secondary" id="retrace-btn">\u21BB Re-run Trace</button>
        ${c.status !== 'lab_confirmed' ? `<button class="btn btn-danger" id="confirm-btn">Mark Lab Confirmed</button>` : ''}
        <button class="btn" id="gen-tasks-btn">Generate Tasks (1-click)</button>
      </div>
    </div>

    <div class="grid grid-cols-4 gap-3 mb-4">
      <div class="card stat-card"><div class="card-title">Connected Premises</div><div class="stat-value">${connectedPremises.length}</div></div>
      <div class="card stat-card"><div class="card-title">High Risk</div><div class="stat-value" style="color:#c0392b">${highCount}</div></div>
      <div class="card stat-card"><div class="card-title">Medium Risk</div><div class="stat-value" style="color:#d68910">${medCount}</div></div>
      <div class="card stat-card"><div class="card-title">Contact-Trace Time</div><div class="stat-value">${traceRun ? traceRun.contact_trace_ms.toFixed(0) + 'ms' : '\u2014'}</div></div>
    </div>

    <div class="card mb-4">
      <h2>Map: Index Case + Connected Premises</h2>
      <div id="trace-map" class="mt-2"></div>
    </div>

    <div class="card">
      <h2>Ranked List of Connected Premises &mdash; All Pathways Surfaced</h2>
      <p class="text-muted text-sm">Every pathway connecting a premises to the case is shown (a premises may appear via multiple pathways). Sorted by risk score, highest first.</p>
      ${connectedPremises.length === 0 ? '<div class="empty-state">No connected premises found within the configured lookback window / radius.</div>' : `
      <table>
        <thead><tr><th>Premises</th><th>Type</th><th>District</th><th>Pathways</th><th>Risk</th><th>Task</th></tr></thead>
        <tbody>
          ${connectedPremises.map((cp) => `
            <tr>
              <td class="font-semibold">${esc(cp.premises.name)}<div class="text-xs text-muted">${esc(cp.premises.owner_name || '')}</div></td>
              <td>${esc(cp.premises.premises_type)}</td>
              <td>${esc(cp.premises.district)}</td>
              <td>${cp.pathways.map((p) => `<span class="pathway-chip" title="Hop ${p.hop}, ${p.occurrences} occurrence(s)">${esc(PATHWAY_LABELS[p.pathway] || p.pathway)}${p.hop > 1 ? ` (hop ${p.hop})` : ''}</span>`).join('')}</td>
              <td>${cp.risk ? `<span class="badge badge-${cp.risk.level.toLowerCase()}">${cp.risk.level}</span><div class="text-xs text-muted mt-1">score ${cp.risk.score.toFixed(1)}</div>` : '\u2014'}</td>
              <td>${cp.task ? `<span class="badge badge-${cp.task.status}">${esc(cp.task.status.replace('_', ' '))}</span><div class="text-xs text-muted">${esc(cp.task.task_type)}</div>` : '<span class="text-xs text-muted">Not yet tasked</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`}
    </div>
  `;

  root.innerHTML = renderShell(html);
  attachShellHandlers();

  const mapContainer = document.getElementById('trace-map');
  const points = [
    { lat: indexPremises.lat, lng: indexPremises.lng, label: indexPremises.name, sub: 'Index case premises', isIndex: true, type: indexPremises.premises_type },
    ...connectedPremises.map((cp) => ({
      lat: cp.premises.lat, lng: cp.premises.lng, label: cp.premises.name,
      sub: cp.pathways.map((p) => PATHWAY_LABELS[p.pathway] || p.pathway).join(', '),
      level: cp.risk ? cp.risk.level : 'Low', type: cp.premises.premises_type,
    })),
  ];
  renderMap(mapContainer, points, { height: 380 });

  document.getElementById('retrace-btn').addEventListener('click', async () => {
    try {
      const result = await api.post(`/api/cases/${c.id}/retrace`, {});
      showToast(`Re-trace complete: ${result.trace.connectedPremisesIds.length} connected premises in ${result.trace.contactTraceMs.toFixed(0)}ms.`);
      renderContactTrace(params);
    } catch (err) { showToast(err.message, true); }
  });

  const confirmBtn = document.getElementById('confirm-btn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      try {
        const result = await api.patch(`/api/cases/${c.id}/status`, { status: 'lab_confirmed', lab_result_date: new Date().toISOString().slice(0, 10) });
        showToast('Case marked lab-confirmed. Contact trace re-run automatically.');
        renderContactTrace(params);
      } catch (err) { showToast(err.message, true); }
    });
  }

  document.getElementById('gen-tasks-btn').addEventListener('click', async () => {
    try {
      const result = await api.post(`/api/cases/${c.id}/generate-tasks`, {});
      showToast(`${result.tasksCreated} new field task(s) generated.`);
      renderContactTrace(params);
    } catch (err) { showToast(err.message, true); }
  });
}
