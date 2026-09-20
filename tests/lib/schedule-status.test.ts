import { describe, it, expect } from 'vitest';
import type { AdminNotification } from '../../src/api/sharedAnalysis';
import { failureMessage, keepKnown } from '../../src/lib/scheduleStatus';

const note = (id: number, kind: string, message: string): AdminNotification => ({
  id, kind, message, created_at: '2026-09-21T08:00:00Z', updated_at: '2026-09-21T08:00:00Z',
});

describe('keepKnown', () => {
  it('keeps the previous value when the new read is unknown', () => {
    expect(keepKnown(undefined, 'run-1')).toBe('run-1');
    expect(keepKnown(undefined, null)).toBeNull();
  });

  it('stays unknown when nothing was ever known', () => {
    expect(keepKnown(undefined, undefined)).toBeUndefined();
  });

  it('takes a real answer, including an explicit "no run yet" (null)', () => {
    expect(keepKnown('run-2', 'run-1')).toBe('run-2');
    expect(keepKnown(null, 'run-1')).toBeNull();
  });
});

describe('failureMessage', () => {
  it('is null for an empty list', () => {
    expect(failureMessage([])).toBeNull();
  });

  it('returns the first standard_analysis_failed message', () => {
    const list = [note(1, 'other', 'x'), note(2, 'standard_analysis_failed', 'boom'), note(3, 'standard_analysis_failed', 'later')];
    expect(failureMessage(list)).toBe('boom');
  });

  it('is null when no open item is a standard-analysis failure', () => {
    expect(failureMessage([note(1, 'other', 'x')])).toBeNull();
  });
});
