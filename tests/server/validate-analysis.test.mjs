import { describe, it, expect } from 'vitest';
import { validateAnalysis, computeConfidence } from '../../server/routes/validateAnalysis.mjs';

const baseSnapshot = { dca: null };

describe('validateAnalysis (v2)', () => {
  it('returns ok:true for a clean v2 response', () => {
    const parsed = {
      primary_decision: { action: 'hold', horizon: 'now', headline: 'x', confidence: 'medium', reasons: [{ text: 'steady', evidence_ids: [] }] },
      suggested_weights: { deesc: 30, base: 45, stag: 25 },
      egp_read: { text: 'fine', evidence_ids: [] },
    };
    const result = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: [], snapshot: baseSnapshot });
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('hard-fails when suggested_weights does not sum to 100', () => {
    const parsed = { suggested_weights: { deesc: 30, base: 45, stag: 20 }, primary_decision: { action: 'hold', horizon: 'now', headline: 'x', confidence: 'low', reasons: [] } };
    const result = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: [], snapshot: baseSnapshot });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('suggested_weights sums to 95, not 100');
  });

  it('hard-fails a claim field stating a percentage with no evidence_ids', () => {
    const parsed = {
      primary_decision: { action: 'hold', horizon: 'now', headline: 'x', confidence: 'high', reasons: [] },
      suggested_weights: { deesc: 33, base: 34, stag: 33 },
      egp_read: { text: 'the pound weakened 3% this week', evidence_ids: [] },
    };
    const result = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: ['EV-001'], snapshot: baseSnapshot });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('egp_read'))).toBe(true);
  });

  it('does not fail a claim field with no numeric content and empty evidence_ids', () => {
    const parsed = {
      primary_decision: { action: 'hold', horizon: 'now', headline: 'x', confidence: 'medium', reasons: [] },
      suggested_weights: { deesc: 33, base: 34, stag: 33 },
      egp_read: { text: 'the pound is broadly stable', evidence_ids: [] },
    };
    const result = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: [], snapshot: baseSnapshot });
    expect(result.ok).toBe(true);
  });

  it('hard-fails a cited evidence ID that was never supplied', () => {
    const parsed = {
      primary_decision: { action: 'hold', horizon: 'now', headline: 'x', confidence: 'medium', reasons: [] },
      suggested_weights: { deesc: 33, base: 34, stag: 33 },
      egp_read: { text: 'rates held steady', evidence_ids: ['EV-999'] },
    };
    const result = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: ['EV-001'], snapshot: baseSnapshot });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('EV-999'))).toBe(true);
  });

  it('hard-fails when dca_read states an EGP amount exceeding the plan\'s actual investment cap', () => {
    const parsed = {
      primary_decision: { action: 'hold', horizon: 'now', headline: 'x', confidence: 'medium', reasons: [] },
      suggested_weights: { deesc: 33, base: 34, stag: 33 },
      dca_read: { text: 'deploy 50000 EGP into this tranche', evidence_ids: [] },
    };
    const snapshot = { dca: { mode: 'fixed', total_investment_egp: 30000, monthly_investment_egp: null } };
    const result = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: [], snapshot });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('dca_read'))).toBe(true);
  });

  it('does not fail a dca_read amount within the plan\'s cap', () => {
    const parsed = {
      primary_decision: { action: 'hold', horizon: 'now', headline: 'x', confidence: 'medium', reasons: [] },
      suggested_weights: { deesc: 33, base: 34, stag: 33 },
      dca_read: { text: 'deploy 12000 EGP into this tranche', evidence_ids: [] },
    };
    const snapshot = { dca: { mode: 'fixed', total_investment_egp: 30000, monthly_investment_egp: null } };
    const result = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: [], snapshot });
    expect(result.ok).toBe(true);
  });

  it('returns ok:false with a specific error when parsed is null', () => {
    const result = validateAnalysis({ parsed: null, rawText: 'not json', evidenceIds: [], snapshot: baseSnapshot });
    expect(result).toEqual({ ok: false, errors: ['response was not valid JSON'] });
  });
});

describe('computeConfidence', () => {
  it('returns the model confidence unchanged when there are no errors and coverage is high', () => {
    expect(computeConfidence({ modelConfidence: 'high', errors: [], evidenceCoverageRatio: 1 })).toBe('high');
  });

  it('downgrades to low whenever there are any validation errors, regardless of model confidence', () => {
    expect(computeConfidence({ modelConfidence: 'high', errors: ['x'], evidenceCoverageRatio: 1 })).toBe('low');
  });

  it('caps at medium when evidence coverage is below 50%, even with no errors', () => {
    expect(computeConfidence({ modelConfidence: 'high', errors: [], evidenceCoverageRatio: 0.3 })).toBe('medium');
  });

  it('never raises confidence above what the model itself reported', () => {
    expect(computeConfidence({ modelConfidence: 'low', errors: [], evidenceCoverageRatio: 1 })).toBe('low');
  });
});
