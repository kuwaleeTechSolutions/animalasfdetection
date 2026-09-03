import { api } from '../lib/api.js';
import { esc, fmtDuration, fmtDate, showToast } from '../lib/dom.js';
import { renderShell, attachShellHandlers } from '../layout.js';
import { renderMap } from '../lib/map.js';
import { navigate } from '../router.js';

export async function renderDashboard() {
  const root = document.getElementById('root');
  root.innerHTML = renderShell(`<div class="empty-state">Loading command dashboard&hellip;</div>`);

  let summary;
  try {
    summary = await api.get('/api/dashboard/summary');
  } catch (err) {
    root.innerHTML = renderShell(`<div class="card"><p class="form-error">Failed to load dashboard: ${esc(err.message)}</p></div>`);
    attachShellHandlers();
    return;
  }

  const { activeOutbreaksCount, districtsAffectedCount, districtsAffected, tasksByStatus, metrics, epicentres, riskMapPoints, totalPremises } = summary;

  const html = `
    <div class="flex justify-between items-center mb-4">
      <div>
        <h1>Command Dashboard</h1>
        <p class="text-muted">Real-time outbreak intelligence &mdash; African Swine Fever, Phase 1 pilot districts.</p>
      </div>
      <button class="btn btn-secondary" id="refresh-btn">\u21BB Refresh</button>
    </div>

    <div class="grid grid-cols-4 gap-3 mb-4">
      <div class="card stat-card">
        <div class="card-title">Active Outbreaks</div>
        <div class="stat-value">${activeOutbreaksCount}</div>
        <div class="stat-sub">Suspected + lab-confirmed cases</div>
      </div>
      <div class="card stat-card">
        <div class="card-title">Districts Affected</div>
        <div class="stat-value">${districtsAffectedCount}</div>
        <div class="stat-sub">${districtsAffected.map(esc).join(', ') || 'None currently'}</div>
      </div>
      <div class="card stat-card">
        <div class="card-title">Contact-Trace Time <span title="Wall-clock time for the contact-tracing engine to complete, averaged across all runs">\u2139\uFE0F</span></div>
        <div class="stat-value">${metrics.contactTraceMsAvg != null ? metrics.contactTraceMsAvg.toFixed(0) + 'ms' : '\u2014'}</div>
        <div class="stat-sub">Avg. of ${metrics.traceRunCount} trace run(s) &mdash; target: hours &rarr; achieved: seconds</div>
      </div>
      <div class="card stat-card">
        <div class="card-title">Detection-to-Alert Time</div>
        <div class="stat-value">${metrics.detectionToAlertSecondsAvg != null ? fmtDuration(metrics.detectionToAlertSecondsAvg) : '\u2014'}</div>
        <div class="stat-sub">Lab-confirmation &rarr; contact trace complete</div>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-4" style="grid-template-columns: 2fr 1fr;">
      <div class="card">
        <h2>Epicentre &amp; Risk Map</h2>
        <p class="text-muted text-sm">Index case premises (dark) and risk-scored connected premises (red = High, amber = Medium, blue = Low).</p>
        <div id="dashboard-map" class="mt-2"></div>
      </div>
      <div class="card">
        <h2>Tasks by Status</h2>
        <div class="mt-3">
          ${renderFunnelRow('Open', tasksByStatus.open, tasksByStatus.open + tasksByStatus.in_progress + tasksByStatus.completed, '#5b6b62')}
          ${renderFunnelRow('In Progress', tasksByStatus.in_progress, tasksByStatus.open + tasksByStatus.in_progress + tasksByStatus.completed, '#d68910')}
          ${renderFunnelRow('Completed', tasksByStatus.completed, tasksByStatus.open + tasksByStatus.in_progress + tasksByStatus.completed, '#229954')}
        </div>
        <a href="#/tasks" class="btn btn-secondary btn-block mt-3">Open Task Board</a>
        <hr class="divider" />
        <div class="text-sm text-muted">Total registered premises: <strong>${totalPremises}</strong></div>
      </div>
    </div>

    <div class="card">
      <h2>Active Outbreak Epicentres</h2>
      ${epicentres.length === 0 ? '<div class="empty-state">No active outbreaks. All clear.</div>' : `
      <table>
        <thead><tr><th>Premises</th><th>District</th><th>Disease</th><th>Status</th><th>Connected Premises</th><th>Risk Breakdown</th><th></th></tr></thead>
        <tbody>
          ${epicentres.map((e) => `
            <tr>
              <td class="font-semibold">${esc(e.premises ? e.premises.name : '\u2014')}</td>
              <td>${esc(e.premises ? e.premises.district : '\u2014')}</td>
              <td>${esc(e.disease)}</td>
              <td><span class="badge badge-${e.status}">${esc(e.status.replace('_', ' '))}</span></td>
              <td>${e.connectedCount}</td>
              <td>
                <span class="badge badge-high">${e.highRisk} High</span>
                <span class="badge badge-medium">${e.mediumRisk} Med</span>
                <span class="badge badge-low">${e.lowRisk} Low</span>
              </td>
              <td><button class="btn btn-sm" data-view-case="${esc(e.caseId)}">View Trace</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>`}
    </div>
  `;

  root.innerHTML = renderShell(html);
  attachShellHandlers();

  document.getElementById('refresh-btn').addEventListener('click', () => renderDashboard());
  document.querySelectorAll('[data-view-case]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(`/cases/${btn.getAttribute('data-view-case')}/contacts`));
  });

  // Render map: index premises (dark) + all connected risk-scored premises.
  const mapContainer = document.getElementById('dashboard-map');
  const points = [
    ...epicentres.filter((e) => e.premises).map((e) => ({
      lat: e.premises.lat, lng: e.premises.lng, label: e.premises.name, sub: `Index case &middot; ${e.disease}`,
      isIndex: true, type: e.premises.premises_type, onClick: () => navigate(`/cases/${e.caseId}/contacts`),
    })),
    ...riskMapPoints.map((r) => ({
      lat: r.premises.lat, lng: r.premises.lng, label: r.premises.name, sub: `${r.premises.district} &middot; score ${r.score.toFixed(1)}`,
      level: r.level, type: r.premises.premises_type, onClick: () => navigate(`/cases/${r.caseId}/contacts`),
    })),
  ];
  renderMap(mapContainer, points, { height: 340 });
}

function renderFunnelRow(label, count, total, color) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return `
    <div class="mb-2">
      <div class="flex justify-between text-sm"><span>${label}</span><span class="font-semibold">${count}</span></div>
      <div style="background:#eef1ef; border-radius: 999px; height: 8px; overflow:hidden;">
        <div style="width:${pct}%; background:${color}; height:100%;"></div>
      </div>
    </div>`;
}
