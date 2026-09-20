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
  it('records why validation failed in the metrics, and nothing when it passed', async () => {
    const ok = await runAnalysisV3(provider, snapshot, runProviderAnalysis);
    expect(ok.metrics.validationErrors).toEqual([]);

    runProviderAnalysis.mockReset();
    runProviderAnalysis.mockResolvedValue({ text: 'not json', usage: { input_tokens: 10, output_tokens: 3 } });
    const bad = await runAnalysisV3(provider, snapshot, runProviderAnalysis);
    expect(bad.validation.ok).toBe(false);
    expect(bad.metrics.validationErrors).toEqual(bad.validation.errors.slice(0, 6));
    expect(bad.metrics.validationErrors).toContain('response must be a JSON object');
  });
  describe('an over-limit amount in the optional DCA note', () => {
    const withDca = (dca, extra = {}) => ({ ...OUTPUT_EXAMPLE, reads: { ...OUTPUT_EXAMPLE.reads, dca }, ...extra });
    const answer = (obj) => ({ text: JSON.stringify(obj), usage: { input_tokens: 10, output_tokens: 5 } });

    it('drops only that note after the retry fails, keeps the rest, and says so', async () => {
      runProviderAnalysis.mockResolvedValue(answer(withDca('Deploy 100,000 EGP now')));

      const out = await runAnalysisV3(provider, snapshot, runProviderAnalysis);

      expect(runProviderAnalysis).toHaveBeenCalledTimes(2);
      expect(out.validation).toEqual({ ok: true, errors: [] });
      expect(out.result.reads.dca).toBeUndefined();
      expect(out.result.reads.egp).toBe(OUTPUT_EXAMPLE.reads.egp);
      expect(out.result.primary_decision.action).toBe(OUTPUT_EXAMPLE.primary_decision.action);
      expect(out.result.assumptions.at(-1)).toMatch(/DCA/);
      expect(out.metrics.dcaReadOmitted).toBe(true);
      expect(JSON.parse(out.text).reads.dca).toBeUndefined();
    });

    it('leaves an in-limit DCA note alone', async () => {
      runProviderAnalysis.mockResolvedValue(answer(withDca('Deploy 40,000 EGP now')));

      const out = await runAnalysisV3(provider, snapshot, runProviderAnalysis);

      expect(out.validation.ok).toBe(true);
      expect(out.result.reads.dca).toBe('Deploy 40,000 EGP now');
      expect(out.metrics.dcaReadOmitted).toBe(false);
      expect(runProviderAnalysis).toHaveBeenCalledTimes(1);
    });

    it('does NOT rescue an answer that has other validation errors', async () => {
      runProviderAnalysis.mockResolvedValue(answer(withDca('Deploy 100,000 EGP now', { suggested_weights: { deesc: 35, base: 45, stag: 25 } })));

      const out = await runAnalysisV3(provider, snapshot, runProviderAnalysis);

      expect(out.validation.ok).toBe(false);
      expect(out.result.status).toBe('insufficient_evidence');
      expect(out.metrics.dcaReadOmitted).toBe(false);
    });

    it('writes the omission note in Arabic for an Arabic analysis', async () => {
      const ar = { ...snapshot, locale: 'ar' };
      const arAnswer = {
        ...OUTPUT_EXAMPLE,
        primary_decision: { ...OUTPUT_EXAMPLE.primary_decision, headline: 'انتظر', next_trigger: 'راقب السوق', invalidation: 'تغير الظروف' },
        evidence: [{ ...OUTPUT_EXAMPLE.evidence[0], implication: 'تأثير الدليل' }],
        reads: { egp: 'قراءة الجنيه', dca: 'ضخ ١٠٠٬٠٠٠ جنيه الآن' },
      };
      runProviderAnalysis.mockResolvedValue(answer(arAnswer));

      const out = await runAnalysisV3(provider, ar, runProviderAnalysis);

      expect(out.validation.ok).toBe(true);
      expect(out.result.reads.dca).toBeUndefined();
      expect(out.result.assumptions.at(-1)).toMatch(/[\u0621-\u064A]/);
    });
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
