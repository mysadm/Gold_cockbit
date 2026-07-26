import { Router } from 'express';
import { createApiKeyAuthMiddleware } from '../auth.mjs';
import { runProviderAnalysis } from '../providers/dispatch.mjs';

const PUBLIC_COLUMNS = 'id, user_id, provider_type, label, base_url, model, is_active, created_at, updated_at';
const TEST_PROMPT = 'Reply with only the single word: OK';

function validationError(label, model) {
  if (!label || !label.trim()) return 'label is required';
  if (!model || !model.trim()) return 'model is required';
  return null;
}

export function createLlmProvidersRouter(db, userId) {
  const router = Router();
  router.use(createApiKeyAuthMiddleware());

  router.get('/', async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${PUBLIC_COLUMNS} FROM llm_providers WHERE user_id = $1 ORDER BY created_at`,
      [userId]
    );
    res.json(rows);
  });

  router.post('/', async (req, res) => {
    const { provider_type, label, base_url, api_key, model } = req.body;
    const error = validationError(label, model);
    if (error) return res.status(400).json({ error });
    const { rows } = await db.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, base_url, api_key, model)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${PUBLIC_COLUMNS}`,
      [userId, provider_type, label, base_url ?? null, api_key ?? null, model]
    );
    res.status(201).json(rows[0]);
  });

  router.post('/test', async (req, res) => {
    const { provider_type, base_url, api_key, model } = req.body;
    try {
      const result = await runProviderAnalysis({ provider_type, base_url, api_key, model }, TEST_PROMPT);
      res.json({ text: result.text });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  router.put('/:id', async (req, res) => {
    const { provider_type, label, base_url, api_key, model } = req.body;
    const error = validationError(label, model);
    if (error) return res.status(400).json({ error });
    const { rows } = await db.query(
      `UPDATE llm_providers
       SET provider_type = $1, label = $2, base_url = $3,
           api_key = COALESCE(NULLIF($4, ''), api_key),
           model = $5
       WHERE id = $6 AND user_id = $7
       RETURNING ${PUBLIC_COLUMNS}`,
      [provider_type, label, base_url ?? null, api_key ?? '', model, req.params.id, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
    res.json(rows[0]);
  });

  router.delete('/:id', async (req, res) => {
    await db.query('DELETE FROM llm_providers WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    res.status(204).end();
  });

  router.post('/:id/activate', async (req, res) => {
    await db.query('UPDATE llm_providers SET is_active = false WHERE user_id = $1', [userId]);
    const { rows } = await db.query(
      `UPDATE llm_providers SET is_active = true WHERE id = $1 AND user_id = $2 RETURNING ${PUBLIC_COLUMNS}`,
      [req.params.id, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
    res.json(rows[0]);
  });

  return router;
}
