# Scheduled Shared Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Cut AI cost. One market-only analysis runs on a schedule the admin sets (default twice a day) and every user sees the latest one. A user can still press **Update now**, which is today's personalised analysis and consumes one of their daily allowed analyses (default 3, per-user, admin-adjustable — unchanged).

**Approved design (from chat, 2026-09-21):**
- **Lazy scheduling, no background timer.** The first signed-in user's browser after a slot time (e.g. 08:00 / 16:00, in the admin's timezone) triggers the shared run. The server claims the slot atomically so only one run happens; a failed run frees the slot for retry after 5 minutes. Nothing runs if nobody opens the app (accepted).
- **The shared analysis is market-only.** The server strips wallet, DCA and watchlist from whatever snapshot the browser sends, so those sections never appear in it. **Update now** keeps the current personalised flow.
- **Not charged to any user.** Shared runs do not touch `ai_shared_usage`. The per-user daily limit (default 3, admin sets it per user in Settings → Users) applies only to Update now, exactly as today.
- **Cheaper calls:** shared runs use the compact v3 analyst contract (`runAnalysisV3`: 4–8k output tokens, evidence pack from web search) directly. Manual updates become cheaper by setting `ANALYST_CONTRACT_VERSION=v3` (documented, opt-in).

**Architecture:** new `shared_analysis_runs` + `app_settings` tables; a pure schedule/slot module; a small server service + router under `/api/analysis`; the client fetches `/latest` on load, shows it through the existing `state.ai` renderer (same `parseCompactAnalysis` path), triggers a refresh when the slot is stale and prices are fresh, and the admin gets a schedule panel in Settings.

**Tech Stack:** Node ESM + Express 5 + Postgres (`pg`), Preact + TypeScript, Vitest + supertest (real Postgres). No new dependencies.

## Global Constraints

- Follow every convention of the multi-user branch: `requireAuth` on all `/api` routes (new routes mount behind it), admin-only via `requireAdmin`, real-Postgres tests with `resetAndMigrate`, `createTestUser`/`signIn` helpers (`tests/helpers/users.mjs`), one vitest process at a time (shared `TEST_DATABASE_URL`), no `npm install` in a worktree with a symlinked `node_modules`.
- The user's real database (`gold_cockpit_dev`) and real app ports (3577/8787) are never touched by tests or checks; browser checks use a scratch database (`gold_cockpit_ui_try`, API :8788, UI :3588 via `API_TARGET`/`DEV_PORT`) and tear it down.
- Every new visible string is bilingual (Arabic default, RTL-safe), works at 390px and 1280px, dark and light, real `<button>`/labelled inputs.
- The schedule is **disabled by default** (`enabled: false`) so deploying this spends nothing until the admin turns it on.
- Times are `HH:MM` 24-hour in an IANA timezone (default `Africa/Cairo`); 1–4 times per day; shared-analysis language `ar` or `en` (default `ar`), level fixed to `beginner`.
- Commit after each task; end commit messages with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`; never `git add -A`.
- After each task: `npx tsc -b` clean and `npm test` green.

## File Structure

**Create:** `migrations/0025_add_shared_analysis.sql`, `server/analysisSchedule.mjs`, `server/appSettings.mjs`, `server/sharedAnalysis.mjs`, `server/routes/sharedAnalysis.mjs`, `src/api/sharedAnalysis.ts`, `src/ui/SchedulePanel.tsx`; tests `tests/server/analysis-schedule.test.mjs`, `tests/server/shared-analysis.test.mjs`, `tests/server/shared-analysis-routes.test.mjs`, `tests/lib/shared-analysis-api.test.ts`.
**Modify:** `server/createApp.mjs`, `src/App.tsx`, `tests/db/*` only if a test enumerates tables (check), `.env.example`, `README.md`.

---

## Task 1: Migration, schedule maths and settings store

**Files:** create `migrations/0025_add_shared_analysis.sql`, `server/analysisSchedule.mjs`, `server/appSettings.mjs`, `tests/server/analysis-schedule.test.mjs`.

**Produces:** `DEFAULT_SCHEDULE`, `normalizeSchedule(input)` (throws `Error` with a clear message), `currentSlot(now: Date, schedule) → { key: 'YYYY-MM-DD@HH:MM', startedAt: Date, nextAt: Date }`, `getSetting(db, key)`, `setSetting(db, key, value)`; tables `app_settings(key PK, value JSONB, updated_at)` and `shared_analysis_runs(id BIGSERIAL PK, slot_key TEXT UNIQUE, status 'running'|'done'|'failed', result JSONB, error TEXT, started_at, finished_at)`.

- [ ] **Step 1: Failing tests** — `tests/server/analysis-schedule.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { DEFAULT_SCHEDULE, normalizeSchedule, currentSlot } from '../../server/analysisSchedule.mjs';

const utc = { ...DEFAULT_SCHEDULE, tz: 'UTC', enabled: true };

describe('normalizeSchedule', () => {
  it('fills defaults, sorts and de-duplicates times', () => {
    expect(normalizeSchedule({ times: ['16:00', '08:00', '08:00'] })).toEqual({ enabled: false, times: ['08:00', '16:00'], tz: 'Africa/Cairo', language: 'ar' });
  });
  it.each([
    [{ enabled: 'yes' }], [{ times: [] }], [{ times: ['8:00'] }], [{ times: ['24:00'] }],
    [{ times: ['01:00', '02:00', '03:00', '04:00', '05:00'] }], [{ tz: 'Mars/Base' }], [{ language: 'fr' }],
  ])('rejects %j', (bad) => {
    expect(() => normalizeSchedule(bad)).toThrow();
  });
});

describe('currentSlot (UTC)', () => {
  it('between the two times', () => {
    const s = currentSlot(new Date('2026-09-21T09:30:00Z'), utc);
    expect(s.key).toBe('2026-09-21@08:00');
    expect(s.startedAt.toISOString()).toBe('2026-09-21T08:00:00.000Z');
    expect(s.nextAt.toISOString()).toBe('2026-09-21T16:00:00.000Z');
  });
  it('before the first time uses yesterday\'s last slot', () => {
    const s = currentSlot(new Date('2026-09-21T07:00:00Z'), utc);
    expect(s.key).toBe('2026-09-20@16:00');
    expect(s.nextAt.toISOString()).toBe('2026-09-21T08:00:00.000Z');
  });
  it('after the last time, next is tomorrow\'s first', () => {
    const s = currentSlot(new Date('2026-09-21T17:00:00Z'), utc);
    expect(s.key).toBe('2026-09-21@16:00');
    expect(s.nextAt.toISOString()).toBe('2026-09-22T08:00:00.000Z');
  });
  it('exactly at a slot time belongs to that slot; handles month rollover', () => {
    expect(currentSlot(new Date('2026-10-01T08:00:00Z'), utc).key).toBe('2026-10-01@08:00');
    expect(currentSlot(new Date('2026-10-01T05:00:00Z'), utc).key).toBe('2026-09-30@16:00');
  });
});

describe('currentSlot (Africa/Cairo, DST-safe)', () => {
  it('slot start is at the local wall-clock time and now is inside [start, next)', () => {
    const cairo = { ...utc, tz: 'Africa/Cairo' };
    for (const iso of ['2026-01-15T10:00:00Z', '2026-07-15T10:00:00Z', '2026-07-15T23:30:00Z']) {
      const now = new Date(iso);
      const s = currentSlot(now, cairo);
      const hm = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
      expect(['08:00', '16:00']).toContain(hm(s.startedAt));
      expect(['08:00', '16:00']).toContain(hm(s.nextAt));
      expect(s.startedAt.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(now.getTime()).toBeLessThan(s.nextAt.getTime());
    }
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/server/analysis-schedule.test.mjs` → FAIL (module missing).
- [ ] **Step 3: Implement** `server/analysisSchedule.mjs`:

```js
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const DEFAULT_SCHEDULE = Object.freeze({ enabled: false, times: ['08:00', '16:00'], tz: 'Africa/Cairo', language: 'ar' });

function validTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

export function normalizeSchedule(input) {
  const s = { ...DEFAULT_SCHEDULE, ...(input && typeof input === 'object' ? input : {}) };
  if (typeof s.enabled !== 'boolean') throw new Error('enabled must be true or false');
  if (!Array.isArray(s.times) || s.times.length < 1 || s.times.length > 4 || !s.times.every((t) => typeof t === 'string' && TIME_RE.test(t))) {
    throw new Error('times must be 1 to 4 values in HH:MM (24-hour) format');
  }
  if (typeof s.tz !== 'string' || !validTimeZone(s.tz)) throw new Error('tz must be a valid IANA time zone, e.g. Africa/Cairo');
  if (!['ar', 'en'].includes(s.language)) throw new Error("language must be 'ar' or 'en'");
  return { enabled: s.enabled, times: [...new Set(s.times)].sort(), tz: s.tz, language: s.language };
}

function zonedParts(date, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute') };
}

// UTC instant of a wall-clock time in `tz`; two correction passes absorb DST offset changes.
function zonedToUtc(y, m, d, h, min, tz) {
  const target = Date.UTC(y, m - 1, d, h, min);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), tz);
    guess -= Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - target;
  }
  return new Date(guess);
}

const pad = (n) => String(n).padStart(2, '0');
function shiftDay(y, m, d, delta) {
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function currentSlot(now, schedule) {
  const { tz, times } = schedule;
  const local = zonedParts(now, tz);
  const nowHm = `${pad(local.h)}:${pad(local.min)}`;
  const past = times.filter((t) => t <= nowHm);
  const slotTime = past.length ? past[past.length - 1] : times[times.length - 1];
  const slotDay = past.length ? { y: local.y, m: local.m, d: local.d } : shiftDay(local.y, local.m, local.d, -1);
  const later = times.filter((t) => t > nowHm);
  const nextTime = later.length ? later[0] : times[0];
  const nextDay = later.length ? { y: local.y, m: local.m, d: local.d } : shiftDay(local.y, local.m, local.d, 1);
  const at = (day, hm) => { const [h, min] = hm.split(':').map(Number); return zonedToUtc(day.y, day.m, day.d, h, min, tz); };
  return {
    key: `${slotDay.y}-${pad(slotDay.m)}-${pad(slotDay.d)}@${slotTime}`,
    startedAt: at(slotDay, slotTime),
    nextAt: at(nextDay, nextTime),
  };
}
```

- [ ] **Step 4: Migration + settings store.** `migrations/0025_add_shared_analysis.sql`:

```sql
CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shared_analysis_runs (
    id BIGSERIAL PRIMARY KEY,
    slot_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
    result JSONB,
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);
```

`server/appSettings.mjs`:

```js
export async function getSetting(db, key) {
  const { rows } = await db.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(db, key, value) {
  await db.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}
```
Add a tiny test in the same file (or `tests/server/app-settings.test.mjs`) using `resetAndMigrate`: get → null; set then get round-trips; set again overwrites.

- [ ] **Step 5: Run** `npx vitest run tests/server/analysis-schedule.test.mjs tests/server/app-settings.test.mjs`, then the full `npm test`. If an existing test enumerates tables/migration counts (grep `tests/db`, `schema_migrations`), update it minimally.
- [ ] **Step 6: Commit** `feat: add shared analysis tables, schedule maths and settings store`.

---

## Task 2: Shared analysis service and routes

**Files:** create `server/sharedAnalysis.mjs`, `server/routes/sharedAnalysis.mjs`, tests `tests/server/shared-analysis.test.mjs`, `tests/server/shared-analysis-routes.test.mjs`; modify `server/createApp.mjs`.

**Consumes:** Task 1 exports; `runAnalysisV3(provider, snapshot, runProvider, { signal })` (`server/runAnalysisV3.mjs`, returns `{ text, result, validation, usedWebSearch, searchStatus, evidenceSources, usage, metrics }`); `runProviderAnalysis` (`server/providers/dispatch.mjs`); `validateSnapshot`, `alignSnapshot` (`shared/analystContract.mjs`); `createRequireAuth`/`requireAdmin`.

**Produces:**
- `sanitizeSharedSnapshot(snapshot, { locale, previousAnalysis })` → deep copy with `locale` set, `explanation_level: 'beginner'`, `wallet = { has_holdings:false, holdings:{}, value_intl_egp:0, value_egypt_egp:null, cost_basis:[] }`, `dca = null`, `watchlist = []`, `previous_analysis = previousAnalysis ?? null`.
- `claimSlot(db, slotKey) → id | null`, `finishRun(db, id, result)`, `failRun(db, id, message)`, `latestDone(db) → row | null`, `slotState(db, slotKey) → 'none'|'running'|'done'|'failed'` plus `isClaimable(row)`.
- `runSharedAnalysis({ db, adminId, snapshot, slotKey, schedule, runAnalysis = runAnalysisV3, runProvider = runProviderAnalysis }) → { status: 'done', id } | { status: 'busy', state } ` (throws on hard failures after `failRun`).
- Router `createSharedAnalysisRouter(db, { adminId, runShared })` mounted at `/api/analysis`: `GET /latest`, `POST /refresh`, `GET /schedule`, `PUT /schedule` (admin), `POST /run-now` (admin).

- [ ] **Step 1: Failing tests** (`tests/server/shared-analysis.test.mjs`, service level, real DB, injected `runAnalysis`/`runProvider` fakes; and `tests/server/shared-analysis-routes.test.mjs`, through `createApp(client, { adminId, authRateLimit, runSharedAnalysis })` with `createTestUser`/`signIn`). Cover exactly these behaviours (write real assertions):
  1. `sanitizeSharedSnapshot` strips wallet/dca/watchlist, sets locale and level, injects `previous_analysis`, and does not mutate its input.
  2. `claimSlot`: first claim returns an id; a second immediate claim returns null; after marking `failed` with `finished_at` 6 minutes ago it can be reclaimed, but not at 1 minute ago; a `running` row older than 4 minutes can be reclaimed, a fresh one cannot; two `Promise.all` claims → exactly one id.
  3. `runSharedAnalysis`: success stores `status='done'` with `result` containing `text`, `snapshot` (the sanitized+aligned one), `evidence_sources`, `validation`, `provider_label`; a thrown analysis marks `failed` with the message and rethrows; no active admin provider → `failed` + clear error; nothing is ever written to `ai_shared_usage`.
  4. Routes: `GET /latest` requires login (401 signed out); as a regular user returns `{ schedule, slot: { key, next_at }, latest, running, stale }` with `stale:false` and no trigger when the schedule is disabled; `POST /refresh` → 409 when disabled; when enabled and stale → 200 and the injected runner is called once with a snapshot whose wallet/dca/watchlist are stripped; two simultaneous `POST /refresh` → one 200 and one 202 with `{ status: 'running' }`; after success `GET /latest` returns the run and `stale:false`; `POST /refresh` with an invalid snapshot → 400 and the claim is released (a valid retry succeeds); `PUT /schedule` and `POST /run-now` → 403 for a regular user, 400 with the validation message for a bad schedule, 200 and persisted (via `GET /schedule`) for the admin; `/run-now` runs regardless of `enabled` under slot key `adhoc:<epoch ms>` and becomes `latest`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `server/sharedAnalysis.mjs`:**

```js
import { validateSnapshot, alignSnapshot } from '../shared/analystContract.mjs';
import { runAnalysisV3 } from './runAnalysisV3.mjs';
import { runProviderAnalysis } from './providers/dispatch.mjs';

const FAILED_RETRY_AFTER = "interval '5 minutes'";
const RUNNING_STALE_AFTER = "interval '4 minutes'";
const RUN_TIMEOUT_MS = 85_000;

export function sanitizeSharedSnapshot(snapshot, { locale, previousAnalysis = null }) {
  const s = structuredClone(snapshot);
  s.locale = locale;
  s.explanation_level = 'beginner';
  s.wallet = { has_holdings: false, holdings: {}, value_intl_egp: 0, value_egypt_egp: null, cost_basis: [] };
  s.dca = null;
  s.watchlist = [];
  s.previous_analysis = previousAnalysis;
  return s;
}

export async function claimSlot(db, slotKey) {
  const { rows } = await db.query(
    `INSERT INTO shared_analysis_runs (slot_key, status) VALUES ($1, 'running')
     ON CONFLICT (slot_key) DO UPDATE
        SET status = 'running', started_at = now(), finished_at = NULL, error = NULL
      WHERE (shared_analysis_runs.status = 'failed' AND shared_analysis_runs.finished_at < now() - ${FAILED_RETRY_AFTER})
         OR (shared_analysis_runs.status = 'running' AND shared_analysis_runs.started_at < now() - ${RUNNING_STALE_AFTER})
     RETURNING id`,
    [slotKey]
  );
  return rows[0]?.id ?? null;
}

export async function slotIsClaimable(db, slotKey) {
  const { rows } = await db.query(
    `SELECT (status = 'failed' AND finished_at < now() - ${FAILED_RETRY_AFTER})
         OR (status = 'running' AND started_at < now() - ${RUNNING_STALE_AFTER}) AS claimable, status
       FROM shared_analysis_runs WHERE slot_key = $1`,
    [slotKey]
  );
  if (rows.length === 0) return { claimable: true, state: 'none' };
  return { claimable: rows[0].claimable, state: rows[0].status };
}

export const finishRun = (db, id, result) =>
  db.query(`UPDATE shared_analysis_runs SET status = 'done', result = $2, finished_at = now(), error = NULL WHERE id = $1`, [id, JSON.stringify(result)]);
export const failRun = (db, id, message) =>
  db.query(`UPDATE shared_analysis_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [id, String(message).slice(0, 500)]);
export const releaseRun = (db, id) => db.query('DELETE FROM shared_analysis_runs WHERE id = $1', [id]);

export async function latestDone(db) {
  const { rows } = await db.query(
    `SELECT id, slot_key, result, finished_at FROM shared_analysis_runs WHERE status = 'done' ORDER BY finished_at DESC LIMIT 1`
  );
  return rows[0] ?? null;
}

function previousFrom(row) {
  const parsed = row?.result?.parsed;
  if (!parsed?.primary_decision || !row.result.validation?.ok || parsed.primary_decision.action === 'insufficient_evidence') return null;
  return {
    generated_at: row.finished_at.toISOString(),
    action: parsed.primary_decision.action,
    confidence: parsed.primary_decision.confidence,
    suggested_weights: parsed.suggested_weights,
  };
}

// Returns { status: 'done', id } or { status: 'busy', state }. Throws after marking the run failed/released.
export async function runSharedAnalysis({ db, adminId, snapshot, slotKey, schedule, runAnalysis = runAnalysisV3, runProvider = runProviderAnalysis }) {
  const id = await claimSlot(db, slotKey);
  if (id === null) return { status: 'busy', state: (await slotIsClaimable(db, slotKey)).state };
  try {
    const { rows } = await db.query('SELECT * FROM llm_providers WHERE user_id = $1 AND is_active = true', [adminId]);
    if (rows.length === 0) throw new Error('No active AI provider is configured');
    const provider = rows[0];
    const clean = sanitizeSharedSnapshot(snapshot, { locale: schedule.language, previousAnalysis: previousFrom(await latestDone(db)) });
    const errors = validateSnapshot(clean);
    if (errors.length) {
      await releaseRun(db, id);
      const err = new Error(errors.join('; '));
      err.status = 400;
      throw err;
    }
    const aligned = alignSnapshot(clean);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
    let out;
    try { out = await runAnalysis(provider, clean, runProvider, { signal: controller.signal }); } finally { clearTimeout(timer); }
    await finishRun(db, id, {
      text: out.text, parsed: out.result, snapshot: aligned, validation: out.validation,
      evidence_sources: out.evidenceSources ?? [], used_web_search: Boolean(out.usedWebSearch), search_status: out.searchStatus ?? null,
      provider_label: `${provider.label} · ${provider.model}`, slot_key: slotKey,
    });
    return { status: 'done', id };
  } catch (err) {
    if (err.status !== 400) await failRun(db, id, err.message);
    throw err;
  }
}
```
  (`runAnalysisV3` takes the snapshot and aligns it itself; pass the sanitized `clean`. `aligned` is stored so the client can re-parse with the exact snapshot the server validated against: `parseCompactAnalysis(text, snapshot, evidenceIds)`. Verify by test that `parseCompactAnalysis` on the stored `text`+`snapshot` does not throw — do this in a client-side test in Task 3 with a fixture generated from the real `alignSnapshot`.)

- [ ] **Step 4: Implement `server/routes/sharedAnalysis.mjs`:**

```js
import { Router } from 'express';
import { requireAdmin } from '../auth/middleware.mjs';
import { getSetting, setSetting } from '../appSettings.mjs';
import { DEFAULT_SCHEDULE, normalizeSchedule, currentSlot } from '../analysisSchedule.mjs';
import { runSharedAnalysis, latestDone, slotIsClaimable } from '../sharedAnalysis.mjs';

const SETTING_KEY = 'analysis_schedule';

async function loadSchedule(db) {
  try { return normalizeSchedule(await getSetting(db, SETTING_KEY)); } catch { return { ...DEFAULT_SCHEDULE }; }
}

const publicRun = (row) => row && {
  id: Number(row.id), slot_key: row.slot_key, created_at: row.finished_at,
  text: row.result.text, snapshot: row.result.snapshot, validation: row.result.validation,
  evidence_sources: row.result.evidence_sources, used_web_search: row.result.used_web_search,
  search_status: row.result.search_status, provider_label: row.result.provider_label,
};

export function createSharedAnalysisRouter(db, { adminId, runShared = runSharedAnalysis }) {
  const router = Router();

  router.get('/latest', async (req, res) => {
    const schedule = await loadSchedule(db);
    const slot = currentSlot(new Date(), schedule);
    const { claimable, state } = await slotIsClaimable(db, slot.key);
    res.json({
      schedule, slot: { key: slot.key, next_at: slot.nextAt.toISOString() },
      latest: publicRun(await latestDone(db)),
      running: state === 'running' && !claimable,
      stale: schedule.enabled && claimable && state !== 'done',
    });
  });

  async function trigger(res, snapshot, slotKey, schedule) {
    try {
      const out = await runShared({ db, adminId, snapshot, slotKey, schedule });
      if (out.status === 'busy') return res.status(202).json({ status: out.state });
      return res.json({ status: 'done', id: Number(out.id) });
    } catch (err) {
      return res.status(err.status === 400 ? 400 : 502).json({ error: err.message });
    }
  }

  router.post('/refresh', async (req, res) => {
    const schedule = await loadSchedule(db);
    if (!schedule.enabled) return res.status(409).json({ error: 'Scheduled analysis is turned off' });
    const slot = currentSlot(new Date(), schedule);
    return trigger(res, req.body?.snapshot, slot.key, schedule);
  });

  router.get('/schedule', async (req, res) => res.json(await loadSchedule(db)));

  router.put('/schedule', requireAdmin, async (req, res) => {
    let next;
    try { next = normalizeSchedule(req.body); } catch (err) { return res.status(400).json({ error: err.message }); }
    await setSetting(db, SETTING_KEY, next);
    res.json(next);
  });

  router.post('/run-now', requireAdmin, async (req, res) => {
    const schedule = await loadSchedule(db);
    return trigger(res, req.body?.snapshot, `adhoc:${Date.now()}`, schedule);
  });

  return router;
}
```
  (`trigger` must return `res.status(400)` for a missing/invalid snapshot: `sanitizeSharedSnapshot(undefined)` would throw a TypeError — guard first: if `req.body?.snapshot` is not an object → 400 `snapshot is required` before claiming.)

- [ ] **Step 5: Mount in `server/createApp.mjs`** — add `runSharedAnalysis` to the `createApp(db, { adminId, authRateLimit, runSharedAnalysis })` options (default the real function) and, behind the existing `requireAuth`, `app.use('/api/analysis', createSharedAnalysisRouter(db, { adminId, runShared: runSharedAnalysis }))` (place it next to the other personal/shared routers; `requireAdmin` is applied inside the router only on `/schedule` PUT and `/run-now`).
- [ ] **Step 6: Run** the two new files, then full `npm test`. Confirm nothing writes `ai_shared_usage`.
- [ ] **Step 7: Commit** `feat: add scheduled shared analysis service and routes`.

---

## Task 3: Client — show the latest analysis, lazy trigger, Update now

**Files:** create `src/api/sharedAnalysis.ts`, `tests/lib/shared-analysis-api.test.ts`; modify `src/App.tsx`.

**Produces (`src/api/sharedAnalysis.ts`):**
```ts
export type AnalysisSchedule = { enabled: boolean; times: string[]; tz: string; language: 'ar' | 'en' };
export type SharedRun = { id: number; slot_key: string; created_at: string; text: string; snapshot: unknown; validation: { ok: boolean; errors: string[] }; evidence_sources: { id: string; title: string; link: string; date: string }[]; used_web_search: boolean; search_status: string | null; provider_label: string };
export type LatestResponse = { schedule: AnalysisSchedule; slot: { key: string; next_at: string }; latest: SharedRun | null; running: boolean; stale: boolean };
export const fetchLatest: () => Promise<LatestResponse>;                       // GET  /api/analysis/latest
export const refreshShared: (snapshot: unknown) => Promise<{ status: string }>; // POST /api/analysis/refresh  (202 ⇒ {status}, 200 ⇒ {status:'done'})
export const fetchSchedule / saveSchedule(s) / runSharedNow(snapshot)           // admin: GET/PUT /schedule, POST /run-now
```
(use the same `parseJson`-style error handling as `src/api/adminUsers.ts`; treat 202 as success.)

- [ ] **Step 1: Tests** (`tests/lib/shared-analysis-api.test.ts`, mock global `fetch` like `tests/lib/auth-api.test.ts`): each function hits the right URL/method/body; 202 is not an error; a non-OK response throws with the server's `error` text. Also a fixture test that proves the stored server payload can be rendered: build a snapshot with `buildAnalysisSnapshot` (market-only), run it through the server's `alignSnapshot` and a hand-written valid v3 `text` (see `tests/client/analyst-v3.test.ts` for a valid example) and assert `parseCompactAnalysis(text, snapshot, ids)` does not throw and has no `wallet_read`/`dca_read`.
- [ ] **Step 2: `App.tsx` integration** (read the existing `analyze()` and `state.ai` code first; keep the personal flow untouched):
  1. Extend `AppState['ai']` with optional `atMs?: number` and `sharedRunId?: number | null`, and set `atMs: Date.now(), sharedRunId: null` in `analyze()`'s success `setState` (default state: leave undefined).
  2. Extract the existing scenario-mapping in `analyze()` into a local helper `scenarioSnapshot(weights)` used by both `analyze()` and the new function; add `buildMarketSnapshot()` → `buildAnalysisSnapshot({ generatedAt: now, marketRetrievedAt: state.marketRetrievedAt, previousAnalysis: null, locale: 'ar', explanationLevel: 'beginner', spot: state.spot, egp: state.egp, weightedTarget, scenarios: scenarioSnapshot(DEFAULT_WEIGHTS), egypt: <same egypt mapping as analyze()>, wallet: { hasHoldings: false, holdings: {}, intlValueEgp: 0, egyptValueEgp: null, costBasis: [] }, dca: null, watchlist: [] })` where `DEFAULT_WEIGHTS` is the seeded default (`{ deesc: 35, base: 45, stag: 20 }` — reuse `defaultState.weights`). The server overrides locale/level/wallet/dca/watchlist/previous anyway.
  3. `applyShared(run)`: `parseCompactAnalysis(run.text, run.snapshot as AnalysisSnapshot, run.evidence_sources.map(s => s.id))` in try/catch (ignore on failure); then `setState` `ai: { loading:false, error:null, data: parsed, at: <same en-GB formatted string from run.created_at>, atMs: Date.parse(run.created_at), sharedRunId: run.id, applied:false, usedWebSearch: run.used_web_search, searchStatus: run.search_status as SearchStatus | null, evidenceSources: run.evidence_sources, validation: run.validation, providerLabel: run.provider_label, startedAt:null, timedOut:false }` — only when `!state.ai.data || Date.parse(run.created_at) > (state.ai.atMs ?? 0)`.
  4. Effect on mount (after login; runs for every user): `fetchLatest()` → `applyShared(latest)` → if `stale` and prices are fresh (`state.marketRetrievedAt.xau && .fx` both within the last 30 minutes; if not yet loaded, re-check when they change) → `refreshShared(buildMarketSnapshot())` fire-and-forget (`.catch(() => {})`), then poll `fetchLatest()` every 8 s up to 3 min while `running || stale || we triggered`, applying the run when it appears; clear the timer on unmount. Guard with a ref so only one trigger is sent per page load per slot key.
  5. UI on the Analyst screen (bilingual, new `T` strings): when `state.ai.sharedRunId` is set show a small line "Scheduled analysis · updated {at} · next update {HH:MM}" (`next_at` from the last `/latest`, formatted in the browser's locale); relabel the existing analyze button/quota hint to make the trade-off explicit: EN "Update now — uses 1 of your {n} daily updates" / AR equivalent (keep `analyzeQuota` display). If the schedule is disabled or there is no shared run, behaviour is exactly as today.
- [ ] **Step 3: Verify** `npx tsc -b`, `npx vitest run tests/lib tests/client`, full `npm test`. **Browser check** (scratch DB per Global Constraints): as admin turn the schedule on with times so the current slot is stale, add an active provider row for the admin, and confirm: `/api/analysis/latest` reports `stale:true`; opening the app as a second (regular) user triggers exactly ONE `POST /api/analysis/refresh` (a stub/unreachable provider makes the run fail — expect a 502, `failed` row and NO second trigger inside 5 minutes; the UI shows the personal-analysis controls normally with no error banner for the background failure); the regular user's Analyst screen never shows wallet/DCA sections from a shared run (use a directly inserted `done` row with a valid v3 `text` + snapshot for the display check); the "Scheduled analysis · updated … · next …" line and the Update-now hint render at 390px and 1280px in Arabic and English.
- [ ] **Step 4: Commit** `feat: show the scheduled shared analysis and trigger it lazily`.

---

## Task 4: Admin schedule panel

**Files:** create `src/ui/SchedulePanel.tsx`; modify `src/App.tsx` (mount it in the admin-only Settings tab between `AIModelSettingsManager` and `UsersPanel`).

**Interfaces:** `<SchedulePanel ar={boolean} onRunNow={() => Promise<void>} />`, where `App` supplies `onRunNow = () => runSharedNow(buildMarketSnapshot())`.

- [ ] **Step 1: Implement** (bilingual, RTL-safe, `Card`/`SectionLabel`/`btn-primary`/`btn-outline`, labelled inputs): loads `fetchSchedule()` + `fetchLatest()`; controls: enabled checkbox (`role="switch"`-style label), two `<input type="time">` (a "+ add time" is out of scope — exactly the times returned, edit the first two), timezone text input with `list` datalist of `Africa/Cairo`, `UTC`, `Europe/London`, `Asia/Riyadh`, `Asia/Dubai`, language select (`ar`/`en`), **Save** (disabled until changed; shows the server's validation error inline), and **Run now** (busy-guarded; shows "Running…" then the outcome). Below: "Last run: {time} · {provider_label}" or "No run yet"; if the last claim failed show the error text. Never show secrets.
- [ ] **Step 2: Verify in the browser** (scratch DB): as admin change times/timezone/enabled, Save, reload → values persisted; an invalid timezone shows the server error; a regular user has no Settings tab and `PUT /api/analysis/schedule` returns 403; Run now with a reachable-but-blocked provider shows the 502 message without breaking the panel; 390px Arabic no horizontal overflow.
- [ ] **Step 3:** `npx tsc -b`, `npm test`. **Commit** `feat: add the admin schedule panel for shared analysis`.

---

## Task 5: Docs and go-live notes

**Files:** modify `.env.example`, `README.md`.

- [ ] **Step 1:** README section "Scheduled analysis": what it is; it is OFF by default; turn it on in Settings → Analysis schedule; lazy trigger explanation (runs when the first user opens the app after a slot time; nothing runs if nobody opens it); the shared analysis has no wallet/DCA sections; Update now uses the user's daily allowance (default 3, set per user in Settings → Users); cost tips: keep 2 slots/day, set `ANALYST_CONTRACT_VERSION=v3` in `.env` and restart to make manual updates use the compact contract too (4–8k output tokens vs a 16k floor), and lower per-user limits to save more.
- [ ] **Step 2:** `.env.example`: add a commented `# ANALYST_CONTRACT_VERSION=v3` with a one-line explanation.
- [ ] **Step 3 (for the user, not the agent — needs real provider credits):** after deploying, run once from the app as admin (Settings → Analysis schedule → Run now) and compare the analysis quality/cost with today's; optionally `node scripts/benchmark-analyst.mjs` (read the script header first; it calls the real provider).
- [ ] **Step 4:** `npm test`; **commit** `docs: document scheduled shared analysis`.

---

## Self-Review Notes

- **Spec coverage:** lazy schedule (T1 slot maths, T2 claim/refresh, T3 trigger); shared analysis market-only (T2 `sanitizeSharedSnapshot`, enforced server-side); not charged to users + limit stays 3 and per-user (no changes to `daily_ai_limit` code); admin-defined schedule (T4); users see latest only and update with allowance (T3); token efficiency (v3 shared runs, opt-in v3 manual, ≤2 shared calls/day regardless of user count).
- **Known limits (accepted):** the shared run's prices come from whichever approved user's browser triggers it (same trust level as the existing price-history writes); nothing runs when nobody opens the app; a run spanning the slot boundary is attributed to the slot it started in; the shared analysis uses the app's default scenario weights as its baseline, users apply suggested weights to their own.
- **Type consistency:** `SharedRun`/`LatestResponse` mirror `publicRun`/the `/latest` response in Task 2; `AnalysisSchedule` mirrors `normalizeSchedule`'s output; `sanitizeSharedSnapshot` field names are the snake_case `AnalysisSnapshot` shape (`wallet.has_holdings`, `value_intl_egp`, …) from `src/lib/analysisSnapshot.ts`.
