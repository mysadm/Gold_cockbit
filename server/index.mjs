import 'dotenv/config';
import express from 'express';
import { getPool } from './pool.mjs';
import { ensureDefaultUser } from './ensureDefaultUser.mjs';
import { ensureDefaultScenarios } from './ensureDefaultScenarios.mjs';
import { ensureDefaultTranches } from './ensureDefaultTranches.mjs';
import { ensureDefaultDcaPlan } from './ensureDefaultDcaPlan.mjs';
import { ensureDefaultWalletHoldings } from './ensureDefaultWalletHoldings.mjs';
import { ensureDefaultLlmProvider } from './ensureDefaultLlmProvider.mjs';
import { createLlmProvidersRouter } from './routes/llmProviders.mjs';
import { createAnalyzeRouter } from './routes/analyze.mjs';
import { createEgyptPricesRouter } from './routes/egyptPrices.mjs';
import { createScenariosRouter } from './routes/scenarios.mjs';
import { createTranchesRouter } from './routes/tranches.mjs';
import { createWatchlistRouter } from './routes/watchlist.mjs';
import { createAlertRulesRouter } from './routes/alertRules.mjs';
import { createDcaPlanRouter } from './routes/dcaPlan.mjs';
import { createWalletRouter } from './routes/wallet.mjs';
import { createSoftwareReviewRouter } from './routes/softwareReview.mjs';

const PORT = process.env.SERVER_PORT || 8787;

const pool = getPool(process.env.DATABASE_URL);
const userId = await ensureDefaultUser(pool);
await ensureDefaultScenarios(pool, userId);
await ensureDefaultTranches(pool, userId);
await ensureDefaultDcaPlan(pool, userId);
await ensureDefaultWalletHoldings(pool, userId);
await ensureDefaultLlmProvider(pool, userId);

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use('/api/llm-providers', createLlmProvidersRouter(pool, userId));
app.use('/api/analyze', createAnalyzeRouter(pool, userId));
app.use('/api/egypt-prices', createEgyptPricesRouter(pool));
app.use('/api/scenarios', createScenariosRouter(pool, userId));
app.use('/api/tranches', createTranchesRouter(pool, userId));
app.use('/api/watchlist', createWatchlistRouter(pool, userId));
app.use('/api/alert-rules', createAlertRulesRouter(pool, userId));
app.use('/api/dca-plan', createDcaPlanRouter(pool, userId));
app.use('/api/wallet', createWalletRouter(pool, userId));
app.use('/api/software-review', createSoftwareReviewRouter());

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Gold Cockpit API server listening on http://localhost:${PORT}`);
});
