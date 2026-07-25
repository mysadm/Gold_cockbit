import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../server/isaghaPrices.mjs', () => ({
  fetchEgyptGoldPrices: vi.fn(),
}));

const { fetchEgyptGoldPrices } = await import('../../server/isaghaPrices.mjs');
const { createEgyptPricesRouter } = await import('../../server/routes/egyptPrices.mjs');

function buildApp() {
  const app = express();
  app.use('/api/egypt-prices', createEgyptPricesRouter());
  return app;
}

describe('GET /api/egypt-prices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
  });

  it('returns 502 with a clear error message when the scrape fails', async () => {
    fetchEgyptGoldPrices.mockRejectedValue(new Error('Could not parse iSagha gold price table — the page layout may have changed'));

    const response = await request(buildApp()).get('/api/egypt-prices');

    expect(response.status).toBe(502);
    expect(response.body.error).toMatch(/could not parse/i);
  });
});
