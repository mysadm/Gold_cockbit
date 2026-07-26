import { Router } from 'express';
import { createApiKeyAuthMiddleware } from '../auth.mjs';

const PUBLIC_COLUMNS = 'id, user_id, label, status, sort_order, created_at, updated_at';
const UPDATABLE_FIELDS = ['label', 'status', 'sort_order'];

function labelError(label) {
  if (!label || !label.trim()) return 'label is required';
  if (label.length > 40) return 'label must be 40 characters or fewer';
  return null;
}

export function createWatchlistRouter(db, userId) {
  const router = Router();
  router.use(createApiKeyAuthMiddleware());

  router.get('/', async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${PUBLIC_COLUMNS} FROM watchlist_items WHERE user_id = $1 ORDER BY sort_order`,
      [userId]
    );
    res.json(rows);
  });

  router.post('/', async (req, res) => {
    const { label, status, sort_order } = req.body;
    const error = labelError(label);
    if (error) return res.status(400).json({ error });

    const { rows } = await db.query(
      `INSERT INTO watchlist_items (user_id, label, status, sort_order)
       VALUES ($1, $2, $3, $4) RETURNING ${PUBLIC_COLUMNS}`,
      [userId, label, status, sort_order ?? 0]
    );
    res.status(201).json(rows[0]);
  });

  router.patch('/:id', async (req, res) => {
    if ('label' in req.body) {
      const error = labelError(req.body.label);
      if (error) return res.status(400).json({ error });
    }

    const updates = UPDATABLE_FIELDS.filter((field) => field in req.body);
    if (updates.length === 0) {
      return res.status(400).json({ error: 'no updatable fields provided' });
    }

    const setClause = updates.map((field, index) => `${field} = $${index + 1}`).join(', ');
    const values = updates.map((field) => req.body[field]);

    const { rows } = await db.query(
      `UPDATE watchlist_items SET ${setClause} WHERE id = $${updates.length + 1} AND user_id = $${updates.length + 2} RETURNING ${PUBLIC_COLUMNS}`,
      [...values, req.params.id, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Watchlist item not found' });
    res.json(rows[0]);
  });

  router.delete('/:id', async (req, res) => {
    await db.query('DELETE FROM watchlist_items WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    res.status(204).end();
  });

  return router;
}
