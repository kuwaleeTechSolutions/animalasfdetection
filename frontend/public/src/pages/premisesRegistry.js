import { api } from '../lib/api.js';
import { esc, showToast } from '../lib/dom.js';
import { renderShell, attachShellHandlers } from '../layout.js';
import { getUser } from '../lib/api.js';

const SOURCE_LABELS = { manual: 'Manual entry', bharat_pashudhan_import: 'Bharat Pashudhan import', inaph_import: 'INAPH import' };

export async function renderPremisesRegistry() {
  const root = document.getElementById('root');
  root.innerHTML = renderShell(`<div class="empty-state">Loading premises registry&hellip;</div>`);

  let premisesList = [];
  try {
    const res = await api.get('/api/premises');
    premisesList = res.premises;
  } catch (err) {
    root.innerHTML = renderShell(`<div class="card"><p class="form-error">${esc(err.message)}</p></div>`);
    attachShellHandlers();
    return;
  }

  const user = getUser();
  const canImport = user && ['state_admin', 'district_officer'].includes(user.role);

  const html = `
    <div class="flex justify-between items-center mb-3">
      <div>
        <h1>Farm / Premises Registry</h1>
        <p class="text-muted">${premisesList.length} premises registered${user && user.role === 'field_officer' ? ` in your district (${esc(user.district || '')})` : ''}.</p>
      </div>
      <div class="flex gap-2">
        ${canImport ? `<button class="btn btn-secondary" id="import-btn">\u2B06\uFE0F Import from Bharat Pashudhan/INAPH</button>` : ''}
        <button class="btn" id="add-premises-btn">+ Register Premises</button>
      </div>
    </div>

    <div class="card mb-3">
      <div class="field-row" style="align-items:flex-end;">
        <div class="field"><label>Search</label><input type="text" id="search-input" placeholder="Name, owner, or village&hellip;" /></div>
        <div class="field" style="max-width:180px;"><label>District</label><select id="district-filter"><option value="">All districts</option>${[...new Set(premisesList.map((p) => p.district))].map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select></div>
        <div class="field" style="max-width:180px;"><label>Type</label><select id="type-filter"><option value="">All types</option><option value="farm">Farm</option><option value="market">Market</option><option value="slaughterhouse">Slaughterhouse</option><option value="vet_clinic">Vet Clinic</option><option value="transport_hub">Transport Hub</option></select></div>
      </div>
    </div>

    <div class="card">
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Village/Block</th><th>District</th><th>Owner</th><th>Source</th></tr></thead>
        <tbody id="premises-tbody">
          ${renderRows(premisesList)}
        </tbody>
      </table>
    </div>

    <!-- Add Premises Modal (simple inline card toggled by JS) -->
    <div id="add-modal" class="hidden" style="position:fixed; inset:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; z-index:50;">
      <div class="card" style="width:520px; max-width:92vw;">
        <h2>Register New Premises</h2>
        <form id="add-form">
          <div class="field"><label>Name</label><input type="text" name="name" required /></div>
          <div class="field-row">
            <div class="field"><label>Owner Name</label><input type="text" name="owner_name" /></div>
            <div class="field"><label>Owner Contact</label><input type="text" name="owner_contact" /></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Village</label><input type="text" name="village" /></div>
            <div class="field"><label>Block</label><input type="text" name="block" /></div>
          </div>
          <div class="field-row">
            <div class="field"><label>District</label><input type="text" name="district" required /></div>
            <div class="field"><label>Premises Type</label>
              <select name="premises_type"><option value="farm">Farm</option><option value="market">Market</option><option value="slaughterhouse">Slaughterhouse</option><option value="vet_clinic">Vet Clinic</option><option value="transport_hub">Transport Hub</option></select>
            </div>
          </div>
          <div class="field-row">
            <div class="field"><label>Latitude</label><input type="number" step="any" name="lat" required /></div>
            <div class="field"><label>Longitude</label><input type="number" step="any" name="lng" required /></div>
          </div>
          <div id="add-error" class="form-error hidden"></div>
          <div class="flex justify-end gap-2 mt-2">
            <button type="button" class="btn btn-secondary" id="cancel-add">Cancel</button>
            <button type="submit" class="btn">Register</button>
          </div>
        </form>
      </div>
    </div>

    <!-- CSV Import Modal -->
    <div id="import-modal" class="hidden" style="position:fixed; inset:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; z-index:50;">
      <div class="card" style="width:600px; max-width:92vw;">
        <h2>Import Premises from Bharat Pashudhan / INAPH</h2>
        <div class="integration-note">[INTEGRATION POINT] Live API sync with Bharat Pashudhan / INAPH is not available in this pilot. This CSV-upload stub is a placeholder for the real integration &mdash; the underlying data model (registration_source, external_ref_id) is already wired for it.</div>
        <form id="import-form" class="mt-3">
          <div class="field">
            <label>Source</label>
            <select name="source"><option value="bharat_pashudhan">Bharat Pashudhan</option><option value="inaph">INAPH</option></select>
          </div>
          <div class="field">
            <label>CSV Data (columns: name,owner_name,owner_contact,village,block,district,lat,lng,premises_type,external_ref_id)</label>
            <textarea name="csv" rows="6" placeholder="name,owner_name,owner_contact,village,block,district,lat,lng,premises_type,external_ref_id
Example Farm,Owner Name,9800000000,Village,Block,Dibrugarh,27.47,94.91,farm,BPD-1234"></textarea>
          </div>
          <div id="import-error" class="form-error hidden"></div>
          <div class="flex justify-end gap-2 mt-2">
            <button type="button" class="btn btn-secondary" id="cancel-import">Cancel</button>
            <button type="submit" class="btn">Import</button>
          </div>
        </form>
      </div>
    </div>
  `;

  root.innerHTML = renderShell(html);
  attachShellHandlers();

  function applyFilters() {
    const q = document.getElementById('search-input').value.toLowerCase();
    const district = document.getElementById('district-filter').value;
    const type = document.getElementById('type-filter').value;
    const filtered = premisesList.filter((p) =>
      (!q || p.name.toLowerCase().includes(q) || (p.owner_name || '').toLowerCase().includes(q) || (p.village || '').toLowerCase().includes(q)) &&
      (!district || p.district === district) &&
      (!type || p.premises_type === type)
    );
    document.getElementById('premises-tbody').innerHTML = renderRows(filtered);
  }
  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('district-filter').addEventListener('change', applyFilters);
  document.getElementById('type-filter').addEventListener('change', applyFilters);

  document.getElementById('add-premises-btn').addEventListener('click', () => document.getElementById('add-modal').classList.remove('hidden'));
  document.getElementById('cancel-add').addEventListener('click', () => document.getElementById('add-modal').classList.add('hidden'));
  document.getElementById('add-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.target).entries());
    try {
      await api.post('/api/premises', body);
      showToast('Premises registered.');
      renderPremisesRegistry();
    } catch (err) {
      const errEl = document.getElementById('add-error');
      errEl.textContent = err.message; errEl.classList.remove('hidden');
    }
  });

  const importBtn = document.getElementById('import-btn');
  if (importBtn) {
    importBtn.addEventListener('click', () => document.getElementById('import-modal').classList.remove('hidden'));
    document.getElementById('cancel-import').addEventListener('click', () => document.getElementById('import-modal').classList.add('hidden'));
    document.getElementById('import-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const body = { source: fd.get('source'), csv: fd.get('csv') };
      try {
        const result = await api.post('/api/import/premises-csv', body);
        showToast(`Imported ${result.importedCount} premises.`);
        renderPremisesRegistry();
      } catch (err) {
        const errEl = document.getElementById('import-error');
        errEl.textContent = err.message; errEl.classList.remove('hidden');
      }
    });
  }
}

function renderRows(list) {
  if (list.length === 0) return `<tr><td colspan="6"><div class="empty-state">No premises match the current filters.</div></td></tr>`;
  return list.map((p) => `
    <tr>
      <td class="font-semibold">${esc(p.name)}</td>
      <td>${esc(p.premises_type)}</td>
      <td>${esc(p.village || '')}${p.block ? ' / ' + esc(p.block) : ''}</td>
      <td>${esc(p.district)}</td>
      <td>${esc(p.owner_name || '\u2014')}</td>
      <td class="text-xs">${esc(SOURCE_LABELS[p.registration_source] || p.registration_source)}</td>
    </tr>`).join('');
}
