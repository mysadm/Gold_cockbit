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
  // .env.dev sets ANALYST_V4=1 for the running dev API; this whole file exercises the real (v3)
  // pipeline regardless of what the shell exports — see tests/server/run-analysis-v4.test.mjs.
  vi.stubEnv('ANALYST_V4', '');
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

  describe('"no material change" when the previous suggestion was never applied', () => {
    const answer = (obj) => ({ text: JSON.stringify(obj), usage: { input_tokens: 10, output_tokens: 5 } });
    const prior = (weights, over = {}) => ({ ...snapshot, previous_analysis: { generated_at: '2026-09-17T08:00:00Z', action: 'wait', confidence: 'medium', suggested_weights: weights, ...over } });
    const unchanged = { ...OUTPUT_EXAMPLE, status: 'no_material_change' };

    it('reports it as a material change with the current weights instead of rejecting the analysis', async () => {
      runProviderAnalysis.mockResolvedValue(answer(unchanged));

      const out = await runAnalysisV3(provider, prior({ deesc: 30, base: 50, stag: 20 }), runProviderAnalysis);

      expect(out.validation).toEqual({ ok: true, errors: [] });
      expect(out.result.status).toBe('material_change');
      expect(out.result.suggested_weights).toEqual({ deesc: 35, base: 45, stag: 20 });
      expect(out.result.primary_decision.action).toBe('wait');
      expect(out.metrics.statusCorrected).toBe(true);
    });

    it('keeps a genuine no_material_change untouched', async () => {
      runProviderAnalysis.mockResolvedValue(answer(unchanged));

      const out = await runAnalysisV3(provider, prior({ deesc: 35, base: 45, stag: 20 }), runProviderAnalysis);

      expect(out.result.status).toBe('no_material_change');
      expect(out.metrics.statusCorrected).toBe(false);
    });

    it('does not rescue an answer with other validation errors', async () => {
      runProviderAnalysis.mockResolvedValue(answer({ ...unchanged, suggested_weights: { deesc: 35, base: 45, stag: 25 } }));

      const out = await runAnalysisV3(provider, prior({ deesc: 30, base: 50, stag: 20 }), runProviderAnalysis);

      expect(out.validation.ok).toBe(false);
      expect(out.result.status).toBe('insufficient_evidence');
      expect(out.metrics.statusCorrected).toBe(false);
    });
  });

  it('sends the admin-supplied system prompt, with no separate built-in scope block', async () => {
    const market = { ...snapshot, analysis_scope: 'market' };
    await runAnalysisV3(provider, market, runProviderAnalysis, { prompts: { system: 'CUSTOM SYSTEM' } });
    const [, prompt, options] = runProviderAnalysis.mock.calls[0];
    expect(options.system).toBe('CUSTOM SYSTEM');
    expect(prompt).not.toContain('STANDARD MARKET ANALYSIS');
  });
  it('puts a supplied output format after the data', async () => {
    await runAnalysisV3(provider, snapshot, runProviderAnalysis, { prompts: { system: 'CUSTOM SYSTEM', format: 'CUSTOM FORMAT in {LANG}' } });
    const prompt = runProviderAnalysis.mock.calls[0][1];
    expect(prompt.endsWith('CUSTOM FORMAT in English')).toBe(true);
    expect(prompt).not.toContain('OUTPUT_SCHEMA');
  });
  it('hands each raw model answer to onRawAnswer, before validation', async () => {
    runProviderAnalysis.mockResolvedValue({ text: 'not json', usage: { input_tokens: 1, output_tokens: 1 } });
    const seen = [];
    const out = await runAnalysisV3(provider, snapshot, runProviderAnalysis, { onRawAnswer: (t) => seen.push(t) });
    expect(seen).toEqual(['not json', 'not json']);
    expect(out.validation.ok).toBe(false);
    expect(out.text).not.toContain('not json');
  });
  it('falls back to the built-in prompts when none are supplied', async () => {
    await runAnalysisV3(provider, { ...snapshot, analysis_scope: 'market' }, runProviderAnalysis);
    const [, prompt, options] = runProviderAnalysis.mock.calls[0];
    expect(options.system).toContain("Gold Cockpit's decision analyst");
    expect(prompt).toContain('STANDARD MARKET ANALYSIS');
  });
  describe('extra fields the model adds to its answer', () => {
    const answer = (obj) => ({ text: JSON.stringify(obj), usage: { input_tokens: 10, output_tokens: 5 } });
    const changed = {
      ...OUTPUT_EXAMPLE,
      suggested_weights: { deesc: 30, base: 50, stag: 20 },
      weight_changes: [
        { scenario: 'deesc', from: 35, to: 30, evidence_ids: ['EV-001'], reason: 'extra prose field' },
        { scenario: 'base', from: 45, to: 50, evidence_ids: ['EV-001'], confidence: 'high' },
      ],
    };

    it('removes unknown fields instead of rejecting an otherwise valid answer', async () => {
      runProviderAnalysis.mockResolvedValue(answer({ ...changed, search_performed: false, reads: { ...OUTPUT_EXAMPLE.reads, extra: 'x' } }));

      const out = await runAnalysisV3(provider, snapshot, runProviderAnalysis);

      expect(out.validation).toEqual({ ok: true, errors: [] });
      expect(out.result.weight_changes).toEqual([
        { scenario: 'deesc', from: 35, to: 30, evidence_ids: ['EV-001'] },
        { scenario: 'base', from: 45, to: 50, evidence_ids: ['EV-001'] },
      ]);
      expect(out.result.search_performed).toBeUndefined();
      expect(out.result.reads.extra).toBeUndefined();
      expect(out.metrics.fieldsStripped).toBe(true);
      expect(JSON.parse(out.text).search_performed).toBeUndefined();
    });

    it('also drops an over-limit DCA note in the same answer', async () => {
      const withDca = { ...changed, reads: { ...OUTPUT_EXAMPLE.reads, dca: 'Deploy 100,000 EGP now' } };
      runProviderAnalysis.mockResolvedValue(answer(withDca));

      const out = await runAnalysisV3(provider, snapshot, runProviderAnalysis);

      expect(out.validation.ok).toBe(true);
      expect(out.result.reads.dca).toBeUndefined();
      expect(out.result.weight_changes[0]).not.toHaveProperty('reason');
      expect(out.metrics).toMatchObject({ fieldsStripped: true, dcaReadOmitted: true });
    });

    it('leaves a clean answer alone', async () => {
      const out = await runAnalysisV3(provider, snapshot, runProviderAnalysis);
      expect(out.metrics.fieldsStripped).toBe(false);
    });

    it('does not rescue an answer in a different layout, where the extra fields are only part of the problem', async () => {
      runProviderAnalysis.mockResolvedValue(answer({ as_of: 'x', evidence: [{ text: 'a' }], scenarios: {} }));

      const out = await runAnalysisV3(provider, snapshot, runProviderAnalysis);

      expect(out.validation.ok).toBe(false);
      expect(out.result.status).toBe('insufficient_evidence');
      expect(out.metrics.fieldsStripped).toBe(false);
    });

    it('does not rescue an answer whose weights are wrong even after stripping', async () => {
      runProviderAnalysis.mockResolvedValue(answer({ ...changed, suggested_weights: { deesc: 30, base: 50, stag: 25 } }));

      const out = await runAnalysisV3(provider, snapshot, runProviderAnalysis);

      expect(out.validation.ok).toBe(false);
      expect(out.metrics.fieldsStripped).toBe(false);
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
