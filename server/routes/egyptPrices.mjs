import { Router } from 'express';
import { createApiKeyAuthMiddleware } from '../auth.mjs';
import { fetchEgyptGoldPrices } from '../isaghaPrices.mjs';

export function createEgyptPricesRouter(db) {
  const router = Router();
  router.use(createApiKeyAuthMiddleware());

  router.get('/', async (req, res) => {
    try {
      const snapshot = await fetchEgyptGoldPrices();
      await db.query(
        `INSERT INTO egypt_price_cache (id, rows, fetched_at) VALUES (true, $1, $2)
         ON CONFLICT (id) DO UPDATE SET rows = EXCLUDED.rows, fetched_at = EXCLUDED.fetched_at`,
        [JSON.stringify(snapshot.rows), snapshot.fetchedAt]
      );
      res.json(snapshot);
    } catch (err) {
      const { rows: cacheRows } = await db.query('SELECT rows, fetched_at FROM egypt_price_cache WHERE id = true');
      if (cacheRows.length === 0) {
        return res.status(502).json({ error: err.message });
      }
      res.json({
        source: 'isagha.com',
        fetchedAt: cacheRows[0].fetched_at.toISOString(),
        rows: cacheRows[0].rows,
        stale: true,
      });
    }
  });

  return router;
}
