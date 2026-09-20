import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createTestUser } from '../helpers/users.mjs';
import { createSession, SESSION_COOKIE } from '../../server/auth/sessions.mjs';
import { createRequireAuth, requireAdmin, perUserRouter } from '../../server/auth/middleware.mjs';
import { Router } from 'express';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
let client;
let app;
let factory;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  factory = vi.fn((userId) => {
    const r = Router();
    r.get('/whoami', (req, res) => res.json({ userId }));
    return r;
  });
  app = express();
  app.use(express.json());
  const requireAuth = createRequireAuth(client);
  app.get('/private', requireAuth, (req, res) => res.json({ id: req.user.id }));
  app.get('/admin', requireAuth, requireAdmin, (req, res) => res.json({ ok: true }));
  app.use('/per-user', requireAuth, perUserRouter(factory));
});
afterEach(async () => { await client.end(); });

const cookieFor = (token) => `${SESSION_COOKIE}=${token}`;

describe('requireAuth / requireAdmin', () => {
  it('401s without a session and with a garbage cookie', async () => {
    expect((await request(app).get('/private')).status).toBe(401);
    expect((await request(app).get('/private').set('Cookie', cookieFor('garbage'))).status).toBe(401);
  });

  it('lets an active user through and exposes req.user', async () => {
    const u = await createTestUser(client, { email: 'a@x.com' });
    const token = await createSession(client, u.id);
    const res = await request(app).get('/private').set('Cookie', cookieFor(token));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(u.id);
  });

  it('401s a pending user even with a valid session row', async () => {
    const u = await createTestUser(client, { email: 'p@x.com', status: 'pending' });
    const token = await createSession(client, u.id);
    expect((await request(app).get('/private').set('Cookie', cookieFor(token))).status).toBe(401);
  });

  it('requireAdmin: 403 for a user, 200 for an admin', async () => {
    const u = await createTestUser(client, { email: 'u@x.com' });
    const a = await createTestUser(client, { email: 'adm@x.com', role: 'admin' });
    const ut = await createSession(client, u.id);
    const at = await createSession(client, a.id);
    expect((await request(app).get('/admin').set('Cookie', cookieFor(ut))).status).toBe(403);
    expect((await request(app).get('/admin').set('Cookie', cookieFor(at))).status).toBe(200);
  });
});

describe('perUserRouter', () => {
  it('builds one router per user, reuses it, and routes each user to their own', async () => {
    const a = await createTestUser(client, { email: 'a@x.com' });
    const b = await createTestUser(client, { email: 'b@x.com' });
    const at = await createSession(client, a.id);
    const bt = await createSession(client, b.id);

    const r1 = await request(app).get('/per-user/whoami').set('Cookie', cookieFor(at));
    const r2 = await request(app).get('/per-user/whoami').set('Cookie', cookieFor(bt));
    const r3 = await request(app).get('/per-user/whoami').set('Cookie', cookieFor(at));

    expect(r1.body.userId).toBe(a.id);
    expect(r2.body.userId).toBe(b.id);
    expect(r3.body.userId).toBe(a.id);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
