import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createTestUser, signIn } from '../helpers/users.mjs';
import { provisionUserDefaults } from '../../server/provisionUserDefaults.mjs';
import { createApp } from '../../server/createApp.mjs';
import { DEFAULT_PROMPTS, DEFAULT_FORMAT as DEFAULT_PROMPTS_FORMAT, PROMPTS_TEST_SETTING, loadPrompts, MAX_PROMPT_LENGTH } from '../../server/analystPrompts.mjs';
import { GOLD_MARKET_ANALYST_SYSTEM_PROMPT, APP_RULES } from '../../server/prompts/goldMarketAnalyst.mjs';
import { runStandardAnalysis } from '../../server/standardAnalysis.mjs';
import { currentSlot, DEFAULT_SCHEDULE } from '../../server/analysisSchedule.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
let client, app, admin, user, adminAgent, userAgent, deps;

const parsed = (status = 'material_change', action = 'wait') => ({
  schema_version: '3', status,
  primary_decision: { action, horizon: 'now', confidence: 'medium', headline: 'Headline', next_trigger: 'n', invalidation: 'i' },
  suggested_weights: { deesc: 35, base: 45, stag: 20 }, evidence: [], weight_changes: [], reads: { egp: 'e' }, assumptions: [], missing_inputs: [],
});
const analysisResult = (over = {}) => ({
  text: '{}', result: parsed(), validation: { ok: true, errors: [] }, usedWebSearch: false, searchStatus: 'disabled', evidenceSources: [], metrics: { totalMs: 1234 }, ...over,
});
function makeDeps(over = {}) {
  return {
    fetchPrices: vi.fn(async () => ({ spot: 4500, usdEgp: 48.5, goldSource: 'gold-api', retrievedAt: new Date().toISOString() })),
    fetchEgypt: vi.fn(async () => null),
    runAnalysis: vi.fn(async () => analysisResult()),
    notify: vi.fn(async () => {}),
    ...over,
  };
}
async function build(over) {
  deps = makeDeps(over);
  app = createApp(client, { adminId: admin.id, authRateLimit: { max: 1000, windowMs: 60_000 }, analysisDeps: deps });
  adminAgent = await signIn(app, admin);
  userAgent = await signIn(app, user);
}
const TEXT = 'My standard prompt';
const FORMAT = 'Answer in {LANG} as JSON: {"schema_version":"3"}';
const testDraft = (text = TEXT, kind = 'standard', format = FORMAT) => adminAgent.post(`/api/admin/prompts/${kind}/test`).send({ text, format });
const save = (body, kind = 'standard') => adminAgent.put(`/api/admin/prompts/${kind}`).send(body);
const reset = (body, kind = 'standard') => adminAgent.post(`/api/admin/prompts/${kind}/reset`).send(body);

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  admin = await createTestUser(client, { email: 'admin@x.com', role: 'admin' });
  await provisionUserDefaults(client, admin.id);
  user = await createTestUser(client, { email: 'plain@x.com' });
  await provisionUserDefaults(client, user.id);
  await client.query(`INSERT INTO llm_providers (user_id, provider_type, label, model, is_active) VALUES ($1, 'ollama', 'Prov', 'm', true)`, [admin.id]);
  await build();
});
afterEach(async () => { await client.end(); });

describe('access', () => {
  it.each([
    ['get', '/api/admin/prompts'], ['post', '/api/admin/prompts/standard/test'], ['put', '/api/admin/prompts/personalized'],
    ['post', '/api/admin/prompts/standard/reset'],
  ])('403 for a regular user, 401 signed out: %s %s', async (method, url) => {
    expect((await userAgent[method](url).send({})).status).toBe(403);
    const request = (await import('supertest')).default;
    expect((await request(app)[method](url).send({})).status).toBe(401);
  });

  it('404 for an unknown prompt name', async () => {
    expect((await testDraft('x', 'nope')).status).toBe(404);
  });
});

describe('reading', () => {
  it('returns both built-in prompts, uncustomized, with the locked output schema', async () => {
    const res = await adminAgent.get('/api/admin/prompts');
    expect(res.status).toBe(200);
    expect(res.body.standard).toMatchObject({ text: DEFAULT_PROMPTS.standard, default: DEFAULT_PROMPTS.standard, customized: false, revision: 0 });
    expect(res.body.personalized).toMatchObject({ text: DEFAULT_PROMPTS.personalized, customized: false, revision: 0 });
    expect(res.body.standard.format).toBe(DEFAULT_PROMPTS_FORMAT);
    expect(res.body.personalized.defaultFormat).toBe(DEFAULT_PROMPTS_FORMAT);
    expect(DEFAULT_PROMPTS_FORMAT).toContain('{LANG}');
    expect(res.body.lockedRules).toBe(APP_RULES);
    expect(res.body.requiredKeys).toEqual(expect.arrayContaining(['schema_version', 'status', 'primary_decision', 'suggested_weights']));
    expect(res.body.maxLength).toBe(MAX_PROMPT_LENGTH);
  });

  it('the standard default is the shared policy plus the market-only scope, the personalized one is the policy alone', () => {
    expect(DEFAULT_PROMPTS.personalized).toBe(GOLD_MARKET_ANALYST_SYSTEM_PROMPT);
    expect(DEFAULT_PROMPTS.standard.startsWith(GOLD_MARKET_ANALYST_SYSTEM_PROMPT)).toBe(true);
    expect(DEFAULT_PROMPTS.standard).toContain('STANDARD MARKET ANALYSIS');
  });
});

describe('testing a draft', () => {
  it('runs a standard analysis with the draft as the system prompt, stores nothing, and reports the outcome', async () => {
    const res = await testDraft();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ passed: true, reason: null, status: 'material_change', action: 'wait', headline: 'Headline', sample: false });
    const [, snapshot, , options] = deps.runAnalysis.mock.calls[0];
    expect(options.prompts).toEqual({ system: `${TEXT}\n\n${APP_RULES}`, format: FORMAT });
    expect(snapshot.analysis_scope).toBe('market');
    expect(snapshot.wallet.has_holdings).toBe(false);
    expect((await client.query('SELECT count(*)::int AS n FROM shared_analysis_runs')).rows[0].n).toBe(0);
    expect((await loadPrompts(client)).standard.customized).toBe(false);
  });

  it('tests the personalized prompt on the market data plus a sample portfolio', async () => {
    const res = await testDraft('My personal prompt', 'personalized');
    expect(res.body).toMatchObject({ passed: true, sample: true });
    const [, snapshot, , options] = deps.runAnalysis.mock.calls[0];
    expect(options.prompts).toEqual({ system: `My personal prompt\n\n${APP_RULES}`, format: FORMAT });
    expect(snapshot.analysis_scope).toBeUndefined();
    expect(snapshot.explanation_level).toBe('beginner');
    expect(snapshot.wallet.has_holdings).toBe(true);
    expect(snapshot.dca.mode).toBe('fixed');
    expect(snapshot.market.xau_usd).toBe(4500);
  });

  it('fails a draft whose answer does not validate, and says why', async () => {
    deps.runAnalysis.mockResolvedValue(analysisResult({ validation: { ok: false, errors: ['schema_version must be 3'] } }));
    const res = await testDraft();
    expect(res.body.passed).toBe(false);
    expect(res.body.reason).toContain('schema_version must be 3');
  });

  it('shows each validation error once, explains a wrong layout, and previews what the model wrote', async () => {
    deps.runAnalysis.mockImplementation(async (provider, snapshot, run, options) => {
      options.onRawAnswer?.('{"as_of":"2026-09-22","evidence":["a"]}');
      return analysisResult({ validation: { ok: false, errors: ['schema_version must be 3', 'unknown evidence ID', 'unknown evidence ID', 'unknown evidence ID'] } });
    });
    const res = await testDraft();
    expect(res.body.passed).toBe(false);
    expect(res.body.errors).toEqual(['schema_version must be 3', 'unknown evidence ID']);
    expect(res.body.hint).toMatch(/output format box/);
    expect(res.body.answerPreview).toBe('{"as_of":"2026-09-22","evidence":["a"]}');
  });

  it('gives no preview or layout hint for a passing test or an unrelated failure', async () => {
    const ok = await testDraft();
    expect(ok.body).toMatchObject({ passed: true, hint: null, answerPreview: null });

    deps.runAnalysis.mockImplementation(async (provider, snapshot, run, options) => {
      options.onRawAnswer?.('raw');
      return analysisResult({ validation: { ok: false, errors: ['DCA amount exceeds current installment limit'] } });
    });
    const bad = await testDraft();
    expect(bad.body.hint).toBeNull();
    expect(bad.body.answerPreview).toBe('raw');
  });

  it('truncates a long preview', async () => {
    deps.runAnalysis.mockImplementation(async (provider, snapshot, run, options) => {
      options.onRawAnswer?.('x'.repeat(5000));
      return analysisResult({ validation: { ok: false, errors: ['response must be a JSON object'] } });
    });
    expect((await testDraft()).body.answerPreview).toHaveLength(1200);
  });

  it('fails a draft that only produces "insufficient evidence"', async () => {
    deps.runAnalysis.mockResolvedValue(analysisResult({ result: parsed('insufficient_evidence', 'insufficient_evidence') }));
    const res = await testDraft();
    expect(res.body.passed).toBe(false);
    expect(res.body.reason).toMatch(/insufficient evidence/i);
  });

  it('reports a provider error as 502 and leaves nothing to save', async () => {
    deps.runAnalysis.mockRejectedValue(new Error('provider down'));
    const res = await testDraft();
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('provider down');
    expect((await save({ text: TEXT, format: FORMAT, password: admin.password })).status).toBe(409);
  });

  it.each([[''], ['   '], ['x'.repeat(MAX_PROMPT_LENGTH + 1)], [5]])('400 for an invalid prompt text %#', async (text) => {
    expect((await testDraft(text)).status).toBe(400);
    expect(deps.runAnalysis).not.toHaveBeenCalled();
  });

  it.each([[''], ['   '], ['x'.repeat(MAX_PROMPT_LENGTH + 1)], [null]])('400 for an invalid output format %#', async (format) => {
    expect((await testDraft(TEXT, 'standard', format)).status).toBe(400);
    expect(deps.runAnalysis).not.toHaveBeenCalled();
  });
});

describe('saving is signed with the password and requires a passing test', () => {
  it('saves after a passing test and a correct password, and the next standard analysis uses it', async () => {
    await testDraft();
    const res = await save({ text: TEXT, format: FORMAT, password: admin.password });
    expect(res.status).toBe(200);
    expect(res.body.standard).toMatchObject({ customized: true, revision: 1, text: TEXT, updatedBy: 'admin@x.com' });
    expect(res.body.standard.updatedAt).toBeTruthy();
    expect(res.body.personalized.customized).toBe(false);

    const slot = currentSlot(new Date(), { ...DEFAULT_SCHEDULE, enabled: true });
    await runStandardAnalysis({ db: client, adminId: admin.id, slotKey: slot.key, schedule: DEFAULT_SCHEDULE, deps });
    expect(deps.runAnalysis.mock.calls.at(-1)[3].prompts).toEqual({ system: `${TEXT}\n\n${APP_RULES}`, format: FORMAT });
  });

  it('saves and reloads the output format with the prompt, and a changed format needs its own test', async () => {
    await testDraft();
    const res = await save({ text: TEXT, format: FORMAT, password: admin.password });
    expect(res.body.standard).toMatchObject({ text: TEXT, format: FORMAT, defaultFormat: DEFAULT_PROMPTS_FORMAT });
    expect((await loadPrompts(client)).standard.format).toBe(FORMAT);

    await testDraft(TEXT, 'standard', FORMAT);
    expect((await save({ text: TEXT, format: `${FORMAT} Be brief.`, password: admin.password })).status).toBe(409);
  });

  it('keeps the two prompts independent', async () => {
    await testDraft('Personal one', 'personalized');
    expect((await save({ text: 'Personal one', format: FORMAT, password: admin.password }, 'personalized')).status).toBe(200);
    const all = await loadPrompts(client);
    expect(all.personalized).toMatchObject({ customized: true, text: 'Personal one' });
    expect(all.standard).toMatchObject({ customized: false, text: DEFAULT_PROMPTS.standard });

    // a passing standard test does not allow saving the personalized text, and vice versa
    await testDraft('Standard one');
    expect((await save({ text: 'Standard one', format: FORMAT, password: admin.password }, 'personalized')).status).toBe(409);
  });

  it('rejects a wrong password with 403 (not 401) and saves nothing', async () => {
    await testDraft();
    const res = await save({ text: TEXT, format: FORMAT, password: 'not-my-password' });
    expect(res.status).toBe(403);
    expect((await loadPrompts(client)).standard.customized).toBe(false);
  });

  it('asks for the password when it is missing', async () => {
    await testDraft();
    expect((await save({ text: TEXT, format: FORMAT })).status).toBe(400);
    expect((await loadPrompts(client)).standard.customized).toBe(false);
  });

  it('rejects a save with no test at all', async () => {
    expect((await save({ text: TEXT, format: FORMAT, password: admin.password })).status).toBe(409);
    expect((await loadPrompts(client)).standard.customized).toBe(false);
  });

  it('rejects a save whose text differs from the tested text', async () => {
    await testDraft();
    expect((await save({ text: 'Edited after the test', format: FORMAT, password: admin.password })).status).toBe(409);
    expect((await loadPrompts(client)).standard.customized).toBe(false);
  });

  it('rejects a save after a later failed test, and an old test cannot be reused after saving', async () => {
    await testDraft();
    deps.runAnalysis.mockResolvedValueOnce(analysisResult({ validation: { ok: false, errors: ['x'] } }));
    await testDraft('Another');
    expect((await save({ text: TEXT, format: FORMAT, password: admin.password })).status).toBe(409);

    await testDraft();
    expect((await save({ text: TEXT, format: FORMAT, password: admin.password })).status).toBe(200);
    expect((await save({ text: TEXT, format: FORMAT, password: admin.password })).status).toBe(409);
  });

  it('rejects an expired test', async () => {
    await testDraft();
    await client.query(
      `UPDATE app_settings SET value = jsonb_set(value, '{standard,passed_at}', to_jsonb((now() - interval '31 minutes')::text)) WHERE key = $1`,
      [PROMPTS_TEST_SETTING]
    );
    expect((await save({ text: TEXT, format: FORMAT, password: admin.password })).status).toBe(409);
  });

  it('counts the revision up on each save', async () => {
    await testDraft();
    await save({ text: TEXT, format: FORMAT, password: admin.password });
    await testDraft('Second');
    const res = await save({ text: 'Second', format: FORMAT, password: admin.password });
    expect(res.body.standard.revision).toBe(2);
  });

  it('limits password attempts', async () => {
    await testDraft();
    let last;
    for (let i = 0; i < 11; i++) last = await save({ text: TEXT, format: FORMAT, password: 'wrong-guess' });
    expect(last.status).toBe(429);
  });
});

describe('resetting', () => {
  it('needs the password, then restores only that built-in prompt', async () => {
    await testDraft();
    await save({ text: TEXT, format: FORMAT, password: admin.password });
    await testDraft('Personal one', 'personalized');
    await save({ text: 'Personal one', format: FORMAT, password: admin.password }, 'personalized');

    expect((await reset({ password: 'nope' })).status).toBe(403);
    expect((await loadPrompts(client)).standard.customized).toBe(true);

    const res = await reset({ password: admin.password });
    expect(res.status).toBe(200);
    expect(res.body.standard).toMatchObject({ customized: false, text: DEFAULT_PROMPTS.standard });
    expect(res.body.personalized).toMatchObject({ customized: true, text: 'Personal one' });
  });
});
