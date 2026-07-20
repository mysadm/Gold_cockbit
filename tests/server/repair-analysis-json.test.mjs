import { describe, it, expect } from 'vitest';
import { repairAnalysisJson } from '../../server/routes/repairAnalysisJson.mjs';

describe('repairAnalysisJson', () => {
  it('returns the parsed object unchanged when the JSON is already valid', () => {
    const text = JSON.stringify({
      one_liner: 'ok',
      trends: ['a', 'b'],
      suggested_weights: { deesc: 35, base: 45, stag: 20 },
      weights_reasoning: 'why',
      tranche2: { verdict: 'wait', reasoning: 'why' },
      egp_read: 'read',
    });

    expect(repairAnalysisJson(text)).toEqual(JSON.parse(text));
  });

  it('repairs a real captured gemma4 response with an unclosed trends array', () => {
    // Captured verbatim from a real local-model call: the model opened the
    // `trends` array with `[` but never closed it with `]` before starting
    // `suggested_weights`, so `JSON.parse` fails with a delimiter error.
    const broken = '{"one_liner": "التركيز لازم يكون على المقاومة المحلية في الذهب.", "trends": ["سوق الذهب بيجري بقوة.\\nالمخاوف لسه غامضة.\\nتدهور سعر الجنيه.", "suggested_weights": { "deesc": 20, "base": 50, "stag": 30 }, "weights_reasoning": "احنا قللنا وزن الإنخفاض التدريجي.", "tranche2": { "verdict": "partial", "reasoning": "مفيش فرصة استثمارية سريعة." }, "egp_read": "الضغوط على الجنيه بتفضل مستمرة."}';

    expect(() => JSON.parse(broken)).toThrow();

    const repaired = repairAnalysisJson(broken);

    expect(repaired).not.toBeNull();
    expect(repaired.one_liner).toBe('التركيز لازم يكون على المقاومة المحلية في الذهب.');
    expect(repaired.trends).toEqual(['سوق الذهب بيجري بقوة.\nالمخاوف لسه غامضة.\nتدهور سعر الجنيه.']);
    expect(repaired.suggested_weights).toEqual({ deesc: 20, base: 50, stag: 30 });
    expect(repaired.tranche2).toEqual({ verdict: 'partial', reasoning: 'مفيش فرصة استثمارية سريعة.' });
    expect(repaired.egp_read).toBe('الضغوط على الجنيه بتفضل مستمرة.');
  });

  it('repairs an unclosed nested object (tranche2 missing its closing brace)', () => {
    const broken = '{"one_liner": "x", "trends": ["a"], "suggested_weights": {"deesc": 33, "base": 34, "stag": 33}, "weights_reasoning": "y", "tranche2": { "verdict": "wait", "reasoning": "z", "egp_read": "w"}';

    expect(() => JSON.parse(broken)).toThrow();

    const repaired = repairAnalysisJson(broken);

    expect(repaired).not.toBeNull();
    expect(repaired.tranche2).toEqual({ verdict: 'wait', reasoning: 'z' });
    expect(repaired.egp_read).toBe('w');
  });

  it('handles text truncated mid-value by closing whatever is still open', () => {
    const truncated = '{"one_liner": "x", "trends": ["first item", "second item is cut off mid';

    const repaired = repairAnalysisJson(truncated);

    expect(repaired).not.toBeNull();
    expect(repaired.one_liner).toBe('x');
  });

  it('repairs text that is fenced AND truncated right after a complete nested object', () => {
    // Real failure mode: the model wraps its reply in ```json fences, then
    // gets cut off mid-word partway through weights_reasoning — after the
    // nested suggested_weights object is already fully closed. A naive
    // "trim to the last }" heuristic would pick that nested object's closer
    // as the end, silently discarding weights_reasoning/tranche2/egp_read
    // instead of at least recovering what came before the cut.
    const truncated = '```json\n{\n  "one_liner": "x",\n  "trends": ["a", "b"],\n  "suggested_weights": {\n    "deesc": 25,\n    "base": 40,\n    "stag": 35\n  },\n  "weights_reasoning": "some text that gets cut off mid';

    const repaired = repairAnalysisJson(truncated);

    expect(repaired).not.toBeNull();
    expect(repaired.one_liner).toBe('x');
    expect(repaired.trends).toEqual(['a', 'b']);
    expect(repaired.suggested_weights).toEqual({ deesc: 25, base: 40, stag: 35 });
  });

  it('drops a dangling KEY fragment truncated mid-name, rather than closing it as a bogus key', () => {
    // Real failure mode: response cut off partway through writing the key
    // name "deesc" itself — before any ":" or value appeared. Closing this
    // as `{ "d" }` would still be invalid JSON (a lone string is not a valid
    // object member); the correct repair is to drop the incomplete key and
    // leave the object as-is (empty, in this case) rather than fabricate one.
    const truncated = '{"one_liner": "x", "trends": ["a", "b"], "suggested_weights": {\n    "d';

    const repaired = repairAnalysisJson(truncated);

    expect(repaired).not.toBeNull();
    expect(repaired.one_liner).toBe('x');
    expect(repaired.trends).toEqual(['a', 'b']);
    expect(repaired.suggested_weights).toEqual({});
  });

  it('closes a dangling VALUE string fragment as-is (not treated as a key)', () => {
    const truncated = '{"one_liner": "x", "trends": ["first", "second is cut off mid';

    const repaired = repairAnalysisJson(truncated);

    expect(repaired).not.toBeNull();
    expect(repaired.trends).toEqual(['first', 'second is cut off mid']);
  });

  it('strips a stray period a model appends after a string closes, before the real delimiter', () => {
    // Real failure mode: the model "finishes the sentence" with a period
    // after already closing the JSON string, e.g. `"...حركة".\n  },` — the
    // period is not valid JSON between a string and its delimiter.
    const broken = '{"one_liner": "x", "trends": ["item one". , "item two"], "suggested_weights": {"deesc": 33, "base": 34, "stag": 33}, "weights_reasoning": "y", "tranche2": {"verdict": "wait", "reasoning": "z". }, "egp_read": "w"}';

    const repaired = repairAnalysisJson(broken);

    expect(repaired).not.toBeNull();
    expect(repaired.trends).toEqual(['item one', 'item two']);
    expect(repaired.tranche2).toEqual({ verdict: 'wait', reasoning: 'z' });
  });

  it('returns null when there is no JSON object at all', () => {
    expect(repairAnalysisJson('not json at all, just plain text')).toBeNull();
  });

  it('extracts JSON wrapped in markdown code fences', () => {
    const fenced = '```json\n{"one_liner": "x", "trends": ["a"], "suggested_weights": {"deesc": 33, "base": 34, "stag": 33}, "weights_reasoning": "y", "tranche2": {"verdict": "wait", "reasoning": "z"}, "egp_read": "w"}\n```';

    const repaired = repairAnalysisJson(fenced);

    expect(repaired).not.toBeNull();
    expect(repaired.one_liner).toBe('x');
  });
});
