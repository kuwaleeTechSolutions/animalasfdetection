import { api, setSession } from '../lib/api.js';
import { el, esc } from '../lib/dom.js';
import { navigate } from '../router.js';

// [INTEGRATION POINT: Assam SSO / State Data Centre auth]
// This screen posts email+password to /api/auth/login (local hash check, see
// backend/src/lib/auth.mts). In production, replace this form with a redirect to the
// State SSO provider's login page, and handle its callback/token instead.

export function renderLogin() {
  const root = el('root');
  root.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="brand-title">\uD83D\uDC16 Assam Livestock Biosecurity Platform</div>
        <div class="brand-sub">African Swine Fever Contact-Tracing Pilot &middot; Animal Husbandry &amp; Veterinary Dept., Govt. of Assam</div>
        <form id="login-form">
          <div class="field">
            <label>Email</label>
            <input type="email" name="email" required placeholder="name@ahvet.assam.gov.in" value="state.admin@ahvet.assam.gov.in" />
          </div>
          <div class="field">
            <label>Password</label>
            <input type="password" name="password" required placeholder="Password" value="password123" />
          </div>
          <div id="login-error" class="form-error hidden"></div>
          <button type="submit" class="btn btn-block mt-2">Sign in</button>
        </form>
        <div class="demo-creds">
          <strong>Demo accounts</strong> (all passwords <code>password123</code>):<br/>
          State Admin: <code>state.admin@ahvet.assam.gov.in</code><br/>
          District Officer: <code>do.dibrugarh@ahvet.assam.gov.in</code><br/>
          Field Officer: <code>fo1.dibrugarh@ahvet.assam.gov.in</code><br/>
          Policymaker (read-only): <code>secretary@ahvet.assam.gov.in</code>
        </div>
      </div>
    </div>`;

  const form = el('login-form');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const formData = new FormData(form);
    const email = formData.get('email');
    const password = formData.get('password');
    const errorEl = el('login-error');
    errorEl.classList.add('hidden');
    try {
      const { token, user } = await api.post('/api/auth/login', { email, password });
      setSession(token, user);
      navigate('/dashboard');
      window.location.reload();
    } catch (err) {
      errorEl.textContent = err.message || 'Login failed';
      errorEl.classList.remove('hidden');
    }
  });
}
