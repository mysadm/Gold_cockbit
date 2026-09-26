import { describe, it, expect } from 'vitest';
import { validateAnalystOutput, BASE_SCHEMA, PERSONALIZED_SCHEMA } from '../../shared/analystOutputV4.mjs';
import { matchesSchema } from '../helpers/miniSchemaMatch.mjs';

// Proves the hand-rolled validator and the .schema.json files agree on every
// structurally-encodable rule (required fields, enums, maxLength, additionalProperties) so
// they cannot silently drift apart. Cross-field/business rules the schema cannot express
// (weight sum, EV-ID existence in the pack) are deliberately out of scope — evidenceIds
// below always covers the EV-IDs used, so those checks never fire in this test.
const EV1 = 'EV-20260101-0800-01';

const valid = () => ({
  status: 'material_change', confidence: 'medium', headline: 'h', data_flags: [],
  evidence: [{ ev_id: EV1, implication: 'x' }],
  scenario_weights: { deesc: 35, base: 45, stag: 20 },
  weight_changes: [{ scenario: 'deesc', ev_ids: [EV1], reason: 'x' }],
  action: 'hold', next_trigger: 't', invalidation: 'i',
});

const mutations = {
  'missing required field': (o) => delete o.headline,
  'invalid status enum': (o) => { o.status = 'bogus'; },
  'invalid confidence enum': (o) => { o.confidence = 'certain'; },
  'invalid action enum': (o) => { o.action = 'sell'; },
  'headline over 120 chars': (o) => { o.headline = 'x'.repeat(121); },
  'next_trigger over 200 chars': (o) => { o.next_trigger = 'x'.repeat(201); },
  'extra top-level field': (o) => { o.extra_field = true; },
  'extra field on an evidence item': (o) => { o.evidence[0].scenario_effect = 'gold_up'; },
  'extra field on a weight change': (o) => { o.weight_changes[0].from = 45; },
  'more than 3 evidence items': (o) => { o.evidence = Array(4).fill({ ev_id: EV1, implication: 'x' }); },
  'more than 3 weight changes': (o) => { o.weight_changes = Array(4).fill({ scenario: 'deesc', ev_ids: [EV1], reason: 'x' }); },
  'extra scenario_weights key': (o) => { o.scenario_weights.extra = 0; },
  'missing scenario_weights key': (o) => { delete o.scenario_weights.stag; },
  'scenario_weights value is a string': (o) => { o.scenario_weights.deesc = '35'; },
  'scenario_weights value out of range': (o) => { o.scenario_weights.deesc = 150; },
  'malformed ev_id pattern': (o) => { o.evidence[0].ev_id = 'not-an-id'; },
  'empty ev_ids on a weight change': (o) => { o.weight_changes[0].ev_ids = []; },
  'data_flags item over 100 chars': (o) => { o.data_flags = ['x'.repeat(101)]; },
  'more than 5 data_flags': (o) => { o.data_flags = Array(6).fill('x'); },
};

describe('analyst output schema/validator agreement', () => {
  it('agree on the valid case', () => {
    expect(matchesSchema(valid(), BASE_SCHEMA)).toBe(true);
    expect(validateAnalystOutput(valid(), { evidenceIds: [EV1] }).ok).toBe(true);
  });

  it.each(Object.entries(mutations))('agree that %s is invalid', (_name, mutate) => {
    const o = valid();
    mutate(o);
    const schemaResult = matchesSchema(o, BASE_SCHEMA);
    const validatorResult = validateAnalystOutput(o, { evidenceIds: [EV1] }).ok;
    expect(schemaResult).toBe(false);
    expect(validatorResult).toBe(false);
  });

  describe('personalized tier', () => {
    const validPersonalized = () => ({ ...valid(), dca: { status: 'proceed', note: 'n' } });

    it('agree on the valid case', () => {
      expect(matchesSchema(validPersonalized(), PERSONALIZED_SCHEMA)).toBe(true);
      expect(validateAnalystOutput(validPersonalized(), { tier: 'personalized', evidenceIds: [EV1] }).ok).toBe(true);
    });

    it('agree that a missing dca is invalid', () => {
      const o = valid();
      expect(matchesSchema(o, PERSONALIZED_SCHEMA)).toBe(false);
      expect(validateAnalystOutput(o, { tier: 'personalized', evidenceIds: [EV1] }).ok).toBe(false);
    });

    it('agree that an extra field on dca is invalid', () => {
      const o = validPersonalized();
      o.dca.amount_egp = 1000;
      expect(matchesSchema(o, PERSONALIZED_SCHEMA)).toBe(false);
      expect(validateAnalystOutput(o, { tier: 'personalized', evidenceIds: [EV1] }).ok).toBe(false);
    });

    it('agree that an invalid dca status is invalid', () => {
      const o = validPersonalized();
      o.dca.status = 'go';
      expect(matchesSchema(o, PERSONALIZED_SCHEMA)).toBe(false);
      expect(validateAnalystOutput(o, { tier: 'personalized', evidenceIds: [EV1] }).ok).toBe(false);
    });
  });
});
