// Background scheduler: a 60 s tick inside the API process. When the schedule is enabled and
// the current time slot has no successful run, it runs the standard analysis. A missed slot
// (server down) is therefore caught up on the first tick after start.
import { getSetting } from './appSettings.mjs';
import { DEFAULT_SCHEDULE, normalizeSchedule, currentSlot } from './analysisSchedule.mjs';
import { runStandardAnalysis, slotState, sweepStrandedRuns } from './standardAnalysis.mjs';

export const SCHEDULE_SETTING = 'analysis_schedule';

// The stored schedule, normalized. Missing or invalid stored values fall back to the
// (disabled) default so a bad row can never crash a tick.
export async function loadSchedule(db) {
  const stored = await getSetting(db, SCHEDULE_SETTING);
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return normalizeSchedule(DEFAULT_SCHEDULE);
  try {
    return normalizeSchedule(stored);
  } catch {
    return normalizeSchedule(DEFAULT_SCHEDULE);
  }
}

export async function runDueAnalysis({ db, adminId, now, deps = {} }) {
  const clock = typeof now === 'function' ? now : now instanceof Date ? () => now : (deps.now ?? (() => new Date()));
  // First, so a run stranded by a crash is reported even if the schedule was switched off since.
  await sweepStrandedRuns({ db, deps });
  const schedule = await loadSchedule(db);
  if (!schedule.enabled) return { ran: false, reason: 'disabled' };

  const slot = currentSlot(clock(), schedule);
  const state = await slotState(db, slot.key);
  if (state.state === 'done') return { ran: false, reason: 'done', slot: slot.key };
  if (state.state !== 'none' && !state.claimable) return { ran: false, reason: state.state, slot: slot.key };

  const result = await runStandardAnalysis({ db, adminId, slotKey: slot.key, schedule, deps: { ...deps, now: clock } });
  return { ran: result.status !== 'skipped', slot: slot.key, result };
}

export function startAnalysisScheduler({ db, adminId, deps = {}, intervalMs = 60_000 }) {
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    runDueAnalysis({ db, adminId, deps })
      .catch((error) => console.error('[analysis-scheduler] tick failed:', error))
      .finally(() => { inFlight = false; });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
