// The V4 pipeline (GOLD_COCKPIT_SPEED_PLAN.md Phase 2): PROMPT_V2 + the closed schema/validator
// from shared/analystOutputV4.mjs, wired in behind ANALYST_V4=1 via runAnalysisV3.mjs's own flag
// check. Unlike v3, there is no admin-editable prompt/format layer here — the schema enforces the
// shape, so PROMPT_V2 is used unconditionally regardless of any saved/tested custom prompt.
import { collectEvidence } from './evidence.mjs';
import { alignSnapshot, snapshotWeights } from '../shared/analystContract.mjs';
import { computePriorStateEligible } from '../shared/analystOutputV4.mjs';
import { buildAnalysisPromptV4 } from './prompts/buildAnalysisPromptV4.mjs';
import { PROMPT_V2 } from './prompts/promptV2.mjs';
import { runValidatedAnalysis } from './providers/validatedAnalysis.mjs';

const tierOf = (snapshot) => (snapshot.analysis_scope === 'market' ? 'standard' : 'personalized');

// The legacy web-search collector (server/evidence.mjs) still emits EV-001-style ids — the v2
// route's own tests pin that exact format, so it is left untouched. V4's schema instead expects
// the Phase 3/4 evidence-pipeline shape, EV-YYYYMMDD-HHMM-NN (EV_ID_PATTERN in
// shared/analystOutputV4.mjs), so ids are remapped locally here. Delete this once Phase 4's real
// pipeline emits pattern-compliant ids natively.
function remapEvidenceIds(evidence, at) {
  const pad = (n, len) => String(n).padStart(len, '0');
  const prefix = `EV-${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1, 2)}${pad(at.getUTCDate(), 2)}-${pad(at.getUTCHours(), 2)}${pad(at.getUTCMinutes(), 2)}`;
  const map = new Map(evidence.evidenceIds.map((id, i) => [id, `${prefix}-${pad(i + 1, 2)}`]));
  const remap = (item) => ({ ...item, id: map.get(item.id) ?? item.id });
  return {
    evidenceIds: evidence.evidenceIds.map((id) => map.get(id)),
    evidencePack: evidence.evidencePack.map(remap),
    evidenceSources: evidence.evidenceSources.map(remap),
  };
}

export async function runAnalysisV4(provider, input, runProvider, { signal, evidenceCollector = collectEvidence, onRawAnswer } = {}) {
  const started = Date.now();
  const snapshot = alignSnapshot(input);
  const tier = tierOf(snapshot);

  const evidenceBuiltAt = new Date();
  signal?.throwIfAborted();
  const rawEvidence = await evidenceCollector(provider);
  const searchMs = Date.now() - started;
  const evidence = remapEvidenceIds(rawEvidence, evidenceBuiltAt);
  // A query that timed out and fell back to a stale cached result (server/webSearch.mjs) means
  // the evidence is really as old as that fallback's original fetch, not "now" — surfaced so
  // PROMPT_V2's "if evidence_age_hours is high, flag stale evidence" has real data to act on.
  const staleFallbackAt = rawEvidence.searchMetrics?.staleFallbackAt;
  const effectiveEvidenceBuiltAt = Number.isFinite(staleFallbackAt) ? new Date(staleFallbackAt) : evidenceBuiltAt;
  const evidenceAgeHours = Math.max(0, (Date.now() - effectiveEvidenceBuiltAt.getTime()) / 3600000);

  const precomputed = {
    prior_state_eligible: computePriorStateEligible({
      previousAnalysis: snapshot.previous_analysis,
      currentWeights: snapshotWeights(snapshot),
      generatedAt: snapshot.generated_at,
    }),
    evidence_built_at: effectiveEvidenceBuiltAt.toISOString(),
    evidence_age_hours: Math.round(evidenceAgeHours * 100) / 100,
    // Phases 3-4 assign a real evidence_packs.pack_id; there is no persisted pack yet.
    evidence_pack_id: null,
  };
  const prompt = buildAnalysisPromptV4(snapshot, evidence.evidencePack, precomputed);
  const scenarioKeys = snapshot.scenarios.map((s) => s.key);

  signal?.throwIfAborted();
  const modelStarted = Date.now();
  const outcome = await runValidatedAnalysis({
    provider, prompt, runProvider, tier, scenarioKeys, evidenceIds: evidence.evidenceIds, onRawAnswer,
    dcaLimitEgp: snapshot.dca?.current_installment_limit_egp,
    options: { system: PROMPT_V2, expectJson: false, compact: 'v4', signal },
  });
  const modelMs = Date.now() - modelStarted;
  signal?.throwIfAborted();

  const parsed = outcome.ok ? outcome.output : null;
  const validation = outcome.ok ? { ok: true, errors: [] } : { ok: false, errors: outcome.errors };
  const totalMs = Date.now() - started;
  const metrics = {
    contract: '4', tier, providerType: provider.provider_type,
    // otherMs covers precompute/prompt-assembly/id-remap between the two measured phases — near
    // zero in this synchronous pipeline, kept explicit rather than assumed.
    searchMs, modelMs, otherMs: totalMs - searchMs - modelMs, totalMs, retries: outcome.retries,
    staleFallbackUsed: Number.isFinite(staleFallbackAt),
    // Per attempt, not summed across retries — see runValidatedAnalysis.
    attempts: outcome.attempts.map((a) => ({
      outputTokens: a.usage?.output_tokens ?? null, inputTokens: a.usage?.input_tokens ?? null, truncated: a.truncated,
      errors: a.errors.slice(0, 6), repaired: a.repaired, repairedFields: a.repairedFields,
    })),
    validationOk: validation.ok, validationErrors: validation.errors.slice(0, 6),
  };
  console.info('[analyst-v4-metrics]', JSON.stringify(metrics));

  return {
    text: JSON.stringify(parsed), result: parsed, validation,
    usage: outcome.attempts.at(-1)?.usage ?? null, retries: outcome.retries,
    usedWebSearch: rawEvidence.usedWebSearch, searchStatus: rawEvidence.searchStatus,
    evidenceSources: evidence.evidenceSources, metrics,
  };
}
