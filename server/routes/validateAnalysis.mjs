// Deterministic validation over an analysis response. Unlike v1, hard
// failures here are meant to block the response (see analyze.mjs's
// retry-then-downgrade loop) rather than ride along as warnings — this is
// the application-side enforcement the model itself cannot be trusted to
// do (ANALYST-PROMPT-ENHANCEMENT-PLAN.md §11, and the reviewed recommendation
// this file implements: reject on conflict, don't just flag it).

const WEIGHTS_SUM_TOLERANCE = 1; // absorbs Math.round() rounding, not real drift
// dca_read is deliberately excluded here: its numeric content is the user's
// own plan data (from the snapshot), not an external market claim needing
// evidence-ID citation — it's validated instead by checkDcaAmountWithinSnapshot
// below, which is the correct, more specific gate for that field. Folding it
// into the generic evidence-citation rule too would reject a legitimate
// "12000 EGP into this tranche, within your 30000 EGP cap" statement for
// carrying no evidence_ids, when none is expected or needed for the user's
// own numbers.
const CLAIM_FIELD_KEYS = ['weights_reasoning', 'egp_read', 'wallet_read', 'watchlist_read'];
export const NUMBER_OR_PERCENT_RE = /(\d{1,3}(?:[.,]\d+)?\s?%)|(\$\s?\d[\d,]*(?:\.\d+)?)|(\b\d[\d,]{2,}(?:\.\d+)?\s?(?:EGP|جنيه)\b)/;

function checkWeightsSum(parsed) {
  const weights = parsed?.suggested_weights;
  if (!weights || typeof weights !== 'object') return [];
  const { deesc, base, stag } = weights;
  if (typeof deesc !== 'number' || typeof base !== 'number' || typeof stag !== 'number') return [];
  const sum = deesc + base + stag;
  if (Math.abs(sum - 100) <= WEIGHTS_SUM_TOLERANCE) return [];
  return [`suggested_weights sums to ${sum}, not 100`];
}

function fieldText(field) {
  return field && typeof field === 'object' && typeof field.text === 'string' ? field.text : '';
}

function fieldEvidenceIds(field) {
  if (!field || typeof field !== 'object' || !Array.isArray(field.evidence_ids)) return [];
  return field.evidence_ids.filter((id) => typeof id === 'string');
}

function checkClaimField(key, field, knownIds, errors) {
  if (!field) return;
  const text = fieldText(field);
  const ids = fieldEvidenceIds(field);
  if (NUMBER_OR_PERCENT_RE.test(text) && ids.length === 0) {
    errors.push(`${key} states a number/percentage/price with no evidence_ids attached`);
  }
  const unknown = ids.filter((id) => !knownIds.has(id));
  if (unknown.length > 0) {
    errors.push(`${key} cites evidence ID(s) not in the supplied search results: ${unknown.join(', ')}`);
  }
}

function checkClaimFields(parsed, evidenceIds) {
  const errors = [];
  const known = new Set(evidenceIds || []);
  for (const key of CLAIM_FIELD_KEYS) checkClaimField(key, parsed?.[key], known, errors);
  const reasons = parsed?.primary_decision?.reasons;
  if (Array.isArray(reasons)) {
    reasons.forEach((reason, i) => checkClaimField(`primary_decision.reasons[${i}]`, reason, known, errors));
  }
  return errors;
}

function checkDcaAmountWithinSnapshot(parsed, snapshot) {
  const dca = snapshot?.dca;
  const field = parsed?.dca_read;
  if (!dca || !field) return [];
  const cap = dca.mode === 'recurring' ? dca.monthly_investment_egp : dca.total_investment_egp;
  if (typeof cap !== 'number') return [];
  const text = fieldText(field);
  const amounts = [...text.matchAll(/(\d[\d,]{2,})\s?(?:EGP|جنيه)/g)].map((m) => Number(m[1].replace(/,/g, '')));
  const overCap = amounts.find((amt) => amt > cap * 1.05); // 5% slack for rounding language
  if (overCap === undefined) return [];
  return [`dca_read mentions ${overCap} EGP, exceeding the plan's actual ${dca.mode === 'recurring' ? 'monthly' : 'total'} investment of ${cap} EGP`];
}

export function validateAnalysis({ parsed, rawText, evidenceIds, snapshot }) {
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, errors: ['response was not valid JSON'] };
  }
  const errors = [
    ...checkWeightsSum(parsed),
    ...checkClaimFields(parsed, evidenceIds),
    ...checkDcaAmountWithinSnapshot(parsed, snapshot),
  ];
  return { ok: errors.length === 0, errors };
}

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };
const CONFIDENCE_NAMES = ['low', 'medium', 'high'];

export function computeConfidence({ modelConfidence, errors, evidenceCoverageRatio }) {
  let rank = CONFIDENCE_RANK[modelConfidence] ?? 0;
  if (errors && errors.length > 0) {
    rank = 0;
  } else if (typeof evidenceCoverageRatio === 'number' && evidenceCoverageRatio < 0.5) {
    rank = Math.min(rank, 1);
  }
  return CONFIDENCE_NAMES[rank];
}
