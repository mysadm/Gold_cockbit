import { describe, it, expect } from 'vitest';
import { draftState, sameDraft } from '../../src/lib/promptDraft';

const saved = { text: 'policy', format: 'format' };
const MAX = 50;
const passed = (draft: { text: string; format: string }) => ({ draft, passed: true });

describe('sameDraft', () => {
  it('ignores surrounding whitespace only, in either box', () => {
    expect(sameDraft({ text: ' a\n', format: 'b' }, { text: 'a', format: ' b ' })).toBe(true);
    expect(sameDraft({ text: 'a', format: 'b' }, { text: 'a', format: 'c' })).toBe(false);
    expect(sameDraft({ text: 'a', format: 'b' }, { text: 'x', format: 'b' })).toBe(false);
  });
});

describe('draftState', () => {
  it('offers nothing while locked or unchanged', () => {
    expect(draftState({ ...saved, text: 'policy 2' }, saved, null, false, MAX)).toMatchObject({ dirty: true, canTest: false, canSave: false });
    expect(draftState(saved, saved, null, true, MAX)).toMatchObject({ dirty: false, canTest: false, canSave: false });
  });

  it('treats a change to only the output format as a change', () => {
    expect(draftState({ ...saved, format: 'format 2' }, saved, null, true, MAX)).toMatchObject({ dirty: true, canTest: true, canSave: false });
  });

  it('allows the save only for the exact tested pair of texts', () => {
    const draft = { text: 'policy 2', format: 'format' };
    expect(draftState(draft, saved, passed(draft), true, MAX).canSave).toBe(true);
    expect(draftState({ ...draft, text: 'policy 2!' }, saved, passed(draft), true, MAX)).toMatchObject({ tested: false, canSave: false });
    expect(draftState({ ...draft, format: 'format!' }, saved, passed(draft), true, MAX)).toMatchObject({ tested: false, canSave: false });
  });

  it('never saves a failed test', () => {
    const draft = { text: 'policy 2', format: 'format' };
    expect(draftState(draft, saved, { draft, passed: false }, true, MAX).canSave).toBe(false);
  });

  it('rejects an empty or over-long box', () => {
    expect(draftState({ text: '  ', format: 'f' }, saved, null, true, MAX)).toMatchObject({ valid: false, canTest: false });
    expect(draftState({ text: 't', format: '' }, saved, null, true, MAX).valid).toBe(false);
    expect(draftState({ text: 't', format: 'x'.repeat(MAX + 1) }, saved, null, true, MAX).valid).toBe(false);
  });
});
