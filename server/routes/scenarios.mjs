import { Router } from 'express';
import { createApiKeyAuthMiddleware } from '../auth.mjs';

const PUBLIC_COLUMNS = 'id, user_id, name, band_low, band_high, weight_pct, probability_pct, sort_order, created_at, updated_at';
const UPDATABLE_FIELDS = ['name', 'band_low', 'band_high', 'weight_pct', 'probability_pct', 'sort_order'];

export function createScenariosRouter(db, userId) {
  const router = Router();
  router.use(createApiKeyAuthMiddleware());

  router.get('/', async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${PUBLIC_COLUMNS} FROM scenarios WHERE user_id = $1 ORDER BY sort_order`,
      [userId]
    );
    res.json(rows);
  });

  router.patch('/:id', async (req, res) => {
    const updates = UPDATABLE_FIELDS.filter((field) => field in req.body);
    if (updates.length === 0) {
      return res.status(400).json({ error: 'no updatable fields provided' });
    }

    const setClause = updates.map((field, index) => `${field} = $${index + 1}`).join(', ');
    const values = updates.map((field) => req.body[field]);

    try {
      const { rows } = await db.query(
        `UPDATE scenarios SET ${setClause} WHERE id = $${updates.length + 1} AND user_id = $${updates.length + 2} RETURNING ${PUBLIC_COLUMNS}`,
        [...values, req.params.id, userId]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Scenario not found' });
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23514') return res.status(400).json({ error: err.message });
      throw err;
    }
  });

  return router;
}
