# Unified & Cached Web-Search Evidence Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for this plan) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Token/time-efficiency note:** this plan was deliberately kept to 3 tasks touching 4 files, each task landing everything it needs to say about a given file in one pass rather than revisiting the same lines across multiple tasks. **Prefer inline execution (`executing-plans`) over one subagent per task** — with only 3 tasks sharing 2 files (`server/routes/analyze.mjs`, `src/App.tsx`), a fresh subagent per task would re-read those same files from scratch three times, which costs more tokens than one session holding them in context throughout. Within each task, run the full local test file directly (`npx vitest run tests/server/analyze-route.test.mjs`) rather than the whole suite (`npm test`) — the plan only calls for a full-suite run once, at the very end.

**Goal:** Make every analysis run — regardless of which provider/model is active — search the web with the same evidence when compared close together, make it visible *why* a given run didn't search when it didn't, cut the analysis pipeline's latency by removing redundant SerpAPI round-trips, and — whenever an analysis actually used evidence — show the reader exactly which sources backed it via a glossary at the end of the analysis.

**Architecture:** `server/routes/analyze.mjs`'s `augmentPromptWithSearch()` already runs the same `searchWeb()` calls for every `provider_type` (claude, shared, openai, ollama, openrouter, custom) — evidence gathering was already unified in a prior plan (see "Task 3: Retire Claude's native web-search tool" in `docs/superpowers/plans/2026-09-15-analyst-data-contract-v2.md`) and is covered by an explicit regression test (`tests/server/analyze-route.test.mjs`, `'searches for claude providers too...'`). The actual sources of "different models, different analysis" are (a) SerpAPI's results are not deterministic call-to-call — comparing two providers a few minutes apart can hand them genuinely different top-5 results even under the same `tbs=qdr:d` recency filter, and (b) a search that silently fails (rate limit, the IPv6-routing flakiness already observed against `serpapi.com`, the provider's own "Web search" toggle being off) collapses to the same `usedWebSearch: false` the UI shows for every other reason, so the user can't tell "this model doesn't search" from "this run's search happened to fail." This plan adds a short-TTL cache in front of `searchWeb()` so back-to-back analyses reuse byte-identical evidence (unifying comparisons *and* skipping the network round-trip — the speed win), rewrites `augmentPromptWithSearch` once to return both a specific `searchStatus` reason and the `evidenceSources` behind every `[EV-00N]` citation (currently discarded once the prompt is built), and renders both in the frontend in one pass.

**Tech Stack:** Node/Express backend (`server/`), Preact/TypeScript frontend (`src/`), Vitest for tests.

**Spec:** This plan is self-contained; it extends the evidence-gathering design from `docs/superpowers/plans/2026-09-15-analyst-data-contract-v2.md` (Task 3 and Task 8 of that plan), which remains the source of truth for the retry-then-downgrade loop and schema v2 shapes referenced below.

## Global Constraints

- Never cache a failed or empty search result — a transient SerpAPI outage must not poison the cache for other queries/providers during the TTL window.
- The cache is in-memory, per server process — no new infrastructure (no Redis, no DB table). This is a single-node app; a `Map` with timestamps is sufficient and matches this codebase's existing preference for the simplest thing that works (see `server/webSearch.mjs`'s existing style — plain functions, no classes).
- `searchStatus` and `evidenceSources` must be additive — do not remove or change the meaning of the existing `usedWebSearch: boolean` field; every current consumer (frontend, existing tests) keeps working unchanged.
- Cache TTL: 10 minutes. Long enough that comparing 2-3 providers back-to-back gets identical evidence; short enough that "today's news" (the `qdr:d` recency filter's whole point) doesn't go stale within a session.
- The evidence glossary renders only when there is evidence to show (`evidenceSources.length > 0`) — no empty "Sources" heading on a run that didn't search or found nothing. It is the last section of the analysis card, after the sensitivity table (the current last section) — a footnote to the whole analysis, not to any one field.
- All new/changed code follows the existing comment style in this codebase: comments explain *why*, not *what* — see `server/webSearch.mjs`'s `RECENCY_FILTER` comment for the bar to match.
- Don't write a test for anything already covered by an existing test with a different assertion added on — extend, don't duplicate (see Task 2's consolidated table-driven test).

---

## File Structure

- Create: `server/searchCache.mjs` — a tiny TTL cache (`getCached`/`setCached`). Split out from `webSearch.mjs` so a future second cache consumer doesn't have to import search-specific code; tested only indirectly through `searchWeb()`'s own tests (Task 1) — its behavior has no independent surface worth a second test file.
- Modify: `server/webSearch.mjs` — check the cache before hitting SerpAPI; populate it only on success.
- Modify: `server/routes/analyze.mjs` — rewrite `augmentPromptWithSearch()` once to return `searchStatus` and `evidenceSources` together, and thread both into the final JSON response.
- Modify: `src/api/llmProviders.ts` — add `searchStatus` and `evidenceSources` to `analyzeViaBackend`'s return type.
- Modify: `src/App.tsx` — store `searchStatus`/`evidenceSources` in `AppState['ai']`, set them on both the success and catch paths, render a bilingual reason next to the existing "+ web search" indicator when search did not run, and render the evidence glossary as the last section of the analysis card.
- Modify tests: `tests/server/web-search.test.mjs` (cache behavior), `tests/server/analyze-route.test.mjs` (searchStatus + evidenceSources).

---

## Task 1: Cache `searchWeb()` results

**Files:**
- Create: `server/searchCache.mjs`
- Modify: `server/webSearch.mjs`
- Test: `tests/server/web-search.test.mjs`

**Interfaces:**
- Produces: `getCached(key: string): unknown | undefined`, `setCached(key: string, value: unknown): void` (`server/searchCache.mjs`) — internal to `webSearch.mjs`, no other file imports these. `searchWeb(query, apiKey)`'s external behavior/return shape is unchanged; it now serves a cache hit without calling `fetch`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/server/web-search.test.mjs` (it already imports `searchWeb`, `vi`, `describe`, `it`, `expect`, `afterEach`):

```js
  it('does not call fetch a second time for the same query within the cache TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ organic_results: [{ title: 'Fresh', snippet: '', link: 'https://fresh.example' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await searchWeb('a cache-test query', 'serp-test-key');
    const second = await searchWeb('a cache-test query', 'serp-test-key');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('does not cache a failed request, so the next call for that query retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ organic_results: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchWeb('a query that fails once', 'serp-test-key')).rejects.toThrow();
    await expect(searchWeb('a query that fails once', 'serp-test-key')).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/server/web-search.test.mjs`
Expected: FAIL — both new tests see `fetchMock` called twice (no cache exists yet).

- [ ] **Step 3: Create the cache and wire it into `searchWeb`**

`server/searchCache.mjs`:

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

In `server/webSearch.mjs`, add the import and wrap the existing fetch logic (keep the existing `RECENCY_FILTER`/`SEARCH_TIMEOUT_MS` constants and their comments unchanged):

```js
import { getCached, setCached } from './searchCache.mjs';

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

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/server/web-search.test.mjs`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add server/searchCache.mjs server/webSearch.mjs tests/server/web-search.test.mjs
git commit -m "feat: cache searchWeb results for 10 minutes to unify and speed up evidence gathering"
```

---

## Task 2: Rewrite `augmentPromptWithSearch` — `searchStatus` + `evidenceSources` together

**Files:**
- Modify: `server/routes/analyze.mjs`
- Test: `tests/server/analyze-route.test.mjs`

**Interfaces:**
- Consumes: Task 1's cached `searchWeb`; the existing `evidenceIdFor(index)` and `formatSearchResults(results)` helpers already in `analyze.mjs`.
- Produces: `augmentPromptWithSearch(prompt, providerRow)` returns `{ prompt, usedWebSearch, evidenceIds, evidenceSources, searchStatus }`, where `searchStatus` is one of `'ok' | 'disabled' | 'no_api_key' | 'no_results' | 'failed'` and `evidenceSources` is `{ id: string; title: string; link: string; date: string }[]` (one entry per result actually injected, same order as their `[EV-00N]` IDs). The `/api/analyze` response gains top-level `searchStatus` and `evidenceSources` fields.

- [ ] **Step 1: Write the failing tests**

Add to `tests/server/analyze-route.test.mjs`, inside the existing `describe('POST /api/analyze — web search augmentation', ...)` block (it already has the provider-insert + `searchWeb.mockResolvedValue`/`mockRejectedValue` patterns to copy):

```js
  it.each([
    ['ok', { key: 'serp-test-key', results: [{ title: 'Gold hits record high', snippet: '', link: 'https://example.com/1', date: '' }], settings: undefined }],
    ['no_api_key', { key: undefined, results: undefined, settings: undefined }],
    ['disabled', { key: 'serp-test-key', results: undefined, settings: { webSearch: false } }],
    ['no_results', { key: 'serp-test-key', results: [], settings: undefined }],
  ])('reports searchStatus %s', async (expectedStatus, { key, results, settings }) => {
    if (key) process.env.SERPAPI_API_KEY = key;
    else delete process.env.SERPAPI_API_KEY;
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active, settings)
       VALUES ($1, 'ollama', 'Local', 'gemma4', true, $2)`,
      [userId, JSON.stringify(settings || {})]
    );
    if (results) searchWeb.mockResolvedValue(results);
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.body.searchStatus).toBe(expectedStatus);
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

  it('returns the evidence sources behind each injected [EV-00N] ID, empty when search did not run', async () => {
    process.env.SERPAPI_API_KEY = 'serp-test-key';
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'ollama', 'Local', 'gemma4', true)`,
      [userId]
    );
    searchWeb.mockResolvedValue([
      { title: 'Gold hits record high', snippet: 'Prices surged on Fed cut bets', link: 'https://example.com/1', date: '2 hours ago' },
      { title: 'Fed holds rates steady', snippet: 'FOMC statement cites inflation risk', link: 'https://example.com/2', date: '' },
    ]);
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.body.evidenceSources).toEqual([
      { id: 'EV-001', title: 'Gold hits record high', link: 'https://example.com/1', date: '2 hours ago' },
      { id: 'EV-002', title: 'Fed holds rates steady', link: 'https://example.com/2', date: '' },
    ]);

    await client.query(`UPDATE llm_providers SET is_active = false WHERE user_id = $1`, [userId]);
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'claude', 'Claude', 'claude-sonnet-4-6', true)`,
      [userId]
    );
    const second = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });
    // Same cached evidence handed to a completely different provider_type —
    // this is the "unify web search across models" property this plan is for.
    expect(second.body.evidenceSources).toEqual(res.body.evidenceSources);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/server/analyze-route.test.mjs`
Expected: FAIL — `res.body.searchStatus`/`res.body.evidenceSources` are `undefined`.

- [ ] **Step 3: Rewrite `augmentPromptWithSearch` and its call site**

```js
async function augmentPromptWithSearch(prompt, providerRow) {
  if (!isWebSearchEnabled(providerRow)) {
    return { prompt, usedWebSearch: false, evidenceIds: [], evidenceSources: [], searchStatus: 'disabled' };
  }

  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return { prompt, usedWebSearch: false, evidenceIds: [], evidenceSources: [], searchStatus: 'no_api_key' };

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
    if (results.length === 0) return { prompt, usedWebSearch: false, evidenceIds: [], evidenceSources: [], searchStatus: 'no_results' };
    const evidenceIds = results.map((_, i) => evidenceIdFor(i));
    // The model only ever sees title/snippet/date inline in the prompt text
    // below — it has no reason to echo the source URL back in its JSON
    // response, so the app holds onto it separately to ever show the reader
    // where an [EV-00N] citation actually came from.
    const evidenceSources = results.map((r, i) => ({ id: evidenceIdFor(i), title: r.title, link: r.link, date: r.date }));
    const augmented = `LIVE WEB SEARCH RESULTS (use these as your source of current market/news context). Each result is tagged with a stable evidence ID like [EV-001]. Whenever you state a time-sensitive fact drawn from these results anywhere in your JSON output, cite the ID(s) it came from in brackets at the end of that sentence, e.g. "...rose 2% today [EV-002]." Never invent an ID that is not listed below, and never attach an ID to a claim these results don't actually support:\n${formatSearchResults(results)}\n\n${prompt}`;
    return { prompt: augmented, usedWebSearch: true, evidenceIds, evidenceSources, searchStatus: 'ok' };
  } catch {
    return { prompt, usedWebSearch: false, evidenceIds: [], evidenceSources: [], searchStatus: 'failed' };
  }
}
```

Note vs. the current code: `Promise.all` no longer has a per-query `.catch(() => [])` — a single query's rejection now propagates to the outer `try/catch` so `searchStatus` becomes `'failed'` instead of silently degrading to a partial result set. This is a deliberate behavior change (a partial failure now discards the whole batch rather than using whatever succeeded); it's the simplest way to get an honest `'failed'` label, and the existing retry-then-downgrade loop downstream (Task 8 of the prior plan) already tolerates a prompt with no injected evidence.

Update the call site (currently `if (webSearchEnabled) { const augmented = await augmentPromptWithSearch(prompt); ... }`):

```js
      let effectivePrompt = prompt;
      const augmented = await augmentPromptWithSearch(prompt, provider);
      effectivePrompt = augmented.prompt;
      const injectedWebSearch = augmented.usedWebSearch;
      const evidenceIds = augmented.evidenceIds;
      const searchStatus = augmented.searchStatus;
      const evidenceSources = augmented.evidenceSources;
```

Remove the now-unused `webSearchEnabled` local and its standalone `isWebSearchEnabled(provider)` call at the old call site — keep the `isWebSearchEnabled` function itself, it's still used from inside `augmentPromptWithSearch`.

Add both fields to the response:

```js
      res.json({ ...result, text, validation, searchStatus, evidenceSources });
```

- [ ] **Step 4: Run this file, then the full server suite**

Run: `npx vitest run tests/server/analyze-route.test.mjs` — expect PASS, then `npm test` — expect all tests pass, no regressions elsewhere (the pre-existing `'does not augment...'` and `'falls back to the unaugmented prompt...'` tests still pass unchanged since they only assert `usedWebSearch`/`searchWeb` call counts).

- [ ] **Step 5: Commit**

```bash
git add server/routes/analyze.mjs tests/server/analyze-route.test.mjs
git commit -m "feat: report searchStatus and evidenceSources from the web-search augmentation step"
```

---

## Task 3: Frontend — show why search didn't run, and the sources when it did

**Files:**
- Modify: `src/api/llmProviders.ts:117-127`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `searchStatus`/`evidenceSources` from the `/api/analyze` response (Task 2).
- Produces: `AppState['ai'].searchStatus: 'ok' | 'disabled' | 'no_api_key' | 'no_results' | 'failed' | null` and `AppState['ai'].evidenceSources: { id: string; title: string; link: string; date: string }[]`.

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
  evidenceSources: { id: string; title: string; link: string; date: string }[];
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

- [ ] **Step 2: Thread both fields through `AppState` and `analyze()`**

In the `ai` block of `AppState` (around line 85-95), add after `usedWebSearch: boolean;`:

```ts
    searchStatus: 'ok' | 'disabled' | 'no_api_key' | 'no_results' | 'failed' | null;
    evidenceSources: { id: string; title: string; link: string; date: string }[];
```

In the initial state (around line 180), add after `usedWebSearch: false,`:

```ts
    searchStatus: null,
    evidenceSources: [],
```

In `analyze()`'s success path, change the destructure (currently `const { text, usedWebSearch, validation } = await analyzeViaBackend(...)`, around line 1091) to:

```ts
      const { text, usedWebSearch, searchStatus, evidenceSources, validation } = await analyzeViaBackend(prompt, snapshot, controller.signal);
```

and in that same block's `setState` (around line 1128-1141), add `searchStatus, evidenceSources,` right after `usedWebSearch,`.

In the catch-path `setState` (around line 1184-1197), add `searchStatus: null, evidenceSources: [],` right after `usedWebSearch: false,` — a caught error (network failure, timeout, abort) never got far enough to know either.

- [ ] **Step 3: Render the "why" note and the sources glossary**

Add a helper near `progressStageLabel` (defined earlier in this file, from the prior plan):

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

Update the existing disclaimer render line (currently `{state.ai.at || ''} {state.ai.providerLabel ? \`· ${state.ai.providerLabel}\` : ''} {state.ai.usedWebSearch ? '+ web search' : ''} · {t.aiDisc}`, around line 1824):

```tsx
{state.ai.at || ''} {state.ai.providerLabel ? `· ${state.ai.providerLabel}` : ''} {state.ai.usedWebSearch ? '+ web search' : searchStatusNote(state.ai.searchStatus, state.lang) || ''} · {t.aiDisc}
```

Immediately after the sensitivity-table block (the current last section of the analysis card, closing around line 1804 — the block starting `{state.aiLevel === 'expert' && sensitivityTable.length ? (`), add the glossary, unconditional on `aiLevel` (a beginner benefits from being able to check a source just as much as an expert; only the inline per-field `[EV-00N]` chips are expert-only):

```tsx
                    {state.ai.evidenceSources.length ? (
                      <div style={{ marginTop: 16 }}>
                        <div className="section-label gold-text" style={{ marginBottom: 6 }}>{t.aiEvidenceH}</div>
                        {state.ai.evidenceSources.map((source) => (
                          <div key={source.id} className="soft-text" style={{ fontSize: 13, lineHeight: 1.8 }}>
                            <span style={{ opacity: 0.7 }}>[{source.id}]</span>{' '}
                            <a href={source.link} target="_blank" rel="noopener noreferrer">{source.title}</a>
                            {source.date ? ` — ${source.date}` : ''}
                          </div>
                        ))}
                      </div>
                    ) : null}
```

Add one translation key to each of the `ar`/`en` objects, next to `aiSensitivityH`:

```ts
// ar object: aiEvidenceH: 'مصادر الأدلة',
// en object: aiEvidenceH: 'SOURCES',
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -b`
Expected: no errors

- [ ] **Step 5: Manual verification**

Run `npm run dev`. Trigger one analysis with a provider that has "Web search" enabled and a working `SERPAPI_API_KEY` — confirm a "SOURCES"/"مصادر الأدلة" list appears at the bottom of the card with clickable titles numbered `[EV-001]`, `[EV-002]`, etc. Then trigger a second analysis with a provider that has "Web search" disabled — confirm the disclaimer shows "(web search off for this provider)"/"(البحث معطّل لهذا المزوّد)" and the glossary section does not render at all (not even an empty heading).

- [ ] **Step 6: Commit**

```bash
git add src/api/llmProviders.ts src/App.tsx
git commit -m "feat: show why web search didn't run, and a sources glossary when it did"
```

---

## Self-Review Notes

- **Spec coverage:** "unify web search for all models" → Task 1's cache + Task 2's cross-provider identical-evidence assertion (folded into its evidenceSources test, not a separate task); "not all models are searching" → Task 2's `searchStatus` plus Task 3's UI note distinguish "toggled off" / "no API key" / "search failed" / "genuinely no results" instead of a bare boolean; "speed up analysis" → Task 1's cache removes up to 5 parallel SerpAPI round-trips on a cache hit; "evidence glossary at the end of the analysis" → Task 2's `evidenceSources` + Task 3's render block.
- **Token/time efficiency, concretely:** collapsed the original 6-task/37-step version (which touched `analyze.mjs` in two separate passes and `App.tsx` in two separate passes) into 3 tasks that each touch a file once; replaced 5 near-duplicate `searchStatus` test cases with one `it.each` table; dropped a standalone `searchCache.test.mjs` file in favor of testing the cache through `searchWeb()`'s own behavior (the cache has no behavior worth verifying independent of its one caller); folded the old dedicated "verify cache unifies providers" task into a single extra assertion inside Task 2's existing evidenceSources test instead of a fourth task with its own setup.
- **Deliberately out of scope** (a product decision, not an engineering one): reducing `WEB_SEARCH_QUERIES` from 5 to fewer queries, changing the LLM retry-then-downgrade loop's shape, or lowering providers' `REQUEST_TIMEOUT_MS`/`max_tokens` floors. These trade analysis *quality* for speed and deserve their own explicit decision.
- **Placeholder scan:** no TBD/TODO markers; every step has runnable code.
- **Type consistency:** `searchStatus`'s literal union and `evidenceSources`'s shape (`{ id: string; title: string; link: string; date: string }[]`) are spelled identically across Task 2's server code, Task 3's `analyzeViaBackend` return type, and Task 3's `AppState['ai']` fields — verified by re-reading each occurrence above.
