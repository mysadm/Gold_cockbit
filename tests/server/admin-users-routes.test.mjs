import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createTestUser, signIn } from '../helpers/users.mjs';
import { provisionUserDefaults } from '../../server/provisionUserDefaults.mjs';
import { createApp } from '../../server/createApp.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
let client, app, admin, adminAgent, pending;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  admin = await createTestUser(client, { email: 'admin@x.com', role: 'admin', displayName: 'Boss' });
  await provisionUserDefaults(client, admin.id);
  pending = await createTestUser(client, { email: 'new@x.com', status: 'pending' });
  app = createApp(client, { adminId: admin.id, authRateLimit: { max: 1000, windowMs: 60_000 } });
  adminAgent = await signIn(app, admin);
});
afterEach(async () => { await client.end(); });

describe('GET /api/admin/users', () => {
  it('lists users with status and today usage, pending first', async () => {
    await client.query(`INSERT INTO ai_shared_usage (user_id, used_on, call_count) VALUES ($1, CURRENT_DATE, 2)`, [admin.id]);
    const res = await adminAgent.get('/api/admin/users');
    expect(res.status).toBe(200);
    expect(res.body.map((u) => u.email)).toEqual(['new@x.com', 'admin@x.com']);
    expect(res.body[1]).toMatchObject({ role: 'admin', status: 'active', ai_used_today: 2, daily_ai_limit: 3 });
    expect(res.body[0]).not.toHaveProperty('password_hash');
  });
});

describe('approve / disable / enable', () => {
  it('approve activates a pending user and provisions their defaults', async () => {
    const res = await adminAgent.post(`/api/admin/users/${pending.id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect((await client.query('SELECT count(*)::int n FROM scenarios WHERE user_id = $1', [pending.id])).rows[0].n).toBe(3);
    // the approved user can now sign in
    expect((await signIn(app, pending)).get).toBeDefined();
  });

  it('approve 409s on a user that is not pending', async () => {
    const res = await adminAgent.post(`/api/admin/users/${admin.id}/approve`);
    expect(res.status).toBe(409);
  });

  it('disable locks an active user out immediately; enable restores them', async () => {
    const u = await createTestUser(client, { email: 'u@x.com' });
    const agent = await signIn(app, u);
    expect((await agent.get('/api/scenarios')).status).toBe(200);
    expect((await adminAgent.post(`/api/admin/users/${u.id}/disable`)).status).toBe(200);
    expect((await agent.get('/api/scenarios')).status).toBe(401);
    expect((await adminAgent.post(`/api/admin/users/${u.id}/enable`)).status).toBe(200);
    expect((await signIn(app, u)).get).toBeDefined();
  });

  it('the admin cannot disable themselves', async () => {
    const res = await adminAgent.post(`/api/admin/users/${admin.id}/disable`);
    expect(res.status).toBe(400);
  });

  it('enable 409s on a user that is not disabled', async () => {
    const res = await adminAgent.post(`/api/admin/users/${admin.id}/enable`);
    expect(res.status).toBe(409);
  });

  it('404s for an unknown or malformed id', async () => {
    expect((await adminAgent.post('/api/admin/users/00000000-0000-0000-0000-000000000000/approve')).status).toBe(404);
    expect((await adminAgent.post('/api/admin/users/not-a-uuid/approve')).status).toBe(404);
  });
});

describe('PATCH daily limit and reset password', () => {
  it('updates daily_ai_limit and validates the range', async () => {
    const ok = await adminAgent.patch(`/api/admin/users/${pending.id}`).send({ daily_ai_limit: 7 });
    expect(ok.status).toBe(200);
    expect(ok.body.daily_ai_limit).toBe(7);
    expect((await adminAgent.patch(`/api/admin/users/${pending.id}`).send({ daily_ai_limit: -1 })).status).toBe(400);
    expect((await adminAgent.patch(`/api/admin/users/${pending.id}`).send({ daily_ai_limit: 1.5 })).status).toBe(400);
    expect((await adminAgent.patch(`/api/admin/users/${pending.id}`).send({})).status).toBe(400);
  });

  it('reset-password sets a new password and ends the user\'s sessions', async () => {
    const u = await createTestUser(client, { email: 'u@x.com', password: 'old-password-1' });
    const agent = await signIn(app, u);
    const res = await adminAgent.post(`/api/admin/users/${u.id}/reset-password`).send({ password: 'new-password-1' });
    expect(res.status).toBe(200);
    expect((await agent.get('/api/scenarios')).status).toBe(401);
    expect((await signIn(app, { email: 'u@x.com', password: 'new-password-1' })).get).toBeDefined();
    await expect(signIn(app, { email: 'u@x.com', password: 'old-password-1' })).rejects.toThrow();
  });

  it('reset-password rejects a short password', async () => {
    const res = await adminAgent.post(`/api/admin/users/${pending.id}/reset-password`).send({ password: 'short' });
    expect(res.status).toBe(400);
  });
});
