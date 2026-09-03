// =====================================================================================
// Auth primitives: password hashing + signed session tokens.
//
// [DECIDE] No `bcrypt`/`jsonwebtoken` packages are available (offline sandbox / no
// registry access). We use Node's built-in `node:crypto` scrypt (a memory-hard KDF,
// equivalent security class to bcrypt) for password hashing, and a minimal
// HMAC-SHA256-signed JSON token (same structure/claims as a JWT: header.payload.sig,
// base64url-encoded) for sessions. This keeps the pilot at ZERO external dependencies.
// Swapping to `jsonwebtoken`/`bcrypt` in production is a drop-in change since only this
// file touches token/hash mechanics.
//
// [INTEGRATION POINT: Assam SSO / State Data Centre auth]
// In production, replace `login()` below with a redirect to the State SSO provider and
// verify its assertion/token here instead of checking a local password hash.
// =====================================================================================
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'assam-biosecurity-pilot-dev-secret-CHANGE-IN-PROD';
const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12h session for field officers

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, 64);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export interface SessionClaims {
  sub: string; // user id
  role: string;
  district: string | null;
  name: string;
  iat: number;
  exp: number;
}

export function signToken(claims: Omit<SessionClaims, 'iat' | 'exp'>): string {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_TTL_SECONDS;
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: SessionClaims = { ...claims, iat, exp };
  const headerPart = base64url(JSON.stringify(header));
  const payloadPart = base64url(JSON.stringify(payload));
  const sig = createHmac('sha256', TOKEN_SECRET).update(`${headerPart}.${payloadPart}`).digest('base64url');
  return `${headerPart}.${payloadPart}.${sig}`;
}

export function verifyToken(token: string): SessionClaims | null {
  try {
    const [headerPart, payloadPart, sig] = token.split('.');
    const expectedSig = createHmac('sha256', TOKEN_SECRET).update(`${headerPart}.${payloadPart}`).digest('base64url');
    if (sig !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf-8')) as SessionClaims;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
