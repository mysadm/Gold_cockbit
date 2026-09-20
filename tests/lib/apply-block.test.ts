import { describe, it, expect } from 'vitest';
import { applyBlockReason } from '../../src/lib/applyBlock';

describe('applyBlockReason', () => {
  it('blames validation only when validation actually failed or is unknown', () => {
    expect(applyBlockReason(false, 'wait')).toBe('validation');
    expect(applyBlockReason(undefined, 'wait')).toBe('validation');
    expect(applyBlockReason(false, 'insufficient_evidence')).toBe('validation');
  });

  it('reports a valid "insufficient evidence" answer as lack of evidence, not a validation failure', () => {
    expect(applyBlockReason(true, 'insufficient_evidence')).toBe('no_evidence');
  });

  it('does not block a valid recommendation', () => {
    expect(applyBlockReason(true, 'wait')).toBeNull();
    expect(applyBlockReason(true, 'buy')).toBeNull();
  });
});
