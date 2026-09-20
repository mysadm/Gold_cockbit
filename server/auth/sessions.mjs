import { randomBytes, createHash } from 'node:crypto';

export const SESSION_COOKIE = 'gc_session';
export const SESSION_TTL_DAYS = 30;
const MAX_AGE_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      out[name] = part.slice(index + 1).trim();
    }
  }
  return out;
}

function cookie(value, maxAge, secure) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export const sessionCookie = (token, { secure }) => cookie(token, MAX_AGE_SECONDS, secure);
export const clearedSessionCookie = ({ secure }) => cookie('', 0, secure);

export function isSecureRequest(req) {
  return req.secure || req.get('x-forwarded-proto') === 'https';
}

export async function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [userId, hashToken(token), SESSION_TTL_DAYS]
  );
  return token;
}

export async function findActiveUserBySession(db, token) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.display_name, u.role, u.status, u.daily_ai_limit
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'`,
    [hashToken(token)]
  );
  return rows[0] ?? null;
}

export async function deleteSession(db, token) {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function deleteSessionsForUser(db, userId) {
  await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export async function deleteExpiredSessions(db) {
  await db.query('DELETE FROM sessions WHERE expires_at <= now()');
}
