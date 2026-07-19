import { Router } from 'express';
import { runProviderAnalysis } from '../providers/dispatch.mjs';

export function createAnalyzeRouter(db, userId) {
  const router = Router();

  router.post('/', async (req, res) => {
    const { prompt } = req.body;
    const { rows } = await db.query(
      'SELECT * FROM llm_providers WHERE user_id = $1 AND is_active = true',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No active provider configured' });
    }

    try {
      const result = await runProviderAnalysis(rows[0], prompt);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}
