import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createTestUser, signIn } from '../helpers/users.mjs';
import { provisionUserDefaults } from '../../server/provisionUserDefaults.mjs';
import { createApp } from '../../server/createApp.mjs';
import { raiseNotification, listOpen } from '../../server/adminNotifications.mjs';
import { currentSlot, normalizeSchedule, DEFAULT_SCHEDULE } from '../../server/analysisSchedule.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
let client, app, admin, adminAgent, userAgent, deps;

const parsed = {
  schema_version: '3', status: 'insufficient_evidence',
  primary_decision: { action: 'hold', horizon: 'now', confidence: 'low', headline: 'h', next_trigger: 'n', invalidation: 'i' },
  suggested_weights: { deesc: 35, base: 45, stag: 20 }, evidence: [], weight_changes: [], reads: { egp: 'e' }, assumptions: [], missing_inputs: [],
};
function makeDeps(over = {}) {
  return {
    fetchPrices: vi.fn(async () => ({ spot: 4500, usdEgp: 48.5, goldSource: 'gold-api', retrievedAt: new Date().toISOString() })),
    fetchEgypt: vi.fn(async () => ({ source: 'isagha.com', fetchedAt: new Date().toISOString(), rows: [{ karat: '24k', sell: 7000, buy: 6950 }] })),
    runAnalysis: vi.fn(async () => ({ text: JSON.stringify(parsed), result: parsed, validation: { ok: true, errors: [] }, usedWebSearch: false, searchStatus: 'disabled', evidenceSources: [] })),
    notify: vi.fn(async () => {}),
    ...over,
  };
}
async function build(over, fullDeps) {
  deps = fullDeps ?? makeDeps(over);
  app = createApp(client, { adminId: admin.id, authRateLimit: { max: 1000, windowMs: 60_000 }, analysisDeps: deps });
  adminAgent = await signIn(app, admin);
  userAgent = await signIn(app, user);
}
let user;

beforeEach(async () => {
  // raiseNotification no-ops under DISABLE_NOTIFICATIONS=1 (set in .env.dev for the running dev
  // API); the 'admin notifications' tests below exercise the real behavior regardless.
  vi.stubEnv('DISABLE_NOTIFICATIONS', '');
  client = await resetAndMigrate(MIGRATIONS_DIR);
  admin = await createTestUser(client, { email: 'admin@x.com', role: 'admin' });
  await provisionUserDefaults(client, admin.id);
  user = await createTestUser(client, { email: 'plain@x.com' });
  await provisionUserDefaults(client, user.id);
  await client.query(`INSERT INTO llm_providers (user_id, provider_type, label, model, is_active) VALUES ($1, 'ollama', 'Prov', 'm', true)`, [admin.id]);
  await build();
});
afterEach(async () => { await client.end(); vi.unstubAllEnvs(); });

const insertDone = (slot, { result, minsAgo = 5 } = {}) => client.query(
  `INSERT INTO shared_analysis_runs (slot_key, status, result, started_at, finished_at)
   VALUES ($1, 'done', $2::jsonb, now() - ($3 || ' minutes')::interval, now() - ($3 || ' minutes')::interval)`,
  [slot, JSON.stringify(result ?? {
    text: JSON.stringify(parsed), parsed, snapshot: { generated_at: 'x', wallet: { has_holdings: false } }, validation: { ok: true, errors: [] },
    evidence_sources: [{ id: 'EV-001', title: 't', link: 'https://x.test', date: 'd' }], used_web_search: true, search_status: 'ok', provider_label: 'Prov', slot_key: slot,
  }), String(minsAgo)]
);

describe('authentication and roles', () => {
  const routes = [
    ['get', '/api/analysis/latest'], ['get', '/api/analysis/schedule'], ['put', '/api/analysis/schedule'],
    ['post', '/api/analysis/run-now'], ['get', '/api/admin/notifications'], ['post', '/api/admin/notifications/1/dismiss'],
  ];
  it.each(routes)('401 when signed out: %s %s', async (method, url) => {
    expect((await request(app)[method](url).send({})).status).toBe(401);
  });

  it('a regular user reads latest and schedule but is refused every admin route', async () => {
    expect((await userAgent.get('/api/analysis/latest')).status).toBe(200);
    expect((await userAgent.get('/api/analysis/schedule')).status).toBe(200);
    expect((await userAgent.put('/api/analysis/schedule').send({ enabled: true })).status).toBe(403);
    expect((await userAgent.post('/api/analysis/run-now').send({})).status).toBe(403);
    expect((await userAgent.get('/api/admin/notifications')).status).toBe(403);
    expect((await userAgent.post('/api/admin/notifications/1/dismiss')).status).toBe(403);
    expect(deps.fetchPrices).not.toHaveBeenCalled();
    expect((await client.query('SELECT count(*)::int AS n FROM app_settings')).rows[0].n).toBe(0);
  });
});

describe('GET /api/analysis/latest', () => {
  it('returns latest:null, the default disabled schedule, the current slot and running:false before any run', async () => {
    const res = await userAgent.get('/api/analysis/latest');
    expect(res.status).toBe(200);
    expect(res.body.latest).toBeNull();
    expect(res.body.running).toBe(false);
    expect(res.body.schedule).toEqual(DEFAULT_SCHEDULE);
    const slot = currentSlot(new Date(), normalizeSchedule(DEFAULT_SCHEDULE));
    expect(res.body.slot.key).toBe(slot.key);
    expect(res.body.slot.next_at).toBe(slot.nextAt.toISOString());
    expect(Object.keys(res.body).sort()).toEqual(['latest', 'running', 'schedule', 'slot']);
  });

  it('returns the newest done run flattened (never the raw row)', async () => {
    await insertDone('2026-09-19@08:00', { minsAgo: 600 });
    await insertDone('2026-09-19@16:00', { minsAgo: 5 });
    await client.query(`INSERT INTO shared_analysis_runs (slot_key, status, error) VALUES ('2026-09-20@08:00', 'failed', 'x')`);
    const res = await userAgent.get('/api/analysis/latest');
    const l = res.body.latest;
    expect(Object.keys(l).sort()).toEqual(
      ['created_at', 'evidence_sources', 'id', 'provider_label', 'search_status', 'slot_key', 'snapshot', 'text', 'used_web_search', 'validation']
    );
    expect(l.slot_key).toBe('2026-09-19@16:00');
    expect(typeof l.id).toBe('number');
    expect(l.text).toBe(JSON.stringify(parsed));
    expect(l.provider_label).toBe('Prov');
    expect(l.used_web_search).toBe(true);
    expect(l.search_status).toBe('ok');
    expect(l.validation).toEqual({ ok: true, errors: [] });
    expect(l.evidence_sources).toHaveLength(1);
    expect(Number.isFinite(Date.parse(l.created_at))).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('"attempts"');
    expect(JSON.stringify(res.body)).not.toContain('"error"');
  });

  it('reports running:true only while a fresh running row exists for the current slot', async () => {
    const key = currentSlot(new Date(), normalizeSchedule(DEFAULT_SCHEDULE)).key;
    await client.query(`INSERT INTO shared_analysis_runs (slot_key, status) VALUES ($1, 'running')`, [key]);
    expect((await userAgent.get('/api/analysis/latest')).body.running).toBe(true);
    await client.query(`UPDATE shared_analysis_runs SET started_at = now() - interval '5 minutes'`);
    expect((await userAgent.get('/api/analysis/latest')).body.running).toBe(false);
  });

  it('a running row for some other slot does not count as running', async () => {
    await client.query(`INSERT INTO shared_analysis_runs (slot_key, status) VALUES ('1999-01-01@08:00', 'running')`);
    expect((await userAgent.get('/api/analysis/latest')).body.running).toBe(false);
  });
});

describe('schedule', () => {
  const good = { enabled: true, times: ['09:30', '21:00'], tz: 'Europe/London', language: 'en' };

  it('GET returns the default (disabled) schedule initially', async () => {
    const res = await userAgent.get('/api/analysis/schedule');
    expect(res.body).toEqual(DEFAULT_SCHEDULE);
  });

  it('PUT persists a valid schedule (normalized) and GET /schedule and /latest return it', async () => {
    const res = await adminAgent.put('/api/analysis/schedule').send({ ...good, times: ['21:00', '09:30', '09:30'], extra: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...good });
    expect((await userAgent.get('/api/analysis/schedule')).body).toEqual(good);
    expect((await userAgent.get('/api/analysis/latest')).body.schedule).toEqual(good);
    const { rows } = await client.query(`SELECT value FROM app_settings WHERE key = 'analysis_schedule'`);
    expect(rows[0].value).toEqual(good);
  });

  it('a partial object is filled from the defaults', async () => {
    const res = await adminAgent.put('/api/analysis/schedule').send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...DEFAULT_SCHEDULE, enabled: true });
  });

  it.each([
    ['bad time', { times: ['25:00'] }, /times/],
    ['too many times', { times: ['01:00', '02:00', '03:00', '04:00', '05:00'] }, /times/],
    ['empty times', { times: [] }, /times/],
    ['bad tz', { tz: 'Mars/Base' }, /tz/],
    ['null tz', { tz: null }, /tz/],
    ['bad language', { language: 'fr' }, /language/],
    ['non-boolean enabled', { enabled: 'yes' }, /enabled/],
  ])('rejects %s with 400 and the validation message, leaving the stored schedule alone', async (_n, body, message) => {
    await adminAgent.put('/api/analysis/schedule').send(good);
    const res = await adminAgent.put('/api/analysis/schedule').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect((await adminAgent.get('/api/analysis/schedule')).body).toEqual(good);
  });

  it.each([
    ['an array', '[]'], ['a non-empty array', '[{"enabled":true}]'], ['a string', '"x"'], ['a number', '5'], ['null', 'null'],
  ])('rejects a body that is %s with 400 and never resets the schedule', async (_n, raw) => {
    await adminAgent.put('/api/analysis/schedule').send(good);
    const res = await adminAgent.put('/api/analysis/schedule').set('Content-Type', 'application/json').send(raw);
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect((await adminAgent.get('/api/analysis/schedule')).body).toEqual(good);
  });

  it('rejects a missing body with 400 and never resets the schedule', async () => {
    await adminAgent.put('/api/analysis/schedule').send(good);
    const res = await adminAgent.put('/api/analysis/schedule');
    expect(res.status).toBe(400);
    expect((await adminAgent.get('/api/analysis/schedule')).body).toEqual(good);
  });

  it('GET falls back to the disabled default when the stored value is invalid', async () => {
    await client.query(`INSERT INTO app_settings (key, value) VALUES ('analysis_schedule', '{"enabled":true,"times":["99:99"]}'::jsonb)`);
    const res = await userAgent.get('/api/analysis/schedule');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });
});

describe('POST /api/analysis/run-now', () => {
  it('runs immediately (even when disabled), returns 200 {status, id} and the run becomes latest', async () => {
    const res = await adminAgent.post('/api/analysis/run-now').send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'done', id: expect.any(Number) });
    const latest = (await userAgent.get('/api/analysis/latest')).body.latest;
    expect(latest.id).toBe(res.body.id);
    expect(latest.slot_key).toMatch(/^adhoc:\d+$/);
    expect(latest.provider_label).toBe('Prov');
    expect(deps.runAnalysis).toHaveBeenCalledTimes(1);
    expect((await client.query('SELECT count(*)::int AS n FROM ai_shared_usage')).rows[0].n).toBe(0);
  });

  it('uses the stored schedule language for the snapshot', async () => {
    await adminAgent.put('/api/analysis/schedule').send({ language: 'en' });
    await adminAgent.post('/api/analysis/run-now').send({});
    expect(deps.runAnalysis.mock.calls[0][1].locale).toBe('en');
    deps.runAnalysis.mockClear();
    await adminAgent.put('/api/analysis/schedule').send({ language: 'ar' });
    await adminAgent.post('/api/analysis/run-now').send({});
    expect(deps.runAnalysis.mock.calls[0][1].locale).toBe('ar');
  });

  it('a failing run answers 502 {error}, raises no background notification and marks the run failed', async () => {
    await build({ runAnalysis: vi.fn(async () => { throw new Error('provider unreachable: ECONNREFUSED'); }) });
    const res = await adminAgent.post('/api/analysis/run-now').send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('ECONNREFUSED');
    expect(await listOpen(client)).toEqual([]);
    expect((await client.query(`SELECT status FROM shared_analysis_runs`)).rows).toEqual([{ status: 'failed' }]);
    expect((await userAgent.get('/api/analysis/latest')).body.latest).toBeNull();
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });

  it('answers 502 (not a crash) when no provider is active', async () => {
    await client.query('UPDATE llm_providers SET is_active = false');
    const res = await adminAgent.post('/api/analysis/run-now').send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/provider/i);
  });

  it('answers 502 (never crashes) with the real pipeline when the provider endpoint is unreachable', async () => {
    // Real runAnalysisV3 + real provider dispatch against a closed loopback port; web search off.
    await client.query(`UPDATE llm_providers SET base_url = 'http://127.0.0.1:1/v1', settings = '{"webSearch": false}'::jsonb`);
    const realDeps = makeDeps();
    delete realDeps.runAnalysis;
    await build(undefined, realDeps);
    const res = await adminAgent.post('/api/analysis/run-now').send({});
    expect(res.status).toBe(502);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect((await client.query(`SELECT status FROM shared_analysis_runs`)).rows).toEqual([{ status: 'failed' }]);
  });

  it('answers 502 when the price feeds are down', async () => {
    await build({ fetchPrices: vi.fn(async () => { throw new Error('No gold price feed answered: gold-api: HTTP 503'); }) });
    const res = await adminAgent.post('/api/analysis/run-now').send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('HTTP 503');
  });

  it('a successful manual run closes an open background failure notification', async () => {
    await raiseNotification(client, { kind: 'standard_analysis_failed', message: 'x' });
    expect((await adminAgent.post('/api/analysis/run-now').send({})).status).toBe(200);
    expect(await listOpen(client)).toEqual([]);
  });

  it('refuses a second manual run while one is in flight (409) instead of doubling the cost', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    await build({ runAnalysis: vi.fn(async () => { await gate; return { text: '{}', result: parsed, validation: { ok: true, errors: [] }, evidenceSources: [] }; }) });
    const first = adminAgent.post('/api/analysis/run-now').send({}).then((r) => r);
    await vi.waitFor(() => expect(deps.runAnalysis).toHaveBeenCalledTimes(1));
    expect((await adminAgent.post('/api/analysis/run-now').send({})).status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect((await adminAgent.post('/api/analysis/run-now').send({})).status).toBe(200);
  });
});

describe('admin notifications', () => {
  it('lists open notifications with only the public fields', async () => {
    expect((await adminAgent.get('/api/admin/notifications')).body).toEqual([]);
    await raiseNotification(client, { kind: 'standard_analysis_failed', message: 'slot: boom (attempt 1 of 3)', detail: { secret: 1 } });
    const res = await adminAgent.get('/api/admin/notifications');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(Object.keys(res.body[0]).sort()).toEqual(['created_at', 'id', 'kind', 'message', 'updated_at']);
    expect(res.body[0]).toMatchObject({ kind: 'standard_analysis_failed', message: 'slot: boom (attempt 1 of 3)' });
    expect(typeof res.body[0].id).toBe('number');
  });

  it('dismiss removes it from the list; a second dismiss and unknown ids are 404', async () => {
    await raiseNotification(client, { kind: 'a', message: 'A' });
    const [n] = (await adminAgent.get('/api/admin/notifications')).body;
    const res = await adminAgent.post(`/api/admin/notifications/${n.id}/dismiss`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect((await adminAgent.get('/api/admin/notifications')).body).toEqual([]);
    expect((await adminAgent.post(`/api/admin/notifications/${n.id}/dismiss`)).status).toBe(404);
    expect((await adminAgent.post('/api/admin/notifications/987654/dismiss')).status).toBe(404);
  });

  it.each(['abc', '1.5', '-1', '1e3', '99999999999999999999999', '%20', '0x10'])('malformed id %s is 404 (never a 500)', async (id) => {
    const res = await adminAgent.post(`/api/admin/notifications/${id}/dismiss`);
    expect(res.status).toBe(404);
  });

  it('the existing admin user routes still work next to the notification router', async () => {
    expect((await adminAgent.get('/api/admin/users')).status).toBe(200);
  });
});

describe('the scheduler is never started by createApp', () => {
  it('building an app makes no timers, no fetches and no runs', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const before = spy.mock.calls.length;
    const d = makeDeps();
    createApp(client, { adminId: admin.id, analysisDeps: d });
    expect(spy.mock.calls.length).toBe(before);
    expect(d.fetchPrices).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
