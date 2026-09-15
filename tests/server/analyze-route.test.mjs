import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { createAnalyzeRouter } from '../../server/routes/analyze.mjs';
import { runProviderAnalysis } from '../../server/providers/dispatch.mjs';
import { searchWeb } from '../../server/webSearch.mjs';

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
    expect(res.body).toEqual({ text: '{"one_liner":"ok"}', usedWebSearch: false, validation: { ok: true, errors: [] } });
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
  it('reports shared:false when the active provider is not the shared tier', async () => {
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'claude', 'My Claude', 'claude-sonnet-4-6', true)`,
      [userId]
    );

    const res = await request(app).get('/api/analyze/quota');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ shared: false });
  });

  it('reports used/limit for the shared tier, with 0 used before any calls', async () => {
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'shared', 'Shared AI', 'ignored', true)`,
      [userId]
    );

    const res = await request(app).get('/api/analyze/quota');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ shared: true, used: 0, limit: 2 });
  });

  it('reflects usage already recorded today', async () => {
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'shared', 'Shared AI', 'ignored', true)`,
      [userId]
    );
    await client.query(
      `INSERT INTO ai_shared_usage (user_id, used_on, call_count, total_cost_usd) VALUES ($1, CURRENT_DATE, 1, 0.004)`,
      [userId]
    );

    const res = await request(app).get('/api/analyze/quota');

    expect(res.body).toEqual({ shared: true, used: 1, limit: 2 });
  });
});

describe('POST /api/analyze — shared tier quota', () => {
  it('allows calls up to the daily limit and tracks cost', async () => {
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'shared', 'Shared AI', 'ignored', true)`,
      [userId]
    );
    runProviderAnalysis.mockResolvedValue({
      text: '{"one_liner":"ok"}',
      usedWebSearch: false,
      usage: { input_tokens: 2000, output_tokens: 500 },
    });

    const res1 = await request(app).post('/api/analyze').send({ prompt: 'x' });
    expect(res1.status).toBe(200);
    const res2 = await request(app).post('/api/analyze').send({ prompt: 'x' });
    expect(res2.status).toBe(200);

    const { rows } = await client.query(
      'SELECT call_count, total_cost_usd FROM ai_shared_usage WHERE user_id = $1 AND used_on = CURRENT_DATE',
      [userId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].call_count).toBe(2);
    // Haiku pricing: 2000 in * $1/1M + 500 out * $5/1M = 0.0045, twice = 0.009
    expect(Number(rows[0].total_cost_usd)).toBeCloseTo(0.009, 4);
  });

  it('blocks a call past the daily limit with "Insufficient credit balance"', async () => {
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'shared', 'Shared AI', 'ignored', true)`,
      [userId]
    );
    await client.query(
      `INSERT INTO ai_shared_usage (user_id, used_on, call_count, total_cost_usd) VALUES ($1, CURRENT_DATE, 2, 0.01)`,
      [userId]
    );

    const res = await request(app).post('/api/analyze').send({ prompt: 'x' });

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('Insufficient credit balance');
    expect(runProviderAnalysis).not.toHaveBeenCalled();
  });

  it('does not apply the shared quota to non-shared providers', async () => {
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'claude', 'My Claude', 'claude-sonnet-4-6', true)`,
      [userId]
    );
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: true });

    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/api/analyze').send({ prompt: 'x' });
      expect(res.status).toBe(200);
    }
    const { rows } = await client.query('SELECT * FROM ai_shared_usage WHERE user_id = $1', [userId]);
    expect(rows).toHaveLength(0);
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
    expect(searchWeb).toHaveBeenCalledWith(expect.any(String), 'serp-test-key');
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
