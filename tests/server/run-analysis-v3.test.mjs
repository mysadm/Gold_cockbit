import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fixture from '../fixtures/analyst-request-v2.json';
import { collectEvidence } from '../../server/evidence.mjs';
import { runAnalysisV3 } from '../../server/runAnalysisV3.mjs';
import { OUTPUT_EXAMPLE } from '../../server/prompts/buildAnalysisPrompt.mjs';
import { createAnalyzeRouter } from '../../server/routes/analyze.mjs';
import { runProviderAnalysis } from '../../server/providers/dispatch.mjs';
vi.mock('../../server/evidence.mjs', () => ({ collectEvidence: vi.fn() }));
vi.mock('../../server/providers/dispatch.mjs', () => ({ runProviderAnalysis: vi.fn() }));
const snapshot = { ...fixture, schema_version: '2', previous_analysis: null };
const provider = { provider_type: 'custom', settings: {} };
const pack = { searchStatus: 'ok', usedWebSearch: true, evidenceIds: ['EV-001'], evidenceSources: [{ id: 'EV-001', title: 'Synthetic', date: '', link: 'https://example.com' }], evidencePack: [{ id: 'EV-001', title: 'Synthetic', date: '', snippet: 'Fixture only' }] };
beforeEach(() => {
  vi.resetAllMocks(); vi.unstubAllEnvs();
  collectEvidence.mockResolvedValue(structuredClone(pack));
  runProviderAnalysis.mockResolvedValue({ text: JSON.stringify(OUTPUT_EXAMPLE), usage: { input_tokens: 100, output_tokens: 50 } });
});
describe('compact pipeline', () => {
  it('sends identical prompts for all provider families', async () => {
    for (const provider_type of ['claude', 'shared', 'openai', 'openrouter', 'ollama', 'custom']) {
      const out = await runAnalysisV3({ ...provider, provider_type }, snapshot, runProviderAnalysis);
      expect(out.validation.ok).toBe(true);
      expect(out.evidenceSources).toEqual(pack.evidenceSources);
    }
    const calls = runProviderAnalysis.mock.calls;
    expect(new Set(calls.map(c => c[1])).size).toBe(1);
    expect(new Set(calls.map(c => c[2].system)).size).toBe(1);
    expect(calls[0][2]).toMatchObject({ expectJson: false, compact: true });
    expect(calls[0][1]).not.toContain('https://example.com');
  });
  it('retries once and sums reported usage', async () => {
    runProviderAnalysis.mockResolvedValueOnce({ text: '{}', usage: { input_tokens: 40, output_tokens: 2 } });
    const out = await runAnalysisV3(provider, snapshot, runProviderAnalysis);
    expect(out.validation.ok).toBe(true);
    expect(out.metrics.retries).toBe(1);
    expect(out.usage).toEqual({ input_tokens: 140, output_tokens: 52 });
    expect(runProviderAnalysis).toHaveBeenCalledTimes(2);
  });
  it('fails closed after two invalid answers and preserves the validation warning', async () => {
    runProviderAnalysis.mockResolvedValue({ text: '{}', truncated: true });
    const out = await runAnalysisV3(provider, snapshot, runProviderAnalysis);
    expect(runProviderAnalysis).toHaveBeenCalledTimes(2);
    expect(out.validation.ok).toBe(false);
    expect(out.result.primary_decision.action).toBe('insufficient_evidence');
    expect(out.result.suggested_weights).toEqual({ deesc: 35, base: 45, stag: 20 });
  });
  it('does not skip explicit analysis without evidence and cannot claim no change', async () => {
    collectEvidence.mockResolvedValue({ ...pack, searchStatus: 'disabled', usedWebSearch: false, evidenceIds: [], evidencePack: [], evidenceSources: [] });
    const out = await runAnalysisV3(provider, snapshot, runProviderAnalysis);
    expect(runProviderAnalysis).toHaveBeenCalledTimes(2);
    expect(out.result.status).toBe('insufficient_evidence');
  });
  it('caps partial-search confidence and honors cancellation before provider calls', async () => {
    collectEvidence.mockResolvedValue({ ...pack, searchStatus: 'partial' });
    const result = structuredClone(OUTPUT_EXAMPLE); result.primary_decision.confidence = 'high';
    runProviderAnalysis.mockResolvedValue({ text: JSON.stringify(result) });
    expect((await runAnalysisV3(provider, snapshot, runProviderAnalysis)).result.primary_decision.confidence).toBe('medium');
    runProviderAnalysis.mockClear();
    await expect(runAnalysisV3(provider, snapshot, runProviderAnalysis, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(runProviderAnalysis).not.toHaveBeenCalled();
  });
});
describe('compact route gate', () => {
  const app = () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [provider] }) };
    const a = express(); a.use(express.json()); a.use('/api/analyze', createAnalyzeRouter(db, 1)); return a;
  };
  it('defaults to legacy and refuses v3 while disabled', async () => {
    vi.stubEnv('ANALYST_CONTRACT_VERSION', 'v2');
    expect((await request(app()).get('/api/analyze/contract')).body.version).toBe('2');
    expect((await request(app()).post('/api/analyze').send({ contract_version: '3', snapshot })).status).toBe(409);
  });
  it('rejects malformed snapshots before provider calls', async () => {
    vi.stubEnv('ANALYST_CONTRACT_VERSION', 'v3');
    expect((await request(app()).post('/api/analyze').send({ contract_version: '3', snapshot: {} })).status).toBe(400);
    expect(runProviderAnalysis).not.toHaveBeenCalled();
  });
  it('uses server instructions, ignoring legacy prompt when v3 is explicit', async () => {
    vi.stubEnv('ANALYST_CONTRACT_VERSION', 'v3');
    const res = await request(app()).post('/api/analyze').send({ contract_version: '3', snapshot, prompt: 'CLIENT_OVERRIDE' });
    expect(res.status).toBe(200);
    expect(res.body.result.schema_version).toBe('3');
    expect(runProviderAnalysis.mock.calls[0][1]).not.toContain('CLIENT_OVERRIDE');
  });
});
