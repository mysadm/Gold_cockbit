export type ApplyBlock = 'validation' | 'no_evidence' | null;

// Why "Apply these weights" is unavailable. A valid answer that concludes "insufficient
// evidence" is not a validation failure, and the two need different messages.
export function applyBlockReason(validationOk: boolean | undefined, action: string | undefined): ApplyBlock {
  if (validationOk !== true) return 'validation';
  if (action === 'insufficient_evidence') return 'no_evidence';
  return null;
}
