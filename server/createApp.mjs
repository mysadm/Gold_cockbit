import express from 'express';
import { createRequireAuth, requireAdmin, perUserRouter } from './auth/middleware.mjs';
import { createRateLimiter } from './auth/rateLimit.mjs';
import { createAuthRouter } from './routes/auth.mjs';
import { createAdminUsersRouter } from './routes/adminUsers.mjs';
import { createLlmProvidersRouter } from './routes/llmProviders.mjs';
import { createAnalyzeRouter } from './routes/analyze.mjs';
import { createEgyptPricesRouter } from './routes/egyptPrices.mjs';
import { createInternationalPricesRouter } from './routes/internationalPrices.mjs';
import { createScenariosRouter } from './routes/scenarios.mjs';
import { createTranchesRouter } from './routes/tranches.mjs';
import { createWatchlistRouter } from './routes/watchlist.mjs';
import { createAlertRulesRouter } from './routes/alertRules.mjs';
import { createDcaPlanRouter } from './routes/dcaPlan.mjs';
import { createWalletRouter } from './routes/wallet.mjs';
import { createSoftwareReviewRouter } from './routes/softwareReview.mjs';

export function createApp(db, { adminId, authRateLimit = { max: 20, windowMs: 15 * 60 * 1000 } }) {
  const app = express();
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
  app.use(express.json());
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const requireAuth = createRequireAuth(db);
  app.use('/api/auth', createAuthRouter(db, { requireAuth, rateLimit: createRateLimiter(authRateLimit) }));

  app.use('/api', requireAuth);

  app.use('/api/admin', requireAdmin, createAdminUsersRouter(db));
  app.use('/api/llm-providers', requireAdmin, createLlmProvidersRouter(db, adminId));
  app.use('/api/software-review', requireAdmin, createSoftwareReviewRouter());

  app.use('/api/analyze', perUserRouter((userId) => createAnalyzeRouter(db, userId, { providerOwnerId: adminId })));
  app.use('/api/scenarios', perUserRouter((userId) => createScenariosRouter(db, userId)));
  app.use('/api/tranches', perUserRouter((userId) => createTranchesRouter(db, userId)));
  app.use('/api/watchlist', perUserRouter((userId) => createWatchlistRouter(db, userId)));
  app.use('/api/alert-rules', perUserRouter((userId) => createAlertRulesRouter(db, userId)));
  app.use('/api/dca-plan', perUserRouter((userId) => createDcaPlanRouter(db, userId)));
  app.use('/api/wallet', perUserRouter((userId) => createWalletRouter(db, userId)));

  app.use('/api/egypt-prices', createEgyptPricesRouter(db));
  app.use('/api/international-prices', createInternationalPricesRouter(db));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
