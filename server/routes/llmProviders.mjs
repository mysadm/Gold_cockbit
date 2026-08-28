import { Router } from 'express';
import { createApiKeyAuthMiddleware } from '../auth.mjs';
import { runProviderAnalysis } from '../providers/dispatch.mjs';
import { withTransactionClient } from '../withTransactionClient.mjs';

const PUBLIC_COLUMNS = 'id, user_id, provider_type, label, base_url, model, settings, is_active, created_at, updated_at';
const TEST_PROMPT = 'Reply with only the single word: OK';
// Mirrors the llm_providers_provider_type_check DB constraint — validated
// here so an unrecognized provider_type (e.g. a raw ai-settings-ui catalog
// id like 'gemini' that wasn't mapped to 'custom') returns a clear 400
// instead of an opaque 500 from the DB check-constraint violation.
const VALID_PROVIDER_TYPES = new Set(['ollama', 'openai', 'claude', 'custom', 'shared', 'openrouter']);

function validationError(provider_type, label, model) {
  if (!VALID_PROVIDER_TYPES.has(provider_type)) return 'provider_type is invalid';
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
    const { provider_type, label, base_url, api_key, model, settings } = req.body;
    const error = validationError(provider_type, label, model);
    if (error) return res.status(400).json({ error });
    const { rows } = await db.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, base_url, api_key, model, settings)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${PUBLIC_COLUMNS}`,
      [userId, provider_type, label, base_url ?? null, api_key ?? null, model, JSON.stringify(settings ?? {})]
    );
    res.status(201).json(rows[0]);
  });

  router.post('/test', async (req, res) => {
    const { provider_type, base_url, api_key, model, settings } = req.body;
    try {
      const result = await runProviderAnalysis({ provider_type, base_url, api_key, model, settings }, TEST_PROMPT, { expectJson: false, system: null });
      res.json({ text: result.text });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  router.put('/:id', async (req, res) => {
    const { provider_type, label, base_url, api_key, model, settings } = req.body;
    const error = validationError(provider_type, label, model);
    if (error) return res.status(400).json({ error });
    const { rows } = await db.query(
      `UPDATE llm_providers
       SET provider_type = $1, label = $2, base_url = $3,
           api_key = COALESCE(NULLIF($4, ''), api_key),
           model = $5, settings = $6
       WHERE id = $7 AND user_id = $8
       RETURNING ${PUBLIC_COLUMNS}`,
      [provider_type, label, base_url ?? null, api_key ?? '', model, JSON.stringify(settings ?? {}), req.params.id, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
    res.json(rows[0]);
  });

  router.delete('/:id', async (req, res) => {
    await db.query('DELETE FROM llm_providers WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    res.status(204).end();
  });

  router.post('/:id/test', async (req, res) => {
    const { rows } = await db.query(
      'SELECT provider_type, base_url, api_key, model, settings FROM llm_providers WHERE id = $1 AND user_id = $2',
      [req.params.id, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
    try {
      const result = await runProviderAnalysis(rows[0], TEST_PROMPT, { expectJson: false, system: null });
      res.json({ text: result.text });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  router.post('/:id/activate', async (req, res) => {
    // Deactivating every provider and then activating the target is two
    // statements — run them inside a transaction so a failure partway
    // through (bad id, DB error) can't leave the user with zero active
    // providers, which two plain sequential db.query calls would risk.
    let notFound = false;
    const row = await withTransactionClient(db, async (client) => {
      const { rows: target } = await client.query(
        'SELECT id FROM llm_providers WHERE id = $1 AND user_id = $2',
        [req.params.id, userId]
      );
      if (target.length === 0) {
        notFound = true;
        return null;
      }
      await client.query('UPDATE llm_providers SET is_active = false WHERE user_id = $1', [userId]);
      const { rows } = await client.query(
        `UPDATE llm_providers SET is_active = true WHERE id = $1 AND user_id = $2 RETURNING ${PUBLIC_COLUMNS}`,
        [req.params.id, userId]
      );
      return rows[0];
    });
    if (notFound) return res.status(404).json({ error: 'Provider not found' });
    res.json(row);
  });

  return router;
}
