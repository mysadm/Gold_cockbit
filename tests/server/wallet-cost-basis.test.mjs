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

function findUnit(body, unit) {
  return body.find((row) => row.unit === unit);
}

describe('GET /api/wallet/cost-basis', () => {
  it('returns zeroed rows for every unit when there are no transactions', async () => {
    const res = await request(app).get('/api/wallet/cost-basis');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
    for (const row of res.body) {
      expect(row.avgCostEgp).toBe(0);
      expect(row.openQty).toBe(0);
      expect(row.realizedEgp).toBe(0);
    }
  });

  it('computes average cost from a single buy', async () => {
    await request(app).post('/api/wallet/transactions').send({ unit: 'g24', side: 'buy', amount: 5, price_egp: 7000 });

    const res = await request(app).get('/api/wallet/cost-basis');
    const g24 = findUnit(res.body, 'g24');
    expect(g24.avgCostEgp).toBe(7000);
    expect(g24.openQty).toBe(5);
    expect(g24.realizedEgp).toBe(0);
  });

  it('weighted-averages the cost across multiple buys at different prices', async () => {
    await request(app).post('/api/wallet/transactions').send({ unit: 'g21', side: 'buy', amount: 10, price_egp: 6000 });
    await request(app).post('/api/wallet/transactions').send({ unit: 'g21', side: 'buy', amount: 10, price_egp: 6400 });

    const res = await request(app).get('/api/wallet/cost-basis');
    const g21 = findUnit(res.body, 'g21');
    // (10*6000 + 10*6400) / 20 = 6200
    expect(g21.avgCostEgp).toBe(6200);
    expect(g21.openQty).toBe(20);
    expect(g21.realizedEgp).toBe(0);
  });

  it('computes realized P&L on a partial sell using average cost, leaving the rest as open qty', async () => {
    await request(app).post('/api/wallet/transactions').send({ unit: 'g18', side: 'buy', amount: 10, price_egp: 5000 });
    await request(app).post('/api/wallet/transactions').send({ unit: 'g18', side: 'sell', amount: 4, price_egp: 5500 });

    const res = await request(app).get('/api/wallet/cost-basis');
    const g18 = findUnit(res.body, 'g18');
    // realized = (5500 - 5000) * 4 = 2000, remaining avg cost stays 5000, open qty 6
    expect(g18.realizedEgp).toBe(2000);
    expect(g18.avgCostEgp).toBe(5000);
    expect(g18.openQty).toBe(6);
  });

  it('zeroes out avg cost and open qty on a full sell, keeping only realized P&L', async () => {
    await request(app).post('/api/wallet/transactions').send({ unit: 'pounds', side: 'buy', amount: 2, price_egp: 49000 });
    await request(app).post('/api/wallet/transactions').send({ unit: 'pounds', side: 'sell', amount: 2, price_egp: 51000 });

    const res = await request(app).get('/api/wallet/cost-basis');
    const pounds = findUnit(res.body, 'pounds');
    expect(pounds.openQty).toBe(0);
    expect(pounds.avgCostEgp).toBe(0);
    expect(pounds.realizedEgp).toBe(4000);
  });

  it('requires a configured API key when GOLD_COCKPIT_API_KEY is set', async () => {
    const previousKey = process.env.GOLD_COCKPIT_API_KEY;
    process.env.GOLD_COCKPIT_API_KEY = 'test-secret';
    try {
      const denied = await request(app).get('/api/wallet/cost-basis');
      expect(denied.status).toBe(401);
    } finally {
      if (previousKey === undefined) delete process.env.GOLD_COCKPIT_API_KEY;
      else process.env.GOLD_COCKPIT_API_KEY = previousKey;
    }
  });
});
