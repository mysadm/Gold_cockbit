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

  it('defaults to the fixed 40/35/25 split, 2-month spacing', async () => {
    const res = await request(app).get('/api/dca-plan');
    expect(res.body.tranche_pcts.map(Number)).toEqual([40, 35, 25]);
    expect(res.body.spacing_months).toBe(2);
    expect(res.body.mode).toBe('fixed');
  });

  it('updates tranche_pcts when it still sums to 100', async () => {
    const res = await request(app).patch('/api/dca-plan').send({ tranche_pcts: [50, 30, 20] });
    expect(res.status).toBe(200);
    expect(res.body.tranche_pcts.map(Number)).toEqual([50, 30, 20]);
  });

  it('allows an arbitrary tranche count as long as it sums to 100', async () => {
    const res = await request(app).patch('/api/dca-plan').send({ tranche_pcts: [25, 25, 25, 25] });
    expect(res.status).toBe(200);
    expect(res.body.tranche_pcts.map(Number)).toEqual([25, 25, 25, 25]);
  });

  it('rejects tranche_pcts that do not sum to 100 while in fixed mode', async () => {
    const res = await request(app).patch('/api/dca-plan').send({ tranche_pcts: [50, 30, 10] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tranche_pcts/i);
  });

  it('rejects a non-positive value inside tranche_pcts', async () => {
    const res = await request(app).patch('/api/dca-plan').send({ tranche_pcts: [100, 0] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tranche_pcts/i);
  });

  it('updates spacing_months', async () => {
    const res = await request(app).patch('/api/dca-plan').send({ spacing_months: 1 });
    expect(res.status).toBe(200);
    expect(res.body.spacing_months).toBe(1);
  });

  it('rejects a non-positive spacing_months', async () => {
    const res = await request(app).patch('/api/dca-plan').send({ spacing_months: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/spacing_months/i);
  });

  it('switches to recurring mode without requiring tranche_pcts to sum to 100', async () => {
    const res = await request(app).patch('/api/dca-plan').send({ mode: 'recurring', tranche_pcts: [15] });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('recurring');
    expect(res.body.tranche_pcts.map(Number)).toEqual([15]);
  });

  it('re-validates the sum against the stored tranche_pcts when only switching back to fixed mode', async () => {
    await request(app).patch('/api/dca-plan').send({ mode: 'recurring', tranche_pcts: [15] });
    const res = await request(app).patch('/api/dca-plan').send({ mode: 'fixed' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tranche_pcts/i);
  });

  it('rejects an invalid mode', async () => {
    const res = await request(app).patch('/api/dca-plan').send({ mode: 'weekly' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mode/i);
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
