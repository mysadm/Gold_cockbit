import { Router } from 'express';
import { createApiKeyAuthMiddleware } from '../auth.mjs';

const PUBLIC_COLUMNS = 'id, user_id, tranche_number, plan_pct, amount_egp, gram_equivalent, status, purchased_at, created_at, updated_at';
const UPDATABLE_FIELDS = ['status', 'amount_egp', 'gram_equivalent', 'purchased_at'];

export function createTranchesRouter(db, userId) {
  const router = Router();
  router.use(createApiKeyAuthMiddleware());

  router.get('/', async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${PUBLIC_COLUMNS} FROM tranches WHERE user_id = $1 ORDER BY tranche_number`,
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
        `UPDATE tranches SET ${setClause} WHERE id = $${updates.length + 1} AND user_id = $${updates.length + 2} RETURNING ${PUBLIC_COLUMNS}`,
        [...values, req.params.id, userId]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Tranche not found' });
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23514') return res.status(400).json({ error: err.message });
      throw err;
    }
  });

  return router;
}
