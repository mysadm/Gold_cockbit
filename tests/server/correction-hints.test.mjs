import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fixture from '../fixtures/analyst-request-v2.json';
import { correctionHints } from '../../server/prompts/correctionHints.mjs';
import { collectEvidence } from '../../server/evidence.mjs';
import { runAnalysisV3 } from '../../server/runAnalysisV3.mjs';
import { OUTPUT_EXAMPLE, buildAnalysisPrompt } from '../../server/prompts/buildAnalysisPrompt.mjs';
import { runProviderAnalysis } from '../../server/providers/dispatch.mjs';

vi.mock('../../server/evidence.mjs', () => ({ collectEvidence: vi.fn() }));
vi.mock('../../server/providers/dispatch.mjs', () => ({ runProviderAnalysis: vi.fn() }));

const snapshot = { ...fixture, schema_version: '2', previous_analysis: null };
const dcaSnapshot = { ...snapshot, dca: { ...(snapshot.dca ?? {}), current_installment_limit_egp: 120000 } };
const pack = { searchStatus: 'ok', usedWebSearch: true, evidenceIds: ['EV-001'], evidenceSources: [{ id: 'EV-001', title: 'Synthetic', date: '', link: 'https://example.com' }], evidencePack: [{ id: 'EV-001', title: 'Synthetic', date: '', snippet: 'x' }] };

describe('correctionHints', () => {
  it('explains how to fix a weights total that is not 100', () => {
    const hints = correctionHints(['suggested_weights must be numeric percentages totaling 100'], snapshot);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('deesc + base + stag must equal exactly 100');
    expect(hints[0]).toContain('copy the snapshot weights');
  });

  it('tells the model to drop currency amounts from the DCA note and names the actual limit', () => {
    const hints = correctionHints(['DCA amount exceeds current installment limit'], dcaSnapshot);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('reads.dca');
    expect(hints[0]).toContain('120000');
    expect(hints[0]).toMatch(/do not (write|mention).*(total|budget)/i);
  });

  it('tells the model to use material_change when the previous suggestion differs from the current weights', () => {
    const hints = correctionHints(['no_material_change must preserve current and prior weights'], snapshot);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('material_change');
    expect(hints[0]).toMatch(/previous.*(differ|not applied)/i);
  });

  it('tells the model to remove fields that are not in the output example, once however many items had them', () => {
    const hints = correctionHints(['weight change: unknown fields', 'weight change: unknown fields', 'response: unknown fields'], snapshot);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatch(/only the fields (shown )?in the (output )?example/i);
    expect(hints[0]).toContain('weight_changes');
  });

  it('gives no hint for errors it does not know, and one hint per known error', () => {
    expect(correctionHints(['something else'], snapshot)).toEqual([]);
    expect(correctionHints(['DCA amount exceeds current installment limit', 'suggested_weights must be numeric percentages totaling 100', 'x'], dcaSnapshot)).toHaveLength(2);
  });
});

describe('the retry prompt', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // .env.dev sets ANALYST_V4=1 for the running dev API; this test exercises the real (v3)
    // correctionHints pipeline regardless of what the shell exports.
    vi.stubEnv('ANALYST_V4', '');
    collectEvidence.mockResolvedValue(structuredClone(pack));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('carries the hint for the error the first answer produced', async () => {
    const badWeights = { ...OUTPUT_EXAMPLE, suggested_weights: { deesc: 35, base: 45, stag: 25 } };
    runProviderAnalysis
      .mockResolvedValueOnce({ text: JSON.stringify(badWeights), usage: { input_tokens: 1, output_tokens: 1 } })
      .mockResolvedValueOnce({ text: JSON.stringify(OUTPUT_EXAMPLE), usage: { input_tokens: 1, output_tokens: 1 } });

    await runAnalysisV3({ provider_type: 'custom', settings: {} }, snapshot, runProviderAnalysis);

    const second = runProviderAnalysis.mock.calls[1][1];
    expect(second).toContain('CORRECTION:');
    expect(second).toContain('deesc + base + stag must equal exactly 100');
  });
});

describe('the first prompt', () => {
  it('warns about the two easiest mistakes', () => {
    const prompt = buildAnalysisPrompt(snapshot, pack.evidencePack);
    expect(prompt).toContain('suggested_weights are three whole numbers that add up to exactly 100');
    expect(prompt).toContain('never write a currency amount in reads.dca except current_installment_limit_egp');
    expect(prompt).toContain('changes wording only: apply the same evidence standard and decision rules in both');
  });
});
