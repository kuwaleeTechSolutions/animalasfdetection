import type { Req, Res, Handler } from '../lib/http.mts';
import { verifyToken } from '../lib/auth.mts';
import { UserRepo } from '../repositories/adminRepo.mts';

/** Populates req.user from the Bearer token, if present. Does not reject unauthenticated requests
 *  by itself -- use `requireAuth` / `requireRole` on specific routes for that. */
export const attachUser: Handler = (req, res, next) => {
  const header = req.headers['authorization'];
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length);
    const claims = verifyToken(token);
    if (claims) {
      const user = UserRepo.getById(claims.sub);
      if (user && user.is_active) {
        req.user = { id: user.id, role: user.role, district: user.district, name: user.name };
      }
    }
  }
  next();
};

export const requireAuth: Handler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
};

export function requireRole(...roles: string[]): Handler {
  return (req, res, next) => {
    if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: `Forbidden: requires role in [${roles.join(', ')}]`, yourRole: req.user.role });
      return;
    }
    next();
  };
}

/** Read-only enforcement: policymaker role is blocked from any write route.
 *  Apply this alongside requireAuth on POST/PUT/PATCH/DELETE routes. */
export const blockReadOnly: Handler = (req, res, next) => {
  if (req.user?.role === 'policymaker') {
    res.status(403).json({ error: 'Read-only role cannot perform write actions' });
    return;
  }
  next();
};
