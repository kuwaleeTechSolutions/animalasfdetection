import { api, getUser } from '../lib/api.js';
import { esc, showToast } from '../lib/dom.js';
import { renderShell, attachShellHandlers } from '../layout.js';

const ROLE_LABELS = {
  field_officer: 'Field Veterinary Officer', district_officer: 'District AH Officer',
  state_admin: 'State/Directorate Admin', policymaker: 'Policymaker (Read-only)',
};

export async function renderAdminSettings() {
  const root = document.getElementById('root');
  root.innerHTML = renderShell(`<div class="empty-state">Loading admin settings&hellip;</div>`);

  const user = getUser();
  const isStateAdmin = user && user.role === 'state_admin';

  let users = [];
  let settings = {};
  try {
    const [ures, sres] = await Promise.all([api.get('/api/users'), api.get('/api/settings')]);
    users = ures.users;
    settings = sres.settings;
  } catch (err) {
    root.innerHTML = renderShell(`<div class="card"><p class="form-error">${esc(err.message)}</p></div>`);
    attachShellHandlers();
    return;
  }

  const html = `
    <h1>\u2699\uFE0F Users &amp; Settings</h1>
    <p class="text-muted">Configure risk-scoring thresholds, lookback windows, and manage user accounts. Only State/Directorate Admins can change settings.</p>

    <div class="card mb-4">
      <h2>Contact-Tracing &amp; Risk-Scoring Configuration</h2>
      <p class="text-muted text-sm">These parameters are read from the <code>settings</code> table (not hardcoded) so Assam can tune them after the pilot. Changing them re-applies on the next contact trace / re-trace.</p>
      <form id="settings-form">
        <div class="field-row">
          <div class="field"><label>Lookback Window (days)</label><input type="number" name="lookbackWindowDays" value="${settings.lookbackWindowDays}" min="1" ${isStateAdmin ? '' : 'disabled'} /></div>
          <div class="field"><label>Nearby-Farm Radius (km)</label><input type="number" step="0.1" name="proximityRadiusKm" value="${settings.proximityRadiusKm}" min="0.1" ${isStateAdmin ? '' : 'disabled'} /></div>
          <div class="field"><label>Max BFS Hops</label><input type="number" name="maxHops" value="${settings.maxHops}" min="1" max="4" ${isStateAdmin ? '' : 'disabled'} /></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Risk Threshold &mdash; High (score &ge;)</label><input type="number" step="0.5" name="riskThresholdHigh" value="${settings.riskThresholds.high}" ${isStateAdmin ? '' : 'disabled'} /></div>
          <div class="field"><label>Risk Threshold &mdash; Medium (score &ge;)</label><input type="number" step="0.5" name="riskThresholdMedium" value="${settings.riskThresholds.medium}" ${isStateAdmin ? '' : 'disabled'} /></div>
          <div class="field"><label>Hop Decay Factor</label><input type="number" step="0.05" name="hopDecayFactor" value="${settings.hopDecayFactor}" ${isStateAdmin ? '' : 'disabled'} /></div>
        </div>
        <div class="field">
          <label>Pilot Districts (comma-separated)</label>
          <input type="text" name="pilotDistricts" value="${esc(settings.pilotDistricts.join(', '))}" ${isStateAdmin ? '' : 'disabled'} />
        </div>
        <div class="field">
          <label>Pathway Weights (JSON)</label>
          <textarea name="pathwayWeights" rows="3" ${isStateAdmin ? '' : 'disabled'}>${esc(JSON.stringify(settings.pathwayWeights, null, 2))}</textarea>
        </div>
        ${isStateAdmin ? `
        <div id="settings-error" class="form-error hidden"></div>
        <button type="submit" class="btn">Save Settings</button>` : `<p class="text-sm text-muted">Read-only for your role.</p>`}
      </form>
    </div>

    <div class="card">
      <div class="flex justify-between items-center mb-2">
        <h2>Users</h2>
        ${isStateAdmin ? '<button class="btn btn-sm" id="add-user-btn">+ Add User</button>' : ''}
      </div>
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>District</th><th>Contact</th></tr></thead>
        <tbody>
          ${users.map((u) => `
            <tr>
              <td class="font-semibold">${esc(u.name)}</td>
              <td>${esc(u.email)}</td>
              <td>${esc(ROLE_LABELS[u.role] || u.role)}</td>
              <td>${esc(u.district || '\u2014')}</td>
              <td>${esc(u.contact || '\u2014')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    ${isStateAdmin ? `
    <div id="add-user-modal" class="hidden" style="position:fixed; inset:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; z-index:50;">
      <div class="card" style="width:420px; max-width:92vw;">
        <h2>Add User</h2>
        <form id="add-user-form">
          <div class="field"><label>Name</label><input type="text" name="name" required /></div>
          <div class="field"><label>Email</label><input type="email" name="email" required /></div>
          <div class="field"><label>Password</label><input type="password" name="password" required /></div>
          <div class="field"><label>Role</label>
            <select name="role">
              <option value="field_officer">Field Veterinary Officer</option>
              <option value="district_officer">District AH Officer</option>
              <option value="state_admin">State/Directorate Admin</option>
              <option value="policymaker">Policymaker (Read-only)</option>
            </select>
          </div>
          <div class="field"><label>District</label><input type="text" name="district" /></div>
          <div id="add-user-error" class="form-error hidden"></div>
          <div class="flex justify-end gap-2 mt-2">
            <button type="button" class="btn btn-secondary" id="cancel-add-user">Cancel</button>
            <button type="submit" class="btn">Create</button>
          </div>
        </form>
      </div>
    </div>` : ''}
  `;

  root.innerHTML = renderShell(html);
  attachShellHandlers();

  if (isStateAdmin) {
    document.getElementById('settings-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      let pathwayWeights;
      try { pathwayWeights = JSON.parse(fd.get('pathwayWeights')); } catch { pathwayWeights = settings.pathwayWeights; }
      const body = {
        lookbackWindowDays: Number(fd.get('lookbackWindowDays')),
        proximityRadiusKm: Number(fd.get('proximityRadiusKm')),
        maxHops: Number(fd.get('maxHops')),
        riskThresholds: { high: Number(fd.get('riskThresholdHigh')), medium: Number(fd.get('riskThresholdMedium')) },
        hopDecayFactor: Number(fd.get('hopDecayFactor')),
        pilotDistricts: String(fd.get('pilotDistricts')).split(',').map((s) => s.trim()).filter(Boolean),
        pathwayWeights,
      };
      try {
        await api.patch('/api/settings', body);
        showToast('Settings updated.');
        renderAdminSettings();
      } catch (err) {
        const errEl = document.getElementById('settings-error');
        errEl.textContent = err.message; errEl.classList.remove('hidden');
      }
    });

    document.getElementById('add-user-btn').addEventListener('click', () => document.getElementById('add-user-modal').classList.remove('hidden'));
    document.getElementById('cancel-add-user').addEventListener('click', () => document.getElementById('add-user-modal').classList.add('hidden'));
    document.getElementById('add-user-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(ev.target).entries());
      try {
        await api.post('/api/users', body);
        showToast('User created.');
        renderAdminSettings();
      } catch (err) {
        const errEl = document.getElementById('add-user-error');
        errEl.textContent = err.message; errEl.classList.remove('hidden');
      }
    });
  }
}
