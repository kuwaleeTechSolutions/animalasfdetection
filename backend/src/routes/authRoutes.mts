import { App } from '../lib/http.mts';
import { UserRepo } from '../repositories/adminRepo.mts';
import { verifyPassword, signToken } from '../lib/auth.mts';
import { AuditRepo } from '../repositories/adminRepo.mts';
import { requireAuth } from '../middleware/auth.mts';

// [INTEGRATION POINT: Assam SSO / State Data Centre auth]
// Replace this password-based login with a redirect to the State SSO provider,
// verifying its token/assertion instead of a local password hash, once credentials
// are available. Everything downstream (JWT-like session, RBAC middleware) stays the same.
export function registerAuthRoutes(app: App) {
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) { res.status(400).json({ error: 'email and password are required' }); return; }
    const user = UserRepo.getByEmail(String(email).toLowerCase());
    if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const token = signToken({ sub: user.id, role: user.role, district: user.district, name: user.name });
    AuditRepo.log(user.id, 'login', 'user', user.id, {});
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, district: user.district, block: user.block },
    });
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });
}
