import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { ensureDefaultScenarios } from '../../server/ensureDefaultScenarios.mjs';
import { ensureDefaultTranches } from '../../server/ensureDefaultTranches.mjs';
import { createScenariosRouter } from '../../server/routes/scenarios.mjs';
import { createTranchesRouter } from '../../server/routes/tranches.mjs';
import { createWatchlistRouter } from '../../server/routes/watchlist.mjs';
import { createAlertRulesRouter } from '../../server/routes/alertRules.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;
let app;

afterEach(async () => {
  await client.end();
});

describe('full route wiring (mirrors server/index.mjs)', () => {
  beforeEach(async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await ensureDefaultUser(client);
    await ensureDefaultScenarios(client, userId);
    await ensureDefaultTranches(client, userId);

    app = express();
    app.use(express.json());
    app.use('/api/scenarios', createScenariosRouter(client, userId));
    app.use('/api/tranches', createTranchesRouter(client, userId));
    app.use('/api/watchlist', createWatchlistRouter(client, userId));
    app.use('/api/alert-rules', createAlertRulesRouter(client, userId));
  });

  it('serves all four new endpoints', async () => {
    expect((await request(app).get('/api/scenarios')).status).toBe(200);
    expect((await request(app).get('/api/tranches')).status).toBe(200);
    expect((await request(app).get('/api/watchlist')).status).toBe(200);
    expect((await request(app).get('/api/alert-rules')).status).toBe(200);
  });
});
