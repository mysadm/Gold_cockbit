import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { ensureDefaultTranches } from '../../server/ensureDefaultTranches.mjs';
import { createTranchesRouter } from '../../server/routes/tranches.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;
let app;
let userId;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  userId = await ensureDefaultUser(client);
  await ensureDefaultTranches(client, userId);
  app = express();
  app.use(express.json());
  app.use('/api/tranches', createTranchesRouter(client, userId));
});

afterEach(async () => {
  await client.end();
});

describe('tranches routes', () => {
  it('lists the seeded tranches ordered by tranche_number', async () => {
    const res = await request(app).get('/api/tranches');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.map((t) => t.tranche_number)).toEqual([1, 2, 3]);
  });

  it('updates status and amount_egp on a tranche', async () => {
    const list = await request(app).get('/api/tranches');
    const target = list.body[0];

    const res = await request(app)
      .patch(`/api/tranches/${target.id}`)
      .send({ status: 'filled', amount_egp: 250000, gram_equivalent: 42.5 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('filled');
    expect(Number(res.body.amount_egp)).toBe(250000);
  });

  it('rejects an invalid status', async () => {
    const list = await request(app).get('/api/tranches');
    const target = list.body[0];

    const res = await request(app).patch(`/api/tranches/${target.id}`).send({ status: 'cancelled' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when updating a tranche that does not exist', async () => {
    const res = await request(app).patch('/api/tranches/999999').send({ status: 'filled' });
    expect(res.status).toBe(404);
  });
});
