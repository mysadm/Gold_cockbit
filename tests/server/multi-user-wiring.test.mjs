import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createTestUser, signIn } from '../helpers/users.mjs';
import { provisionUserDefaults } from '../../server/provisionUserDefaults.mjs';
import { createApp } from '../../server/createApp.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
let client, app, admin, alice, bob;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  admin = await createTestUser(client, { email: 'admin@x.com', role: 'admin' });
  alice = await createTestUser(client, { email: 'alice@x.com' });
  bob = await createTestUser(client, { email: 'bob@x.com' });
  for (const u of [admin, alice, bob]) await provisionUserDefaults(client, u.id);
  app = createApp(client, { adminId: admin.id, authRateLimit: { max: 1000, windowMs: 60_000 } });
});
afterEach(async () => { await client.end(); });

describe('authentication is required', () => {
  it.each([
    ['get', '/api/scenarios'], ['get', '/api/tranches'], ['get', '/api/watchlist'],
    ['get', '/api/alert-rules'], ['get', '/api/dca-plan'], ['get', '/api/wallet'],
    ['get', '/api/egypt-prices'], ['get', '/api/international-prices'],
    ['get', '/api/analyze/quota'], ['get', '/api/llm-providers'], ['get', '/api/admin/users'],
  ])('%s %s -> 401 when signed out', async (method, path) => {
    expect((await request(app)[method](path)).status).toBe(401);
  });

  it('keeps /api/auth/login reachable without a session', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@x.com', password: 'whatever1' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });
});

describe('admin-only areas', () => {
  it.each([
    ['get', '/api/llm-providers'], ['get', '/api/admin/users'], ['post', '/api/software-review/run'],
  ])('%s %s -> 403 for a regular user', async (method, path) => {
    const agent = await signIn(app, alice);
    expect((await agent[method](path).send({})).status).toBe(403);
  });

  it('lets the admin list AI providers', async () => {
    const agent = await signIn(app, admin);
    expect((await agent.get('/api/llm-providers')).status).toBe(200);
  });
});

describe('data isolation between users', () => {
  it("each user sees only their own scenarios, and edits don't leak", async () => {
    const a = await signIn(app, alice);
    const b = await signIn(app, bob);
    const aList = (await a.get('/api/scenarios')).body;
    const bList = (await b.get('/api/scenarios')).body;
    expect(aList).toHaveLength(3);
    expect(bList).toHaveLength(3);
    expect(aList.map((s) => s.id)).not.toEqual(bList.map((s) => s.id));

    const patched = await a.patch(`/api/scenarios/${aList[0].id}`).send({ weight_pct: 61 });
    expect(Number(patched.body.weight_pct)).toBe(61);
    const bAfter = (await b.get('/api/scenarios')).body;
    expect(Number(bAfter[0].weight_pct)).toBe(35);
  });

  it("a user cannot modify another user's scenario by id", async () => {
    const a = await signIn(app, alice);
    const b = await signIn(app, bob);
    const bList = (await b.get('/api/scenarios')).body;
    const res = await a.patch(`/api/scenarios/${bList[0].id}`).send({ weight_pct: 1 });
    expect(res.status).toBe(404);
  });

  it("wallet and DCA plan are per user", async () => {
    const a = await signIn(app, alice);
    const b = await signIn(app, bob);
    const aPlan = (await a.get('/api/dca-plan')).body;
    const bPlan = (await b.get('/api/dca-plan')).body;
    expect(aPlan.user_id).toBe(alice.id);
    expect(bPlan.user_id).toBe(bob.id);
  });
});
