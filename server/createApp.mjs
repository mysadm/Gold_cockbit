import express from 'express';
import { createRequireAuth, requireAdmin, perUserRouter } from './auth/middleware.mjs';
import { createRateLimiter } from './auth/rateLimit.mjs';
import { createAuthRouter } from './routes/auth.mjs';
import { createAdminUsersRouter } from './routes/adminUsers.mjs';
import { createAdminNotificationsRouter } from './routes/adminNotifications.mjs';
import { createAnalysisRouter } from './routes/analysis.mjs';
import { createAdminPromptsRouter } from './routes/adminPrompts.mjs';
import { fetchMarketPrices } from './marketPrices.mjs';
import { fetchEgyptGoldPrices } from './isaghaPrices.mjs';
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

// If the response has already started, hand the error to Express's default handler
// (which closes the connection) instead of trying to send a second response.
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  // Malformed or oversized request bodies (body-parser) are the caller's mistake, not ours.
  if (err.status >= 400 && err.status < 500 && err.expose) {
    return res.status(err.status).json({ error: err.status === 413 ? 'Request body too large' : 'Invalid request body' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

// The real market data sources; tests inject fakes through `analysisDeps`.
const DEFAULT_ANALYSIS_DEPS = { fetchPrices: fetchMarketPrices, fetchEgypt: fetchEgyptGoldPrices };

// The background scheduler is deliberately NOT started here (see server/index.mjs).
export function createApp(db, { adminId, authRateLimit = { max: 20, windowMs: 15 * 60 * 1000 }, analysisDeps = DEFAULT_ANALYSIS_DEPS }) {
  const app = express();
  // Only an explicit "1" or "true" turns this on; "0"/"false"/anything else leaves it off.
  if (['1', 'true'].includes(String(process.env.TRUST_PROXY ?? '').trim().toLowerCase())) app.set('trust proxy', 1);
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

  app.use('/api/admin/prompts', requireAdmin, createAdminPromptsRouter(db, { adminId, deps: analysisDeps }));
  app.use('/api/admin', requireAdmin, createAdminUsersRouter(db));
  app.use('/api/admin', requireAdmin, createAdminNotificationsRouter(db));
  app.use('/api/analysis', createAnalysisRouter(db, { adminId, deps: analysisDeps }));
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

  app.use(errorHandler);

  return app;
}
