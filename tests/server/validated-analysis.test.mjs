import { describe, it, expect, vi } from 'vitest';
import { runValidatedAnalysis } from '../../server/providers/validatedAnalysis.mjs';

const EV1 = 'EV-20260101-0800-01';
const valid = () => ({
  status: 'material_change', confidence: 'medium', headline: 'h', data_flags: [],
  evidence: [{ ev_id: EV1, implication: 'x' }],
  scenario_weights: { deesc: 35, base: 45, stag: 20 },
  weight_changes: [{ scenario: 'deesc', ev_ids: [EV1], reason: 'x' }],
  action: 'hold', next_trigger: 't', invalidation: 'i',
});

describe('runValidatedAnalysis', () => {
  it('returns ok on a valid first attempt, passing the schema and per-tier max_tokens to the provider', async () => {
    const runProvider = vi.fn().mockResolvedValue({ text: JSON.stringify(valid()), usage: { input_tokens: 1, output_tokens: 1 } });
    const result = await runValidatedAnalysis({ provider: {}, prompt: 'p', runProvider, tier: 'standard', evidenceIds: [EV1] });
    expect(result).toEqual({ ok: true, output: valid(), usage: { input_tokens: 1, output_tokens: 1 }, retries: 0 });
    expect(runProvider).toHaveBeenCalledTimes(1);
    const [, prompt, options] = runProvider.mock.calls[0];
    expect(prompt).toBe('p');
    expect(options.maxTokens).toBe(1400);
    expect(options.jsonSchema.schema.required).toContain('scenario_weights');
  });

  it('uses the personalized max_tokens budget and schema for the personalized tier', async () => {
    const output = { ...valid(), dca: { status: 'proceed', note: 'n' } };
    const runProvider = vi.fn().mockResolvedValue({ text: JSON.stringify(output) });
    const result = await runValidatedAnalysis({ provider: {}, prompt: 'p', runProvider, tier: 'personalized', evidenceIds: [EV1] });
    expect(result.ok).toBe(true);
    expect(runProvider.mock.calls[0][2].maxTokens).toBe(2550);
    expect(runProvider.mock.calls[0][2].jsonSchema.schema.required).toContain('dca');
  });

  it('retries once with the validation error appended, then succeeds', async () => {
    const bad = { ...valid(), scenario_weights: { deesc: 35, base: 45, stag: 30 } };
    const runProvider = vi.fn()
      .mockResolvedValueOnce({ text: JSON.stringify(bad) })
      .mockResolvedValueOnce({ text: JSON.stringify(valid()) });
    const result = await runValidatedAnalysis({ provider: {}, prompt: 'p', runProvider, tier: 'standard', evidenceIds: [EV1] });
    expect(result).toEqual({ ok: true, output: valid(), usage: undefined, retries: 1 });
    expect(runProvider).toHaveBeenCalledTimes(2);
    expect(runProvider.mock.calls[1][1]).toContain('CORRECTION:');
    expect(runProvider.mock.calls[1][1]).toContain('scenario_weights must sum to 100');
  });

  it('returns a controlled error after the retry still fails', async () => {
    const bad = { ...valid(), scenario_weights: { deesc: 35, base: 45, stag: 30 } };
    const runProvider = vi.fn().mockResolvedValue({ text: JSON.stringify(bad) });
    const result = await runValidatedAnalysis({ provider: {}, prompt: 'p', runProvider, tier: 'standard', evidenceIds: [EV1] });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('validation_failed');
    expect(result.errors).toContain('scenario_weights must sum to 100');
    expect(runProvider).toHaveBeenCalledTimes(2);
  });
});
