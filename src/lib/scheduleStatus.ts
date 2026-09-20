import type { AdminNotification } from '../api/sharedAnalysis';

// `undefined` means "unknown" (the read failed); it must never overwrite a known value.
// `null` is a real answer (e.g. the server says there is no run yet).
export function keepKnown<T>(next: T | undefined, previous: T | undefined): T | undefined {
  return next === undefined ? previous : next;
}

const FAILURE_KIND = 'standard_analysis_failed';

// The message the schedule panel shows: the first open standard-analysis failure, if any.
export function failureMessage(list: readonly AdminNotification[]): string | null {
  return list.find((n) => n.kind === FAILURE_KIND)?.message ?? null;
}
