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

  it.each([
    ['spot_usd is zero', { spot_usd: 0 }],
    ['spot_usd is negative', { spot_usd: -5 }],
    ['spot_usd is above 100000', { spot_usd: 100001 }],
    ['spot_usd is a string', { spot_usd: '4500' }],
    ['spot_usd is null', { spot_usd: null }],
    ['usd_egp is zero', { spot_usd: 4500, usd_egp: 0 }],
    ['usd_egp is negative', { spot_usd: 4500, usd_egp: -1 }],
    ['usd_egp is above 10000', { spot_usd: 4500, usd_egp: 10001 }],
    ['usd_egp is a string', { spot_usd: 4500, usd_egp: '50' }],
    ['source is a number', { spot_usd: 4500, source: 123 }],
    ['source is an object', { spot_usd: 4500, source: { a: 1 } }],
    ['source is longer than 100 characters', { spot_usd: 4500, source: 'x'.repeat(101) }],
  ])('rejects with 400 and writes nothing when %s', async (_name, body) => {
    const response = await request(app).post('/api/international-prices').send(body);

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual(expect.any(String));
    const { rows } = await client.query('SELECT 1 FROM international_price_history');
    expect(rows).toHaveLength(0);
  });

  it('rejects a number that overflows to Infinity', async () => {
    // 1e999 is valid JSON text that JSON.parse turns into Infinity.
    const response = await request(app)
      .post('/api/international-prices')
      .set('Content-Type', 'application/json')
      .send('{"spot_usd": 1e999}');
    expect(response.status).toBe(400);
    const { rows } = await client.query('SELECT 1 FROM international_price_history');
    expect(rows).toHaveLength(0);
  });

  it('accepts values at the upper limits and a 100-character source', async () => {
    const response = await request(app)
      .post('/api/international-prices')
      .send({ spot_usd: 100000, usd_egp: 10000, source: 'x'.repeat(100) });

    expect(response.status).toBe(201);
    expect(response.body.spot_usd).toBe('100000.00');
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
