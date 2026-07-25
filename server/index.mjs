import 'dotenv/config';
import express from 'express';
import { getPool } from './pool.mjs';
import { ensureDefaultUser } from './ensureDefaultUser.mjs';
import { createLlmProvidersRouter } from './routes/llmProviders.mjs';
import { createAnalyzeRouter } from './routes/analyze.mjs';
import { createEgyptPricesRouter } from './routes/egyptPrices.mjs';

const PORT = process.env.SERVER_PORT || 8787;

const pool = getPool(process.env.DATABASE_URL);
const userId = await ensureDefaultUser(pool);

const app = express();
app.use(express.json());
app.use('/api/llm-providers', createLlmProvidersRouter(pool, userId));
app.use('/api/analyze', createAnalyzeRouter(pool, userId));
app.use('/api/egypt-prices', createEgyptPricesRouter());

app.listen(PORT, () => {
  console.log(`Gold Cockpit API server listening on http://localhost:${PORT}`);
});
