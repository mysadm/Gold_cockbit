import { Router } from 'express';

export function createLlmProvidersRouter(db, userId) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { rows } = await db.query(
      'SELECT * FROM llm_providers WHERE user_id = $1 ORDER BY created_at',
      [userId]
    );
    res.json(rows);
  });

  router.post('/', async (req, res) => {
    const { provider_type, label, base_url, api_key, model } = req.body;
    const { rows } = await db.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, base_url, api_key, model)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, provider_type, label, base_url ?? null, api_key ?? null, model]
    );
    res.status(201).json(rows[0]);
  });

  router.put('/:id', async (req, res) => {
    const { provider_type, label, base_url, api_key, model } = req.body;
    const { rows } = await db.query(
      `UPDATE llm_providers
       SET provider_type = $1, label = $2, base_url = $3, api_key = $4, model = $5
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [provider_type, label, base_url ?? null, api_key ?? null, model, req.params.id, userId]
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
      'UPDATE llm_providers SET is_active = true WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Provider not found' });
    res.json(rows[0]);
  });

  return router;
}
