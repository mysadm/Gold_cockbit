import { Router } from 'express';
import { hashPassword, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '../auth/password.mjs';
import { deleteSessionsForUser } from '../auth/sessions.mjs';
import { provisionUserDefaults } from '../provisionUserDefaults.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_COLUMNS = 'id, email, display_name, role, status, daily_ai_limit, created_at';

export function createAdminUsersRouter(db) {
  const router = Router();

  router.get('/users', async (req, res) => {
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.display_name, u.role, u.status, u.daily_ai_limit, u.created_at,
              COALESCE(a.call_count, 0)::int AS ai_used_today
         FROM users u
         LEFT JOIN ai_shared_usage a ON a.user_id = u.id AND a.used_on = CURRENT_DATE
        ORDER BY (u.status = 'pending') DESC, u.created_at`
    );
    res.json(rows);
  });

  router.param('id', (req, res, next, id) => {
    if (!UUID_RE.test(id)) return res.status(404).json({ error: 'User not found' });
    next();
  });

  async function transition(req, res, { from, to, before }) {
    const { rows } = await db.query('SELECT status FROM users WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (rows[0].status !== from) return res.status(409).json({ error: `User is ${rows[0].status}, not ${from}` });
    if (before) await before();
    // The status predicate makes the change atomic: a concurrent request that already
    // moved this user leaves 0 rows here, so the loser gets a 409 instead of a false success.
    const updated = await db.query(
      `UPDATE users SET status = $1 WHERE id = $2 AND status = $3 RETURNING ${PUBLIC_COLUMNS}`,
      [to, req.params.id, from]
    );
    if (updated.rows.length === 0) return res.status(409).json({ error: 'User was changed by another request' });
    res.json(updated.rows[0]);
  }

  // provisionUserDefaults is check-then-insert, so two overlapping approvals of one user
  // would both insert (duplicate rows or a primary-key 500). Let only one run at a time.
  const approving = new Set();
  router.post('/users/:id/approve', async (req, res) => {
    const id = req.params.id;
    if (approving.has(id)) return res.status(409).json({ error: 'User is already being approved' });
    approving.add(id);
    try {
      await transition(req, res, { from: 'pending', to: 'active', before: () => provisionUserDefaults(db, id) });
    } finally {
      approving.delete(id);
    }
  });

  router.post('/users/:id/enable', (req, res) => transition(req, res, { from: 'disabled', to: 'active' }));

  router.post('/users/:id/disable', async (req, res) => {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot disable your own account' });
    const { rows } = await db.query('SELECT status FROM users WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    // Only active users can be disabled: disabling a pending user would let enable
    // activate them without ever provisioning their defaults.
    if (rows[0].status !== 'active') return res.status(409).json({ error: `User is ${rows[0].status}, not active` });
    const updated = await db.query(
      `UPDATE users SET status = 'disabled' WHERE id = $1 AND status = 'active' RETURNING ${PUBLIC_COLUMNS}`,
      [req.params.id]
    );
    if (updated.rows.length === 0) return res.status(409).json({ error: 'User was changed by another request' });
    await deleteSessionsForUser(db, req.params.id);
    res.json(updated.rows[0]);
  });

  router.patch('/users/:id', async (req, res) => {
    const limit = req.body?.daily_ai_limit;
    if (!Number.isInteger(limit) || limit < 0 || limit > 1000) {
      return res.status(400).json({ error: 'daily_ai_limit must be a whole number from 0 to 1000' });
    }
    const { rows } = await db.query(
      `UPDATE users SET daily_ai_limit = $1 WHERE id = $2 RETURNING ${PUBLIC_COLUMNS}`,
      [limit, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  });

  router.post('/users/:id/reset-password', async (req, res) => {
    const password = req.body?.password;
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters` });
    }
    const { rows } = await db.query(
      `UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id`,
      [await hashPassword(password), req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    await deleteSessionsForUser(db, req.params.id);
    res.json({ ok: true });
  });

  return router;
}
