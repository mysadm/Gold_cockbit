import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseCompactAnalysis } from '../../src/lib/analyst';
import { analyzeViaBackend } from '../../src/api/llmProviders';
import type { AnalysisSnapshot } from '../../src/lib/analysisSnapshot';
import fixture from '../fixtures/analyst-request-v2.json';
import { OUTPUT_EXAMPLE } from '../../server/prompts/buildAnalysisPrompt.mjs';
const snapshot = { ...fixture, schema_version: '2' } as AnalysisSnapshot;
afterEach(() => vi.unstubAllGlobals());
describe('compact client', () => {
  it('preserves the strict result and maps a compatibility view without invented content', () => {
    const view = parseCompactAnalysis(JSON.stringify(OUTPUT_EXAMPLE), snapshot, ['EV-001']);
    expect(view.compact_result).toEqual(OUTPUT_EXAMPLE);
    expect(view.primary_decision.reasons[0].evidence_ids).toEqual(['EV-001']);
    expect(view.suggested_weights).toEqual(OUTPUT_EXAMPLE.suggested_weights);
    expect(() => parseCompactAnalysis('{}', snapshot, [])).toThrow();
  });
  it('sends only snapshot and version to a v3 server, never constructs legacy prompt', async () => {
    const legacy = vi.fn(() => 'legacy');
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ version: '3' }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ text: '{}' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await analyzeViaBackend(legacy, snapshot);
    expect(result.contractVersion).toBe('3');
    expect(legacy).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ contract_version: '3', snapshot });
  });
  it('keeps legacy compatibility for an older server without negotiation', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ status: 404 }).mockResolvedValueOnce({ ok: true, json: async () => ({ text: '{}' }) });
    vi.stubGlobal('fetch', fetchMock);
    expect((await analyzeViaBackend('legacy', snapshot)).contractVersion).toBe('2');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).prompt).toBe('legacy');
  });
});
