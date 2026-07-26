import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { createAlertRulesRouter } from '../../server/routes/alertRules.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;
let app;
let userId;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  userId = await ensureDefaultUser(client);
  app = express();
  app.use(express.json());
  app.use('/api/alert-rules', createAlertRulesRouter(client, userId));
});

afterEach(async () => {
  await client.end();
});

describe('alert rules routes', () => {
  it('creates and lists an alert rule', async () => {
    const createRes = await request(app)
      .post('/api/alert-rules')
      .send({ rule_type: 'band_edge', config: { scenario: 'base', edge: 'low' } });

    expect(createRes.status).toBe(201);
    expect(createRes.body.rule_type).toBe('band_edge');
    expect(createRes.body.active).toBe(true);

    const listRes = await request(app).get('/api/alert-rules');
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
  });

  it('rejects an invalid rule_type', async () => {
    const res = await request(app)
      .post('/api/alert-rules')
      .send({ rule_type: 'bogus', config: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rule_type/i);
  });

  it('rejects a missing config', async () => {
    const res = await request(app)
      .post('/api/alert-rules')
      .send({ rule_type: 'egp_move' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/config/i);
  });

  it('updates active flag on a rule', async () => {
    const created = await request(app)
      .post('/api/alert-rules')
      .send({ rule_type: 'tranche_window', config: { tranche: 2 } });

    const updated = await request(app)
      .patch(`/api/alert-rules/${created.body.id}`)
      .send({ active: false });

    expect(updated.status).toBe(200);
    expect(updated.body.active).toBe(false);
  });

  it('returns 404 when updating a rule that does not exist', async () => {
    const res = await request(app).patch('/api/alert-rules/999999').send({ active: false });
    expect(res.status).toBe(404);
  });

  it('deletes an alert rule', async () => {
    const created = await request(app)
      .post('/api/alert-rules')
      .send({ rule_type: 'egp_move', config: { threshold_pct: 2 } });

    await request(app).delete(`/api/alert-rules/${created.body.id}`).expect(204);

    const list = await request(app).get('/api/alert-rules');
    expect(list.body).toHaveLength(0);
  });
});
