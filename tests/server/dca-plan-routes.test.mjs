import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { ensureDefaultDcaPlan } from '../../server/ensureDefaultDcaPlan.mjs';
import { createDcaPlanRouter } from '../../server/routes/dcaPlan.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;
let app;
let userId;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  userId = await ensureDefaultUser(client);
  await ensureDefaultDcaPlan(client, userId);
  app = express();
  app.use(express.json());
  app.use('/api/dca-plan', createDcaPlanRouter(client, userId));
});

afterEach(async () => {
  await client.end();
});

describe('dca-plan routes', () => {
  it('gets the seeded plan', async () => {
    const res = await request(app).get('/api/dca-plan');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('start_date');
    expect(Number(res.body.total_investment_egp)).toBe(300000);
  });

  it('updates start_date and total_investment_egp', async () => {
    const res = await request(app)
      .patch('/api/dca-plan')
      .send({ start_date: '2026-09-01', total_investment_egp: 450000 });

    expect(res.status).toBe(200);
    expect(res.body.start_date).toBe('2026-09-01');
    expect(Number(res.body.total_investment_egp)).toBe(450000);
  });

  it('rejects an invalid start_date', async () => {
    const res = await request(app).patch('/api/dca-plan').send({ start_date: 'not-a-date' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/start_date/i);
  });

  it('rejects a negative total_investment_egp', async () => {
    const res = await request(app).patch('/api/dca-plan').send({ total_investment_egp: -100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/total_investment_egp/i);
  });

  it('rejects a PATCH with no updatable fields', async () => {
    const res = await request(app).patch('/api/dca-plan').send({});
    expect(res.status).toBe(400);
  });

  it('requires a configured API key when GOLD_COCKPIT_API_KEY is set', async () => {
    const previousKey = process.env.GOLD_COCKPIT_API_KEY;
    process.env.GOLD_COCKPIT_API_KEY = 'test-secret';
    try {
      const denied = await request(app).get('/api/dca-plan');
      expect(denied.status).toBe(401);
      const allowed = await request(app).get('/api/dca-plan').set('x-api-key', 'test-secret');
      expect(allowed.status).toBe(200);
    } finally {
      if (previousKey === undefined) delete process.env.GOLD_COCKPIT_API_KEY;
      else process.env.GOLD_COCKPIT_API_KEY = previousKey;
    }
  });
});
