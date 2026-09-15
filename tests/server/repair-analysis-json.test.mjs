import { describe, it, expect } from 'vitest';
import { repairAnalysisJson } from '../../server/routes/repairAnalysisJson.mjs';

describe('repairAnalysisJson', () => {
  it('returns the parsed object unchanged when the JSON is already valid', () => {
    const text = JSON.stringify({
      schema_version: '2',
      primary_decision: {
        action: 'hold',
        horizon: 'now',
        headline: 'h',
        confidence: 'medium',
        reasons: [{ text: 'a', evidence_ids: ['EV-1'] }],
      },
      horizon_actions: [{ horizon: 'now', action: 'x', condition: 'y' }],
      suggested_weights: { deesc: 35, base: 45, stag: 20 },
      weights_reasoning: { text: 'why', evidence_ids: [] },
      egp_read: { text: 'read', evidence_ids: [] },
    });

    expect(repairAnalysisJson(text)).toEqual(JSON.parse(text));
  });

  it('repairs a response truncated inside primary_decision.reasons with an unclosed array', () => {
    // Real failure mode this fix targets: the model opened
    // primary_decision.reasons with `[` but never closed it (or
    // primary_decision's own `}`) before starting the next top-level key,
    // horizon_actions. Before EXPECTED_KEYS included 'primary_decision',
    // this boundary went unrecognized and the whole object was unrecoverable.
    const broken =
      '{"schema_version": "2", "primary_decision": {"action": "hold", "horizon": "now", "headline": "التركيز لازم يكون على المقاومة المحلية.", "confidence": "medium", "reasons": [{"text": "سوق الذهب بيجري بقوة.", "evidence_ids": ["EV-1"]}, "horizon_actions": [{"horizon": "now", "action": "راقب المستوى", "condition": "لو كسر المقاومة"}], "suggested_weights": {"deesc": 20, "base": 50, "stag": 30}, "weights_reasoning": {"text": "قللنا وزن الانخفاض التدريجي.", "evidence_ids": []}, "egp_read": {"text": "الضغط على الجنيه مستمر.", "evidence_ids": []}}';

    expect(() => JSON.parse(broken)).toThrow();

    const repaired = repairAnalysisJson(broken);

    expect(repaired).not.toBeNull();
    expect(repaired.primary_decision).toBeDefined();
    expect(repaired.primary_decision.action).toBe('hold');
    expect(repaired.primary_decision.reasons).toEqual([
      { text: 'سوق الذهب بيجري بقوة.', evidence_ids: ['EV-1'] },
    ]);
    expect(repaired.horizon_actions).toEqual([
      { horizon: 'now', action: 'راقب المستوى', condition: 'لو كسر المقاومة' },
    ]);
    expect(repaired.suggested_weights).toEqual({ deesc: 20, base: 50, stag: 30 });
    expect(repaired.egp_read).toEqual({ text: 'الضغط على الجنيه مستمر.', evidence_ids: [] });
  });

  it('repairs an unclosed nested object (weights_reasoning missing its closing brace)', () => {
    const broken =
      '{"schema_version": "2", "primary_decision": {"action": "hold", "horizon": "now", "headline": "h", "confidence": "low", "reasons": []}, "horizon_actions": [], "suggested_weights": {"deesc": 33, "base": 34, "stag": 33}, "weights_reasoning": { "text": "y", "egp_read": "w"}';

    expect(() => JSON.parse(broken)).toThrow();

    const repaired = repairAnalysisJson(broken);

    expect(repaired).not.toBeNull();
    expect(repaired.weights_reasoning).toEqual({ text: 'y' });
    expect(repaired.egp_read).toBe('w');
  });

  it('handles text truncated mid-value by closing whatever is still open', () => {
    const truncated = '{"schema_version": "2", "primary_decision": {"action": "hold", "headline": "first part cut off mid';

    const repaired = repairAnalysisJson(truncated);

    expect(repaired).not.toBeNull();
    expect(repaired.schema_version).toBe('2');
  });

  it('repairs text that is fenced AND truncated right after a complete nested object', () => {
    // Real failure mode: the model wraps its reply in ```json fences, then
    // gets cut off mid-word partway through weights_reasoning — after the
    // nested suggested_weights object is already fully closed. A naive
    // "trim to the last }" heuristic would pick that nested object's closer
    // as the end, silently discarding weights_reasoning/egp_read instead of
    // at least recovering what came before the cut.
    const truncated =
      '```json\n{\n  "schema_version": "2",\n  "primary_decision": {"action": "hold", "horizon": "now", "headline": "h", "confidence": "low", "reasons": []},\n  "horizon_actions": [],\n  "suggested_weights": {\n    "deesc": 25,\n    "base": 40,\n    "stag": 35\n  },\n  "weights_reasoning": {"text": "some text that gets cut off mid';

    const repaired = repairAnalysisJson(truncated);

    expect(repaired).not.toBeNull();
    expect(repaired.schema_version).toBe('2');
    expect(repaired.primary_decision.action).toBe('hold');
    expect(repaired.suggested_weights).toEqual({ deesc: 25, base: 40, stag: 35 });
  });

  it('drops a dangling KEY fragment truncated mid-name, rather than closing it as a bogus key', () => {
    // Real failure mode: response cut off partway through writing the key
    // name "deesc" itself — before any ":" or value appeared. Closing this
    // as `{ "d" }` would still be invalid JSON (a lone string is not a valid
    // object member); the correct repair is to drop the incomplete key and
    // leave the object as-is (empty, in this case) rather than fabricate one.
    const truncated =
      '{"schema_version": "2", "primary_decision": {"action": "hold", "horizon": "now", "headline": "h", "confidence": "low", "reasons": []}, "horizon_actions": [], "suggested_weights": {\n    "d';

    const repaired = repairAnalysisJson(truncated);

    expect(repaired).not.toBeNull();
    expect(repaired.primary_decision.action).toBe('hold');
    expect(repaired.suggested_weights).toEqual({});
  });

  it('closes a dangling VALUE string fragment as-is (not treated as a key)', () => {
    const truncated =
      '{"schema_version": "2", "primary_decision": {"action": "hold", "horizon": "now", "headline": "h", "confidence": "low", "reasons": []}, "horizon_actions": ["first", "second is cut off mid';

    const repaired = repairAnalysisJson(truncated);

    expect(repaired).not.toBeNull();
    expect(repaired.horizon_actions).toEqual(['first', 'second is cut off mid']);
  });

  it('strips a stray period a model appends after a string closes, before the real delimiter', () => {
    // Real failure mode: the model "finishes the sentence" with a period
    // after already closing the JSON string, e.g. `"...حركة".\n  },` — the
    // period is not valid JSON between a string and its delimiter.
    const broken =
      '{"schema_version": "2", "primary_decision": {"action": "hold", "horizon": "now", "headline": "h", "confidence": "low", "reasons": ["item one". , "item two"]}, "horizon_actions": [], "suggested_weights": {"deesc": 33, "base": 34, "stag": 33}, "weights_reasoning": {"text": "y". }, "egp_read": {"text": "w"}}';

    const repaired = repairAnalysisJson(broken);

    expect(repaired).not.toBeNull();
    expect(repaired.primary_decision.reasons).toEqual(['item one', 'item two']);
    expect(repaired.weights_reasoning).toEqual({ text: 'y' });
  });

  it('returns null when there is no JSON object at all', () => {
    expect(repairAnalysisJson('not json at all, just plain text')).toBeNull();
  });

  it('prefers the repair candidate that recovers more known v2 fields when both otherwise parse', () => {
    // The "last '}'" candidate truncates right after primary_decision's
    // nested object, silently dropping assumptions/missing_inputs entirely
    // (they come after primary_decision in the text but before the object's
    // real end). Only the "full remainder" candidate recovers them — and it
    // only wins the score comparison because 'assumptions'/'missing_inputs'
    // are themselves in EXPECTED_KEYS; without them, both candidates would
    // tie and the first (shorter) one would win the tie-break instead.
    const broken =
      '{"schema_version": "2", "primary_decision": {"action": "hold", "horizon": "now", "headline": "h", "confidence": "medium", "reasons": []}, "assumptions": ["a"], "missing_inputs": ["m"';

    const repaired = repairAnalysisJson(broken);

    expect(repaired).not.toBeNull();
    expect(repaired.primary_decision.action).toBe('hold');
    expect(repaired.assumptions).toEqual(['a']);
    expect(repaired.missing_inputs).toEqual(['m']);
  });

  it('repairs a response truncated mid-way through horizon_actions, recovering dca_read', () => {
    // Missing the closing ']'/'}' for horizon_actions before dca_read starts.
    const broken =
      '{"schema_version": "2", "primary_decision": {"action": "hold", "horizon": "now", "headline": "h", "confidence": "low", "reasons": []}, "horizon_actions": [{"horizon": "now", "action": "a", "dca_read": "the DCA read", "watchlist_read": "z"}';

    const repaired = repairAnalysisJson(broken);

    expect(repaired).not.toBeNull();
    expect(repaired.dca_read).toBe('the DCA read');
  });

  it('extracts JSON wrapped in markdown code fences', () => {
    const fenced =
      '```json\n{"schema_version": "2", "primary_decision": {"action": "hold", "horizon": "now", "headline": "h", "confidence": "low", "reasons": []}, "horizon_actions": [], "suggested_weights": {"deesc": 33, "base": 34, "stag": 33}, "weights_reasoning": {"text": "y"}, "egp_read": {"text": "w"}}\n```';

    const repaired = repairAnalysisJson(fenced);

    expect(repaired).not.toBeNull();
    expect(repaired.schema_version).toBe('2');
  });
});
