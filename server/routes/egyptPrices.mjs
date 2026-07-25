import { Router } from 'express';
import { fetchEgyptGoldPrices } from '../isaghaPrices.mjs';

export function createEgyptPricesRouter() {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const snapshot = await fetchEgyptGoldPrices();
      res.json(snapshot);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}
