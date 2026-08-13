import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { ensureDefaultWalletHoldings } from '../../server/ensureDefaultWalletHoldings.mjs';
import { createWalletRouter } from '../../server/routes/wallet.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;
let app;
let userId;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  userId = await ensureDefaultUser(client);
  await ensureDefaultWalletHoldings(client, userId);
  app = express();
  app.use(express.json());
  app.use('/api/wallet', createWalletRouter(client, userId));
});

afterEach(async () => {
  await client.end();
});

describe('wallet holdings routes', () => {
  it('gets the seeded holdings', async () => {
    const res = await request(app).get('/api/wallet');
    expect(res.status).toBe(200);
    expect(Number(res.body.oz)).toBe(0);
    expect(Number(res.body.g24)).toBe(0);
    expect(res.body).toHaveProperty('updated_at');
  });

  it('updates holdings and bumps updated_at', async () => {
    const before = await request(app).get('/api/wallet');
    const res = await request(app)
      .put('/api/wallet')
      .send({ oz: 2, g24: 10.5, g21: 20.3, g18: 5.1, pounds: 2.7 });

    expect(res.status).toBe(200);
    expect(Number(res.body.oz)).toBe(2);
    expect(Number(res.body.g24)).toBe(10.5);
    expect(Number(res.body.g21)).toBe(20.3);
    expect(Number(res.body.g18)).toBe(5.1);
    expect(Number(res.body.pounds)).toBe(2.7);
    expect(new Date(res.body.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(before.body.updated_at).getTime());
  });

  it('rejects a negative holding amount', async () => {
    const res = await request(app).put('/api/wallet').send({ oz: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/oz/i);
  });

  it('rejects a fractional oz amount', async () => {
    const res = await request(app).put('/api/wallet').send({ oz: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/oz/i);
  });

  it('rejects a non-numeric holding amount', async () => {
    const res = await request(app).put('/api/wallet').send({ g24: 'lots' });
    expect(res.status).toBe(400);
  });

  it('requires a configured API key when GOLD_COCKPIT_API_KEY is set', async () => {
    const previousKey = process.env.GOLD_COCKPIT_API_KEY;
    process.env.GOLD_COCKPIT_API_KEY = 'test-secret';
    try {
      const denied = await request(app).get('/api/wallet');
      expect(denied.status).toBe(401);
      const allowed = await request(app).get('/api/wallet').set('x-api-key', 'test-secret');
      expect(allowed.status).toBe(200);
    } finally {
      if (previousKey === undefined) delete process.env.GOLD_COCKPIT_API_KEY;
      else process.env.GOLD_COCKPIT_API_KEY = previousKey;
    }
  });
});

describe('wallet snapshot routes', () => {
  it('creates a snapshot for today', async () => {
    const res = await request(app)
      .post('/api/wallet/snapshots')
      .send({ intl_value_egp: 100000, egypt_value_egp: 102000 });

    expect(res.status).toBe(201);
    expect(Number(res.body.intl_value_egp)).toBe(100000);
    expect(Number(res.body.egypt_value_egp)).toBe(102000);
    expect(res.body).toHaveProperty('recorded_at');
  });

  it('posting twice on the same day updates the existing snapshot instead of duplicating it', async () => {
    await request(app).post('/api/wallet/snapshots').send({ intl_value_egp: 100000 });
    const second = await request(app).post('/api/wallet/snapshots').send({ intl_value_egp: 105000 });
    expect(second.status).toBe(201);

    const list = await request(app).get('/api/wallet/snapshots');
    expect(list.body).toHaveLength(1);
    expect(Number(list.body[0].intl_value_egp)).toBe(105000);
  });

  it('rejects a snapshot with a missing intl_value_egp', async () => {
    const res = await request(app).post('/api/wallet/snapshots').send({ egypt_value_egp: 1000 });
    expect(res.status).toBe(400);
  });

  it('lists snapshots ordered by recorded_at, optionally filtered by since', async () => {
    await request(app).post('/api/wallet/snapshots').send({ intl_value_egp: 100000 });

    const all = await request(app).get('/api/wallet/snapshots');
    expect(all.status).toBe(200);
    expect(all.body).toHaveLength(1);

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const filtered = await request(app).get(`/api/wallet/snapshots?since=${encodeURIComponent(future)}`);
    expect(filtered.body).toHaveLength(0);
  });
});
