import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { ensureDefaultScenarios } from '../../server/ensureDefaultScenarios.mjs';
import { createScenariosRouter } from '../../server/routes/scenarios.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;
let app;
let userId;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  userId = await ensureDefaultUser(client);
  await ensureDefaultScenarios(client, userId);
  app = express();
  app.use(express.json());
  app.use('/api/scenarios', createScenariosRouter(client, userId));
});

afterEach(async () => {
  await client.end();
});

describe('scenarios routes', () => {
  it('lists the seeded scenarios ordered by sort_order', async () => {
    const res = await request(app).get('/api/scenarios');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].name).toBe('De-escalation');
  });

  it('updates weight_pct on a scenario', async () => {
    const list = await request(app).get('/api/scenarios');
    const target = list.body[0];

    const res = await request(app)
      .patch(`/api/scenarios/${target.id}`)
      .send({ weight_pct: 60 });

    expect(res.status).toBe(200);
    expect(Number(res.body.weight_pct)).toBe(60);
  });

  it('rejects a weight_pct above 100', async () => {
    const list = await request(app).get('/api/scenarios');
    const target = list.body[0];

    const res = await request(app)
      .patch(`/api/scenarios/${target.id}`)
      .send({ weight_pct: 150 });

    expect(res.status).toBe(400);
  });

  it('returns 404 when updating a scenario that does not exist', async () => {
    const res = await request(app).patch('/api/scenarios/999999').send({ weight_pct: 40 });
    expect(res.status).toBe(404);
  });

  it('rejects a PATCH with no updatable fields', async () => {
    const list = await request(app).get('/api/scenarios');
    const target = list.body[0];

    const res = await request(app).patch(`/api/scenarios/${target.id}`).send({});
    expect(res.status).toBe(400);
  });

  it('requires a configured API key when GOLD_COCKPIT_API_KEY is set', async () => {
    const previousKey = process.env.GOLD_COCKPIT_API_KEY;
    process.env.GOLD_COCKPIT_API_KEY = 'test-secret';
    try {
      const denied = await request(app).get('/api/scenarios');
      expect(denied.status).toBe(401);
      const allowed = await request(app).get('/api/scenarios').set('x-api-key', 'test-secret');
      expect(allowed.status).toBe(200);
    } finally {
      if (previousKey === undefined) delete process.env.GOLD_COCKPIT_API_KEY;
      else process.env.GOLD_COCKPIT_API_KEY = previousKey;
    }
  });
});
