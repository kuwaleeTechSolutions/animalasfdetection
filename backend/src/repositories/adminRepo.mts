import { run, get, all, nowIso } from './dbHelpers.mts';
import { newId } from '../lib/ids.mts';
import { hashPassword } from '../lib/auth.mts';

// ---------------------------------------------------------------------------
// USERS
// ---------------------------------------------------------------------------
export interface User {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: 'field_officer' | 'district_officer' | 'state_admin' | 'policymaker';
  district: string | null;
  block: string | null;
  contact: string | null;
  is_active: number;
  created_at: string;
}

export const UserRepo = {
  create(data: { name: string; email: string; password: string; role: User['role']; district?: string | null; block?: string | null; contact?: string | null; }): User {
    const id = newId('user');
    const ts = nowIso();
    run(
      `INSERT INTO users (id,name,email,password_hash,role,district,block,contact,is_active,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)`,
      [id, data.name, data.email, hashPassword(data.password), data.role, data.district || null, data.block || null, data.contact || null, ts]
    );
    return this.getById(id)!;
  },
  getById(id: string): User | undefined { return get<User>('SELECT * FROM users WHERE id = ?', [id]); },
  getByEmail(email: string): User | undefined { return get<User>('SELECT * FROM users WHERE email = ?', [email]); },
  all(): User[] { return all<User>('SELECT * FROM users ORDER BY created_at ASC'); },
  byRole(role: User['role']): User[] { return all<User>('SELECT * FROM users WHERE role = ?', [role]); },
  fieldOfficersInDistrict(district: string): User[] {
    return all<User>("SELECT * FROM users WHERE role = 'field_officer' AND district = ? AND is_active = 1", [district]);
  },
};

// ---------------------------------------------------------------------------
// AUDIT LOG
// ---------------------------------------------------------------------------
export interface AuditLogEntry {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  timestamp: string;
  details_json: string | null;
}

export const AuditRepo = {
  log(userId: string | null, action: string, entityType: string, entityId: string | null, details?: any) {
    const id = newId('audit');
    run(
      'INSERT INTO audit_logs (id,user_id,action,entity_type,entity_id,timestamp,details_json) VALUES (?,?,?,?,?,?,?)',
      [id, userId, action, entityType, entityId, nowIso(), details ? JSON.stringify(details) : null]
    );
  },
  recent(limit = 200): AuditLogEntry[] {
    return all<AuditLogEntry>('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?', [limit]);
  },
  forEntity(entityType: string, entityId: string): AuditLogEntry[] {
    return all<AuditLogEntry>('SELECT * FROM audit_logs WHERE entity_type = ? AND entity_id = ? ORDER BY timestamp DESC', [entityType, entityId]);
  },
};

// ---------------------------------------------------------------------------
// SETTINGS (configurable thresholds -- see services/riskScoring.mts and contactTracing.mts)
// ---------------------------------------------------------------------------
export interface PlatformSettings {
  lookbackWindowDays: number;
  proximityRadiusKm: number;
  maxHops: number;
  pathwayWeights: Record<string, number>;
  hopDecayFactor: number;
  riskThresholds: { high: number; medium: number };
  pilotDistricts: string[];
}

const DEFAULT_SETTINGS: PlatformSettings = {
  lookbackWindowDays: 21,       // [DECIDE] default contact-tracing lookback window
  proximityRadiusKm: 2,         // [DECIDE] default "nearby farm" radius
  maxHops: 2,                   // [DECIDE] default BFS hop depth
  pathwayWeights: {
    animal_movement: 10,
    previous_farm: 10,
    destination_farm: 10,
    transport_vehicle: 6,
    market: 6,
    veterinary_visit: 3,
    nearby_farm: 2,
  },
  hopDecayFactor: 0.5,           // weight multiplier applied per extra hop beyond 1
  riskThresholds: { high: 10, medium: 5 },
  pilotDistricts: ['Dibrugarh', 'Tinsukia', 'Charaideo'], // [DECIDE] Phase-1 pilot districts, configurable not hardcoded
};

export const SettingsRepo = {
  ensureDefaults() {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      const existing = get('SELECT key FROM settings WHERE key = ?', [key]);
      if (!existing) {
        run('INSERT INTO settings (key, value, description, updated_at) VALUES (?,?,?,?)',
          [key, JSON.stringify(value), `Default seeded setting for ${key}`, nowIso()]);
      }
    }
  },
  getAll(): PlatformSettings {
    const rows = all<{ key: string; value: string }>('SELECT key, value FROM settings');
    const map: any = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      try { map[row.key] = JSON.parse(row.value); } catch { /* ignore malformed */ }
    }
    return map as PlatformSettings;
  },
  set(key: keyof PlatformSettings, value: any, updatedBy?: string) {
    const existing = get('SELECT key FROM settings WHERE key = ?', [key]);
    if (existing) {
      run('UPDATE settings SET value=?, updated_by=?, updated_at=? WHERE key=?', [JSON.stringify(value), updatedBy || null, nowIso(), key]);
    } else {
      run('INSERT INTO settings (key,value,description,updated_by,updated_at) VALUES (?,?,?,?,?)',
        [key, JSON.stringify(value), '', updatedBy || null, nowIso()]);
    }
  },
};
