import { describe, it, expect } from 'vitest';
import { validateAnalystOutput, EV_ID_PATTERN } from '../../shared/analystOutputV4.mjs';

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
    const validPersonalized = () => ({ ...valid(), dca: { status: 'proceed', note: 'Within the current tranche limit.' } });

    it('accepts a well-formed personalized-tier output', () => {
      expect(check(validPersonalized(), [EV1, EV2], 'personalized')).toEqual({ ok: true, errors: [] });
    });

    it('requires the dca field on the personalized tier', () => {
      expect(check(valid(), [EV1, EV2], 'personalized').ok).toBe(false);
    });

    it('rejects an invalid dca status', () => {
      const o = validPersonalized();
      o.dca.status = 'go';
      expect(check(o, [EV1, EV2], 'personalized').ok).toBe(false);
    });

    it('does not require dca on the standard tier', () => {
      expect(check(valid(), [EV1, EV2], 'standard').ok).toBe(true);
    });
  });
});
