import { App } from '../lib/http.mts';
import { requireAuth, requireRole } from '../middleware/auth.mts';
import { UserRepo, SettingsRepo, AuditRepo } from '../repositories/adminRepo.mts';

export function registerAdminRoutes(app: App) {
  // ---------------------------------------------------------------------
  // USERS & SETTINGS ADMIN (State/Directorate Admin only)
  // ---------------------------------------------------------------------
  app.get('/api/users', requireAuth, requireRole('state_admin', 'district_officer'), (req, res) => {
    const users = UserRepo.all().map(({ password_hash, ...safe }) => safe);
    res.json({ users });
  });

  app.post('/api/users', requireAuth, requireRole('state_admin'), (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.email || !b.password || !b.role) {
      res.status(400).json({ error: 'name, email, password, role are required' });
      return;
    }
    if (UserRepo.getByEmail(b.email)) { res.status(409).json({ error: 'A user with this email already exists' }); return; }
    const user = UserRepo.create({
      name: b.name, email: b.email.toLowerCase(), password: b.password, role: b.role,
      district: b.district || null, block: b.block || null, contact: b.contact || null,
    });
    AuditRepo.log(req.user!.id, 'create', 'user', user.id, { name: b.name, email: b.email, role: b.role });
    const { password_hash, ...safe } = user;
    res.status(201).json({ user: safe });
  });

  app.get('/api/settings', requireAuth, (req, res) => {
    res.json({ settings: SettingsRepo.getAll() });
  });

  // Configure risk-scoring thresholds & lookback windows (spec §6: State Admin only).
  app.patch('/api/settings', requireAuth, requireRole('state_admin'), (req, res) => {
    const b = req.body || {};
    const allowedKeys = ['lookbackWindowDays', 'proximityRadiusKm', 'maxHops', 'pathwayWeights', 'hopDecayFactor', 'riskThresholds', 'pilotDistricts'];
    for (const key of Object.keys(b)) {
      if (allowedKeys.includes(key)) SettingsRepo.set(key as any, b[key], req.user!.id);
    }
    AuditRepo.log(req.user!.id, 'update', 'settings', null, b);
    res.json({ settings: SettingsRepo.getAll() });
  });

  // ---------------------------------------------------------------------
  // AUDIT LOG viewer (state admin oversight)
  // ---------------------------------------------------------------------
  app.get('/api/audit-log', requireAuth, requireRole('state_admin', 'district_officer'), (req, res) => {
    res.json({ entries: AuditRepo.recent(300) });
  });
}
