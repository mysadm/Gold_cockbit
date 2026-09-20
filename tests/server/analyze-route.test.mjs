import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { createAnalyzeRouter } from '../../server/routes/analyze.mjs';
import { runProviderAnalysis } from '../../server/providers/dispatch.mjs';
import { searchWeb } from '../../server/webSearch.mjs';
import fixture from '../fixtures/analyst-request-v2.json';

vi.mock('../../server/providers/dispatch.mjs', () => ({
  runProviderAnalysis: vi.fn(),
}));
vi.mock('../../server/webSearch.mjs', () => ({
  searchWeb: vi.fn(),
}));

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;
let app;
let userId;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  userId = await ensureDefaultUser(client);
  app = express();
  app.use(express.json());
  app.use('/api/analyze', createAnalyzeRouter(client, userId));
  runProviderAnalysis.mockReset();
  searchWeb.mockReset();
});

afterEach(async () => {
  await client.end();
});

describe('POST /api/analyze', () => {
  it('returns 400 when no provider is active', async () => {
    const res = await request(app).post('/api/analyze').send({ prompt: 'hello' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No active provider/);
    expect(runProviderAnalysis).not.toHaveBeenCalled();
  });

  it('dispatches to the active provider and returns its result', async () => {
    const { rows } = await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'claude', 'Claude', 'claude-sonnet-4-6', true) RETURNING *`,
      [userId]
    );
    // runProviderAnalysis's own usedWebSearch is always overwritten by
    // whether the evidence pack actually ran (see analyze.mjs) — no
    // SERPAPI_API_KEY is set in this test, so the pack does not run and the
    // response reports false regardless of what the provider call returns.
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: true });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ text: '{"one_liner":"ok"}', usedWebSearch: false, evidenceSources: [], validation: { ok: true, errors: [] } });
    expect(runProviderAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ id: rows[0].id, provider_type: 'claude' }),
      'analyze this'
    );
    expect(runProviderAnalysis).toHaveBeenCalledTimes(1);
  });

  it('repairs malformed-but-recoverable JSON before returning it', async () => {
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'ollama', 'Local', 'gemma4', true)`,
      [userId]
    );
    // Missing the closing ']' for trends before suggested_weights starts —
    // the exact failure mode weaker local models produce.
    const broken = '{"one_liner": "x", "trends": ["a", "suggested_weights": {"deesc": 33, "base": 34, "stag": 33}, "weights_reasoning": "y", "tranche2": {"verdict": "wait", "reasoning": "z"}, "egp_read": "w"}';
    runProviderAnalysis.mockResolvedValue({ text: broken, usedWebSearch: false });

    const res = await request(app).post('/api/analyze').send({ prompt: 'x' });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.text);
    expect(parsed.one_liner).toBe('x');
    expect(parsed.suggested_weights).toEqual({ deesc: 33, base: 34, stag: 33 });
    expect(parsed.tranche2).toEqual({ verdict: 'wait', reasoning: 'z' });
  });

  it('returns validation:{ok:true, errors:[]} for a clean response, with no retry', async () => {
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'claude', 'Claude', 'claude-sonnet-4-6', true)`,
      [userId]
    );
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.status).toBe(200);
    expect(res.body.validation).toEqual({ ok: true, errors: [] });
    expect(runProviderAnalysis).toHaveBeenCalledTimes(1);
  });

  it('retries once on a hard validation failure and returns the corrected response when the retry passes', async () => {
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'claude', 'Claude', 'claude-sonnet-4-6', true)`,
      [userId]
    );
    // First attempt: weights don't sum to 100 — a hard validation failure.
    // Second attempt (the corrective retry): fixed weights, passes validation.
    runProviderAnalysis
      .mockResolvedValueOnce({
        text: '{"primary_decision":{"headline":"h","action":"buy","confidence":"high"},"suggested_weights":{"deesc":30,"base":40,"stag":20}}',
        usedWebSearch: false,
      })
      .mockResolvedValueOnce({
        text: '{"primary_decision":{"headline":"h","action":"buy","confidence":"high"},"suggested_weights":{"deesc":30,"base":40,"stag":30}}',
        usedWebSearch: false,
      });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.status).toBe(200);
    expect(res.body.validation).toEqual({ ok: true, errors: [] });
    expect(runProviderAnalysis).toHaveBeenCalledTimes(2);
    const parsed = JSON.parse(res.body.text);
    expect(parsed.suggested_weights).toEqual({ deesc: 30, base: 40, stag: 30 });
  });

  it('forces primary_decision.action to insufficient_evidence when both the original and the retry fail validation', async () => {
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'claude', 'Claude', 'claude-sonnet-4-6', true)`,
      [userId]
    );
    // Both attempts return weights that don't sum to 100 — the retry never
    // corrects the problem, so the route must force a safe downgrade rather
    // than silently returning an unverified analysis.
    runProviderAnalysis.mockResolvedValue({
      text: '{"primary_decision":{"headline":"h","action":"buy","confidence":"high"},"suggested_weights":{"deesc":30,"base":40,"stag":20}}',
      usedWebSearch: false,
    });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.status).toBe(200);
    expect(res.body.validation.ok).toBe(false);
    expect(res.body.validation.errors).toEqual(['suggested_weights sums to 90, not 100']);
    expect(runProviderAnalysis).toHaveBeenCalledTimes(2);
    const parsed = JSON.parse(res.body.text);
    expect(parsed.primary_decision.action).toBe('insufficient_evidence');
  });

  it('does not count dca_read toward evidenceCoverageRatio, so an uncited DCA amount never caps confidence at medium', async () => {
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'claude', 'Claude', 'claude-sonnet-4-6', true)`,
      [userId]
    );
    // dca_read states an EGP amount with no evidence_ids — that's correct,
    // not a violation: it's the user's own plan data (validated separately
    // by checkDcaAmountWithinSnapshot), not an evidence-backed market claim.
    // No other field here states a number, so if dca_read were wrongly
    // counted as a "claim" this response's evidenceCoverageRatio would drop
    // from 1 to 0 and cap confidence at 'medium' even though validation
    // passes cleanly and the model reported 'high'.
    runProviderAnalysis.mockResolvedValue({
      text: JSON.stringify({
        primary_decision: { headline: 'h', action: 'buy', confidence: 'high' },
        suggested_weights: { deesc: 33, base: 34, stag: 33 },
        weights_reasoning: { text: 'steady macro backdrop supports current allocation', evidence_ids: [] },
        dca_read: { text: 'Invest 5000 EGP into this tranche', evidence_ids: [] },
      }),
      usedWebSearch: false,
    });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.status).toBe(200);
    expect(res.body.validation).toEqual({ ok: true, errors: [] });
    expect(runProviderAnalysis).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(res.body.text);
    expect(parsed.primary_decision.confidence).toBe('high');
  });

  it('does not force insufficient_evidence for a numeric claim when web search is disabled and no evidence pack exists', async () => {
    // provider's own "Web search" toggle is off (settings.webSearch: false)
    // and no SERPAPI_API_KEY is set in this test environment, so evidenceIds
    // is []. Before the fix, checkClaimField's citation-required rule fired
    // unconditionally, so any numeric claim (here, egp_read's "3%") hard-
    // failed both the original attempt and the retry — since there are no
    // valid evidence IDs to cite either way — and got forced to
    // insufficient_evidence on every single analysis with search off.
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active, settings)
       VALUES ($1, 'claude', 'Claude', 'claude-sonnet-4-6', true, $2)`,
      [userId, JSON.stringify({ webSearch: false })]
    );
    runProviderAnalysis.mockResolvedValue({
      text: JSON.stringify({
        primary_decision: { headline: 'h', action: 'buy', confidence: 'high' },
        suggested_weights: { deesc: 33, base: 34, stag: 33 },
        egp_read: { text: 'the pound weakened 3% this week', evidence_ids: [] },
      }),
      usedWebSearch: false,
    });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.status).toBe(200);
    expect(res.body.validation).toEqual({ ok: true, errors: [] });
    expect(runProviderAnalysis).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(res.body.text);
    expect(parsed.primary_decision.action).toBe('buy');
  });

  it('returns 502 when the provider call fails', async () => {
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'claude', 'Claude', 'claude-sonnet-4-6', true)`,
      [userId]
    );
    runProviderAnalysis.mockRejectedValue(new Error('HTTP 500'));

    const res = await request(app).post('/api/analyze').send({ prompt: 'x' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('HTTP 500');
  });
});

describe('GET /api/analyze/quota', () => {
  it('reports used/limit for a regular user, with 0 used before any calls', async () => {
    const res = await request(app).get('/api/analyze/quota');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ capped: true, used: 0, limit: 3 });
  });

  it("reflects a per-user limit set by the admin and today's recorded usage", async () => {
    await client.query('UPDATE users SET daily_ai_limit = 5 WHERE id = $1', [userId]);
    await client.query(
      `INSERT INTO ai_shared_usage (user_id, used_on, call_count, total_cost_usd) VALUES ($1, CURRENT_DATE, 2, 0)`,
      [userId]
    );
    const res = await request(app).get('/api/analyze/quota');
    expect(res.body).toEqual({ capped: true, used: 2, limit: 5 });
  });

  it('reports capped:false for an admin', async () => {
    await client.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [userId]);
    const res = await request(app).get('/api/analyze/quota');
    expect(res.body).toEqual({ capped: false });
  });
});

describe('GET /api/analyze/provider', () => {
  const insertAdmin = async () => {
    const { rows } = await client.query(
      `INSERT INTO users (email, role, status) VALUES ('admin@x.com', 'admin', 'active') RETURNING id`
    );
    return rows[0].id;
  };

  it("returns the provider owned by providerOwnerId with only whitelisted fields", async () => {
    const adminId = await insertAdmin();
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, base_url, api_key, model, settings, is_active)
       VALUES ($1, 'openai', 'Admin OpenAI', 'http://secret.internal', 'sk-secret', 'gpt-x',
               '{"webSearch": false, "extra": {"token": "t"}, "temperature": 0.3}', true)`,
      [adminId]
    );
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'claude', 'Caller Own', 'm', true)`,
      [userId]
    );
    const adminApp = express();
    adminApp.use(express.json());
    adminApp.use('/api/analyze', createAnalyzeRouter(client, userId, { providerOwnerId: adminId }));

    const res = await request(adminApp).get('/api/analyze/provider');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['provider']);
    expect(Object.keys(res.body.provider).sort()).toEqual(['id', 'is_active', 'label', 'model', 'provider_type', 'settings']);
    expect(res.body.provider).toMatchObject({ provider_type: 'openai', label: 'Admin OpenAI', model: 'gpt-x', is_active: true, settings: { webSearch: false } });
    expect(Object.keys(res.body.provider.settings)).toEqual(['webSearch']);
    expect(JSON.stringify(res.body)).not.toMatch(/sk-secret|secret\.internal|api_key|base_url|token/);
  });

  it('omits webSearch when the provider does not set it', async () => {
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'claude', 'Plain', 'm', true)`,
      [userId]
    );
    const res = await request(app).get('/api/analyze/provider');
    expect(res.body.provider.settings).toEqual({});
  });

  it('returns { provider: null } when none is active', async () => {
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'claude', 'Inactive', 'm', false)`,
      [userId]
    );
    const res = await request(app).get('/api/analyze/provider');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ provider: null });
  });
});

describe('POST /api/analyze — per-user daily cap', () => {
  const insertProvider = (type = 'claude', label = 'My Claude', owner = userId) =>
    client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, $2, $3, 'some-model', true)`,
      [owner, type, label]
    );
  const usageRows = () =>
    client.query('SELECT call_count, total_cost_usd FROM ai_shared_usage WHERE user_id = $1 AND used_on = CURRENT_DATE', [userId]);

  it('records one use per successful analysis for any provider type', async () => {
    await insertProvider('claude');
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });
    for (let i = 0; i < 2; i++) {
      expect((await request(app).post('/api/analyze').send({ prompt: 'x' })).status).toBe(200);
    }
    const { rows } = await usageRows();
    expect(rows[0].call_count).toBe(2);
    expect(Number(rows[0].total_cost_usd)).toBe(0);
  });

  it('tracks Haiku-priced cost when the provider is the shared tier', async () => {
    await insertProvider('shared', 'Shared AI');
    runProviderAnalysis.mockResolvedValue({
      text: '{"one_liner":"ok"}',
      usedWebSearch: false,
      usage: { input_tokens: 2000, output_tokens: 500 },
    });
    await request(app).post('/api/analyze').send({ prompt: 'x' });
    await request(app).post('/api/analyze').send({ prompt: 'x' });
    const { rows } = await usageRows();
    expect(rows[0].call_count).toBe(2);
    // 2000 in * $1/1M + 500 out * $5/1M = 0.0045, twice = 0.009
    expect(Number(rows[0].total_cost_usd)).toBeCloseTo(0.009, 4);
  });

  it('blocks a call past the limit with 429 and never calls the provider', async () => {
    await insertProvider('claude');
    await client.query(
      `INSERT INTO ai_shared_usage (user_id, used_on, call_count, total_cost_usd) VALUES ($1, CURRENT_DATE, 3, 0)`,
      [userId]
    );
    const res = await request(app).post('/api/analyze').send({ prompt: 'x' });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'Daily analysis limit reached', used: 3, limit: 3 });
    expect(runProviderAnalysis).not.toHaveBeenCalled();
  });

  it("honours a per-user limit change (limit 1 blocks the second call)", async () => {
    await insertProvider('claude');
    await client.query('UPDATE users SET daily_ai_limit = 1 WHERE id = $1', [userId]);
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });
    expect((await request(app).post('/api/analyze').send({ prompt: 'x' })).status).toBe(200);
    expect((await request(app).post('/api/analyze').send({ prompt: 'x' })).status).toBe(429);
  });

  it('does not cap or record usage for an admin', async () => {
    await insertProvider('claude');
    await client.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [userId]);
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/api/analyze').send({ prompt: 'x' })).status).toBe(200);
    }
    expect((await usageRows()).rows).toHaveLength(0);
  });

  it('does not consume quota when the provider call fails', async () => {
    await insertProvider('claude');
    runProviderAnalysis.mockRejectedValue(new Error('HTTP 500'));
    expect((await request(app).post('/api/analyze').send({ prompt: 'x' })).status).toBe(502);
    expect((await usageRows()).rows).toHaveLength(0);
  });

  it('enforces the limit atomically under concurrent requests', async () => {
    await insertProvider('claude');
    await client.query('UPDATE users SET daily_ai_limit = 2 WHERE id = $1', [userId]);
    runProviderAnalysis.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ text: '{"one_liner":"ok"}', usedWebSearch: false }), 50))
    );
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => request(app).post('/api/analyze').send({ prompt: 'x' }))
    );
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 429, 429, 429]);
    expect(runProviderAnalysis).toHaveBeenCalledTimes(2);
    expect((await usageRows()).rows[0].call_count).toBe(2);
  });

  it('releases the reserved use when the analysis fails', async () => {
    await insertProvider('claude');
    await client.query(
      `INSERT INTO ai_shared_usage (user_id, used_on, call_count, total_cost_usd) VALUES ($1, CURRENT_DATE, 2, 0)`,
      [userId]
    );
    runProviderAnalysis.mockRejectedValueOnce(new Error('HTTP 500'));
    expect((await request(app).post('/api/analyze').send({ prompt: 'x' })).status).toBe(502);
    expect((await usageRows()).rows[0].call_count).toBe(2);
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });
    expect((await request(app).post('/api/analyze').send({ prompt: 'x' })).status).toBe(200);
    expect((await usageRows()).rows[0].call_count).toBe(3);
  });

  it('a limit of 0 blocks with 429 and creates no usage row', async () => {
    await insertProvider('claude');
    await client.query('UPDATE users SET daily_ai_limit = 0 WHERE id = $1', [userId]);
    const res = await request(app).post('/api/analyze').send({ prompt: 'x' });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'Daily analysis limit reached', used: 0, limit: 0 });
    expect(runProviderAnalysis).not.toHaveBeenCalled();
    expect((await usageRows()).rows).toHaveLength(0);
  });

  describe('compact (v3) analyses and the daily allowance', () => {
    const snapshot = { ...fixture, schema_version: '2', previous_analysis: null };
    const weights = Object.fromEntries(snapshot.scenarios.map((sc) => [sc.key, sc.weight_pct]));
    const validInsufficient = {
      schema_version: '3', status: 'insufficient_evidence',
      primary_decision: { action: 'insufficient_evidence', horizon: 'now', confidence: 'low', headline: 'h', next_trigger: 'n', invalidation: 'i' },
      evidence: [], suggested_weights: weights, weight_changes: [], reads: { egp: 'e' }, assumptions: [], missing_inputs: [],
    };
    const post = () => request(app).post('/api/analyze').send({ contract_version: '3', snapshot });
    const used = async () => (await request(app).get('/api/analyze/quota')).body.used;

    it('gives the use back when the model answer fails validation (fallback result)', async () => {
      vi.stubEnv('ANALYST_CONTRACT_VERSION', 'v3');
      try {
        await insertProvider('claude');
        runProviderAnalysis.mockResolvedValue({ text: 'not json at all', usage: { input_tokens: 10, output_tokens: 5 } });

        const res = await post();

        expect(res.status).toBe(200);
        expect(res.body.validation.ok).toBe(false);
        expect(await used()).toBe(0);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('still counts a valid answer, even when the model concludes there is not enough evidence', async () => {
      vi.stubEnv('ANALYST_CONTRACT_VERSION', 'v3');
      try {
        await insertProvider('claude');
        runProviderAnalysis.mockResolvedValue({ text: JSON.stringify(validInsufficient), usage: { input_tokens: 10, output_tokens: 5 } });

        const res = await post();

        expect(res.status).toBe(200);
        expect(res.body.validation.ok).toBe(true);
        expect(await used()).toBe(1);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  it("uses the provider owned by providerOwnerId (the admin's), not the caller's", async () => {
    const { rows } = await client.query(
      `INSERT INTO users (email, role, status) VALUES ('admin@x.com', 'admin', 'active') RETURNING id`
    );
    const adminId = rows[0].id;
    await insertProvider('claude', 'Admin Claude', adminId);
    await insertProvider('claude', 'Caller Own', userId);
    const adminApp = express();
    adminApp.use(express.json());
    adminApp.use('/api/analyze', createAnalyzeRouter(client, userId, { providerOwnerId: adminId }));
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });

    const res = await request(adminApp).post('/api/analyze').send({ prompt: 'x' });

    expect(res.status).toBe(200);
    expect(runProviderAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Admin Claude' }),
      expect.anything()
    );
  });
});

describe('POST /api/analyze — web search augmentation', () => {
  const previousKey = process.env.SERPAPI_API_KEY;

  afterEach(() => {
    if (previousKey === undefined) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = previousKey;
  });

  it('augments the prompt with search results and reports usedWebSearch:true when SERPAPI_API_KEY is set', async () => {
    process.env.SERPAPI_API_KEY = 'serp-test-key';
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'ollama', 'Local', 'gemma4', true)`,
      [userId]
    );
    searchWeb.mockResolvedValue([
      { title: 'Gold hits record high', snippet: 'Prices surged on Fed cut bets', link: 'https://example.com/1' },
    ]);
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.status).toBe(200);
    expect(res.body.usedWebSearch).toBe(true);
    expect(res.body.searchStatus).toBe('ok');
    expect(res.body.evidenceSources).toEqual([{id:'EV-001',title:'Gold hits record high',link:'https://example.com/1',date:''}]);
    expect(searchWeb).toHaveBeenCalledWith(expect.any(String), 'serp-test-key', expect.any(Object));
    const [, augmentedPrompt] = runProviderAnalysis.mock.calls[0];
    expect(augmentedPrompt).toContain('Gold hits record high');
    expect(augmentedPrompt).toContain('Prices surged on Fed cut bets');
    expect(augmentedPrompt).toContain('analyze this');
  });

  it('tags injected search results with stable evidence IDs and instructs the model to cite them', async () => {
    process.env.SERPAPI_API_KEY = 'serp-test-key';
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'ollama', 'Local', 'gemma4', true)`,
      [userId]
    );
    searchWeb.mockResolvedValue([
      { title: 'Gold hits record high', snippet: 'Prices surged on Fed cut bets', link: 'https://example.com/1', date: '2 hours ago' },
      { title: 'Fed holds rates steady', snippet: 'FOMC statement cites inflation risk', link: 'https://example.com/2', date: '' },
    ]);
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.status).toBe(200);
    const [, augmentedPrompt] = runProviderAnalysis.mock.calls[0];
    expect(augmentedPrompt).toContain('[EV-001]');
    expect(augmentedPrompt).toContain('[EV-002]');
    expect(augmentedPrompt).toContain('Gold hits record high');
    expect(augmentedPrompt).toMatch(/cite the ID/i);
    expect(augmentedPrompt).toMatch(/[Nn]ever invent an ID/);
  });


  it('does not augment the prompt when SERPAPI_API_KEY is not configured', async () => {
    delete process.env.SERPAPI_API_KEY;
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'ollama', 'Local', 'gemma4', true)`,
      [userId]
    );
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.status).toBe(200);
    expect(res.body.usedWebSearch).toBe(false);
    expect(searchWeb).not.toHaveBeenCalled();
    expect(runProviderAnalysis).toHaveBeenCalledWith(expect.anything(), 'analyze this');
  });

  it('falls back to the unaugmented prompt when the search call fails', async () => {
    process.env.SERPAPI_API_KEY = 'serp-test-key';
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'ollama', 'Local', 'gemma4', true)`,
      [userId]
    );
    searchWeb.mockRejectedValue(new Error('SerpAPI down'));
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.status).toBe(200);
    expect(res.body.usedWebSearch).toBe(false);
    expect(runProviderAnalysis).toHaveBeenCalledWith(expect.anything(), 'analyze this');
  });

  it('searches for claude providers too, now that native web search has been retired — evidence gathering is uniform across provider types', async () => {
    process.env.SERPAPI_API_KEY = 'serp-test-key';
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'claude', 'Claude', 'claude-sonnet-4-6', true)`,
      [userId]
    );
    searchWeb.mockResolvedValue([
      { title: 'Gold hits record high', snippet: 'Prices surged on Fed cut bets', link: 'https://example.com/1' },
    ]);
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.status).toBe(200);
    expect(res.body.usedWebSearch).toBe(true);
    expect(searchWeb).toHaveBeenCalled();
    const [, augmentedPrompt] = runProviderAnalysis.mock.calls[0];
    expect(augmentedPrompt).toContain('Gold hits record high');
  });

  it.each(['shared', 'openai', 'openrouter', 'custom'])(
    'augments the prompt with search results for %s, the same as ollama, since no provider type has a working native search anymore',
    async (providerType) => {
      process.env.SERPAPI_API_KEY = 'serp-test-key';
      await client.query(
        `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
         VALUES ($1, $2, 'Provider', 'some-model', true)`,
        [userId, providerType]
      );
      searchWeb.mockResolvedValue([
        { title: 'Gold hits record high', snippet: 'Prices surged on Fed cut bets', link: 'https://example.com/1' },
      ]);
      runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });

      const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

      expect(res.status).toBe(200);
      expect(res.body.usedWebSearch).toBe(true);
      const [, augmentedPrompt] = runProviderAnalysis.mock.calls[0];
      expect(augmentedPrompt).toContain('Gold hits record high');
      expect(augmentedPrompt).toContain('analyze this');
    }
  );
});
