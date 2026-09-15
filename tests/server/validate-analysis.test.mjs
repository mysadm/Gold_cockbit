import { describe, it, expect } from 'vitest';
import { validateAnalysis } from '../../server/routes/validateAnalysis.mjs';

describe('validateAnalysis', () => {
  it('returns no warnings for a clean result with weights summing to 100 and only known evidence IDs', () => {
    const parsed = {
      one_liner: 'Hold steady [EV-001].',
      suggested_weights: { deesc: 30, base: 45, stag: 25 },
    };
    const warnings = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: ['EV-001', 'EV-002'] });
    expect(warnings).toEqual([]);
  });

  it('flags suggested_weights that do not sum to 100', () => {
    const parsed = { suggested_weights: { deesc: 30, base: 45, stag: 20 } };
    const warnings = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: [] });
    expect(warnings).toEqual(['suggested_weights sums to 95, not 100']);
  });

  it('tolerates a rounding-only mismatch of at most 1', () => {
    const parsed = { suggested_weights: { deesc: 33, base: 34, stag: 34 } };
    const warnings = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: [] });
    expect(warnings).toEqual([]);
  });

  it('flags a cited evidence ID that was never supplied to the model', () => {
    const rawText = 'The Fed held rates steady [EV-007].';
    const warnings = validateAnalysis({ parsed: { one_liner: rawText }, rawText, evidenceIds: ['EV-001', 'EV-002'] });
    expect(warnings).toEqual(['cited evidence ID(s) not in the supplied search results: EV-007']);
  });

  it('does not flag evidence IDs when none were supplied to the model (no web search occurred)', () => {
    const rawText = 'Gold looks steady today.';
    const warnings = validateAnalysis({ parsed: { one_liner: rawText }, rawText, evidenceIds: [] });
    expect(warnings).toEqual([]);
  });

  it('skips the weights check entirely when suggested_weights is absent', () => {
    const warnings = validateAnalysis({ parsed: { one_liner: 'x' }, rawText: 'x', evidenceIds: [] });
    expect(warnings).toEqual([]);
  });

  it('handles parsed being null (unparseable response) without throwing', () => {
    const rawText = 'not json [EV-999]';
    const warnings = validateAnalysis({ parsed: null, rawText, evidenceIds: ['EV-001'] });
    expect(warnings).toEqual(['cited evidence ID(s) not in the supplied search results: EV-999']);
  });
});
