import { describe, it, expect } from 'vitest';
import { repairFormatting, truncateAtBoundary } from '../../server/providers/formatRepair.mjs';

const EV1 = 'EV-20260101-0800-01';
const valid = () => ({
  status: 'material_change', confidence: 'medium', headline: 'h', data_flags: [],
  evidence: [{ ev_id: EV1, implication: 'x' }],
  scenario_weights: { deesc: 35, base: 45, stag: 20 },
  weight_changes: [{ scenario: 'deesc', ev_ids: [EV1], reason: 'x' }],
  action: 'hold', next_trigger: 't', invalidation: 'i',
});

describe('truncateAtBoundary', () => {
  it('leaves a string within the limit alone', () => {
    expect(truncateAtBoundary('short', 100)).toBe('short');
  });

  it('cuts at the last sentence boundary within the limit', () => {
    const s = 'First clause is here. Second clause pushes this well past twenty chars.';
    expect(truncateAtBoundary(s, 25)).toBe('First clause is here.');
  });

  it('falls back to the last word boundary when no sentence boundary fits, never mid-word', () => {
    const s = 'one two three four five six seven';
    const result = truncateAtBoundary(s, 15);
    expect(s.startsWith(result)).toBe(true);
    expect(result.endsWith(' ')).toBe(false);
    expect(s[result.length]).not.toBeUndefined();
    // The char right after the cut in the original string must be a boundary (space), not a
    // continuation of the same word.
    expect([' ', undefined]).toContain(s[result.length] === ' ' ? ' ' : s[result.length]);
  });

  it('cuts Arabic text at a word boundary, never mid-word', () => {
    const s = 'الأسعار مرتفعة اليوم بسبب قرارات البنك المركزي المصري بشأن أسعار الفائدة';
    const max = 30;
    const result = truncateAtBoundary(s, max);
    expect(result.length).toBeLessThanOrEqual(max);
    expect(s.startsWith(result)).toBe(true);
    // Every word in the truncated result must be a complete word from the original (word-split
    // equality), proving the cut never landed inside a word.
    const originalWords = s.split(' ');
    const resultWords = result.split(' ').filter(Boolean);
    resultWords.forEach((w, i) => expect(w).toBe(originalWords[i]));
  });

  it('returns null when there is no safe boundary (one token longer than the limit)', () => {
    expect(truncateAtBoundary('a'.repeat(50), 20)).toBeNull();
  });
});

describe('repairFormatting', () => {
  it('leaves an already-valid output completely untouched (no repair reported)', () => {
    const result = repairFormatting(valid(), { tier: 'standard' });
    expect(result.repaired).toBe(false);
    expect(result.fields).toEqual([]);
    expect(result.output).toEqual(valid());
  });

  it('strips an unknown top-level field', () => {
    const o = { ...valid(), search_performed: true };
    const result = repairFormatting(o, { tier: 'standard' });
    expect(result.repaired).toBe(true);
    expect(result.fields).toContain('top level (unknown field)');
    expect(result.output.search_performed).toBeUndefined();
  });

  it('truncates an over-length headline at a word boundary', () => {
    const o = { ...valid(), headline: 'word '.repeat(40).trim() };
    const result = repairFormatting(o, { tier: 'standard' });
    expect(result.fields).toContain('headline (truncated)');
    expect(result.output.headline.length).toBeLessThanOrEqual(120);
    expect(o.headline.startsWith(result.output.headline)).toBe(true);
  });

  it('drops empty/whitespace data_flags entries and truncates an over-length one', () => {
    const o = { ...valid(), data_flags: ['  ', 'ok flag', 'x '.repeat(60).trim()] };
    const result = repairFormatting(o, { tier: 'standard' });
    expect(result.fields).toContain('data_flags (dropped empty)');
    expect(result.fields).toContain('data_flags (item truncated)');
    expect(result.output.data_flags).not.toContain('  ');
    expect(result.output.data_flags.every((s) => s.length <= 100)).toBe(true);
  });

  it('caps data_flags to 5 items, keeping the first 5 in model order', () => {
    const o = { ...valid(), data_flags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] };
    const result = repairFormatting(o, { tier: 'standard' });
    expect(result.fields).toContain('data_flags (capped to 5)');
    expect(result.output.data_flags).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('caps evidence to 3 items, strips an unknown evidence field, and truncates implication', () => {
    const o = {
      ...valid(),
      evidence: [
        { ev_id: EV1, implication: 'word '.repeat(60).trim(), scenario_effect: 'gold_up' },
        { ev_id: EV1, implication: 'b' },
        { ev_id: EV1, implication: 'c' },
        { ev_id: EV1, implication: 'd' },
      ],
    };
    const result = repairFormatting(o, { tier: 'standard' });
    expect(result.fields).toContain('evidence (capped to 3)');
    expect(result.fields).toContain('evidence item (unknown field)');
    expect(result.fields).toContain('implication (truncated)');
    expect(result.output.evidence).toHaveLength(3);
    expect(result.output.evidence[0].scenario_effect).toBeUndefined();
    expect(result.output.evidence[0].implication.length).toBeLessThanOrEqual(200);
  });

  it('caps weight_changes to the scenario count, strips an unknown field, and truncates reason', () => {
    const o = {
      ...valid(),
      weight_changes: [
        { scenario: 'deesc', ev_ids: [EV1], reason: 'reason '.repeat(40).trim(), confidence: 'high' },
        { scenario: 'base', ev_ids: [EV1], reason: 'r' },
        { scenario: 'stag', ev_ids: [EV1], reason: 'r' },
        { scenario: 'deesc', ev_ids: [EV1], reason: 'extra' },
      ],
    };
    const result = repairFormatting(o, { tier: 'standard', scenarioKeys: ['deesc', 'base', 'stag'] });
    expect(result.fields).toContain('weight_changes (capped to 3)');
    expect(result.fields).toContain('weight change (unknown field)');
    expect(result.fields).toContain('reason (truncated)');
    expect(result.output.weight_changes).toHaveLength(3);
    expect(result.output.weight_changes[0].confidence).toBeUndefined();
  });

  it('truncates over-length next_trigger and invalidation', () => {
    const o = { ...valid(), next_trigger: 't '.repeat(150).trim(), invalidation: 'i '.repeat(150).trim() };
    const result = repairFormatting(o, { tier: 'standard' });
    expect(result.fields).toContain('next_trigger (truncated)');
    expect(result.fields).toContain('invalidation (truncated)');
    expect(result.output.next_trigger.length).toBeLessThanOrEqual(200);
    expect(result.output.invalidation.length).toBeLessThanOrEqual(200);
  });

  it('repairs dca_read on the personalized tier: unknown field, over-length text, over-count ev_ids', () => {
    const o = { ...valid(), dca_read: { text: 't '.repeat(150).trim(), ev_ids: [EV1, EV1, EV1, EV1], note: 'x' } };
    const result = repairFormatting(o, { tier: 'personalized' });
    expect(result.fields).toContain('dca_read (unknown field)');
    expect(result.fields).toContain('text (truncated)');
    expect(result.fields).toContain('dca_read.ev_ids (capped to 3)');
    expect(result.output.dca_read.note).toBeUndefined();
    expect(result.output.dca_read.text.length).toBeLessThanOrEqual(200);
    expect(result.output.dca_read.ev_ids).toHaveLength(3);
  });

  it('does not touch dca_read on the standard tier (field does not exist there)', () => {
    const o = { ...valid() };
    const result = repairFormatting(o, { tier: 'standard' });
    expect(result.output.dca_read).toBeUndefined();
  });

  it('never touches semantic content: a bad scenario_weights sum survives untouched', () => {
    const o = { ...valid(), scenario_weights: { deesc: 35, base: 45, stag: 30 } };
    const result = repairFormatting(o, { tier: 'standard' });
    expect(result.output.scenario_weights).toEqual({ deesc: 35, base: 45, stag: 30 });
  });

  it('truncates Arabic prose fields at a word boundary too', () => {
    const arabicHeadline = 'قوة الدولار الأمريكي تضغط على أسعار الذهب مع تراجع الطلب من البنوك المركزية حول العالم بشكل ملحوظ هذا الأسبوع';
    const o = { ...valid(), headline: arabicHeadline.repeat(2) };
    const result = repairFormatting(o, { tier: 'standard' });
    expect(result.fields).toContain('headline (truncated)');
    expect(result.output.headline.length).toBeLessThanOrEqual(120);
    expect(o.headline.startsWith(result.output.headline)).toBe(true);
  });

  it('does nothing to a non-object input', () => {
    expect(repairFormatting(null)).toEqual({ repaired: false, fields: [], output: null });
    expect(repairFormatting('not json')).toEqual({ repaired: false, fields: [], output: 'not json' });
  });
});
