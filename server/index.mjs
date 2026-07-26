import 'dotenv/config';
import express from 'express';
import { getPool } from './pool.mjs';
import { ensureDefaultUser } from './ensureDefaultUser.mjs';
import { ensureDefaultScenarios } from './ensureDefaultScenarios.mjs';
import { ensureDefaultTranches } from './ensureDefaultTranches.mjs';
import { createLlmProvidersRouter } from './routes/llmProviders.mjs';
import { createAnalyzeRouter } from './routes/analyze.mjs';
import { createEgyptPricesRouter } from './routes/egyptPrices.mjs';
import { createScenariosRouter } from './routes/scenarios.mjs';
import { createTranchesRouter } from './routes/tranches.mjs';
import { createWatchlistRouter } from './routes/watchlist.mjs';
import { createAlertRulesRouter } from './routes/alertRules.mjs';

const PORT = process.env.SERVER_PORT || 8787;

const pool = getPool(process.env.DATABASE_URL);
const userId = await ensureDefaultUser(pool);
await ensureDefaultScenarios(pool, userId);
await ensureDefaultTranches(pool, userId);

const app = express();
app.use(express.json());
app.use('/api/llm-providers', createLlmProvidersRouter(pool, userId));
app.use('/api/analyze', createAnalyzeRouter(pool, userId));
app.use('/api/egypt-prices', createEgyptPricesRouter());
app.use('/api/scenarios', createScenariosRouter(pool, userId));
app.use('/api/tranches', createTranchesRouter(pool, userId));
app.use('/api/watchlist', createWatchlistRouter(pool, userId));
app.use('/api/alert-rules', createAlertRulesRouter(pool, userId));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Gold Cockpit API server listening on http://localhost:${PORT}`);
});
