import { route, onRouteChange, dispatch, currentPath, navigate } from './router.js';
import { getToken } from './lib/api.js';
import { renderLogin } from './pages/login.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderCaseRegistration } from './pages/caseRegistration.js';
import { renderContactTrace } from './pages/contactTrace.js';
import { renderPremisesRegistry } from './pages/premisesRegistry.js';
import { renderTaskBoard } from './pages/taskBoard.js';
import { renderCompensation } from './pages/compensation.js';
import { renderMyTasks } from './pages/myTasks.js';
import { renderTaskDetail } from './pages/taskDetail.js';
import { renderQuickCaseReport } from './pages/quickCaseReport.js';
import { renderQuickMovementLog } from './pages/quickMovementLog.js';
import { renderAdminSettings } from './pages/adminSettings.js';
import { renderAuditLog } from './pages/auditLog.js';

function requireSession(renderFn) {
  return (params) => {
    if (!getToken()) { navigate('/login'); renderLogin(); return; }
    renderFn(params);
  };
}

route('/login', () => renderLogin());
route('/dashboard', requireSession(renderDashboard));
route('/cases/new', requireSession(renderCaseRegistration));
route('/cases/:id/contacts', requireSession(renderContactTrace));
route('/premises', requireSession(renderPremisesRegistry));
route('/tasks', requireSession(renderTaskBoard));
route('/tasks/:id', requireSession(renderTaskDetail));
route('/compensation', requireSession(renderCompensation));
route('/my-tasks', requireSession(renderMyTasks));
route('/quick-case', requireSession(renderQuickCaseReport));
route('/quick-movement', requireSession(renderQuickMovementLog));
route('/admin', requireSession(renderAdminSettings));
route('/audit-log', requireSession(renderAuditLog));
route('/', () => {
  navigate(getToken() ? '/dashboard' : '/login');
});

onRouteChange(() => {});

// Initial dispatch
if (!window.location.hash) {
  navigate(getToken() ? '/dashboard' : '/login');
}
dispatch();
