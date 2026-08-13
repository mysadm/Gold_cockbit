import { Router } from 'express';
import { createApiKeyAuthMiddleware } from '../auth.mjs';

const PUBLIC_COLUMNS = "user_id, to_char(start_date, 'YYYY-MM-DD') AS start_date, total_investment_egp, created_at, updated_at";
const UPDATABLE_FIELDS = ['start_date', 'total_investment_egp'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validationError(field, value) {
  if (field === 'start_date') {
    if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(new Date(value).getTime())) {
      return 'start_date must be a valid YYYY-MM-DD date';
    }
  }
  if (field === 'total_investment_egp') {
    if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
      return 'total_investment_egp must be a non-negative number';
    }
  }
  return null;
}

export function createDcaPlanRouter(db, userId) {
  const router = Router();
  router.use(createApiKeyAuthMiddleware());

  router.get('/', async (req, res) => {
    const { rows } = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM dca_plan WHERE user_id = $1`, [userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'DCA plan not found' });
    res.json(rows[0]);
  });

  router.patch('/', async (req, res) => {
    const updates = UPDATABLE_FIELDS.filter((field) => field in req.body);
    if (updates.length === 0) {
      return res.status(400).json({ error: 'no updatable fields provided' });
    }

    for (const field of updates) {
      const error = validationError(field, req.body[field]);
      if (error) return res.status(400).json({ error });
    }

    const setClause = updates.map((field, index) => `${field} = $${index + 1}`).join(', ');
    const values = updates.map((field) => req.body[field]);

    const { rows } = await db.query(
      `UPDATE dca_plan SET ${setClause} WHERE user_id = $${updates.length + 1} RETURNING ${PUBLIC_COLUMNS}`,
      [...values, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'DCA plan not found' });
    res.json(rows[0]);
  });

  return router;
}
