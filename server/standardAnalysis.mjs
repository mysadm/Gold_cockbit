// The standard (market-only) analysis: claims a schedule slot, builds the input on the
// server, runs the admin's active provider and stores every run in shared_analysis_runs.
// Not charged to any user: nothing here touches ai_shared_usage.
import { runAnalysisV3 } from './runAnalysisV3.mjs';
import { runProviderAnalysis } from './providers/dispatch.mjs';
import { validateSnapshot, alignSnapshot } from '../shared/analystContract.mjs';
import { loadScenarioRows, buildMarketSnapshot } from './marketSnapshot.mjs';
import { raiseNotification, resolveNotifications } from './adminNotifications.mjs';

export const FAILURE_KIND = 'standard_analysis_failed';
export const MAX_ATTEMPTS = 3;
const ANALYSIS_TIMEOUT_MS = 85_000;
const ERROR_MAX = 500;

// Retry rule (also enforced in SQL by claimSlot): at most 3 attempts, a failed attempt can be
// re-claimed after 5 minutes, a 'running' claim older than 4 minutes is dead and re-claimable.
const CLAIMABLE_SQL = `attempts < ${MAX_ATTEMPTS} AND (
  (status = 'failed' AND finished_at < now() - interval '5 minutes')
  OR (status = 'running' AND started_at < now() - interval '4 minutes'))`;

async function claim(db, slotKey) {
  const { rows } = await db.query(
    `INSERT INTO shared_analysis_runs (slot_key, status, attempts) VALUES ($1, 'running', 1)
     ON CONFLICT (slot_key) DO UPDATE
       SET status = 'running', attempts = shared_analysis_runs.attempts + 1,
           started_at = now(), finished_at = NULL, error = NULL
     WHERE shared_analysis_runs.attempts < ${MAX_ATTEMPTS}
       AND ((shared_analysis_runs.status = 'failed' AND shared_analysis_runs.finished_at < now() - interval '5 minutes')
         OR (shared_analysis_runs.status = 'running' AND shared_analysis_runs.started_at < now() - interval '4 minutes'))
     RETURNING id, attempts`,
    [slotKey]
  );
  return rows.length ? { id: Number(rows[0].id), attempts: rows[0].attempts } : null;
}

export async function claimSlot(db, slotKey) {
  return (await claim(db, slotKey))?.id ?? null;
}

export async function slotState(db, slotKey) {
  const { rows } = await db.query(
    `SELECT status, attempts, (${CLAIMABLE_SQL}) AS claimable FROM shared_analysis_runs WHERE slot_key = $1`,
    [slotKey]
  );
  if (!rows.length) return { state: 'none', attempts: 0, claimable: true };
  return { state: rows[0].status, attempts: rows[0].attempts, claimable: rows[0].claimable === true };
}

function flatten(row) {
  const r = row.result ?? {};
  return {
    id: Number(row.id),
    slot_key: row.slot_key,
    created_at: (row.finished_at ?? row.started_at).toISOString(),
    text: r.text ?? '',
    snapshot: r.snapshot ?? null,
    validation: r.validation ?? { ok: false, errors: [] },
    evidence_sources: r.evidence_sources ?? [],
    used_web_search: r.used_web_search === true,
    search_status: r.search_status ?? null,
    provider_label: r.provider_label ?? '',
  };
}

export async function latestDone(db) {
  const { rows } = await db.query(
    `SELECT id, slot_key, result, started_at, finished_at FROM shared_analysis_runs
      WHERE status = 'done' AND result IS NOT NULL ORDER BY finished_at DESC, id DESC LIMIT 1`
  );
  return rows.length ? flatten(rows[0]) : null;
}

// The newest done run whose answer passed validation and was a real recommendation,
// in the shape the snapshot's previous_analysis expects.
async function previousAnalysisFrom(db) {
  const { rows } = await db.query(
    `SELECT result FROM shared_analysis_runs WHERE status = 'done' AND result IS NOT NULL
      ORDER BY finished_at DESC, id DESC LIMIT 10`
  );
  for (const { result } of rows) {
    const decision = result?.parsed?.primary_decision;
    if (result?.validation?.ok === true && decision && decision.action !== 'insufficient_evidence'
        && result.snapshot?.generated_at && result.parsed.suggested_weights) {
      return {
        generated_at: result.snapshot.generated_at,
        action: decision.action,
        confidence: decision.confidence,
        suggested_weights: result.parsed.suggested_weights,
      };
    }
  }
  return null;
}

class FinalFailure extends Error {}

async function attempt({ db, adminId, slotKey, schedule, deps }, attempts) {
  const {
    fetchPrices, fetchEgypt, runAnalysis = runAnalysisV3, runProvider = runProviderAnalysis,
    now = () => new Date(), timeoutMs = ANALYSIS_TIMEOUT_MS,
  } = deps;

  const { rows: providers } = await db.query('SELECT * FROM llm_providers WHERE user_id = $1 AND is_active = true', [adminId]);
  if (!providers.length) throw new FinalFailure('No active AI provider is configured for the admin account');
  const provider = providers[0];

  const prices = await fetchPrices({ now });
  let egypt = null;
  try {
    egypt = await fetchEgypt();
  } catch (error) {
    console.warn(`[standard-analysis] Egypt prices unavailable, continuing without them: ${error?.message || error}`);
  }
  const scenarioRows = await loadScenarioRows(db, adminId);
  const previousAnalysis = await previousAnalysisFrom(db);
  const snapshot = buildMarketSnapshot({ now, prices, egypt, scenarioRows, locale: schedule.language, previousAnalysis });
  const errors = validateSnapshot(snapshot);
  if (errors.length) throw new Error(`Invalid analysis snapshot: ${errors.join('; ')}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Analysis timed out after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
  let output;
  try {
    output = await runAnalysis(provider, snapshot, runProvider, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  const result = {
    text: output.text,
    parsed: output.result,
    snapshot: alignSnapshot(snapshot),
    validation: output.validation,
    evidence_sources: output.evidenceSources ?? [],
    used_web_search: output.usedWebSearch === true,
    search_status: output.searchStatus ?? null,
    provider_label: provider.label,
    slot_key: slotKey,
  };
  const { rows } = await db.query(
    `UPDATE shared_analysis_runs SET status = 'done', result = $2::jsonb, error = NULL, finished_at = now()
      WHERE slot_key = $1 AND attempts = $3 RETURNING id`,
    [slotKey, JSON.stringify(result), attempts]
  );
  if (!rows.length) throw new Error('This run was superseded by a newer attempt');
  await resolveNotifications(db, FAILURE_KIND);
  return Number(rows[0].id);
}

export async function runStandardAnalysis({ db, adminId, slotKey, schedule, deps = {} }) {
  const claimed = await claim(db, slotKey);
  if (!claimed) return { status: 'skipped', reason: 'slot is not claimable' };

  try {
    const id = await attempt({ db, adminId, slotKey, schedule, deps }, claimed.attempts);
    return { status: 'done', id };
  } catch (err) {
    const error = String(err?.message || err).slice(0, ERROR_MAX);
    const isFinal = err instanceof FinalFailure;
    const attempts = isFinal ? MAX_ATTEMPTS : claimed.attempts;
    // Only the attempt that still owns the slot may mark it failed (a stale one must not
    // overwrite a newer claim).
    const marked = await db.query(
      `UPDATE shared_analysis_runs SET status = 'failed', error = $2, attempts = $3, finished_at = now()
        WHERE slot_key = $1 AND attempts = $4 AND status = 'running'`,
      [slotKey, error, attempts, claimed.attempts]
    );
    if (marked.rowCount === 0) return { status: 'skipped', reason: 'superseded by a newer attempt' };
    // A manual run is the admin's own action and shows its error in the response.
    if (!slotKey.startsWith('adhoc:')) {
      await raiseNotification(db, {
        kind: FAILURE_KIND,
        message: `${slotKey}: ${error} (attempt ${attempts} of ${MAX_ATTEMPTS})`,
        detail: { slot: slotKey, error, attempts, final: attempts >= MAX_ATTEMPTS },
      });
    }
    const final = attempts >= MAX_ATTEMPTS;
    try {
      await (deps.notify ?? (async () => {}))({ event: FAILURE_KIND, slot: slotKey, error, attempts, final });
    } catch (hookError) {
      console.error('[standard-analysis] notify hook failed:', hookError);
    }
    return { status: 'failed', error, attempts, final };
  }
}
