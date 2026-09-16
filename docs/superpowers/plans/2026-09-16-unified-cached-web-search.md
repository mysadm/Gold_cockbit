# Unified & Cached Web-Search Evidence Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every analysis run — regardless of which provider/model is active — search the web with the same evidence when compared close together, make it visible *why* a given run didn't search when it didn't, and cut the analysis pipeline's latency by removing redundant SerpAPI round-trips.

**Architecture:** `server/routes/analyze.mjs`'s `augmentPromptWithSearch()` already runs the same `searchWeb()` calls for every `provider_type` (claude, shared, openai, ollama, openrouter, custom) — evidence gathering was already unified in a prior plan (see "Task 3: Retire Claude's native web-search tool" in `docs/superpowers/plans/2026-09-15-analyst-data-contract-v2.md`) and is covered by an explicit regression test (`tests/server/analyze-route.test.mjs`, `'searches for claude providers too...'`). The actual sources of "different models, different analysis" are (a) SerpAPI's results are not deterministic call-to-call — comparing two providers a few minutes apart can hand them genuinely different top-5 results even under the same `tbs=qdr:d` recency filter, and (b) a search that silently fails (rate limit, the IPv6-routing flakiness already observed against `serpapi.com`, the provider's own "Web search" toggle being off) collapses to the same `usedWebSearch: false` the UI shows for every other reason, so the user can't tell "this model doesn't search" from "this run's search happened to fail." This plan adds a short-TTL cache in front of `searchWeb()` so back-to-back analyses reuse byte-identical evidence (unifying comparisons *and* skipping the network round-trip — the speed win), and threads a specific `searchStatus` reason through the response so the UI can say why, instead of a bare boolean.

**Tech Stack:** Node/Express backend (`server/`), Preact/TypeScript frontend (`src/`), Vitest for tests.

**Spec:** This plan is self-contained; it extends the evidence-gathering design from `docs/superpowers/plans/2026-09-15-analyst-data-contract-v2.md` (Task 3 and Task 8 of that plan), which remains the source of truth for the retry-then-downgrade loop and schema v2 shapes referenced below.

## Global Constraints

- Never cache a failed or empty search result — a transient SerpAPI outage must not poison the cache for other queries/providers during the TTL window.
- The cache is in-memory, per server process — no new infrastructure (no Redis, no DB table). This is a single-node app; a `Map` with timestamps is sufficient and matches this codebase's existing preference for the simplest thing that works (see `server/webSearch.mjs`'s existing style — plain functions, no classes).
- `searchStatus` must be additive — do not remove or change the meaning of the existing `usedWebSearch: boolean` field; every current consumer (frontend, existing tests) keeps working unchanged.
- Cache TTL: 10 minutes. Long enough that comparing 2-3 providers back-to-back gets identical evidence; short enough that "today's news" (the `qdr:d` recency filter's whole point) doesn't go stale within a session.
- All new/changed code follows the existing comment style in this codebase: comments explain *why*, not *what* — see `server/webSearch.mjs`'s `RECENCY_FILTER` comment for the bar to match.

---

## File Structure

- Create: `server/searchCache.mjs` — a tiny TTL cache (`getCached`/`setCached`), used only by `webSearch.mjs`. Split out from `webSearch.mjs` so it can be unit-tested without mocking `fetch`, and so a future second cache consumer doesn't have to import search-specific code.
- Modify: `server/webSearch.mjs` — check the cache before hitting SerpAPI; populate it only on success.
- Modify: `server/routes/analyze.mjs` — compute and thread a `searchStatus` string through `augmentPromptWithSearch()`'s return value and into the final JSON response.
- Modify: `src/api/llmProviders.ts` — add `searchStatus` to `analyzeViaBackend`'s return type.
- Modify: `src/App.tsx` — store `searchStatus` in `AppState['ai']`, set it on both the success and catch paths, and render a bilingual reason next to the existing "+ web search" indicator when search did not run.
- Modify tests: `tests/server/web-search.test.mjs` (cache behavior), `tests/server/analyze-route.test.mjs` (searchStatus values), create `tests/server/search-cache.test.mjs` (cache module in isolation).

---

## Task 1: `server/searchCache.mjs` — a minimal TTL cache

**Files:**
- Create: `server/searchCache.mjs`
- Test: `tests/server/search-cache.test.mjs`

**Interfaces:**
- Produces: `getCached(key: string): unknown | undefined` — returns the cached value, or `undefined` if missing or expired. `setCached(key: string, value: unknown): void` — stores `value` under `key` with the module's fixed TTL, timestamped `Date.now()`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/server/search-cache.test.mjs
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getCached, setCached } from '../../server/searchCache.mjs';

describe('searchCache', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('returns undefined for a key that was never set', () => {
    expect(getCached('never-set')).toBeUndefined();
  });

  it('returns the cached value before the TTL expires', () => {
    setCached('gold price news', ['result-a']);
    expect(getCached('gold price news')).toEqual(['result-a']);
  });

  it('expires entries after 10 minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    setCached('gold price news', ['result-a']);
    expect(getCached('gold price news')).toEqual(['result-a']);

    vi.setSystemTime(new Date('2026-01-01T00:09:59.000Z'));
    expect(getCached('gold price news')).toEqual(['result-a']);

    vi.setSystemTime(new Date('2026-01-01T00:10:01.000Z'));
    expect(getCached('gold price news')).toBeUndefined();
    vi.useRealTimers();
  });

  it('overwriting a key resets its TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    setCached('gold price news', ['old']);

    vi.setSystemTime(new Date('2026-01-01T00:09:00.000Z'));
    setCached('gold price news', ['new']);

    vi.setSystemTime(new Date('2026-01-01T00:15:00.000Z'));
    expect(getCached('gold price news')).toEqual(['new']);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/search-cache.test.mjs`
Expected: FAIL — `server/searchCache.mjs` does not exist yet (`Cannot find module`).

- [ ] **Step 3: Implement `server/searchCache.mjs`**

```js
// A plain in-memory cache, not a distributed one: this app runs as a single
// Node process, and the only goal is to stop two analyses a few minutes
// apart (e.g. comparing two provider configs back-to-back) from getting
// genuinely different SerpAPI results for the same query — which produces
// different evidence and therefore a different-looking analysis per model
// even though nothing about the model itself differs. 10 minutes balances
// that against the `qdr:d` (past-24h) recency filter's whole purpose: today's
// news should still refresh within the same session.
const TTL_MS = 10 * 60 * 1000;

const cache = new Map();

export function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt > TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCached(key, value) {
  cache.set(key, { value, storedAt: Date.now() });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/search-cache.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/searchCache.mjs tests/server/search-cache.test.mjs
git commit -m "feat: add a 10-minute TTL cache for web-search results"
```

---

## Task 2: Wire the cache into `searchWeb()`

**Files:**
- Modify: `server/webSearch.mjs`
- Test: `tests/server/web-search.test.mjs`

**Interfaces:**
- Consumes: `getCached`/`setCached` from `server/searchCache.mjs` (Task 1).
- Produces: `searchWeb(query, apiKey)` behavior is unchanged from the caller's point of view (same return shape, same thrown-error-on-failure behavior) — only its internals gain a cache check. `server/routes/analyze.mjs`'s existing `Promise.all(WEB_SEARCH_QUERIES.map((query) => searchWeb(query, apiKey).catch(() => [])))` call site needs no changes.

- [ ] **Step 1: Write the failing tests**

Add to `tests/server/web-search.test.mjs` (it already imports `searchWeb`, `vi`, `describe`, `it`, `expect`, `afterEach`):

```js
import { getCached, setCached } from '../../server/searchCache.mjs';

// ... inside the existing `describe('searchWeb', ...)` block, add:

  it('does not call fetch when a cached result exists for the query', async () => {
    setCached('gold price news', [{ title: 'Cached', snippet: '', link: 'https://cached.example', date: '' }]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchWeb('gold price news', 'serp-test-key');

    expect(results).toEqual([{ title: 'Cached', snippet: '', link: 'https://cached.example', date: '' }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches a successful result so a second identical query skips fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        organic_results: [{ title: 'Fresh', snippet: '', link: 'https://fresh.example' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchWeb('a brand new query', 'serp-test-key');
    await searchWeb('a brand new query', 'serp-test-key');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getCached('a brand new query')).toEqual([{ title: 'Fresh', snippet: '', link: 'https://fresh.example', date: '' }]);
  });

  it('does not cache a failed request, so the next call retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchWeb('a query that fails', 'serp-test-key')).rejects.toThrow();
    expect(getCached('a query that fails')).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/web-search.test.mjs`
Expected: FAIL — `fetchMock` gets called even when a cached result was set (no cache check exists yet), and `getCached` after a successful call returns `undefined`.

- [ ] **Step 3: Update `server/webSearch.mjs`**

```js
import { getCached, setCached } from './searchCache.mjs';

const SERPAPI_URL = 'https://serpapi.com/search.json';
const MAX_RESULTS = 5;
const RECENCY_FILTER = 'qdr:d';
const SEARCH_TIMEOUT_MS = 8000;

export async function searchWeb(query, apiKey) {
  const cached = getCached(query);
  if (cached) return cached;

  const url = `${SERPAPI_URL}?engine=google&num=${MAX_RESULTS}&q=${encodeURIComponent(query)}&tbs=${RECENCY_FILTER}&api_key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }

  const results = (data?.organic_results || []).slice(0, MAX_RESULTS).map((r) => ({
    title: r.title || '',
    snippet: r.snippet || '',
    link: r.link || '',
    date: r.date || '',
  }));
  setCached(query, results);
  return results;
}
```

(Keep the existing top-of-file comment explaining `RECENCY_FILTER` and the `SEARCH_TIMEOUT_MS` comment from the prior plan — only the body of `searchWeb` changes.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/web-search.test.mjs`
Expected: PASS (all tests, old and new)

Note: the cache is a module-level `Map` shared across test files run in the same process. Because `vitest.config.mjs` sets `fileParallelism: false`, this is safe within a single run, but if a later test unrelated to search happens to query `'gold price news'` after this file runs, it would see a stale cached entry. If that ever causes a flake, add a `clearCache()` export to `searchCache.mjs` and call it in this file's `afterEach` — not needed now since no other test file uses that exact query string (verified via `grep -rn "gold price news" tests/`).

- [ ] **Step 5: Commit**

```bash
git add server/webSearch.mjs tests/server/web-search.test.mjs
git commit -m "feat: cache searchWeb results so repeated queries skip SerpAPI"
```

---

## Task 3: Thread a specific `searchStatus` reason through `analyze.mjs`

**Files:**
- Modify: `server/routes/analyze.mjs`
- Test: `tests/server/analyze-route.test.mjs`

**Interfaces:**
- Produces: `augmentPromptWithSearch(prompt, providerRow)` now returns `{ prompt, usedWebSearch, evidenceIds, searchStatus }` where `searchStatus` is one of: `'ok'` (search ran and returned at least one result), `'disabled'` (the provider's own `settings.webSearch === false`), `'no_api_key'` (`SERPAPI_API_KEY` not configured), `'no_results'` (search ran, returned zero results across all queries), `'failed'` (every query threw/rejected). The POST `/api/analyze` response body gains a top-level `searchStatus` field alongside the existing `usedWebSearch`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/server/analyze-route.test.mjs`, inside the existing `describe('POST /api/analyze — web search augmentation', ...)` block (it already has the `ollama`/`claude` provider-insert + `searchWeb.mockResolvedValue`/`mockRejectedValue` patterns to copy):

```js
  it('reports searchStatus "ok" when search returns results', async () => {
    process.env.SERPAPI_API_KEY = 'serp-test-key';
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'ollama', 'Local', 'gemma4', true)`,
      [userId]
    );
    searchWeb.mockResolvedValue([
      { title: 'Gold hits record high', snippet: 'Prices surged on Fed cut bets', link: 'https://example.com/1' },
    ]);
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.body.searchStatus).toBe('ok');
  });

  it('reports searchStatus "no_api_key" when SERPAPI_API_KEY is not configured', async () => {
    delete process.env.SERPAPI_API_KEY;
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'ollama', 'Local', 'gemma4', true)`,
      [userId]
    );
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.body.searchStatus).toBe('no_api_key');
  });

  it('reports searchStatus "disabled" when the provider\'s own Web search toggle is off', async () => {
    process.env.SERPAPI_API_KEY = 'serp-test-key';
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active, settings)
       VALUES ($1, 'ollama', 'Local', 'gemma4', true, $2)`,
      [userId, JSON.stringify({ webSearch: false })]
    );
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.body.searchStatus).toBe('disabled');
    expect(searchWeb).not.toHaveBeenCalled();
  });

  it('reports searchStatus "failed" when every search query rejects', async () => {
    process.env.SERPAPI_API_KEY = 'serp-test-key';
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'ollama', 'Local', 'gemma4', true)`,
      [userId]
    );
    searchWeb.mockRejectedValue(new Error('SerpAPI down'));
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.body.searchStatus).toBe('failed');
    expect(res.body.usedWebSearch).toBe(false);
  });

  it('reports searchStatus "no_results" when search runs but every query comes back empty', async () => {
    process.env.SERPAPI_API_KEY = 'serp-test-key';
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'ollama', 'Local', 'gemma4', true)`,
      [userId]
    );
    searchWeb.mockResolvedValue([]);
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.body.searchStatus).toBe('no_results');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/analyze-route.test.mjs`
Expected: FAIL — `res.body.searchStatus` is `undefined` in every new test.

- [ ] **Step 3: Update `server/routes/analyze.mjs`**

Replace `augmentPromptWithSearch` and its call site:

```js
async function augmentPromptWithSearch(prompt, providerRow) {
  if (!isWebSearchEnabled(providerRow)) {
    return { prompt, usedWebSearch: false, evidenceIds: [], searchStatus: 'disabled' };
  }

  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return { prompt, usedWebSearch: false, evidenceIds: [], searchStatus: 'no_api_key' };

  try {
    const resultsPerQuery = await Promise.all(
      WEB_SEARCH_QUERIES.map((query) => searchWeb(query, apiKey))
    );
    const seenLinks = new Set();
    const results = resultsPerQuery.flat().filter((r) => {
      if (!r.link || seenLinks.has(r.link)) return false;
      seenLinks.add(r.link);
      return true;
    });
    if (results.length === 0) return { prompt, usedWebSearch: false, evidenceIds: [], searchStatus: 'no_results' };
    const evidenceIds = results.map((_, i) => evidenceIdFor(i));
    const augmented = `LIVE WEB SEARCH RESULTS (use these as your source of current market/news context). Each result is tagged with a stable evidence ID like [EV-001]. Whenever you state a time-sensitive fact drawn from these results anywhere in your JSON output, cite the ID(s) it came from in brackets at the end of that sentence, e.g. "...rose 2% today [EV-002]." Never invent an ID that is not listed below, and never attach an ID to a claim these results don't actually support:\n${formatSearchResults(results)}\n\n${prompt}`;
    return { prompt: augmented, usedWebSearch: true, evidenceIds, searchStatus: 'ok' };
  } catch {
    return { prompt, usedWebSearch: false, evidenceIds: [], searchStatus: 'failed' };
  }
}
```

Two things changed from the current version beyond adding `searchStatus`: it now takes `providerRow` as a second argument so the `disabled` case can be detected *inside* the function (previously the caller checked `isWebSearchEnabled` before ever calling this), and the per-query `.catch(() => [])` on each `searchWeb` call is removed — with Task 2's cache in place, a single query's rejection should still be visible to the outer `try/catch` so `searchStatus` can become `'failed'`/distinguish from `'no_results'`; letting `Promise.all` reject on any query failure achieves that (a partial failure now degrades the whole augmentation for this call, same as today's behavior after the outer catch, just now labeled).

Update the call site (currently `if (webSearchEnabled) { const augmented = await augmentPromptWithSearch(prompt); ... }`):

```js
      let effectivePrompt = prompt;
      let injectedWebSearch = false;
      let evidenceIds = [];
      const augmented = await augmentPromptWithSearch(prompt, provider);
      effectivePrompt = augmented.prompt;
      injectedWebSearch = augmented.usedWebSearch;
      evidenceIds = augmented.evidenceIds;
      const searchStatus = augmented.searchStatus;
```

Remove the now-unused `webSearchEnabled` local (the `isWebSearchEnabled` check moved inside `augmentPromptWithSearch`) and the now-unused standalone `isWebSearchEnabled` call at the old call site — keep the `isWebSearchEnabled` function itself, it's still used from inside `augmentPromptWithSearch`.

Finally, add `searchStatus` to the response:

```js
      res.json({ ...result, text, validation, searchStatus });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/analyze-route.test.mjs`
Expected: PASS (all tests, old and new — the pre-existing 'does not augment...' and 'falls back to the unaugmented prompt...' tests still pass because their assertions only check `usedWebSearch`/`searchWeb` call counts, which are unchanged)

- [ ] **Step 5: Run the full server suite**

Run: `npm test`
Expected: all tests pass (298+ tests, including the new ones from Tasks 1-3)

- [ ] **Step 6: Commit**

```bash
git add server/routes/analyze.mjs tests/server/analyze-route.test.mjs
git commit -m "feat: report a specific searchStatus reason instead of a bare usedWebSearch boolean"
```

---

## Task 4: Surface `searchStatus` in the frontend

**Files:**
- Modify: `src/api/llmProviders.ts:117-127` (`analyzeViaBackend`)
- Modify: `src/App.tsx` (AppState type around line 85-95, both `setState` call sites around lines 1128 and 1188, and the render line ~1824)

**Interfaces:**
- Consumes: `searchStatus` field from the `/api/analyze` response (Task 3): `'ok' | 'disabled' | 'no_api_key' | 'no_results' | 'failed'`.
- Produces: `AppState['ai'].searchStatus: string | null`, rendered as a short bilingual explanation whenever it is not `'ok'` and not `null`.

- [ ] **Step 1: Update `analyzeViaBackend`'s return type**

In `src/api/llmProviders.ts`:

```ts
export async function analyzeViaBackend(
  prompt: string,
  snapshot: AnalysisSnapshot,
  signal?: AbortSignal
): Promise<{
  text: string;
  usedWebSearch: boolean;
  searchStatus: 'ok' | 'disabled' | 'no_api_key' | 'no_results' | 'failed';
  validation: { ok: boolean; errors: string[] };
}> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, snapshot }),
    signal,
  });
  return parseJsonOrThrow(response);
}
```

- [ ] **Step 2: Add `searchStatus` to `AppState['ai']`**

In `src/App.tsx`, in the `ai` block of the `AppState` type (around line 85-95):

```ts
  ai: {
    loading: boolean;
    error: string | null;
    data: AIResultV2 | null;
    at: string | null;
    applied: boolean;
    usedWebSearch: boolean;
    searchStatus: 'ok' | 'disabled' | 'no_api_key' | 'no_results' | 'failed' | null;
    validation: { ok: boolean; errors: string[] } | null;
    providerLabel: string | null;
    startedAt: number | null;
    timedOut: boolean;
  };
```

Update the initial state (currently `ai: { loading: false, error: null, data: null, at: null, applied: false, usedWebSearch: false, validation: null, providerLabel: null, startedAt: null, timedOut: false }`, around line 180) by inserting `searchStatus: null,` after `usedWebSearch: false,`.

- [ ] **Step 3: Thread it through both `setState` call sites in `analyze()`**

At the success path (currently destructures `const { text, usedWebSearch, validation } = await analyzeViaBackend(...)`, around line 1091):

```ts
      const { text, usedWebSearch, searchStatus, validation } = await analyzeViaBackend(prompt, snapshot, controller.signal);
```

And in that same success block's `setState` (around line 1128-1141), add `searchStatus,` right after `usedWebSearch,`.

At the catch-path `setState` (around line 1184-1197), add `searchStatus: null,` right after `usedWebSearch: false,` — a caught error (network failure, timeout, abort) never got far enough to know a search status, same reasoning as why that path already sets `validation: null` rather than a real value.

- [ ] **Step 4: Render the reason**

Add a translation lookup for the reason text near the top of `src/App.tsx` where other small lang-keyed helpers live (alongside `progressStageLabel`, defined in Task-adjacent code from the prior plan):

```ts
function searchStatusNote(status: AppState['ai']['searchStatus'], lang: 'ar' | 'en'): string | null {
  switch (status) {
    case 'disabled':
      return lang === 'ar' ? '(البحث معطّل لهذا المزوّد)' : '(web search off for this provider)';
    case 'no_api_key':
      return lang === 'ar' ? '(البحث غير مُهيّأ على الخادم)' : '(web search not configured on the server)';
    case 'no_results':
      return lang === 'ar' ? '(لا توجد نتائج بحث حديثة)' : '(no recent search results found)';
    case 'failed':
      return lang === 'ar' ? '(تعذّر الوصول لمحرك البحث)' : '(search temporarily unreachable)';
    default:
      return null;
  }
}
```

Update the render line (currently `{state.ai.at || ''} {state.ai.providerLabel ? \`· ${state.ai.providerLabel}\` : ''} {state.ai.usedWebSearch ? '+ web search' : ''} · {t.aiDisc}`, around line 1824):

```tsx
{state.ai.at || ''} {state.ai.providerLabel ? `· ${state.ai.providerLabel}` : ''} {state.ai.usedWebSearch ? '+ web search' : searchStatusNote(state.ai.searchStatus, state.lang) || ''} · {t.aiDisc}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: no errors

- [ ] **Step 6: Manual verification**

Run `npm run dev` (after `./start.sh` or equivalent backend start), trigger an analysis with a provider that has "Web search" toggled off in its settings, and confirm the disclaimer line shows "(web search off for this provider)" / "(البحث معطّل لهذا المزوّد)" instead of silently omitting any web-search indicator. Then re-enable it and confirm a normal run still shows "+ web search" as before.

- [ ] **Step 7: Commit**

```bash
git add src/api/llmProviders.ts src/App.tsx
git commit -m "feat: show why web search didn't run for an analysis, not just that it didn't"
```

---

## Task 5: Verify the cache actually unifies back-to-back comparisons end-to-end

**Files:**
- Test: `tests/server/analyze-route.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1-3 (cache + `searchStatus`).

- [ ] **Step 1: Write the integration test**

Add to `tests/server/analyze-route.test.mjs`, in the `describe('POST /api/analyze — web search augmentation', ...)` block:

```js
  it('gives two different providers the same evidence when called within the cache TTL', async () => {
    process.env.SERPAPI_API_KEY = 'serp-test-key';
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'ollama', 'Local', 'gemma4', true)`,
      [userId]
    );
    searchWeb.mockResolvedValue([
      { title: 'Gold hits record high', snippet: 'Prices surged on Fed cut bets', link: 'https://example.com/1' },
    ]);
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });

    const first = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });
    const [, firstPrompt] = runProviderAnalysis.mock.calls[0];

    await client.query(`UPDATE llm_providers SET is_active = false WHERE user_id = $1`, [userId]);
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'claude', 'Claude', 'claude-sonnet-4-6', true)`,
      [userId]
    );
    const second = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });
    const [, secondPrompt] = runProviderAnalysis.mock.calls[1];

    expect(first.body.searchStatus).toBe('ok');
    expect(second.body.searchStatus).toBe('ok');
    // Same evidence block injected into both prompts, regardless of provider_type —
    // this is the actual "unify web search across models" property this plan delivers.
    expect(firstPrompt.match(/LIVE WEB SEARCH RESULTS[\s\S]*?\n\n/)[0]).toBe(
      secondPrompt.match(/LIVE WEB SEARCH RESULTS[\s\S]*?\n\n/)[0]
    );
  });
```

Note: this test doesn't actually exercise the cache module directly (the route's `searchWeb` is mocked via `vi.mock`), so it can't prove Task 2's cache is wired up — it proves the *response contract* is unified. Task 2's own tests are what verify the cache mechanics. This test's real value is documenting the end-to-end behavior this plan is for, as a regression guard if a future change accidentally makes evidence provider-specific again.

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/server/analyze-route.test.mjs`
Expected: PASS

- [ ] **Step 3: Run the full suite one more time**

Run: `npm test`
Expected: all tests pass, no regressions

- [ ] **Step 4: Commit**

```bash
git add tests/server/analyze-route.test.mjs
git commit -m "test: verify web-search evidence is identical across providers within the cache window"
```

---

## Self-Review Notes

- **Spec coverage:** "unify web search for all models" → Tasks 2 (cache) + 5 (regression test) directly address evidence becoming identical across providers within a session; "not all models are searching" → Task 3's `searchStatus` makes the actual reason visible per-run instead of collapsing everything into `usedWebSearch: false`, and Task 4 surfaces it in the UI so the user can tell "toggled off" from "search failed" from "genuinely no results." "Speed up analysis" → Task 2's cache removes up to 5 parallel SerpAPI round-trips (each with an 8s timeout, per the prior plan) on a cache hit, which is the single largest fixed cost in the pipeline outside the LLM call itself.
- **Deliberately out of scope** (would need a product decision, not an engineering one, so not included as a task): reducing `WEB_SEARCH_QUERIES` from 5 to fewer queries, changing the LLM retry-then-downgrade loop's shape, or switching providers' `REQUEST_TIMEOUT_MS`/`max_tokens` floors. These all trade off analysis *quality* for speed and should be a separate, explicit decision, not bundled into a caching/observability change.
- **Placeholder scan:** no TBD/TODO markers; every step has runnable code.
- **Type consistency:** `searchStatus`'s literal union (`'ok' | 'disabled' | 'no_api_key' | 'no_results' | 'failed'`) is spelled identically in Task 3's server code, Task 4's TypeScript type, and Task 4's `searchStatusNote` switch — verified by re-reading each occurrence above.
