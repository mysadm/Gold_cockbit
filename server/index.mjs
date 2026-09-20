import 'dotenv/config';
import { getPool } from './pool.mjs';
import { createApp } from './createApp.mjs';
import { neutralizeLegacyApiKey } from './legacyApiKey.mjs';

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

app.listen(PORT, () => {
  console.log(`Gold Cockpit API server listening on http://localhost:${PORT}`);
});
