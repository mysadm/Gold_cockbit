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

describe('wallet transaction routes', () => {
  it('a buy transaction increases the holding and is recorded', async () => {
    const res = await request(app)
      .post('/api/wallet/transactions')
      .send({ unit: 'g24', side: 'buy', amount: 5.5, price_egp: 7000 });

    expect(res.status).toBe(201);
    expect(res.body.transaction.unit).toBe('g24');
    expect(res.body.transaction.side).toBe('buy');
    expect(Number(res.body.transaction.amount)).toBe(5.5);
    expect(Number(res.body.transaction.price_egp)).toBe(7000);
    expect(Number(res.body.holdings.g24)).toBe(5.5);
  });

  it('a sell transaction decreases the holding', async () => {
    await request(app).post('/api/wallet/transactions').send({ unit: 'g21', side: 'buy', amount: 10, price_egp: 6000 });
    const res = await request(app).post('/api/wallet/transactions').send({ unit: 'g21', side: 'sell', amount: 4, price_egp: 6100 });

    expect(res.status).toBe(201);
    expect(Number(res.body.holdings.g21)).toBe(6);
  });

  it('rejects a sell that would drive the holding negative, and does not change the balance', async () => {
    await request(app).post('/api/wallet/transactions').send({ unit: 'pounds', side: 'buy', amount: 1, price_egp: 49000 });
    const res = await request(app).post('/api/wallet/transactions').send({ unit: 'pounds', side: 'sell', amount: 2, price_egp: 49000 });

    expect(res.status).toBe(400);
    const holdings = await request(app).get('/api/wallet');
    expect(Number(holdings.body.pounds)).toBe(1);
  });

  it('rejects an unknown unit', async () => {
    const res = await request(app).post('/api/wallet/transactions').send({ unit: 'g99', side: 'buy', amount: 1, price_egp: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unit/i);
  });

  it('rejects a side other than buy/sell', async () => {
    const res = await request(app).post('/api/wallet/transactions').send({ unit: 'g24', side: 'trade', amount: 1, price_egp: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/side/i);
  });

  it('rejects a non-positive amount', async () => {
    const res = await request(app).post('/api/wallet/transactions').send({ unit: 'g24', side: 'buy', amount: 0, price_egp: 100 });
    expect(res.status).toBe(400);
  });

  it('rejects a fractional oz transaction amount', async () => {
    const res = await request(app).post('/api/wallet/transactions').send({ unit: 'oz', side: 'buy', amount: 1.5, price_egp: 200000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/oz/i);
  });

  it('accepts a whole-number oz transaction and updates the balance', async () => {
    const res = await request(app).post('/api/wallet/transactions').send({ unit: 'oz', side: 'buy', amount: 2, price_egp: 200000 });
    expect(res.status).toBe(201);
    expect(Number(res.body.holdings.oz)).toBe(2);
  });

  it('rejects a negative price', async () => {
    const res = await request(app).post('/api/wallet/transactions').send({ unit: 'g24', side: 'buy', amount: 1, price_egp: -5 });
    expect(res.status).toBe(400);
  });

  it('lists transactions ordered most-recent-first', async () => {
    await request(app).post('/api/wallet/transactions').send({ unit: 'g24', side: 'buy', amount: 1, price_egp: 7000 });
    await request(app).post('/api/wallet/transactions').send({ unit: 'g21', side: 'buy', amount: 2, price_egp: 6000 });

    const res = await request(app).get('/api/wallet/transactions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].unit).toBe('g21');
    expect(res.body[1].unit).toBe('g24');
  });

  it('requires a configured API key when GOLD_COCKPIT_API_KEY is set', async () => {
    const previousKey = process.env.GOLD_COCKPIT_API_KEY;
    process.env.GOLD_COCKPIT_API_KEY = 'test-secret';
    try {
      const denied = await request(app).get('/api/wallet/transactions');
      expect(denied.status).toBe(401);
    } finally {
      if (previousKey === undefined) delete process.env.GOLD_COCKPIT_API_KEY;
      else process.env.GOLD_COCKPIT_API_KEY = previousKey;
    }
  });

  it('accepts a client-supplied recorded_at date', async () => {
    const res = await request(app)
      .post('/api/wallet/transactions')
      .send({ unit: 'g24', side: 'buy', amount: 1, price_egp: 7000, recorded_at: '2026-05-01' });

    expect(res.status).toBe(201);
    expect(res.body.transaction.recorded_at.slice(0, 10)).toBe('2026-05-01');
  });

  it('rejects an invalid recorded_at date', async () => {
    const res = await request(app)
      .post('/api/wallet/transactions')
      .send({ unit: 'g24', side: 'buy', amount: 1, price_egp: 7000, recorded_at: 'not-a-date' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/recorded_at/i);
  });

  it('defaults recorded_at to today when omitted', async () => {
    const res = await request(app).post('/api/wallet/transactions').send({ unit: 'g24', side: 'buy', amount: 1, price_egp: 7000 });
    const today = new Date().toISOString().slice(0, 10);
    expect(res.body.transaction.recorded_at.slice(0, 10)).toBe(today);
  });
});

describe('wallet transaction edit/delete routes', () => {
  it('PATCH adjusts the amount and re-applies the delta to holdings', async () => {
    const created = await request(app).post('/api/wallet/transactions').send({ unit: 'g24', side: 'buy', amount: 5, price_egp: 7000 });
    const txId = created.body.transaction.id;

    const res = await request(app).patch(`/api/wallet/transactions/${txId}`).send({ amount: 8 });

    expect(res.status).toBe(200);
    expect(Number(res.body.transaction.amount)).toBe(8);
    expect(Number(res.body.holdings.g24)).toBe(8);
  });

  it('PATCH flipping side from buy to sell adjusts holdings by double the swing', async () => {
    await request(app).post('/api/wallet/transactions').send({ unit: 'g21', side: 'buy', amount: 20, price_egp: 6000 });
    const created = await request(app).post('/api/wallet/transactions').send({ unit: 'g21', side: 'buy', amount: 5, price_egp: 6000 });
    const txId = created.body.transaction.id;

    const res = await request(app).patch(`/api/wallet/transactions/${txId}`).send({ side: 'sell' });

    expect(res.status).toBe(200);
    // 20 (first buy) - 5 (this one now sold instead of bought) = 15
    expect(Number(res.body.holdings.g21)).toBe(15);
  });

  it('PATCH moving a transaction to a different unit adjusts both units', async () => {
    const created = await request(app).post('/api/wallet/transactions').send({ unit: 'g24', side: 'buy', amount: 3, price_egp: 7000 });
    const txId = created.body.transaction.id;

    const res = await request(app).patch(`/api/wallet/transactions/${txId}`).send({ unit: 'g21' });

    expect(res.status).toBe(200);
    expect(Number(res.body.holdings.g24)).toBe(0);
    expect(Number(res.body.holdings.g21)).toBe(3);
    expect(res.body.transaction.unit).toBe('g21');
  });

  it('PATCH updating recorded_at only leaves holdings unchanged', async () => {
    const created = await request(app).post('/api/wallet/transactions').send({ unit: 'g24', side: 'buy', amount: 3, price_egp: 7000 });
    const txId = created.body.transaction.id;

    const res = await request(app).patch(`/api/wallet/transactions/${txId}`).send({ recorded_at: '2026-01-15' });

    expect(res.status).toBe(200);
    expect(res.body.transaction.recorded_at.slice(0, 10)).toBe('2026-01-15');
    expect(Number(res.body.holdings.g24)).toBe(3);
  });

  it('PATCH rejects an edit that would make holdings negative', async () => {
    const created = await request(app).post('/api/wallet/transactions').send({ unit: 'g24', side: 'buy', amount: 3, price_egp: 7000 });
    await request(app).post('/api/wallet/transactions').send({ unit: 'g24', side: 'sell', amount: 2, price_egp: 7000 });
    const txId = created.body.transaction.id;

    // shrinking the original buy to 1 would leave 1 - 2 = -1
    const res = await request(app).patch(`/api/wallet/transactions/${txId}`).send({ amount: 1 });

    expect(res.status).toBe(400);
    const holdings = await request(app).get('/api/wallet');
    expect(Number(holdings.body.g24)).toBe(1);
  });

  it('PATCH rejects a fractional oz amount', async () => {
    const created = await request(app).post('/api/wallet/transactions').send({ unit: 'oz', side: 'buy', amount: 2, price_egp: 200000 });
    const res = await request(app).patch(`/api/wallet/transactions/${created.body.transaction.id}`).send({ amount: 1.5 });
    expect(res.status).toBe(400);
  });

  it('PATCH returns 404 for a transaction that does not exist', async () => {
    const res = await request(app).patch('/api/wallet/transactions/999999').send({ amount: 1 });
    expect(res.status).toBe(404);
  });

  it('DELETE reverses a buy and removes the transaction', async () => {
    const created = await request(app).post('/api/wallet/transactions').send({ unit: 'g18', side: 'buy', amount: 4, price_egp: 5000 });

    const res = await request(app).delete(`/api/wallet/transactions/${created.body.transaction.id}`);

    expect(res.status).toBe(200);
    expect(Number(res.body.holdings.g18)).toBe(0);
    const list = await request(app).get('/api/wallet/transactions');
    expect(list.body).toHaveLength(0);
  });

  it('DELETE reverses a sell by adding the amount back', async () => {
    await request(app).post('/api/wallet/transactions').send({ unit: 'g18', side: 'buy', amount: 10, price_egp: 5000 });
    const sell = await request(app).post('/api/wallet/transactions').send({ unit: 'g18', side: 'sell', amount: 3, price_egp: 5100 });

    const res = await request(app).delete(`/api/wallet/transactions/${sell.body.transaction.id}`);

    expect(res.status).toBe(200);
    expect(Number(res.body.holdings.g18)).toBe(10);
  });

  it('DELETE rejects when reversal would make holdings negative', async () => {
    const buy = await request(app).post('/api/wallet/transactions').send({ unit: 'g18', side: 'buy', amount: 10, price_egp: 5000 });
    await request(app).post('/api/wallet/transactions').send({ unit: 'g18', side: 'sell', amount: 8, price_egp: 5100 });

    const res = await request(app).delete(`/api/wallet/transactions/${buy.body.transaction.id}`);

    expect(res.status).toBe(400);
    const holdings = await request(app).get('/api/wallet');
    expect(Number(holdings.body.g18)).toBe(2);
  });

  it('DELETE returns 404 for a transaction that does not exist', async () => {
    const res = await request(app).delete('/api/wallet/transactions/999999');
    expect(res.status).toBe(404);
  });
});
