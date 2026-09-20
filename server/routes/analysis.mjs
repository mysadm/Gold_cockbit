import { Router } from 'express';
import { requireAdmin } from '../auth/middleware.mjs';
import { normalizeSchedule, currentSlot } from '../analysisSchedule.mjs';
import { setSetting } from '../appSettings.mjs';
import { loadSchedule, SCHEDULE_SETTING } from '../analysisScheduler.mjs';
import { latestDone, runStandardAnalysis } from '../standardAnalysis.mjs';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Mounted at /api/analysis behind requireAuth. `deps` are the analysis fetchers/runner
// (fakes in tests, the real ones from createApp/index.mjs otherwise).
export function createAnalysisRouter(db, { adminId, deps = {} }) {
  const router = Router();
  let manualRunning = false;

  router.get('/latest', async (req, res) => {
    const schedule = await loadSchedule(db);
    const slot = currentSlot(new Date(), schedule);
    const [latest, running] = await Promise.all([
      latestDone(db),
      db.query(
        `SELECT 1 FROM shared_analysis_runs
          WHERE status = 'running' AND started_at > now() - interval '4 minutes'
            AND (slot_key = $1 OR slot_key LIKE 'adhoc:%') LIMIT 1`,
        [slot.key]
      ),
    ]);
    res.json({
      schedule,
      slot: { key: slot.key, next_at: slot.nextAt.toISOString() },
      latest,
      running: running.rows.length > 0,
    });
  });

  router.get('/schedule', async (req, res) => {
    res.json(await loadSchedule(db));
  });

  router.put('/schedule', requireAdmin, async (req, res) => {
    // normalizeSchedule turns any non-object into the defaults; a bad PUT must never
    // silently reset the schedule.
    if (!isPlainObject(req.body)) return res.status(400).json({ error: 'Schedule must be a JSON object' });
    let schedule;
    try {
      schedule = normalizeSchedule(req.body);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    await setSetting(db, SCHEDULE_SETTING, schedule);
    res.json(schedule);
  });

  router.post('/run-now', requireAdmin, async (req, res) => {
    if (manualRunning) return res.status(409).json({ error: 'A manual analysis is already running' });
    manualRunning = true;
    try {
      const schedule = await loadSchedule(db);
      const result = await runStandardAnalysis({ db, adminId, slotKey: `adhoc:${Date.now()}`, schedule, deps });
      if (result.status === 'done') return res.json({ status: 'done', id: result.id });
      if (result.status === 'skipped') return res.status(409).json({ error: 'A manual analysis is already running' });
      res.status(502).json({ error: result.error });
    } finally {
      manualRunning = false;
    }
  });

  return router;
}
