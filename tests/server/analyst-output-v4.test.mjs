import { describe, it, expect } from 'vitest';
import { validateAnalystOutput, EV_ID_PATTERN, computePriorStateEligible } from '../../shared/analystOutputV4.mjs';

const EV1 = 'EV-20260101-0800-01';
const EV2 = 'EV-20260101-0800-02';

const valid = () => ({
  status: 'material_change',
  confidence: 'medium',
  headline: 'USD strength offsets local premium relief.',
  data_flags: [],
  evidence: [{ ev_id: EV1, implication: 'Stronger dollar pressures gold near-term.' }],
  scenario_weights: { deesc: 35, base: 45, stag: 20 },
  weight_changes: [{ scenario: 'deesc', ev_ids: [EV1], reason: 'Geopolitical risk eased.' }],
  action: 'hold',
  next_trigger: 'Next FOMC statement.',
  invalidation: 'A surprise rate cut.',
});

const check = (output, evidenceIds = [EV1, EV2], tier = 'standard') => validateAnalystOutput(output, { evidenceIds, tier });

describe('analyst output v4 validator', () => {
  it('accepts a well-formed standard-tier output', () => {
    expect(check(valid())).toEqual({ ok: true, errors: [] });
  });

  it('rejects a bad weight sum', () => {
    const o = valid();
    o.scenario_weights = { deesc: 35, base: 45, stag: 30 };
    const result = check(o);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('scenario_weights must sum to 100');
  });

  it('rejects an unknown EV-ID in evidence', () => {
    const o = valid();
    o.evidence = [{ ev_id: 'EV-20260101-0800-99', implication: 'Not in the pack.' }];
    const result = check(o);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown EV-ID'))).toBe(true);
  });

  it('rejects an unknown EV-ID cited in a weight change', () => {
    const o = valid();
    o.weight_changes = [{ scenario: 'deesc', ev_ids: ['EV-20260101-0800-99'], reason: 'x' }];
    expect(check(o).ok).toBe(false);
  });

  it('rejects an extra top-level field', () => {
    const o = { ...valid(), extra_field: true };
    const result = check(o);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('unknown fields'))).toBe(true);
  });

  it('rejects an extra field on an evidence item', () => {
    const o = valid();
    o.evidence[0] = { ...o.evidence[0], scenario_effect: 'gold_up' };
    expect(check(o).ok).toBe(false);
  });

  it('rejects scenario_weights missing or adding a key', () => {
    const missing = valid();
    delete missing.scenario_weights.stag;
    missing.scenario_weights.deesc = 65;
    expect(check(missing).ok).toBe(false);

    const added = valid();
    added.scenario_weights.extra = 0;
    expect(check(added).ok).toBe(false);
  });

  it('rejects a changed weight with no EV-ID', () => {
    const o = valid();
    o.weight_changes = [{ scenario: 'deesc', ev_ids: [], reason: 'x' }];
    expect(check(o).ok).toBe(false);
  });

  it('rejects headline over 120 characters', () => {
    const o = valid();
    o.headline = 'x'.repeat(121);
    expect(check(o).ok).toBe(false);
  });

  it('rejects more than 3 evidence items', () => {
    const o = valid();
    o.evidence = Array(4).fill({ ev_id: EV1, implication: 'x' });
    expect(check(o).ok).toBe(false);
  });

  it('rejects an invalid action/status/confidence enum', () => {
    expect(check({ ...valid(), action: 'sell' }).ok).toBe(false);
    expect(check({ ...valid(), status: 'unchanged' }).ok).toBe(false);
    expect(check({ ...valid(), confidence: 'certain' }).ok).toBe(false);
  });

  it('rejects a non-object output', () => {
    expect(check(null).ok).toBe(false);
    expect(check([]).ok).toBe(false);
  });

  it('validates the EV-ID format', () => {
    expect(EV_ID_PATTERN.test(EV1)).toBe(true);
    expect(EV_ID_PATTERN.test('EV-2026-01-01')).toBe(false);
  });

  describe('personalized tier', () => {
    const validPersonalized = () => ({ ...valid(), dca_read: { text: 'Within the current tranche limit.', ev_ids: [EV1] } });

    it('accepts a well-formed personalized-tier output', () => {
      expect(check(validPersonalized(), [EV1, EV2], 'personalized')).toEqual({ ok: true, errors: [] });
    });

    it('requires the dca_read field on the personalized tier', () => {
      expect(check(valid(), [EV1, EV2], 'personalized').ok).toBe(false);
    });

    it('rejects an unknown EV-ID in dca_read.ev_ids', () => {
      const o = validPersonalized();
      o.dca_read.ev_ids = ['EV-20260101-0800-99'];
      expect(check(o, [EV1, EV2], 'personalized').ok).toBe(false);
    });

    it('does not require dca_read on the standard tier', () => {
      expect(check(valid(), [EV1, EV2], 'standard').ok).toBe(true);
    });

    describe('DCA installment-limit safety check (restores v3\'s dropped check)', () => {
      it('rejects an EGP amount in dca_read.text above the current installment limit', () => {
        const o = validPersonalized();
        o.dca_read.text = 'Deploy 100,000 EGP into this tranche now.';
        const result = validateAnalystOutput(o, { evidenceIds: [EV1, EV2], tier: 'personalized', dcaLimitEgp: 40000 });
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('dca_read: amount exceeds current installment limit');
      });

      it('accepts an EGP amount at or below the limit', () => {
        const o = validPersonalized();
        o.dca_read.text = 'Deploy up to 40000 EGP into this tranche now.';
        expect(validateAnalystOutput(o, { evidenceIds: [EV1, EV2], tier: 'personalized', dcaLimitEgp: 40000 }).ok).toBe(true);
      });

      it('reads Arabic-Indic digits and جنيه the same way', () => {
        const o = validPersonalized();
        o.dca_read.text = 'استثمر ١٠٠٬٠٠٠ جنيه الآن.';
        const result = validateAnalystOutput(o, { evidenceIds: [EV1, EV2], tier: 'personalized', dcaLimitEgp: 40000 });
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('dca_read: amount exceeds current installment limit');
      });

      it('does not check the amount when no limit is supplied (e.g. no active DCA plan)', () => {
        const o = validPersonalized();
        o.dca_read.text = 'Deploy 100,000 EGP into this tranche now.';
        expect(validateAnalystOutput(o, { evidenceIds: [EV1, EV2], tier: 'personalized' }).ok).toBe(true);
      });

      // A limit of 5000 makes each case's pass/fail unambiguous: 10000 (Arabic-Indic + separator,
      // and "10k") is clearly over; 4000 ("ج.م") is clearly under. Exercises the same currency/
      // multiplier formats tests/server/extract-egp-amounts.test.mjs checks in isolation, but here
      // through the real validator path with a real cap, not just the raw extraction function.
      describe('at a 5000 EGP limit, across currency/multiplier formats', () => {
        const rejects = (text) => {
          const o = validPersonalized();
          o.dca_read.text = text;
          const result = validateAnalystOutput(o, { evidenceIds: [EV1, EV2], tier: 'personalized', dcaLimitEgp: 5000 });
          expect(result.ok).toBe(false);
          expect(result.errors).toContain('dca_read: amount exceeds current installment limit');
        };
        const accepts = (text) => {
          const o = validPersonalized();
          o.dca_read.text = text;
          expect(validateAnalystOutput(o, { evidenceIds: [EV1, EV2], tier: 'personalized', dcaLimitEgp: 5000 }).ok).toBe(true);
        };

        it('rejects Arabic-Indic "١٠٬٠٠٠ جنيه" (10,000 > 5000)', () => {
          rejects('استثمر ١٠٬٠٠٠ جنيه الآن.');
        });

        it('rejects "10k LE" (10,000 > 5000)', () => {
          rejects('Deploy 10k LE into this tranche now.');
        });

        it('accepts "4,000 ج.م" (4,000 <= 5000)', () => {
          accepts('Deploy 4,000 ج.م into this tranche now.');
        });
      });
    });
  });
});

describe('computePriorStateEligible', () => {
  const currentWeights = { deesc: 35, base: 45, stag: 20 };
  const generatedAt = '2026-09-20T10:00:00.000Z';

  it('is eligible: a recent prior decision suggested exactly the current weights', () => {
    const previousAnalysis = { generated_at: '2026-09-20T02:00:00.000Z', action: 'wait', confidence: 'medium', suggested_weights: currentWeights };
    expect(computePriorStateEligible({ previousAnalysis, currentWeights, generatedAt })).toBe(true);
  });

  it('is not eligible when the prior suggested weights differ from the current ones', () => {
    const previousAnalysis = { generated_at: '2026-09-20T02:00:00.000Z', action: 'wait', confidence: 'medium', suggested_weights: { deesc: 30, base: 50, stag: 20 } };
    expect(computePriorStateEligible({ previousAnalysis, currentWeights, generatedAt })).toBe(false);
  });

  it('is not eligible when there is no previous run', () => {
    expect(computePriorStateEligible({ previousAnalysis: null, currentWeights, generatedAt })).toBe(false);
  });

  it('is not eligible once the prior decision falls outside the recency window', () => {
    const previousAnalysis = { generated_at: '2026-09-18T09:00:00.000Z', action: 'wait', confidence: 'medium', suggested_weights: currentWeights };
    expect(computePriorStateEligible({ previousAnalysis, currentWeights, generatedAt })).toBe(false);
  });
});
