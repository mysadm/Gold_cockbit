import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createInternationalPricesRouter } from '../../server/routes/internationalPrices.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;
let app;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  app = express();
  app.use(express.json());
  app.use('/api/international-prices', createInternationalPricesRouter(client));
});

afterEach(async () => {
  await client.end();
});

describe('POST /api/international-prices', () => {
  it('records a price snapshot', async () => {
    const response = await request(app)
      .post('/api/international-prices')
      .send({ spot_usd: 4520.5, usd_egp: 50.24, source: 'gold-api' });

    expect(response.status).toBe(201);
    expect(response.body.spot_usd).toBe('4520.50');
    expect(response.body.gold_source).toBe('gold-api');

    const { rows } = await client.query('SELECT spot_usd, usd_egp, gold_source FROM international_price_history');
    expect(rows).toHaveLength(1);
  });

  it('rejects a request missing spot_usd', async () => {
    const response = await request(app).post('/api/international-prices').send({ usd_egp: 50.24 });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/spot_usd/i);
  });

  it('accepts a record with no usd_egp (gold feed succeeded but FX feeds all failed)', async () => {
    const response = await request(app).post('/api/international-prices').send({ spot_usd: 4520.5 });

    expect(response.status).toBe(201);
    expect(response.body.usd_egp).toBeNull();
  });

  it('collapses same-day submissions into one row, keeping the latest', async () => {
    await request(app).post('/api/international-prices').send({ spot_usd: 4500, usd_egp: 50, source: 'gold-api' });
    await request(app).post('/api/international-prices').send({ spot_usd: 4530, usd_egp: 50.1, source: 'goldprice.org' });

    const { rows } = await client.query('SELECT spot_usd, gold_source FROM international_price_history');
    expect(rows).toHaveLength(1);
    expect(rows[0].spot_usd).toBe('4530.00');
    expect(rows[0].gold_source).toBe('goldprice.org');
  });
});

describe('GET /api/international-prices', () => {
  it('returns recorded history ordered by fetch time', async () => {
    await client.query(
      `INSERT INTO international_price_history (spot_usd, usd_egp, gold_source, fetched_at) VALUES ($1, $2, $3, $4)`,
      [4500, 50, 'gold-api', '2026-07-22T10:00:00.000Z']
    );
    await client.query(
      `INSERT INTO international_price_history (spot_usd, usd_egp, gold_source, fetched_at) VALUES ($1, $2, $3, $4)`,
      [4600, 50.5, 'gold-api', '2026-07-23T10:00:00.000Z']
    );

    const response = await request(app).get('/api/international-prices');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body[0].spot_usd).toBe('4500.00');
    expect(response.body[1].spot_usd).toBe('4600.00');
  });
});
