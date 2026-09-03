import { getUser, clearSession } from './lib/api.js';
import { esc } from './lib/dom.js';
import { navigate, currentPath } from './router.js';

const NAV_ITEMS = [
  { section: 'Command' },
  { path: '/dashboard', label: '\uD83D\uDCCA Command Dashboard', roles: null },
  { path: '/cases/new', label: '\uD83D\uDEA8 Report / Register Case', roles: null },
  { section: 'Registry & Field Ops' },
  { path: '/premises', label: '\uD83C\uDFE1 Farm / Premises Registry', roles: null },
  { path: '/tasks', label: '\u2705 Task Board', roles: null },
  { path: '/compensation', label: '\uD83D\uDCB0 Compensation Tracker', roles: null },
  { section: 'Field Officer (Mobile)' },
  { path: '/my-tasks', label: '\uD83D\uDCF1 My Tasks', roles: ['field_officer', 'district_officer', 'state_admin'] },
  { path: '/quick-case', label: '\u26A1 Quick Case Report', roles: ['field_officer', 'district_officer', 'state_admin'] },
  { path: '/quick-movement', label: '\uD83D\uDE9A Quick Movement Log', roles: ['field_officer', 'district_officer', 'state_admin'] },
  { section: 'Admin' },
  { path: '/admin', label: '\u2699\uFE0F Users & Settings', roles: ['state_admin', 'district_officer'] },
  { path: '/audit-log', label: '\uD83D\uDCDC Audit Log', roles: ['state_admin', 'district_officer'] },
];

const ROLE_LABELS = {
  field_officer: 'Field Veterinary Officer',
  district_officer: 'District AH Officer',
  state_admin: 'State/Directorate Admin',
  policymaker: 'Policymaker (Read-only)',
};

export function renderShell(contentHtml) {
  const user = getUser();
  const path = currentPath();

  const navHtml = NAV_ITEMS.map((item) => {
    if (item.section) return `<div class="nav-section-label">${esc(item.section)}</div>`;
    if (item.roles && user && !item.roles.includes(user.role)) return '';
    const isActive = path === item.path || path.startsWith(item.path + '/');
    return `<a href="#${item.path}" class="nav-link${isActive ? ' active' : ''}">${item.label}</a>`;
  }).join('');

  return `
    <div class="app-shell">
      <nav class="app-nav">
        <div class="brand">
          <div class="brand-title">\uD83D\uDC16 Assam Livestock<br/>Biosecurity Platform</div>
          <div class="brand-sub">ASF Contact-Tracing Pilot &middot; Phase 1</div>
        </div>
        ${navHtml}
        <div class="nav-footer">
          <div class="text-muted">Animal Husbandry &amp; Vet. Dept.<br/>Government of Assam</div>
        </div>
      </nav>
      <div class="app-main">
        <div class="app-topbar">
          <div class="font-semibold">Assam Livestock Biosecurity &amp; Disease Contact-Tracing Platform</div>
          <div class="flex items-center gap-2">
            ${user ? `
              <div class="text-right">
                <div class="font-semibold text-sm">${esc(user.name)}</div>
                <div class="text-xs text-muted">${esc(ROLE_LABELS[user.role] || user.role)}${user.district ? ' &middot; ' + esc(user.district) : ''}</div>
              </div>
              <div class="avatar">${esc((user.name || '?').split(' ').map((s) => s[0]).slice(0, 2).join(''))}</div>
              <button class="btn btn-secondary btn-sm" id="logout-btn">Log out</button>
            ` : ''}
          </div>
        </div>
        <div class="app-content" id="app-content">${contentHtml}</div>
      </div>
    </div>`;
}

export function attachShellHandlers() {
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      clearSession();
      navigate('/login');
      window.location.reload();
    });
  }
}
