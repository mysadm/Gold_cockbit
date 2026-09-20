import 'dotenv/config';
import { getPool } from './pool.mjs';
import { createApp } from './createApp.mjs';
import { neutralizeLegacyApiKey } from './legacyApiKey.mjs';
import { fetchMarketPrices } from './marketPrices.mjs';
import { fetchEgyptGoldPrices } from './isaghaPrices.mjs';
import { startAnalysisScheduler } from './analysisScheduler.mjs';

neutralizeLegacyApiKey();

const PORT = process.env.SERVER_PORT || 8787;

const pool = getPool(process.env.DATABASE_URL);
const { rows } = await pool.query(
  `SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at LIMIT 1`
);
if (rows.length === 0) {
  console.error('No admin account exists yet. Create one first:\n  node scripts/create-admin.mjs you@example.com');
  process.exit(1);
}

const app = createApp(pool, { adminId: rows[0].id });

const server = app.listen(PORT, () => {
  console.log(`Gold Cockpit API server listening on http://localhost:${PORT}`);
});

// The background standard analysis runs in this process only (never inside createApp, so
// tests and scripts that build an app never start it).
const stopScheduler = startAnalysisScheduler({
  db: pool,
  adminId: rows[0].id,
  deps: { fetchPrices: fetchMarketPrices, fetchEgypt: fetchEgyptGoldPrices },
});

function shutdown() {
  stopScheduler();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
