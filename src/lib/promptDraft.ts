import type { PromptDraft } from '../api/adminPrompts';

export type TestedDraft = { draft: PromptDraft; passed: boolean };

export const sameDraft = (a: PromptDraft, b: PromptDraft): boolean =>
  a.text.trim() === b.text.trim() && a.format.trim() === b.format.trim();

export type DraftState = {
  dirty: boolean;
  valid: boolean;
  canTest: boolean;
  // The draft is exactly the text that last passed a test.
  tested: boolean;
  canSave: boolean;
};

const partValid = (value: string, maxLength: number) => value.trim().length > 0 && value.trim().length <= maxLength;

// Save is only offered for the exact texts that passed a test, so any further edit to either
// box (even one character) sends the admin back to "Test changes".
export function draftState(draft: PromptDraft, saved: PromptDraft, lastTest: TestedDraft | null, unlocked: boolean, maxLength: number): DraftState {
  const valid = partValid(draft.text, maxLength) && partValid(draft.format, maxLength);
  const dirty = !sameDraft(draft, saved);
  const tested = lastTest !== null && lastTest.passed && sameDraft(lastTest.draft, draft);
  return { dirty, valid, canTest: unlocked && valid && dirty, tested, canSave: unlocked && valid && dirty && tested };
}
