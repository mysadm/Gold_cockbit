import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createTestUser } from '../helpers/users.mjs';
import { createRequireAuth } from '../../server/auth/middleware.mjs';
import { createRateLimiter } from '../../server/auth/rateLimit.mjs';
import { createAuthRouter } from '../../server/routes/auth.mjs';
import { SESSION_COOKIE } from '../../server/auth/sessions.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
let client;
let app;

function buildApp(limit = 1000) {
  const a = express();
  a.use(express.json());
  a.use('/api/auth', createAuthRouter(client, {
    requireAuth: createRequireAuth(client),
    rateLimit: createRateLimiter({ max: limit, windowMs: 60_000 }),
  }));
  return a;
}

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  app = buildApp();
});
afterEach(async () => { await client.end(); });

describe('POST /api/auth/register', () => {
  it('creates a pending user, lower-cases the email, and does not sign in', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: '  New@Example.COM ', password: 'longenough1', display_name: 'New Person' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ status: 'pending' });
    expect(res.headers['set-cookie']).toBeUndefined();
    const { rows } = await client.query(`SELECT email, status, role, display_name, password_hash FROM users WHERE email = 'new@example.com'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', role: 'user', display_name: 'New Person' });
    expect(rows[0].password_hash.startsWith('scrypt$')).toBe(true);
  });

  it('validates email and password length', async () => {
    expect((await request(app).post('/api/auth/register').send({ email: 'nope', password: 'longenough1' })).status).toBe(400);
    expect((await request(app).post('/api/auth/register').send({ email: 'a@b.co', password: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/auth/register').send({})).status).toBe(400);
  });

  it('409s on a duplicate email regardless of case', async () => {
    await createTestUser(client, { email: 'dup@x.com' });
    const res = await request(app).post('/api/auth/register').send({ email: 'DUP@x.com', password: 'longenough1' });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  it('signs in an active user and sets an HttpOnly cookie', async () => {
    await createTestUser(client, { email: 'a@x.com', password: 'password123' });
    const res = await request(app).post('/api/auth/login').send({ email: 'A@x.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'a@x.com', role: 'user', daily_ai_limit: 3, ai_used_today: 0 });
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    await createTestUser(client, { email: 'a@x.com', password: 'password123' });
    const wrong = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'nope-nope-nope' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@x.com', password: 'password123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('403s a pending and a disabled user with a code, only after the password checks out', async () => {
    await createTestUser(client, { email: 'p@x.com', status: 'pending' });
    await createTestUser(client, { email: 'd@x.com', status: 'disabled' });
    const pending = await request(app).post('/api/auth/login').send({ email: 'p@x.com', password: 'password123' });
    const disabled = await request(app).post('/api/auth/login').send({ email: 'd@x.com', password: 'password123' });
    expect(pending.status).toBe(403);
    expect(pending.body.code).toBe('pending');
    expect(disabled.status).toBe(403);
    expect(disabled.body.code).toBe('disabled');
    const wrongPw = await request(app).post('/api/auth/login').send({ email: 'p@x.com', password: 'wrong-wrong' });
    expect(wrongPw.status).toBe(401);
  });

  it('is rate limited', async () => {
    const limited = buildApp(2);
    await request(limited).post('/api/auth/login').send({ email: 'a@x.com', password: 'x' });
    await request(limited).post('/api/auth/login').send({ email: 'a@x.com', password: 'x' });
    expect((await request(limited).post('/api/auth/login').send({ email: 'a@x.com', password: 'x' })).status).toBe(429);
  });
});

describe('GET /api/auth/me and POST /api/auth/logout', () => {
  it('401s when signed out; returns the user (with usage) when signed in; logout ends the session', async () => {
    const u = await createTestUser(client, { email: 'a@x.com', dailyAiLimit: 5 });
    await client.query(`INSERT INTO ai_shared_usage (user_id, used_on, call_count) VALUES ($1, CURRENT_DATE, 2)`, [u.id]);
    expect((await request(app).get('/api/auth/me')).status).toBe(401);

    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'a@x.com', password: 'password123' });
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: u.id, email: 'a@x.com', daily_ai_limit: 5, ai_used_today: 2 });

    const out = await agent.post('/api/auth/logout');
    expect(out.status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});
