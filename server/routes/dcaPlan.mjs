import { Router } from 'express';
import { createApiKeyAuthMiddleware } from '../auth.mjs';

const PUBLIC_COLUMNS =
  "user_id, to_char(start_date, 'YYYY-MM-DD') AS start_date, total_investment_egp, tranche_pcts, spacing_months, mode, created_at, updated_at";
const UPDATABLE_FIELDS = ['start_date', 'total_investment_egp', 'tranche_pcts', 'spacing_months', 'mode'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SUM_TOLERANCE = 0.01;

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
  if (field === 'tranche_pcts') {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      value.some((v) => typeof v !== 'number' || Number.isNaN(v) || v <= 0)
    ) {
      return 'tranche_pcts must be a non-empty array of positive numbers';
    }
  }
  if (field === 'spacing_months') {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      return 'spacing_months must be a positive integer';
    }
  }
  if (field === 'mode') {
    if (value !== 'fixed' && value !== 'recurring') {
      return 'mode must be fixed or recurring';
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

    if ('tranche_pcts' in req.body || 'mode' in req.body) {
      const { rows: existingRows } = await db.query('SELECT tranche_pcts, mode FROM dca_plan WHERE user_id = $1', [userId]);
      if (existingRows.length === 0) return res.status(404).json({ error: 'DCA plan not found' });

      const effectiveMode = 'mode' in req.body ? req.body.mode : existingRows[0].mode;
      const effectiveTranchePcts = 'tranche_pcts' in req.body ? req.body.tranche_pcts : existingRows[0].tranche_pcts.map(Number);

      if (effectiveMode === 'fixed') {
        const sum = effectiveTranchePcts.reduce((total, pct) => total + pct, 0);
        if (Math.abs(sum - 100) > SUM_TOLERANCE) {
          return res.status(400).json({ error: 'tranche_pcts must sum to 100 in fixed mode' });
        }
      }
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
