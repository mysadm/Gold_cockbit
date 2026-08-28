import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';

vi.mock('../../server/isaghaPrices.mjs', () => ({
  fetchEgyptGoldPrices: vi.fn(),
}));

const { fetchEgyptGoldPrices } = await import('../../server/isaghaPrices.mjs');
const { createEgyptPricesRouter } = await import('../../server/routes/egyptPrices.mjs');

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  vi.clearAllMocks();
});

afterEach(async () => {
  await client.end();
});

function buildApp() {
  const app = express();
  app.use('/api/egypt-prices', createEgyptPricesRouter(client));
  return app;
}

describe('GET /api/egypt-prices', () => {
  it('returns the parsed snapshot on success', async () => {
    fetchEgyptGoldPrices.mockResolvedValue({
      source: 'isagha.com',
      fetchedAt: '2026-07-22T10:00:00.000Z',
      rows: [{ karat: '21k', sell: 6000, buy: 5950, changeAmount: 5, changePct: 0.08 }],
    });

    const response = await request(buildApp()).get('/api/egypt-prices');

    expect(response.status).toBe(200);
    expect(response.body.source).toBe('isagha.com');
    expect(response.body.rows).toHaveLength(1);
    expect(response.body.stale).toBeFalsy();
  });

  it('caches a successful fetch so a later failure can fall back to it', async () => {
    fetchEgyptGoldPrices.mockResolvedValue({
      source: 'isagha.com',
      fetchedAt: '2026-07-22T10:00:00.000Z',
      rows: [{ karat: '21k', sell: 6000, buy: 5950, changeAmount: 5, changePct: 0.08 }],
    });
    await request(buildApp()).get('/api/egypt-prices');

    fetchEgyptGoldPrices.mockRejectedValue(new Error('network down'));
    const response = await request(buildApp()).get('/api/egypt-prices');

    expect(response.status).toBe(200);
    expect(response.body.stale).toBe(true);
    expect(response.body.rows).toHaveLength(1);
    expect(response.body.fetchedAt).toBe('2026-07-22T10:00:00.000Z');
  });

  it('returns 502 with a clear error message when the scrape fails and there is no cache yet', async () => {
    fetchEgyptGoldPrices.mockRejectedValue(new Error('Could not parse iSagha gold price table — the page layout may have changed'));

    const response = await request(buildApp()).get('/api/egypt-prices');

    expect(response.status).toBe(502);
    expect(response.body.error).toMatch(/could not parse/i);
  });

  it('records a history row on a successful fetch, distinct from the single-row cache', async () => {
    fetchEgyptGoldPrices.mockResolvedValue({
      source: 'isagha.com',
      fetchedAt: '2026-07-22T10:00:00.000Z',
      rows: [{ karat: '21k', sell: 6000, buy: 5950, changeAmount: 5, changePct: 0.08 }],
    });

    await request(buildApp()).get('/api/egypt-prices');

    const { rows } = await client.query('SELECT rows, fetched_at FROM egypt_price_history');
    expect(rows).toHaveLength(1);
    expect(rows[0].rows).toEqual([{ karat: '21k', sell: 6000, buy: 5950, changeAmount: 5, changePct: 0.08 }]);
  });

  it('does not fail the request or fall back to stale cache when only the history insert would collide', async () => {
    fetchEgyptGoldPrices.mockResolvedValue({
      source: 'isagha.com',
      fetchedAt: '2026-07-22T10:00:00.000Z',
      rows: [{ karat: '21k', sell: 6000, buy: 5950, changeAmount: 5, changePct: 0.08 }],
    });
    await request(buildApp()).get('/api/egypt-prices');

    fetchEgyptGoldPrices.mockResolvedValue({
      source: 'isagha.com',
      fetchedAt: '2026-07-22T18:00:00.000Z',
      rows: [{ karat: '21k', sell: 6100, buy: 6050, changeAmount: 105, changePct: 1.75 }],
    });
    const response = await request(buildApp()).get('/api/egypt-prices');

    expect(response.status).toBe(200);
    expect(response.body.stale).toBeFalsy();
    const { rows } = await client.query('SELECT rows FROM egypt_price_history');
    expect(rows).toHaveLength(1);
    expect(rows[0].rows[0].sell).toBe(6100);
  });
});

describe('GET /api/egypt-prices/history', () => {
  it('returns recorded history rows ordered by fetch time', async () => {
    fetchEgyptGoldPrices.mockResolvedValue({
      source: 'isagha.com',
      fetchedAt: '2026-07-22T10:00:00.000Z',
      rows: [{ karat: '21k', sell: 6000, buy: 5950, changeAmount: 5, changePct: 0.08 }],
    });
    await request(buildApp()).get('/api/egypt-prices');
    await client.query(
      `INSERT INTO egypt_price_history (rows, fetched_at) VALUES ($1, $2)`,
      [JSON.stringify([{ karat: '21k', sell: 6200, buy: 6150, changeAmount: 200, changePct: 3.3 }]), '2026-07-23T10:00:00.000Z']
    );

    const response = await request(buildApp()).get('/api/egypt-prices/history');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body[0].fetchedAt).toBe('2026-07-22T10:00:00.000Z');
    expect(response.body[1].fetchedAt).toBe('2026-07-23T10:00:00.000Z');
  });
});
