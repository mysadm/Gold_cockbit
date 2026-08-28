import { Router } from 'express';
import { createApiKeyAuthMiddleware } from '../auth.mjs';

// Unlike Egypt prices (fetched server-side, see isaghaPrices.mjs), the
// international XAU/USD spot and USD/EGP rate are fetched client-side across
// several free keyless feeds with failover (see pullLive() in src/App.tsx) —
// there's no server-side fetch to piggyback history recording onto. Instead
// the client POSTs here after each successful pull.
export function createInternationalPricesRouter(db) {
  const router = Router();
  router.use(createApiKeyAuthMiddleware());

  router.post('/', async (req, res) => {
    const { spot_usd, usd_egp, source } = req.body;
    if (typeof spot_usd !== 'number' || Number.isNaN(spot_usd)) {
      return res.status(400).json({ error: 'spot_usd is required and must be a number' });
    }
    if (usd_egp !== undefined && usd_egp !== null && (typeof usd_egp !== 'number' || Number.isNaN(usd_egp))) {
      return res.status(400).json({ error: 'usd_egp must be a number when provided' });
    }

    const { rows } = await db.query(
      `INSERT INTO international_price_history (spot_usd, usd_egp, gold_source, fetched_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (((fetched_at AT TIME ZONE 'UTC')::date))
       DO UPDATE SET spot_usd = EXCLUDED.spot_usd, usd_egp = EXCLUDED.usd_egp, gold_source = EXCLUDED.gold_source, fetched_at = now()
       RETURNING id, spot_usd, usd_egp, gold_source, fetched_at`,
      [spot_usd, usd_egp ?? null, source ?? null]
    );
    res.status(201).json(rows[0]);
  });

  router.get('/', async (req, res) => {
    const { rows } = await db.query(
      'SELECT id, spot_usd, usd_egp, gold_source, fetched_at FROM international_price_history ORDER BY fetched_at'
    );
    res.json(rows);
  });

  return router;
}
