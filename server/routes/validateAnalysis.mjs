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
const NUMBER_OR_PERCENT_RE_GLOBAL = new RegExp(NUMBER_OR_PERCENT_RE.source, 'g');

// The prompt tells the model the snapshot is ground truth and to cite its
// Egypt/wallet figures directly in egp_read / wallet_read. Those figures have
// no EV-ID (they aren't search results), so demanding one made correct answers
// fail. A number is exempt only when it matches a snapshot value at the
// precision the model wrote it; anything else still needs a citation.
export function collectSnapshotNumbers(value, out = []) {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectSnapshotNumbers(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectSnapshotNumbers(v, out));
  return out;
}

function parseMatchedNumber(token) {
  const isPercent = token.includes('%');
  const digits = token.replace(/[^\d.,]/g, '');
  const normalized = isPercent ? digits.replace(',', '.') : digits.replace(/,/g, '');
  const value = Number(normalized);
  const decimals = normalized.includes('.') ? normalized.split('.')[1].length : 0;
  return { value, decimals };
}

function isGroundedInSnapshot(token, snapshotNumbers) {
  const { value, decimals } = parseMatchedNumber(token);
  if (!Number.isFinite(value)) return false;
  const tolerance = Math.max(0.5 * 10 ** -decimals, Math.abs(value) * 0.005);
  return snapshotNumbers.some((n) => Math.abs(n - value) <= tolerance);
}

export function hasUngroundedNumber(text, snapshotNumbers) {
  const matches = String(text || '').match(NUMBER_OR_PERCENT_RE_GLOBAL);
  if (!matches) return false;
  return matches.some((token) => !isGroundedInSnapshot(token, snapshotNumbers));
}

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

// The "cited ID must be known" half of the check — kept separate from the
// citation-required check below so it can be applied on its own to fields
// (like dca_read) that legitimately carry evidence_ids without being
// required to cite numeric claims.
function checkEvidenceIdsKnown(key, field, knownIds, errors) {
  if (!field) return;
  const ids = fieldEvidenceIds(field);
  const unknown = ids.filter((id) => !knownIds.has(id));
  if (unknown.length > 0) {
    errors.push(`${key} cites evidence ID(s) not in the supplied search results: ${unknown.join(', ')}`);
  }
}

// requireCitations gates ONLY the "numeric claim needs evidence_ids" rule.
// When no evidence pack was supplied at all (web search off, or no
// SERPAPI_API_KEY), there are no valid IDs the model could possibly cite, so
// demanding citations there would hard-fail every numeric claim
// unconditionally. The "cited ID must be known" check stays unconditional
// regardless: with zero known IDs, any cited ID is still fabricated.
function checkClaimField(key, field, knownIds, errors, requireCitations, snapshotNumbers) {
  if (!field) return;
  const text = fieldText(field);
  const ids = fieldEvidenceIds(field);
  if (requireCitations && ids.length === 0 && hasUngroundedNumber(text, snapshotNumbers)) {
    errors.push(`${key} states a number/percentage/price with no evidence_ids attached`);
  }
  checkEvidenceIdsKnown(key, field, knownIds, errors);
}

function checkClaimFields(parsed, evidenceIds, snapshot) {
  const errors = [];
  const known = new Set(evidenceIds || []);
  const requireCitations = known.size > 0;
  const snapshotNumbers = collectSnapshotNumbers(snapshot);
  for (const key of CLAIM_FIELD_KEYS) checkClaimField(key, parsed?.[key], known, errors, requireCitations, snapshotNumbers);
  const reasons = parsed?.primary_decision?.reasons;
  if (Array.isArray(reasons)) {
    reasons.forEach((reason, i) => checkClaimField(`primary_decision.reasons[${i}]`, reason, known, errors, requireCitations, snapshotNumbers));
  }
  // dca_read is excluded from CLAIM_FIELD_KEYS (its numeric content is the
  // user's own plan data, not an evidence-citation claim — see the comment
  // above), but the prompt schema still invites the model to attach
  // evidence_ids to it, so a fabricated ID there should still be caught.
  checkEvidenceIdsKnown('dca_read', parsed?.dca_read, known, errors);
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
    ...checkClaimFields(parsed, evidenceIds, snapshot),
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
