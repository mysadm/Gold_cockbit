import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { createWatchlistRouter } from '../../server/routes/watchlist.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;
let app;
let userId;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  userId = await ensureDefaultUser(client);
  app = express();
  app.use(express.json());
  app.use('/api/watchlist', createWatchlistRouter(client, userId));
});

afterEach(async () => {
  await client.end();
});

describe('watchlist routes', () => {
  it('creates and lists a watchlist item', async () => {
    const createRes = await request(app)
      .post('/api/watchlist')
      .send({ label: 'Oil prices', status: 'support' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.label).toBe('Oil prices');

    const listRes = await request(app).get('/api/watchlist');
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
  });

  it('rejects creating an item with an empty label', async () => {
    const res = await request(app).post('/api/watchlist').send({ label: '', status: 'support' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/label/i);
  });

  it('rejects creating an item with a label over 40 characters', async () => {
    const res = await request(app)
      .post('/api/watchlist')
      .send({ label: 'x'.repeat(41), status: 'support' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/label/i);
  });

  it('updates a watchlist item status', async () => {
    const created = await request(app).post('/api/watchlist').send({ label: 'Fed policy', status: 'watch' });

    const updated = await request(app)
      .patch(`/api/watchlist/${created.body.id}`)
      .send({ status: 'risk' });

    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe('risk');
  });

  it('returns 404 when updating an item that does not exist', async () => {
    const res = await request(app).patch('/api/watchlist/999999').send({ status: 'risk' });
    expect(res.status).toBe(404);
  });

  it('deletes a watchlist item', async () => {
    const created = await request(app).post('/api/watchlist').send({ label: 'To delete', status: 'watch' });

    await request(app).delete(`/api/watchlist/${created.body.id}`).expect(204);

    const list = await request(app).get('/api/watchlist');
    expect(list.body).toHaveLength(0);
  });
});
