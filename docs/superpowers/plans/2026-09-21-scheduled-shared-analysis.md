# Standard Market Analysis (background) + Personalized Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Cut AI cost and give every user a ready analysis. The server runs one **standard market analysis** in the background on a schedule the admin sets (default twice a day) and keeps every run in the database. Users see the latest one on a **Standard market analysis** card (no wallet, no DCA). Each user also has a **My personalized analysis** card (includes their wallet and DCA plan) that they run on request, limited to their daily allowance (default 3, admin-adjustable per user — unchanged). If a background run fails, the admin is notified **inside the app** (banner + badge).

**Approved design (chat, 2026-09-21, revision 2):**
- **True background run** inside the API process: a 60-second tick checks the schedule; when the current time slot has no successful run, it runs. Missed slots (server was down) are caught up on the next tick after start. No browser is involved.
- **The server builds the analysis input itself:** live prices from the same public feeds the app already uses (gold spot, USD/EGP), Egypt local prices via the existing `fetchEgyptGoldPrices()`, and the **admin's** scenario weights/bands as the framework. Wallet, DCA and watchlist are always empty in this analysis.
- **Runs on the admin's active provider with the compact v3 contract** (`runAnalysisV3`). Not charged to any user; nothing is written to `ai_shared_usage`.
- **Retries and failure notification:** up to 3 attempts per slot, at least 5 minutes apart. The first failure opens an admin notification (updated on each attempt, shown as a banner and a Settings badge in the app for admins; in-app only for now); a successful run closes it. A missing provider counts as a final failure at once.
- **Personalized analysis:** the existing flow, untouched (daily limit, wallet + DCA included); only its card title and hint change.
- **Off by default:** the schedule ships disabled; the admin turns it on in Settings.

**Tech Stack:** Node ESM + Express 5 + Postgres (`pg`), Preact + TypeScript, Vitest + supertest (real Postgres). No new dependencies.

## Global Constraints

- Follow the multi-user conventions: new routes mount behind `requireAuth`; admin-only via `requireAdmin`; real-Postgres tests with `resetAndMigrate`; helpers `createTestUser`/`signIn` (`tests/helpers/users.mjs`); one vitest process at a time; no `npm install` in a worktree with a symlinked `node_modules`.
- Tests never call the network: prices, Egypt prices, the model and any notifier are injected fakes.
- The user's real database (`gold_cockpit_dev`) and real app ports (3577/8787) are never touched; browser checks use a scratch DB (`gold_cockpit_ui_try`, API :8788, UI :3588 via `API_TARGET`/`DEV_PORT`) and tear it down. A scratch API must have the scheduler pointed at the scratch DB only.
- Every new visible string is bilingual (Arabic default, RTL-safe), works at 390px and 1280px, dark and light, real `<button>`/labelled inputs.
- Schedule format: 1–4 times `HH:MM` (24h) in an IANA timezone (default `Africa/Cairo`), language `ar`|`en` (default `ar`), explanation level fixed `beginner`, `enabled` default `false`.
- Retry rule: at most 3 attempts per slot; a failed attempt can be re-claimed only after 5 minutes; a `running` claim older than 4 minutes is considered dead and can be re-claimed (counts as an attempt).
- Commit after each task; messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`; never `git add -A`. After each task: `npx tsc -b` clean and `npm test` green.

## File Structure

**Create:** `migrations/0025_add_standard_analysis.sql`, `server/analysisSchedule.mjs`, `server/appSettings.mjs`, `server/marketPrices.mjs`, `server/marketSnapshot.mjs`, `server/adminNotifications.mjs`, `server/standardAnalysis.mjs`, `server/analysisScheduler.mjs`, `server/routes/analysis.mjs`, `src/api/sharedAnalysis.ts`, `src/ui/StandardAnalysisCard.tsx`, `src/ui/SchedulePanel.tsx`, `src/ui/AdminAlerts.tsx`; matching tests under `tests/server/` and `tests/lib/`.
**Modify:** `server/index.mjs`, `server/createApp.mjs`, `src/App.tsx`, `src/ui/Sidebar.tsx`/`BottomNav.tsx` (badge count only), `.env.example`, `README.md`; any `tests/db/*` that enumerates tables.

---

## Task 1: Migration, schedule maths, settings store

**Files:** create `migrations/0025_add_standard_analysis.sql`, `server/analysisSchedule.mjs`, `server/appSettings.mjs`, tests `tests/server/analysis-schedule.test.mjs`, `tests/server/app-settings.test.mjs`.

**Produces:** `DEFAULT_SCHEDULE`, `normalizeSchedule(input)` (throws `Error` with a clear message), `currentSlot(now, schedule) → { key: 'YYYY-MM-DD@HH:MM', startedAt: Date, nextAt: Date }`, `getSetting(db,key)`, `setSetting(db,key,value)`; tables `app_settings`, `shared_analysis_runs` (`id BIGSERIAL PK, slot_key TEXT UNIQUE NOT NULL, status 'running'|'done'|'failed', attempts INTEGER NOT NULL DEFAULT 1, result JSONB, error TEXT, started_at, finished_at`), `admin_notifications` (`id BIGSERIAL PK, kind TEXT NOT NULL, message TEXT NOT NULL, detail JSONB, created_at, updated_at, resolved_at NULL`) with `CREATE UNIQUE INDEX admin_notifications_one_open ON admin_notifications (kind) WHERE resolved_at IS NULL`.

- [ ] **Step 1: Failing tests** `tests/server/analysis-schedule.test.mjs`:

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
  it("before the first time uses yesterday's last slot", () => {
    const s = currentSlot(new Date('2026-09-21T07:00:00Z'), utc);
    expect(s.key).toBe('2026-09-20@16:00');
    expect(s.nextAt.toISOString()).toBe('2026-09-21T08:00:00.000Z');
  });
  it("after the last time, next is tomorrow's first", () => {
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
plus `tests/server/app-settings.test.mjs` (real DB: get→null; set then get round-trips; set again overwrites).
- [ ] **Step 2:** run → FAIL. **Step 3: implement** `server/analysisSchedule.mjs`:

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
  `server/appSettings.mjs`: `getSetting` = `SELECT value FROM app_settings WHERE key=$1` → `rows[0]?.value ?? null`; `setSetting` = `INSERT ... ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()` (value passed as `JSON.stringify(value)`). Migration creates the three tables above.
- [ ] **Step 4:** run the two test files, then full `npm test` (update any `tests/db/*` that enumerates tables). **Commit** `feat: add standard-analysis tables, schedule maths and settings store`.

---

## Task 2: Server-side market data and snapshot builder

**Files:** create `server/marketPrices.mjs`, `server/marketSnapshot.mjs`, tests `tests/server/market-prices.test.mjs`, `tests/server/market-snapshot.test.mjs`.

**Produces:**
- `fetchMarketPrices({ fetchImpl = fetch, now = () => new Date() }) → { spot, usdEgp, goldSource, retrievedAt }` — **port the browser's feeds verbatim**: read `pullLive` in `src/App.tsx` (~lines 975–1040): the ordered `goldFeeds` list (gold-api, goldprice.org, binance-paxg, jsdelivr-daily, …), first value with `1000 < v < 20000` wins, each with a 6 s timeout; FX from `open.er-api.com` then the jsDelivr currency API, accepted when `20 < fx < 200`. Throws `Error('No gold price feed answered: <diagnostics>')` / `Error('No USD/EGP feed answered')` when nothing usable.
- `SCENARIO_META` (keys `deesc`/`base`/`stag`, `name_en`, `thesis` — copy the English names/theses from `T.en.scen` in `src/App.tsx`: "Geopolitical Changes"/"Global geopolitical tensions ease broadly (not just Iran), Fed pivots, ETF inflows return", "Base Case"/"CB buying ~720t/yr vs. elevated rates — grind higher", "Stagflation Trap"/"Fed hikes into weakness, dollar squeeze, forced selling"), `loadScenarioRows(db, adminId)` (the admin's 3 rows ordered by `sort_order`: `band_low`, `band_high`, `weight_pct` as numbers; error if not exactly 3), and `buildMarketSnapshot({ now, prices, egypt, scenarioRows, locale, previousAnalysis }) → AnalysisSnapshot` (snake_case shape of `src/lib/analysisSnapshot.ts`): `schema_version:'2'`, `market.weighted_target_usd = Σ weight/100 × (lo+hi)/2` rounded exactly as the client does, `xau_retrieved_at`/`fx_retrieved_at` = `prices.retrievedAt`, `egypt` mapped with the SAME implied-rate/premium formulas and rounding as the client's `buildEgypt` (rows limited to `{karat,sell,buy}`), `wallet` empty, `dca: null`, `watchlist: []`, `explanation_level: 'beginner'`.

- [ ] **Step 1: Tests** (fake `fetchImpl` returning canned `Response`s; no network): first gold feed fails/returns 999 → falls through to the next; a value of 25000 is rejected; all feeds fail → clear error; FX primary fails → fallback used; both fail → error. **Parity test:** for the same inputs, `buildMarketSnapshot(...)` equals the client's `buildAnalysisSnapshot({ …wallet empty, dca null, watchlist [] … })` (import `../../src/lib/analysisSnapshot` — vitest transforms TS) after removing `generated_at`, `price_alignment` and `previous_analysis` from both; assert on `market`, `scenarios`, `egypt`, `wallet`, `dca`, `watchlist`. Also: `loadScenarioRows` returns the admin's rows (not another user's) and throws when the admin lacks 3 scenarios; the built snapshot passes `validateSnapshot` from `shared/analystContract.mjs` with no errors.
- [ ] **Step 2:** run → FAIL; **Step 3:** implement; **Step 4:** run new tests + full suite. **Commit** `feat: build the market-only analysis snapshot on the server`.

---

## Task 3: Standard analysis runner, notifications and background scheduler

**Files:** create `server/adminNotifications.mjs`, `server/standardAnalysis.mjs`, `server/analysisScheduler.mjs`, tests `tests/server/admin-notifications.test.mjs`, `tests/server/standard-analysis.test.mjs`, `tests/server/analysis-scheduler.test.mjs`; modify `server/index.mjs`.

**Consumes:** Tasks 1–2; `runAnalysisV3(provider, snapshot, runProvider, { signal })` (returns `{ text, result, validation, usedWebSearch, searchStatus, evidenceSources }`), `runProviderAnalysis` (`server/providers/dispatch.mjs`), `fetchEgyptGoldPrices` (`server/isaghaPrices.mjs`), `validateSnapshot`/`alignSnapshot` (`shared/analystContract.mjs`).

**Produces:**
- `adminNotifications.mjs`: `raiseNotification(db, { kind, message, detail })` (upsert of the single OPEN row of that kind: new row or update message/detail/`updated_at`), `resolveNotifications(db, kind)` (sets `resolved_at`), `listOpen(db)`, `dismiss(db, id)`.
- `standardAnalysis.mjs`: `claimSlot(db, slotKey) → id|null` (SQL: `INSERT (slot_key,status,attempts) VALUES ($1,'running',1) ON CONFLICT (slot_key) DO UPDATE SET status='running', attempts = shared_analysis_runs.attempts + 1, started_at = now(), finished_at = NULL, error = NULL WHERE shared_analysis_runs.attempts < 3 AND ((status='failed' AND finished_at < now() - interval '5 minutes') OR (status='running' AND started_at < now() - interval '4 minutes')) RETURNING id`), `slotState(db, slotKey) → { state: 'none'|'running'|'done'|'failed', attempts, claimable }`, `latestDone(db)`, and
  `runStandardAnalysis({ db, adminId, slotKey, schedule, deps }) → { status: 'done', id } | { status: 'skipped', reason } | { status: 'failed', error, attempts, final }` where `deps = { fetchPrices, fetchEgypt, runAnalysis = runAnalysisV3, runProvider = runProviderAnalysis, now = () => new Date(), notify = async () => {} }`. Flow: claim (else `skipped`) → admin's active provider (none ⇒ final failure, `attempts` set to 3) → prices → Egypt (a failure here is tolerated: `egypt: null`) → scenarios → `previousAnalysis` from the last valid done run → `buildMarketSnapshot` → `validateSnapshot` → `runAnalysis` with an 85 s abort → store `result` = `{ text, parsed, snapshot: alignSnapshot(...), validation, evidence_sources, used_web_search, search_status, provider_label, slot_key }` and `status='done'`, then `resolveNotifications(db,'standard_analysis_failed')`. On any error: `status='failed'` + `error` (≤ 500 chars), `raiseNotification(db, { kind:'standard_analysis_failed', message:'<slot>: <error> (attempt n of 3)', detail })`, and `deps.notify({ event:'standard_analysis_failed', slot, error, attempts, final })` (final = attempts ≥ 3).
- `analysisScheduler.mjs`: `runDueAnalysis({ db, adminId, now, deps })` = load schedule (`app_settings` key `analysis_schedule`, normalized, default disabled) → if disabled return `{ ran:false }` → `currentSlot(now, schedule)` → `slotState` → if `state==='done'` or not `claimable` (and not `none`) return → else `runStandardAnalysis`. `startAnalysisScheduler({ db, adminId, deps, intervalMs = 60_000 }) → stop()` using `setInterval` (`unref()`), a re-entrancy guard (skip a tick while one run is in flight), `.catch(console.error)` on every tick.
- `server/index.mjs`: after `app.listen`, `const stop = startAnalysisScheduler({ db: pool, adminId: rows[0].id, deps: { fetchPrices: fetchMarketPrices, fetchEgypt: fetchEgyptGoldPrices } })`; call `stop()` on SIGINT/SIGTERM.

- [ ] **Step 1: Tests (real Postgres, injected fakes, a controllable clock):** notifications (single open row per kind, upsert updates message, resolve closes, a new open row can be created after resolve, dismiss); `claimSlot` (first ok; immediate second null; failed <5 min → null, failed >5 min → id and `attempts` 2; 3rd attempt allowed, a 4th refused; stale `running` >4 min reclaimable; `Promise.all` of two claims → exactly one id); `runStandardAnalysis` success (row `done`, `result` has `text`/`snapshot`/`provider_label`, snapshot has empty wallet/dca/watchlist, notification resolved, **no `ai_shared_usage` rows**), each failure mode (no provider → final failure + notification + `notify` called with `final:true`; prices throw → `failed`, attempts 1, notification opened, `notify` `final:false`; analysis throws; Egypt fetch throws → still `done` with `egypt: null` in the snapshot), first failure then success later resolves the notification; scheduler (`enabled:false` → nothing runs; enabled + stale slot → runs exactly once across two ticks; done slot → no run; catch-up after "downtime" (clock in the next slot) runs the new slot once; failure at attempt 1 is not retried within 5 minutes but is after, up to 3 attempts, then never again in that slot; re-entrancy guard).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run the three files + full `npm test`. **Commit** `feat: run the standard analysis in the background with retries and admin notifications`.

---

## Task 4: Analysis and notification routes

**Files:** create `server/routes/analysis.mjs`, `tests/server/analysis-routes.test.mjs`; modify `server/createApp.mjs`.

**Produces** (`createAnalysisRouter(db, { adminId, deps })` mounted at `/api/analysis`, behind `requireAuth`; `createApp` accepts an `analysisDeps` option for tests, default = the real fetchers):
- `GET /latest` (any user) → `{ schedule, slot: { key, next_at }, latest: { id, slot_key, created_at, text, snapshot, validation, evidence_sources, used_web_search, search_status, provider_label } | null, running: boolean }` (`latest` = newest `done` run; the `result` JSON columns flattened, never the raw DB row).
- `GET /schedule` (any user, same schedule object), `PUT /schedule` (admin; body validated with `normalizeSchedule`, 400 with its message; persisted in `app_settings`).
- `POST /run-now` (admin) → runs `runStandardAnalysis` with slot key `adhoc:<epoch ms>` immediately (ignores `enabled`), awaits it, returns 200 `{ status:'done', id }` or 502 `{ error }` (a failed manual run does not raise the background notification: pass `deps.notify` unchanged but do NOT call `raiseNotification` for `adhoc:` slots — implement by skipping notification when the slot key starts with `adhoc:`).
- Extend the existing admin router (`server/routes/adminUsers.mjs` mounts at `/api/admin`): `GET /notifications` → open notifications (`id, kind, message, created_at, updated_at`), `POST /notifications/:id/dismiss`.

- [ ] **Step 1: Tests** through `createApp` with `signIn`: 401 signed out on every route; regular user gets `/latest` and `/schedule` but 403 on `PUT /schedule`, `/run-now`, `/api/admin/notifications`; `/latest` returns `latest:null` before any run, then the run after a `done` row exists, the flattened shape, `running` true while a fresh `running` row exists for the current slot; bad schedules → 400 with the message, good ones persist and are returned by `GET /schedule`; `/run-now` with an injected runner → 200 and the run becomes `latest`, failure → 502 and no notification; notification list/dismiss (unknown id → 404, malformed id → 404, dismissed no longer listed).
- [ ] **Step 2:** run → FAIL; **Step 3:** implement + mount (behind `requireAuth`, next to the other routers) + wire `analysisDeps` in `createApp` and `index.mjs`; **Step 4:** run + full `npm test`. **Commit** `feat: add standard analysis and admin notification routes`.

---

## Task 5: Client — two analysis cards

**Files:** create `src/api/sharedAnalysis.ts`, `src/ui/StandardAnalysisCard.tsx`, `tests/lib/shared-analysis-api.test.ts`; modify `src/App.tsx`.

**Produces:** `src/api/sharedAnalysis.ts` with types `AnalysisSchedule`, `StandardRun`, `LatestResponse` (mirror Task 4's JSON) and `fetchLatest()`, `fetchSchedule()`, `saveSchedule(s)`, `runNow()` (same error handling style as `src/api/adminUsers.ts`). `<StandardAnalysisCard ar run schedule nextAt running onApplyWeights />`.

- [ ] **Step 1: API tests** (mock global `fetch`, like `tests/lib/auth-api.test.ts`): each function's URL/method/body and error text. **Fixture test:** take a valid v3 result text (see `tests/client/analyst-v3.test.ts`) + a market-only snapshot from the server builder shape and assert `parseCompactAnalysis(text, snapshot, ids)` succeeds with no `wallet_read`/`dca_read` (this proves stored runs render through the existing parser).
- [ ] **Step 2: `StandardAnalysisCard`** (bilingual, `Card`/`SectionLabel`, existing tokens; small and read-only): title **"Standard market analysis"** / "التحليل القياسي للسوق"; subtitle "Updated {time} · next update {time} · {provider_label}" (times formatted with the browser locale, `nextAt` from the response); shows action + confidence + headline, the evidence implications as short bullets with their `EV-` ids and links from `evidence_sources`, the assumptions, the suggested weights with a small **Apply these weights** button (same guard as the existing `applyAI`: valid, sum 100, `validation.ok`, action not `insufficient_evidence`), and a "Not personalized — no wallet or DCA data" note. States: no run yet ("No standard analysis yet — the first one runs at {next}" or "Scheduled analysis is off"), `running` (spinner text "Updating…").
- [ ] **Step 3: `App.tsx`** (read the existing Analyst screen first; do NOT change `analyze()`): keep `standard` state `{ latest, schedule, nextAt, running, loaded }`; `fetchLatest()` on mount and every 5 minutes while the tab is open (clear on unmount), plus when the user opens the Analyst tab; parse with `parseCompactAnalysis` in try/catch (ignore a bad run). On the Analyst screen render **two sections**: (1) `StandardAnalysisCard` on top; (2) the existing analysis block, retitled **"My personalized analysis"** / "تحليلي الشخصي" with a one-line hint "Includes your wallet and DCA plan · uses 1 of your {n} daily analyses per update" (reuse `analyzeQuota`; the personalized result and its Apply button stay exactly as today). Applying weights from the standard card sets `state.weights` like `applyAI` does (without touching `state.ai`).
- [ ] **Step 4:** `npx tsc -b`, `npx vitest run tests/lib tests/client`, full `npm test`. **Browser check** (scratch DB; scheduler off, rows inserted directly): as a regular user the Analyst screen shows both cards; with a directly inserted `done` run (valid v3 text + snapshot) the standard card renders it at 1280px and 390px in Arabic and English without wallet/DCA sections; "no run yet" and "off" states render; the personalized card still analyzes/quota as before; Apply weights from the standard card changes the user's weights only.
- [ ] **Step 5: Commit** `feat: show the standard and personalized analyses as two cards`.

---

## Task 6: Admin schedule panel and failure alerts

**Files:** create `src/ui/SchedulePanel.tsx`, `src/ui/AdminAlerts.tsx`; modify `src/App.tsx`, `src/ui/Sidebar.tsx`, `src/ui/BottomNav.tsx` (badge count wiring only).

- [ ] **Step 1: `SchedulePanel`** (`ar`, admin-only, mounted in Settings between `AIModelSettingsManager` and `UsersPanel`): loads `fetchSchedule()` + `fetchLatest()`; controls with real labels: enabled switch, two `<input type="time">`, timezone text input with a datalist (`Africa/Cairo`, `UTC`, `Europe/London`, `Asia/Riyadh`, `Asia/Dubai`), language select, **Save** (enabled only when changed; shows the server's validation message inline), **Run now** (busy-guarded; "Running…"; shows the outcome or the error; refreshes the last-run line); a status line: "Last successful run {time} · {provider}" / "No run yet"; the open notification message if any. Never render secrets.
- [ ] **Step 2: `AdminAlerts`** (admin only): a dismissible red banner at the top of the app (all screens) listing open notifications from `GET /api/admin/notifications` (loaded on mount and every 2 minutes), each with **Dismiss** (POST) and a link/button to Settings; `role="alert"`, bilingual, messages shown as returned (English server text is acceptable, prefixed by a bilingual heading "Standard analysis failed" / "فشل التحليل القياسي"). The Settings nav badge count becomes `pendingSignups + openNotifications` (keep the accessible label accurate: e.g. "2 items need attention" bilingual; keep the More-tab badge behaviour).
- [ ] **Step 3: Browser check** (scratch DB): as admin change times/timezone/enabled → Save → reload → persisted; invalid timezone shows the server error; a regular user has no Settings and `PUT /api/analysis/schedule` is 403; insert an open notification by SQL → banner appears for the admin only, Dismiss removes it, the badge count updates; **Run now** against an unreachable provider shows the failure without breaking the panel and without opening a background notification; 390px Arabic has no horizontal overflow. Start the scratch API with the scheduler enabled ONLY against the scratch DB and confirm a due slot with a fake-failing provider produces exactly 3 attempts (use SQL to age `finished_at` between attempts) and one open notification.
- [ ] **Step 4:** `npx tsc -b`, `npm test`. **Commit** `feat: add the admin schedule panel and failure alerts`.

---

## Task 7: Docs and go-live notes

**Files:** modify `.env.example`, `README.md`.

- [ ] **Step 1:** README section "Standard and personalized analysis": what each card is; the background run needs the API process to stay running; it is OFF by default (Settings → Analysis schedule); slots, timezone, retries (3 attempts, 5 minutes apart) and the admin banner on failure; the standard analysis has no wallet/DCA and uses the admin's scenario weights as its framework; personalized analyses use the user's daily allowance (default 3, per-user in Settings → Users); cost tips (2 slots/day; set `ANALYST_CONTRACT_VERSION=v3` in `.env` and restart to make personalized runs use the compact contract too, 4–8k output tokens instead of a 16k floor).
- [ ] **Step 2:** `.env.example`: commented `# ANALYST_CONTRACT_VERSION=v3` with a one-line explanation. **Step 3 (for the user, needs real credits):** Settings → Analysis schedule → Run now once and compare quality/cost with today's analysis.
- [ ] **Step 4:** `npm test`; **commit** `docs: document the standard and personalized analysis`.

---

## Out of scope for now

Notification outside the app (webhook/email/Telegram) is NOT part of this plan: failures are shown **inside the app only** (admin banner + Settings badge). `runStandardAnalysis` keeps an injectable `deps.notify` hook (default no-op) so an outside channel can be added later without touching the runner.

---

## Multi-Agent Execution Plan

**Principle:** parallel lanes only where files and contracts are disjoint; everything that shares the browser, the test database or `src/App.tsx` is serialized or isolated. The controller (main session) owns setup, merges, rulings and the ledger; implementer/reviewer agents never spawn agents and never merge.

### Lanes, ownership and dependencies

| Lane | Agent (model) | Tasks | Owns (writes only these) | Needs before start |
|---|---|---|---|---|
| **S1** | sonnet | Task 1 | `migrations/0025_*`, `server/analysisSchedule.mjs`, `server/appSettings.mjs`, their tests | nothing |
| **S2** | sonnet | Task 2 | `server/marketPrices.mjs`, `server/marketSnapshot.mjs`, their tests | nothing (uses existing `scenarios` table, `shared/analystContract.mjs`, `src/lib/analysisSnapshot.ts`) |
| **C1** | sonnet | Task 5 | `src/api/sharedAnalysis.ts`, `src/ui/StandardAnalysisCard.tsx`, `tests/lib/shared-analysis-api.test.ts`, the Analyst-screen region of `src/App.tsx` | only the frozen JSON contracts below (mocked `fetch`, fixtures) |
| **C2** | sonnet | Task 6 | `src/ui/SchedulePanel.tsx`, `src/ui/AdminAlerts.tsx`, badge wiring in `Sidebar.tsx`/`BottomNav.tsx`, the Settings-tab/top-of-app/badge regions of `src/App.tsx` | the same frozen contracts; imports `fetchSchedule/saveSchedule/runNow/fetchLatest` from C1's `src/api/sharedAnalysis.ts` → **C2 creates that file's function signatures first if C1 has not merged (see Contract file)** |
| **S3** | sonnet (same agent continues into S4) | Tasks 3 → 4 | `server/adminNotifications.mjs`, `server/standardAnalysis.mjs`, `server/analysisScheduler.mjs`, `server/routes/analysis.mjs`, `server/index.mjs`, `server/createApp.mjs`, `server/routes/adminUsers.mjs` (notification routes), their tests | S1 and S2 merged into the integration branch |
| **V** | sonnet | end-to-end browser verification + Task 7 docs | `README.md`, `.env.example` (+ fixes only if a check fails, reported to the controller first) | all lanes merged |
| **R** | sonnet reviewers; **opus** for the final whole-branch review | per-wave reviews | read-only | the wave's merged range |

### Contract file (freeze before Wave 1)
The controller writes `src/api/sharedAnalysis.ts` types + function signatures as a stub in the integration branch BEFORE dispatching Wave 1 (types `AnalysisSchedule`, `StandardRun`, `LatestResponse`; functions `fetchLatest`, `fetchSchedule`, `saveSchedule`, `runNow` throwing `Error('not implemented')`), copied from Task 4's response shapes, plus `fetchNotifications()`/`dismissNotification(id)` for admin alerts. C1 fills in the bodies; C2 imports the same signatures. This removes the only cross-lane compile dependency.

### Isolation setup (controller, before Wave 1)
1. Integration branch: `git worktree add .claude/worktrees/analysis-int -b analysis-standard main`; commit the contract stub there.
2. One worktree per lane branched from `analysis-standard`: `analysis-s1`, `analysis-s2`, `analysis-c1`, `analysis-c2` (later `analysis-s3` from the merged head).
3. **One private test database per lane** (`gold_cockpit_test_s1`, `_s2`, `_c1`, `_c2`, `_s3`, `_int`): `psql postgres://localhost:5432/postgres -c 'create database <name>'`, and each worktree's git-ignored `.env` gets `DATABASE_URL` = the real dev URL (never used by tests) and its own `TEST_DATABASE_URL`. This is what makes parallel `npm test` runs safe (every test file drops the schema of ITS database only). `node_modules` is a symlink to the main checkout's.
4. **Browser and scratch servers are serialized:** only lane **V** (and the controller) may use the Playwright browser, and only with the scratch DB `gold_cockpit_ui_try`, API :8788, UI :3588. Lanes S1/S2/S3/C1/C2 verify with unit/route tests and mocked `fetch` only.
5. Standing rules for every agent: worktree only; never touch `gold_cockpit_dev` or ports 3577/8787; explicit `git add <paths>`; no `git add -A`; commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`; no `npm install`; report file + short status contract.

### Waves

**Wave 1 (parallel, 4 agents):** S1 (Task 1), S2 (Task 2), C1 (Task 5 code + unit tests), C2 (Task 6 code; its App.tsx edits are small and in different regions from C1's). Each finishes with its own `npx tsc -b` + full `npm test` on ITS test DB and reports.
  - **Gate 1 (controller, per lane):** a task review per lane runs in parallel (reviewers R1–R4, read-only, one diff file each); fix rounds go back to the same implementer (max 5, as before). Nothing merges before its lane review is clean.
  - **Merge 1:** into `analysis-standard` in this order: S1, S2, C1, C2. Expected textual conflicts: only `src/App.tsx` between C1 and C2 (different regions) — the controller resolves and re-runs `tsc -b` + the full suite on the `_int` DB; any semantic conflict is a controller ruling.

**Wave 2 (agent S3, with a parallel reviewer):** Tasks 3 → 4 on `analysis-s3` (branched from the merged integration head). In parallel, reviewer R5 does the combined client review (C1+C2 merged diff, including the App.tsx merge) so client findings are fixed by C1/C2 while S3 works (fix commits on new branches merged after Gate 2).
  - **Gate 2:** review S3 (one unit for Tasks 3+4; the runner/claim SQL, retries, notifications and permissions are the risky parts) → fix rounds → merge.

**Wave 3 (serial):** lane V: browser verification of every check listed in Tasks 5–6 against the real merged server on the scratch DB (including the scheduler run with a failing fake provider and 3 attempts), plus Task 7 docs → report; controller fixes go back to the owning lane's agent (not V). Then the **final whole-branch review (opus)** on `analysis-standard` vs `main`, ONE fix wave, one scoped re-review, then the finish step (merge/PR choice is the user's).

### Agent briefs (controller writes one file per lane, containing exactly)
1. The task text from this plan (via the SDD `task-brief` script) + the frozen contract stub path.
2. Lane rules: files the lane may write (table above); files it must NOT touch (everything else); its worktree path and private `TEST_DATABASE_URL`; the standing rules; "ask by returning NEEDS_CONTEXT, do not guess across lanes".
3. Report contract: full report to `<workspace>/<lane>-report.md`; reply ≤ 15 lines: status, commits, one-line test summary, concerns, report path.

### Ledger, rulings, stop conditions
- The controller keeps `.superpowers/sdd/<plan>/progress.md` (git-ignored) with lane state, base/head SHAs per merge, every ruling (`Ruling: … — why — cost if wrong`) and deferred minors; it is the recovery map after compaction.
- The controller stops and asks the user only for: a destructive/irreversible operation, a security-sensitive decision, an external side effect (push, publish, merge to `main`), or a plan so broken that every path is a guess. Everything else is a logged ruling.
- Budget guardrail: at most 5 fix rounds per lane; a lane that trips the breaker is adjudicated by the controller, not looped.

---

## Self-Review Notes

- **Requirement coverage:** background run kept in the DB (T1 tables, T3 scheduler/runner); standard analysis without DCA/wallet (T2 snapshot has them empty by construction); personalized analysis with wallet/DCA and the daily limit of 3, per-user adjustable (existing flow kept, T5 relabels it); two cards (T5); admin notified on failure (T3 notifications, T6 banner + badge, optional T8 outside-app webhook); users can run personalized analyses on request (existing).
- **Trust:** unlike a browser-triggered design, all inputs to the standard analysis come from the server (public feeds, Egypt scrape, the admin's own scenarios), so no user can influence it.
- **Known limits:** a run needs the API process to be up (missed slots are caught up on restart); public price feeds can fail (that is a retried failure with a notification); the standard analysis uses the admin's weights as its baseline while users apply suggested weights to their own; failed-run history is kept but only the newest done run is shown.
- **Type consistency:** `StandardRun`/`LatestResponse` mirror Task 4's flattened response; the stored `result.snapshot` is the `alignSnapshot` output so `parseCompactAnalysis(text, snapshot, ids)` validates exactly what the server validated; `slot_key` formats: `YYYY-MM-DD@HH:MM` (scheduled) and `adhoc:<ms>` (manual).
