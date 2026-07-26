import { Router } from 'express';
import { createApiKeyAuthMiddleware } from '../auth.mjs';

const PUBLIC_COLUMNS = 'id, user_id, rule_type, config, active, created_at, updated_at';
const UPDATABLE_FIELDS = ['rule_type', 'config', 'active'];
const VALID_RULE_TYPES = ['band_edge', 'egp_move', 'tranche_window'];

function ruleValidationError(ruleType, config) {
  if (!VALID_RULE_TYPES.includes(ruleType)) return 'rule_type must be one of band_edge, egp_move, tranche_window';
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return 'config is required and must be an object';
  return null;
}

export function createAlertRulesRouter(db, userId) {
  const router = Router();
  router.use(createApiKeyAuthMiddleware());

  router.get('/', async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${PUBLIC_COLUMNS} FROM alert_rules WHERE user_id = $1 ORDER BY created_at`,
      [userId]
    );
    res.json(rows);
  });

  router.post('/', async (req, res) => {
    const { rule_type, config } = req.body;
    const error = ruleValidationError(rule_type, config);
    if (error) return res.status(400).json({ error });

    const { rows } = await db.query(
      `INSERT INTO alert_rules (user_id, rule_type, config) VALUES ($1, $2, $3) RETURNING ${PUBLIC_COLUMNS}`,
      [userId, rule_type, config]
    );
    res.status(201).json(rows[0]);
  });

  router.patch('/:id', async (req, res) => {
    if ('rule_type' in req.body && !VALID_RULE_TYPES.includes(req.body.rule_type)) {
      return res.status(400).json({ error: 'rule_type must be one of band_edge, egp_move, tranche_window' });
    }

    const updates = UPDATABLE_FIELDS.filter((field) => field in req.body);
    if (updates.length === 0) {
      return res.status(400).json({ error: 'no updatable fields provided' });
    }

    const setClause = updates.map((field, index) => `${field} = $${index + 1}`).join(', ');
    const values = updates.map((field) => (field === 'config' ? JSON.stringify(req.body[field]) : req.body[field]));

    const { rows } = await db.query(
      `UPDATE alert_rules SET ${setClause} WHERE id = $${updates.length + 1} AND user_id = $${updates.length + 2} RETURNING ${PUBLIC_COLUMNS}`,
      [...values, req.params.id, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Alert rule not found' });
    res.json(rows[0]);
  });

  router.delete('/:id', async (req, res) => {
    await db.query('DELETE FROM alert_rules WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    res.status(204).end();
  });

  return router;
}
