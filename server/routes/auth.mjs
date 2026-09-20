import { Router } from 'express';
import { hashPassword, verifyPassword, burnPasswordTime, MIN_PASSWORD_LENGTH } from '../auth/password.mjs';
import {
  createSession, deleteSession, deleteExpiredSessions,
  sessionCookie, clearedSessionCookie, isSecureRequest,
} from '../auth/sessions.mjs';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

export async function loadMe(db, userId) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.display_name, u.role, u.daily_ai_limit,
            COALESCE(a.call_count, 0)::int AS ai_used_today
       FROM users u
       LEFT JOIN ai_shared_usage a ON a.user_id = u.id AND a.used_on = CURRENT_DATE
      WHERE u.id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

export function createAuthRouter(db, { requireAuth, rateLimit }) {
  const router = Router();

  router.post('/register', rateLimit, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    const displayName = typeof req.body?.display_name === 'string' ? req.body.display_name.trim().slice(0, 80) : '';
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    try {
      await db.query(
        `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3)`,
        [email, await hashPassword(password), displayName || null]
      );
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
      throw err;
    }
    res.status(201).json({ status: 'pending' });
  });

  router.post('/login', rateLimit, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const { rows } = await db.query('SELECT id, password_hash, status FROM users WHERE email = $1', [email]);
    const user = rows[0];
    if (!user) {
      await burnPasswordTime(password);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is waiting for admin approval', code: 'pending' });
    }
    if (user.status === 'disabled') {
      return res.status(403).json({ error: 'This account is disabled', code: 'disabled' });
    }
    await deleteExpiredSessions(db);
    const token = await createSession(db, user.id);
    res.set('Set-Cookie', sessionCookie(token, { secure: isSecureRequest(req) }));
    res.json(await loadMe(db, user.id));
  });

  router.post('/logout', requireAuth, async (req, res) => {
    await deleteSession(db, req.sessionToken);
    res.set('Set-Cookie', clearedSessionCookie({ secure: isSecureRequest(req) }));
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, async (req, res) => {
    res.json(await loadMe(db, req.user.id));
  });

  return router;
}
