import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { createAnalyzeRouter } from '../../server/routes/analyze.mjs';
import { runProviderAnalysis } from '../../server/providers/dispatch.mjs';

vi.mock('../../server/providers/dispatch.mjs', () => ({
  runProviderAnalysis: vi.fn(),
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
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: true });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: '{"one_liner":"ok"}', usedWebSearch: true });
    expect(runProviderAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ id: rows[0].id, provider_type: 'claude' }),
      'analyze this'
    );
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
