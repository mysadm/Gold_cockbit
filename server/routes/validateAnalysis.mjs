// Deterministic, non-fatal checks over an analysis response — the
// application-side validation the model itself cannot be trusted to do
// (see ANALYST-PROMPT-ENHANCEMENT-PLAN.md §11). Never throws and never
// blocks the response; callers surface the returned warnings alongside the
// analysis rather than discarding it.

const WEIGHTS_SUM_TOLERANCE = 1; // absorbs Math.round() rounding, not real drift

function checkWeightsSum(parsed) {
  const weights = parsed?.suggested_weights;
  if (!weights || typeof weights !== 'object') return [];
  const { deesc, base, stag } = weights;
  if (typeof deesc !== 'number' || typeof base !== 'number' || typeof stag !== 'number') return [];
  const sum = deesc + base + stag;
  if (Math.abs(sum - 100) <= WEIGHTS_SUM_TOLERANCE) return [];
  return [`suggested_weights sums to ${sum}, not 100`];
}

function checkCitedEvidenceExists(rawText, evidenceIds) {
  if (!evidenceIds || evidenceIds.length === 0) return [];
  const cited = new Set((rawText.match(/EV-\d{3}/g) || []));
  const known = new Set(evidenceIds);
  const unknown = [...cited].filter((id) => !known.has(id));
  if (unknown.length === 0) return [];
  return [`cited evidence ID(s) not in the supplied search results: ${unknown.join(', ')}`];
}

export function validateAnalysis({ parsed, rawText, evidenceIds }) {
  return [
    ...checkWeightsSum(parsed),
    ...checkCitedEvidenceExists(rawText || '', evidenceIds || []),
  ];
}
