# Analyst Prompt Enhancement (Scoped Slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the highest-value, lowest-risk gaps between the current Gold Analyst prompt and `ANALYST-PROMPT-ENHANCEMENT-PLAN.md` — evidence traceability, a `confidence` signal, DCA/cost-basis personalization, and deterministic server-side checks — without adopting the full plan's evaluation suite, observability pipeline, or 5-stage rollout, which are oversized for this app's current scale (single-file React cockpit, one developer, chat-completion providers with no guaranteed structured-output support).

**Architecture:** The analyze pipeline stays a single prompt string sent to one of several providers (Claude, OpenAI-compatible, Ollama, shared tier) via `runProviderAnalysis`. This plan adds: (1) stable `EV-XXX` IDs on server-injected search results plus a citation instruction, (2) a new deterministic validation pass in `analyze.mjs` that checks scenario-weight arithmetic and citation existence and returns non-fatal `validationWarnings`, (3) two new schema fields (`confidence`/`confidence_reasons`, `dca_read`) threaded through the prompt, `AIResult` type, `normalizeAIResult`, `repairAnalysisJson`, and the render tree, (4) DCA plan + wallet cost-basis data (already fetched into `App.tsx` state but unused in the prompt) wired into the context, and (5) the numeric "LIVE COCKPIT STATE" line converted from prose into a compact inline JSON object so it's machine-generated rather than hand-formatted, as a template for further structured-context work later.

**Tech Stack:** Express + Postgres backend (`server/`), Preact/TypeScript single-page frontend (`src/App.tsx`), Vitest + Supertest for server tests (no frontend test harness exists — frontend tasks are verified manually via the dev server).

**Spec:** `ANALYST-PROMPT-ENHANCEMENT-PLAN.md` (repo root) — this plan implements a deliberately narrowed subset of it; see the "Deferred from the spec" section below for what is intentionally not being built now and why.

## Global Constraints

- Every provider (`claude`, `shared`, `openai`, `openrouter`, `ollama`, custom) must keep working — do not assume structured-output/JSON-mode support exists on all of them. `repairAnalysisJson.mjs` remains the safety net for malformed JSON from weaker models; any new schema field must be added to its `EXPECTED_KEYS` list.
- The three `suggested_weights` values must still sum to 100 — this is already relied on by `applyAI()` in `App.tsx`; do not change that contract.
- All user-visible AI output stays in the requested locale (`ar-EG` colloquial or English) — new instruction text added to the prompt must say so explicitly, matching the existing pattern at `src/App.tsx:1098`.
- No new backend dependencies, no new database tables/migrations — this slice is prompt/validation/response-shape work only.
- Preserve the existing conditional-field pattern: `wallet_read`/`watchlist_read` only appear in the schema/prompt when there's data to back them (see `src/App.tsx:1096-1097,1105`) — the new `dca_read` field follows the same rule.
- Keep changes to `server/routes/repairAnalysisJson.mjs` additive only — do not reorder `EXPECTED_KEYS` entries that already exist, since their positions are used to detect where a previous field's array/object was left unclosed.

## Deferred from the spec (and why)

- **§12 Evaluation suite, §13 Observability, §14 five-stage rollout** — these assume a team, a CI eval budget, and a live-traffic canary process. This is a single-developer cockpit app; the equivalent right-sized guardrail is the Vitest suite this plan extends plus manual verification, not a parallel offline-eval harness.
- **§2 Layer D full evidence-pack taxonomy** (quality tiers, duplication groups, freshness windows) — the current search backend is 5 SerpAPI snippet queries (`server/webSearch.mjs`), not a retrieval system with source-quality metadata to tier. Stable evidence IDs + a citation requirement capture the real, actionable gap; a quality-tier taxonomy would be fictional metadata layered on top of snippets.
- **§8 Full nested output schema** (`horizon_actions`, `scenario_update`, `portfolio_read`, `evidence_used[]` as structured objects) — the current UI renders 8 flat string/object fields directly (`src/App.tsx:1584-1640`). Adopting the full contract means a parallel UI rewrite, out of scope for "prompt enhancement." This plan adds exactly two new flat fields that fit the existing render pattern.
- **§6 Beginner/Expert restructuring beyond current differentiation** — the prompt already branches beginner vs. expert instructions (`src/App.tsx:1097`); deepening that split is a separate, independent piece of work not bundled here.

---

## File Structure

- `server/routes/analyze.mjs` — gains evidence-ID tagging in `formatSearchResults`/`augmentPromptWithSearch`, and a call into the new validator before responding.
- `server/routes/validateAnalysis.mjs` — **new file**. Pure functions: weights-sum check, cited-evidence-ID-exists check. No I/O, easy to unit test in isolation.
- `server/routes/repairAnalysisJson.mjs` — `EXPECTED_KEYS` gains `confidence` and `dca_read`.
- `src/App.tsx` — prompt template (`analyze()`, ~line 1067-1107), `AIResult` type (~line 46), `normalizeAIResult` (~line 210), `buildFallbackAnalysis` (~line 1014), render tree (~line 1584-1640), and the `t` translation objects (two giant object literals, English ~line 2380, Arabic ~line 2369) all get small additive changes.
- `src/api/llmProviders.ts` — `analyzeViaBackend` return type gains `validationWarnings`.
- `tests/server/analyze-route.test.mjs` — new assertions for evidence IDs and validation warnings.
- `tests/server/validate-analysis.test.mjs` — **new file**, unit tests for the new validator module.
- `tests/server/repair-analysis-json.test.mjs` — new assertions covering the two new `EXPECTED_KEYS`.

---

### Task 1: Stable evidence IDs on server-injected search results

**Files:**
- Modify: `server/routes/analyze.mjs:32-64` (`formatSearchResults`, `augmentPromptWithSearch`, and the call site in the router handler)
- Test: `tests/server/analyze-route.test.mjs`

**Interfaces:**
- Produces: `augmentPromptWithSearch(prompt): Promise<{ prompt: string, usedWebSearch: boolean, evidenceIds: string[] }>` — the `evidenceIds` array (e.g. `['EV-001', 'EV-002']`) is new and is what Task 2's validator checks citations against.

Today, `formatSearchResults` (analyze.mjs:32-36) numbers results `1.`, `2.`, ... in prose with no stable identifier the model can cite back, and the model is never told to cite anything. This task tags each result with an `EV-XXX` ID and instructs the model to cite IDs for time-sensitive claims — the single highest-value, lowest-risk change from the spec's evidence policy (§4).

- [ ] **Step 1: Write the failing test**

Add to `tests/server/analyze-route.test.mjs`, inside the existing `describe('POST /api/analyze — web search augmentation for non-native-search providers', ...)` block (after the test at line 235):

```js
  it('tags injected search results with stable evidence IDs and instructs the model to cite them', async () => {
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

    expect(res.status).toBe(200);
    const [, augmentedPrompt] = runProviderAnalysis.mock.calls[0];
    expect(augmentedPrompt).toContain('[EV-001]');
    expect(augmentedPrompt).toContain('[EV-002]');
    expect(augmentedPrompt).toContain('Gold hits record high');
    expect(augmentedPrompt).toMatch(/cite the ID/i);
    expect(augmentedPrompt).toMatch(/[Nn]ever invent an ID/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/analyze-route.test.mjs -t "tags injected search results"`
Expected: FAIL — `augmentedPrompt` does not contain `[EV-001]` (current output is `1. Gold hits record high ...`).

- [ ] **Step 3: Implement evidence-ID tagging**

In `server/routes/analyze.mjs`, replace the existing `formatSearchResults` function (lines 32-36) with:

```js
function evidenceIdFor(index) {
  return `EV-${String(index + 1).padStart(3, '0')}`;
}

function formatSearchResults(results) {
  return results
    .map((r, i) => `[${evidenceIdFor(i)}] ${r.title}${r.date ? ` [${r.date}]` : ''} — ${r.snippet} (${r.link})`)
    .join('\n');
}
```

Then replace `augmentPromptWithSearch` (lines 38-56) with:

```js
async function augmentPromptWithSearch(prompt) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return { prompt, usedWebSearch: false, evidenceIds: [] };

  try {
    const resultsPerQuery = await Promise.all(
      WEB_SEARCH_QUERIES.map((query) => searchWeb(query, apiKey).catch(() => []))
    );
    const seenLinks = new Set();
    const results = resultsPerQuery.flat().filter((r) => {
      if (!r.link || seenLinks.has(r.link)) return false;
      seenLinks.add(r.link);
      return true;
    });
    if (results.length === 0) return { prompt, usedWebSearch: false, evidenceIds: [] };
    const evidenceIds = results.map((_, i) => evidenceIdFor(i));
    const augmented = `LIVE WEB SEARCH RESULTS (use these as your source of current market/news context). Each result is tagged with a stable evidence ID like [EV-001]. Whenever you state a time-sensitive fact drawn from these results anywhere in your JSON output, cite the ID(s) it came from in brackets at the end of that sentence, e.g. "...rose 2% today [EV-002]." Never invent an ID that is not listed below, and never attach an ID to a claim these results don't actually support:\n${formatSearchResults(results)}\n\n${prompt}`;
    return { prompt: augmented, usedWebSearch: true, evidenceIds };
  } catch {
    return { prompt, usedWebSearch: false, evidenceIds: [] };
  }
}
```

Then in the `router.post('/', ...)` handler (around line 137-142), update the destructuring to also capture `evidenceIds` — replace:

```js
      let effectivePrompt = prompt;
      let injectedWebSearch = false;
      const usesNativeSearch = NATIVE_SEARCH_PROVIDER_TYPES.has(provider.provider_type);
      const webSearchEnabled = isWebSearchEnabled(provider);
      if (!usesNativeSearch && webSearchEnabled) {
        const augmented = await augmentPromptWithSearch(prompt);
        effectivePrompt = augmented.prompt;
        injectedWebSearch = augmented.usedWebSearch;
      }
```

with:

```js
      let effectivePrompt = prompt;
      let injectedWebSearch = false;
      let evidenceIds = [];
      const usesNativeSearch = NATIVE_SEARCH_PROVIDER_TYPES.has(provider.provider_type);
      const webSearchEnabled = isWebSearchEnabled(provider);
      if (!usesNativeSearch && webSearchEnabled) {
        const augmented = await augmentPromptWithSearch(prompt);
        effectivePrompt = augmented.prompt;
        injectedWebSearch = augmented.usedWebSearch;
        evidenceIds = augmented.evidenceIds;
      }
```

(`evidenceIds` is unused past this point until Task 2 wires it into the validator — leaving it assigned but momentarily unread is fine; it will be consumed in the very next task in this same function.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/analyze-route.test.mjs`
Expected: PASS, including the new test and all pre-existing tests in the file (the two tests at lines 231-234 that assert plain-text content like `'Gold hits record high'` still pass since that text is still present, just now prefixed with `[EV-001] `).

- [ ] **Step 5: Commit**

```bash
git add server/routes/analyze.mjs tests/server/analyze-route.test.mjs
git commit -m "feat: tag server-injected search results with stable evidence IDs"
```

---

### Task 2: Deterministic validation pass (weights sum, citation existence)

**Files:**
- Create: `server/routes/validateAnalysis.mjs`
- Test: `tests/server/validate-analysis.test.mjs`
- Modify: `server/routes/analyze.mjs` (call the validator, attach `validationWarnings` to the response)
- Test: `tests/server/analyze-route.test.mjs`

**Interfaces:**
- Consumes: `evidenceIds: string[]` produced by Task 1's `augmentPromptWithSearch`.
- Produces: `validateAnalysis({ parsed: object|null, rawText: string, evidenceIds: string[] }): string[]` — a list of human-readable warning strings, empty when nothing is wrong. Task 5 (frontend) consumes `validationWarnings` from the `/api/analyze` JSON response.

This is the app-side deterministic check the spec calls for in §11 — scoped to the two checks that are both cheap to compute and already meaningful given today's schema: scenario-weight arithmetic (already relied on by `applyAI()`) and "every cited evidence ID actually exists in what we gave the model" (closes the loop opened by Task 1). This does **not** block the response — a bad analysis is still better returned-with-a-warning than discarded, matching the spec's "safe partial result" principle (§11) without building the fuller repair-pass machinery §11 describes.

- [ ] **Step 1: Write the failing test**

Create `tests/server/validate-analysis.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { validateAnalysis } from '../../server/routes/validateAnalysis.mjs';

describe('validateAnalysis', () => {
  it('returns no warnings for a clean result with weights summing to 100 and only known evidence IDs', () => {
    const parsed = {
      one_liner: 'Hold steady [EV-001].',
      suggested_weights: { deesc: 30, base: 45, stag: 25 },
    };
    const warnings = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: ['EV-001', 'EV-002'] });
    expect(warnings).toEqual([]);
  });

  it('flags suggested_weights that do not sum to 100', () => {
    const parsed = { suggested_weights: { deesc: 30, base: 45, stag: 20 } };
    const warnings = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: [] });
    expect(warnings).toEqual(['suggested_weights sums to 95, not 100']);
  });

  it('tolerates a rounding-only mismatch of at most 1', () => {
    const parsed = { suggested_weights: { deesc: 33, base: 34, stag: 34 } };
    const warnings = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: [] });
    expect(warnings).toEqual([]);
  });

  it('flags a cited evidence ID that was never supplied to the model', () => {
    const rawText = 'The Fed held rates steady [EV-007].';
    const warnings = validateAnalysis({ parsed: { one_liner: rawText }, rawText, evidenceIds: ['EV-001', 'EV-002'] });
    expect(warnings).toEqual(['cited evidence ID(s) not in the supplied search results: EV-007']);
  });

  it('does not flag evidence IDs when none were supplied to the model (no web search occurred)', () => {
    const rawText = 'Gold looks steady today.';
    const warnings = validateAnalysis({ parsed: { one_liner: rawText }, rawText, evidenceIds: [] });
    expect(warnings).toEqual([]);
  });

  it('skips the weights check entirely when suggested_weights is absent', () => {
    const warnings = validateAnalysis({ parsed: { one_liner: 'x' }, rawText: 'x', evidenceIds: [] });
    expect(warnings).toEqual([]);
  });

  it('handles parsed being null (unparseable response) without throwing', () => {
    const rawText = 'not json [EV-999]';
    const warnings = validateAnalysis({ parsed: null, rawText, evidenceIds: ['EV-001'] });
    expect(warnings).toEqual(['cited evidence ID(s) not in the supplied search results: EV-999']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/validate-analysis.test.mjs`
Expected: FAIL with "Cannot find module '../../server/routes/validateAnalysis.mjs'".

- [ ] **Step 3: Implement the validator**

Create `server/routes/validateAnalysis.mjs`:

```js
// Deterministic, non-fatal checks over an analysis response — the
// application-side validation the model itself cannot be trusted to do
// (see ANALYST-PROMPT-ENHANCEMENT-PLAN.md §11). Never throws and never
// blocks the response; callers surface the returned warnings alongside the
// analysis rather than discarding it.

const WEIGHTS_SUM_TOLERANCE = 1; // absorbs Math.round() rounding, not real drift

function checkWeightsSum(parsed) {
  const weights = parsed?.suggested_weights;
  if (!weights || typeof weights !== 'object') return [];
  const { deesc, base, stag } = weights;
  if (typeof deesc !== 'number' || typeof base !== 'number' || typeof stag !== 'number') return [];
  const sum = deesc + base + stag;
  if (Math.abs(sum - 100) <= WEIGHTS_SUM_TOLERANCE) return [];
  return [`suggested_weights sums to ${sum}, not 100`];
}

function checkCitedEvidenceExists(rawText, evidenceIds) {
  if (!evidenceIds || evidenceIds.length === 0) return [];
  const cited = new Set((rawText.match(/EV-\d{3}/g) || []));
  const known = new Set(evidenceIds);
  const unknown = [...cited].filter((id) => !known.has(id));
  if (unknown.length === 0) return [];
  return [`cited evidence ID(s) not in the supplied search results: ${unknown.join(', ')}`];
}

export function validateAnalysis({ parsed, rawText, evidenceIds }) {
  return [
    ...checkWeightsSum(parsed),
    ...checkCitedEvidenceExists(rawText || '', evidenceIds || []),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/validate-analysis.test.mjs`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Wire the validator into the analyze route**

In `server/routes/analyze.mjs`, the response-building section currently reads (around line 148-159, after the JSON-repair block):

```js
      if (!isParseableJson(text)) {
        const repaired = repairAnalysisJson(text);
        if (repaired) text = JSON.stringify(repaired);
      }
```

Add the import at the top of the file (alongside the existing imports):

```js
import { validateAnalysis } from './validateAnalysis.mjs';
```

Then, immediately after the repair block above, add:

```js
      const parsedForValidation = (() => {
        try {
          return JSON.parse(extractBraces(text) || text);
        } catch {
          return null;
        }
      })();
      const validationWarnings = validateAnalysis({ parsed: parsedForValidation, rawText: text, evidenceIds });
```

Finally, update the response line at the end of the handler — currently:

```js
      res.json({ ...result, text });
```

Change to:

```js
      res.json({ ...result, text, validationWarnings });
```

- [ ] **Step 6: Write the route-level test**

Add to `tests/server/analyze-route.test.mjs`, in the top-level `describe('POST /api/analyze', ...)` block:

```js
  it('flags suggested_weights that do not sum to 100 via validationWarnings, without failing the request', async () => {
    const { rows } = await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'claude', 'Claude', 'claude-sonnet-4-6', true) RETURNING *`,
      [userId]
    );
    runProviderAnalysis.mockResolvedValue({
      text: '{"one_liner":"ok","suggested_weights":{"deesc":30,"base":40,"stag":20}}',
      usedWebSearch: false,
    });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.status).toBe(200);
    expect(res.body.validationWarnings).toEqual(['suggested_weights sums to 90, not 100']);
  });

  it('returns an empty validationWarnings array for a clean response', async () => {
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, 'claude', 'Claude', 'claude-sonnet-4-6', true)`,
      [userId]
    );
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });

    const res = await request(app).post('/api/analyze').send({ prompt: 'analyze this' });

    expect(res.status).toBe(200);
    expect(res.body.validationWarnings).toEqual([]);
  });
```

- [ ] **Step 7: Run full test file to verify everything passes**

Run: `npx vitest run tests/server/analyze-route.test.mjs tests/server/validate-analysis.test.mjs`
Expected: PASS, all tests including the pre-existing ones (the `res.body).toEqual({ text: ..., usedWebSearch: ... })` assertion at line 57 will now fail because the response has an extra `validationWarnings` key — fix that specific assertion to include `validationWarnings: []`):

Update line 57 in `tests/server/analyze-route.test.mjs` from:
```js
    expect(res.body).toEqual({ text: '{"one_liner":"ok"}', usedWebSearch: true });
```
to:
```js
    expect(res.body).toEqual({ text: '{"one_liner":"ok"}', usedWebSearch: true, validationWarnings: [] });
```

Re-run: `npx vitest run tests/server/analyze-route.test.mjs tests/server/validate-analysis.test.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/routes/validateAnalysis.mjs server/routes/analyze.mjs tests/server/validate-analysis.test.mjs tests/server/analyze-route.test.mjs
git commit -m "feat: add deterministic validation for scenario weights and evidence citations"
```

---

### Task 3: `confidence` field end-to-end

**Files:**
- Modify: `server/routes/repairAnalysisJson.mjs:1` (`EXPECTED_KEYS`)
- Modify: `tests/server/repair-analysis-json.test.mjs`
- Modify: `src/App.tsx` — `AIResult` type (~line 46), prompt schema block (~line 1098-1106), `normalizeAIResult` (~line 210-244), `buildFallbackAnalysis` (~line 1014-1064), render tree (~line 1584-1640), both `t` translation objects (~lines 2369, 2380)

**Interfaces:**
- Produces: `AIResult.confidence?: 'low' | 'medium' | 'high'`, `AIResult.confidence_reasons?: string[]` — consumed only by the render tree in this task; no other task depends on these types.

The spec's §3.4 confidence rules (low/medium/high plus reasons, never a bare invented percentage) are one of the cheapest, highest-signal additions — the schema barely changes and it directly counters the "little meaningful difference between Beginner and Expert modes" complaint from the spec's problem statement, since Expert mode can show `confidence_reasons` and Beginner mode can just show the badge.

- [ ] **Step 1: Add `confidence` to the JSON-repair schema-aware key list**

In `server/routes/repairAnalysisJson.mjs`, line 1, change:

```js
const EXPECTED_KEYS = ['one_liner', 'trends', 'suggested_weights', 'weights_reasoning', 'tranche2', 'egp_read', 'wallet_read', 'watchlist_read'];
```

to:

```js
const EXPECTED_KEYS = ['one_liner', 'confidence', 'trends', 'suggested_weights', 'weights_reasoning', 'tranche2', 'egp_read', 'wallet_read', 'watchlist_read'];
```

(Placed right after `one_liner` to match where it will sit in the prompt's schema block, added in Step 4 below — the repair function's marker-scanning logic works regardless of exact position, but keeping this list's order aligned with the actual prompt schema order makes future debugging easier.)

- [ ] **Step 2: Write the failing repair test**

Add to `tests/server/repair-analysis-json.test.mjs` (find the existing `describe('repairAnalysisJson', ...)` block and add inside it):

```js
  it('repairs a response truncated mid-way through confidence_reasons, recovering the fields before it', () => {
    // Missing the closing ']' for confidence_reasons before trends starts.
    const broken = '{"one_liner": "x", "confidence": "medium", "confidence_reasons": ["fresh evidence", "trends": ["a"], "suggested_weights": {"deesc": 33, "base": 34, "stag": 33}, "weights_reasoning": "y", "tranche2": {"verdict": "wait", "reasoning": "z"}, "egp_read": "w"}';

    const repaired = repairAnalysisJson(broken);

    expect(repaired.one_liner).toBe('x');
    expect(repaired.confidence).toBe('medium');
    expect(repaired.suggested_weights).toEqual({ deesc: 33, base: 34, stag: 33 });
  });
```

Check the top of `tests/server/repair-analysis-json.test.mjs` for the existing import style (it should already be `import { repairAnalysisJson } from '../../server/routes/repairAnalysisJson.mjs';` — reuse it, don't add a duplicate import).

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/server/repair-analysis-json.test.mjs -t "confidence_reasons"`
Expected: FAIL — before this task's `EXPECTED_KEYS` change, `"confidence"` isn't a known marker, so the repair pass doesn't know to close `confidence_reasons` before `trends` starts, and the JSON stays malformed (`repaired` is `null`, so `repaired.one_liner` throws).

- [ ] **Step 4: Run test to verify it passes**

Since Step 1 already made the `EXPECTED_KEYS` change, run: `npx vitest run tests/server/repair-analysis-json.test.mjs`
Expected: PASS, including all pre-existing tests in the file.

- [ ] **Step 5: Add the field to the `AIResult` type**

In `src/App.tsx`, the `AIResult` type (lines 46-55) currently reads:

```ts
type AIResult = {
  one_liner?: string;
  trends?: string[];
  suggested_weights?: { deesc?: number; base?: number; stag?: number };
  weights_reasoning?: string;
  tranche2?: { verdict?: string; reasoning?: string };
  egp_read?: string;
  wallet_read?: string;
  watchlist_read?: string;
};
```

Change to:

```ts
type AIConfidenceLevel = 'low' | 'medium' | 'high';

type AIResult = {
  one_liner?: string;
  confidence?: AIConfidenceLevel;
  confidence_reasons?: string[];
  trends?: string[];
  suggested_weights?: { deesc?: number; base?: number; stag?: number };
  weights_reasoning?: string;
  tranche2?: { verdict?: string; reasoning?: string };
  egp_read?: string;
  wallet_read?: string;
  watchlist_read?: string;
};
```

- [ ] **Step 6: Add `confidence` handling to `normalizeAIResult`**

In `src/App.tsx`, `normalizeAIResult` (lines 210-244), add after the `oneLiner` line (line 213):

```ts
  const confidence = source.confidence === 'low' || source.confidence === 'medium' || source.confidence === 'high' ? source.confidence : fallback.confidence;
  const confidenceReasons = Array.isArray(source.confidence_reasons) && source.confidence_reasons.some((item: unknown) => typeof item === 'string' && item.trim())
    ? source.confidence_reasons.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
    : fallback.confidence_reasons;
```

And add both to the returned object (the `return { ... }` block at lines 234-243):

```ts
  return {
    one_liner: oneLiner,
    confidence,
    confidence_reasons: confidenceReasons,
    trends,
    suggested_weights: suggestedWeights,
    weights_reasoning: weightsReasoning,
    tranche2,
    egp_read: egpRead,
    wallet_read: walletRead,
    watchlist_read: watchlistRead,
  };
```

- [ ] **Step 7: Give the fallback analysis a `confidence`**

In `buildFallbackAnalysis` (`src/App.tsx:1014-1064`), the returned `fallback` object's first field is `one_liner`. Add right after it opens (right after the `const fallback = {` line, before `one_liner:`):

```ts
      confidence: 'low' as const,
      confidence_reasons: state.lang === 'ar'
        ? ['ده تحليل بديل محلي بدون بحث لحظي — مش من نموذج الذكاء الاصطناعي.']
        : ['This is a local fallback analysis with no live research behind it — not a model-generated read.'],
```

(The fallback is always `'low'` confidence because, by construction, it only ever runs when the real analysis call failed or returned unparseable text — see the `catch` block and the "no parseable JSON" branch in `analyze()`.)

- [ ] **Step 8: Add the field to the prompt's schema block**

In `src/App.tsx`, the prompt's JSON schema block (lines 1099-1106) currently starts:

```ts
{
  "one_liner": "<one-sentence bottom-line: what he should do or watch right now, and the single biggest reason why, in ${langName}>",
  "trends": [...
```

Change the opening to insert `confidence`/`confidence_reasons` right after `one_liner`:

```ts
{
  "one_liner": "<one-sentence bottom-line: what he should do or watch right now, and the single biggest reason why, in ${langName}>",
  "confidence": "<one of exactly: low | medium | high — NEVER an invented percentage like '85%'. Base this on: how fresh and mutually agreeing your search evidence is, whether the watchlist/wallet/DCA context you were given is complete, and whether the scenarios still disagree sharply with what you found>",
  "confidence_reasons": ["<1-3 short reasons for that confidence level, in ${langName}, e.g. 'evidence is same-day and consistent' or 'no wallet context supplied'>"],
  "trends": [...
```

- [ ] **Step 9: Render `confidence` in the UI**

In `src/App.tsx`, the render block for `state.ai.data.one_liner` (lines 1586-1589):

```tsx
                    <div>
                      <div className="section-label gold-text" style={{ marginBottom: 6 }}>{state.lang === 'ar' ? 'ملخص سريع' : 'Quick read'}</div>
                      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', lineHeight: 1.6 }}>{state.ai.data.one_liner}</div>
                    </div>
```

Change to add a confidence badge next to the heading, plus the reasons in expert mode only:

```tsx
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div className="section-label gold-text">{state.lang === 'ar' ? 'ملخص سريع' : 'Quick read'}</div>
                        {state.ai.data.confidence ? (
                          <span
                            className="font-mono"
                            style={{
                              fontSize: 11,
                              padding: '2px 8px',
                              borderRadius: 999,
                              border: '1px solid var(--border)',
                              color: state.ai.data.confidence === 'high' ? 'var(--up)' : state.ai.data.confidence === 'low' ? 'var(--down)' : 'var(--text)',
                            }}
                          >
                            {t.aiConfidenceLbl}: {t.aiConfidenceVal[state.ai.data.confidence]}
                          </span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', lineHeight: 1.6 }}>{state.ai.data.one_liner}</div>
                      {state.aiLevel === 'expert' && state.ai.data.confidence_reasons && state.ai.data.confidence_reasons.length ? (
                        <div className="muted-text" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
                          {state.ai.data.confidence_reasons.join(' · ')}
                        </div>
                      ) : null}
                    </div>
```

This checks `var(--up)`/`var(--down)`/`var(--border)`/`var(--text)` are existing CSS custom properties already used elsewhere in the file (confirm with `grep -n "var(--up)\|var(--down)" src/App.tsx` — both are used at line 1604's sibling styling and throughout the wallet section, so they exist).

- [ ] **Step 10: Add translation keys**

In `src/App.tsx`, the Arabic `t` object (the giant single-line literal containing `aiWatchH: 'قراءة لوحة المتابعة'`), add two new keys right after `aiWatchH: 'قراءة لوحة المتابعة',`:

```
aiConfidenceLbl: 'الثقة', aiConfidenceVal: { low: 'منخفضة', medium: 'متوسطة', high: 'عالية' },
```

In the English `t` object, add right after `aiWatchH: 'WATCHLIST READ',`:

```
aiConfidenceLbl: 'Confidence', aiConfidenceVal: { low: 'Low', medium: 'Medium', high: 'High' },
```

- [ ] **Step 11: Manual verification (no frontend test harness exists in this repo)**

Run: `npm run dev` (or the project's existing dev script — check `package.json` `scripts` if the name differs), open the app, go to the AI Analyst tab, and:
1. Click Analyze with a working provider configured. Confirm a confidence badge appears next to "Quick read" / "ملخص سريع".
2. Switch to Expert mode and re-analyze; confirm `confidence_reasons` render below the one-liner.
3. Switch to Beginner mode; confirm the reasons line is hidden but the badge still shows.
4. Disconnect the provider (or trigger a failure) and confirm the fallback analysis shows a "Low" confidence badge.
5. Toggle language to Arabic and confirm the badge label and value are in Arabic.

- [ ] **Step 12: Commit**

```bash
git add server/routes/repairAnalysisJson.mjs tests/server/repair-analysis-json.test.mjs src/App.tsx
git commit -m "feat: add confidence level and reasons to analyst output"
```

---

### Task 4: Wire DCA plan and wallet cost-basis into the prompt (`dca_read`)

**Files:**
- Modify: `server/routes/repairAnalysisJson.mjs:1` (`EXPECTED_KEYS`)
- Modify: `tests/server/repair-analysis-json.test.mjs`
- Modify: `src/App.tsx` — `AIResult` type, prompt template (`analyze()`), `normalizeAIResult`, `buildFallbackAnalysis`, render tree, both `t` objects

**Interfaces:**
- Consumes: `dcaPlan: { loading: boolean; error: string | null; data: DcaPlan | null }` (already in component state, `src/App.tsx:336`), `walletCostBasis: WalletCostBasis[]` (already in component state, `src/App.tsx:504`), `tranchePct: number[]`, `dcaTrancheOpen: boolean`, `trancheStatus: ('done'|'active'|'pending')[]`, `dcaWindows: {windowStart: Date; windowEnd: Date}[] | null` (all already computed in the component, `src/App.tsx:832-859`).
- Produces: `AIResult.dca_read?: string`, consumed only by the render tree in this task.

Confirmed gap from the codebase review: `fetchDcaPlan()` and `fetchWalletCostBasis()` are already called on mount and held in state, but the `analyze()` prompt at `src/App.tsx:1091-1107` never references them — the spec's §5 personalization contract explicitly calls out DCA installment status and cost basis as required personalization inputs this analysis is currently blind to.

- [ ] **Step 1: Add `dca_read` to the JSON-repair schema-aware key list**

In `server/routes/repairAnalysisJson.mjs`, extend the array from Task 3 — change:

```js
const EXPECTED_KEYS = ['one_liner', 'confidence', 'trends', 'suggested_weights', 'weights_reasoning', 'tranche2', 'egp_read', 'wallet_read', 'watchlist_read'];
```

to:

```js
const EXPECTED_KEYS = ['one_liner', 'confidence', 'trends', 'suggested_weights', 'weights_reasoning', 'tranche2', 'egp_read', 'wallet_read', 'dca_read', 'watchlist_read'];
```

(`dca_read` sits between `wallet_read` and `watchlist_read` to match where it's added to the prompt schema in Step 5 below.)

- [ ] **Step 2: Write the failing repair test**

Add to `tests/server/repair-analysis-json.test.mjs`:

```js
  it('repairs a response truncated mid-way through dca_read, recovering the fields around it', () => {
    // wallet_read value is missing its closing quote before dca_read starts.
    const broken = '{"one_liner": "x", "egp_read": "y", "wallet_read": "value cut off, "dca_read": "the DCA read", "watchlist_read": "z"}';

    const repaired = repairAnalysisJson(broken);

    expect(repaired.one_liner).toBe('x');
    expect(repaired.dca_read).toBe('the DCA read');
    expect(repaired.watchlist_read).toBe('z');
  });
```

- [ ] **Step 3: Run test to verify it fails, then passes**

Run: `npx vitest run tests/server/repair-analysis-json.test.mjs`

This one is subtle: an unterminated *string* value (not an unclosed array/object) isn't the failure mode `EXPECTED_KEYS`-based marker repair targets — that logic only closes open `{`/`[` containers, not dangling string values. Before asserting pass/fail, actually run it: if it fails, that is expected and correct — this specific broken-JSON shape (unterminated string value, not unterminated container) is a different failure mode than what `repairAnalysisJson` targets, and is **not** in scope for this task. If it fails, replace this test with a container-truncation example instead, matching the existing style used for `confidence_reasons` in Task 3:

```js
  it('repairs a response truncated mid-way through a dca_read-adjacent array, recovering dca_read', () => {
    // Missing the closing ']' for trends before dca_read starts (dca_read placed early for this test).
    const broken = '{"one_liner": "x", "trends": ["a", "dca_read": "the DCA read", "watchlist_read": "z"}';

    const repaired = repairAnalysisJson(broken);

    expect(repaired.one_liner).toBe('x');
    expect(repaired.dca_read).toBe('the DCA read');
  });
```

Run again: `npx vitest run tests/server/repair-analysis-json.test.mjs`
Expected: PASS, all tests in the file.

- [ ] **Step 4: Add `dca_read` to the `AIResult` type**

In `src/App.tsx`, extend the `AIResult` type from Task 3 by adding one line:

```ts
type AIResult = {
  one_liner?: string;
  confidence?: AIConfidenceLevel;
  confidence_reasons?: string[];
  trends?: string[];
  suggested_weights?: { deesc?: number; base?: number; stag?: number };
  weights_reasoning?: string;
  tranche2?: { verdict?: string; reasoning?: string };
  egp_read?: string;
  wallet_read?: string;
  dca_read?: string;
  watchlist_read?: string;
};
```

- [ ] **Step 5: Build the DCA context string in `analyze()`**

In `src/App.tsx`, inside `analyze()` (starting line 1067), after the existing `walletContext` block (lines 1088-1090):

```ts
    const walletContext = walletHasHoldings
      ? walletRows.filter((row) => row.amount > 0).map((row) => `${t[row.labelKey]}: ${row.amount}${row.key === 'pounds' ? '' : 'g'}`).join(', ')
      : null;
```

add:

```ts
    const dcaContext = (() => {
      if (!dcaPlan.data) return null;
      const parts = [`mode=${dcaPlan.data.mode}`, `total_investment_egp=${dcaPlan.data.total_investment_egp}`, `spacing_months=${dcaPlan.data.spacing_months}`, `tranche_split=${tranchePct.join('/')}%`];
      if (dcaWindows && trancheStatus.length) {
        const activeIndex = trancheStatus.indexOf('active');
        const nextPendingIndex = trancheStatus.indexOf('pending');
        if (activeIndex >= 0) {
          parts.push(`status=OPEN NOW, window ${formatTrancheWindow(dcaWindows[activeIndex].windowStart, dcaWindows[activeIndex].windowEnd)}, tranche ${activeIndex + 1} at ${tranchePct[activeIndex] ?? tranchePct[activeIndex % tranchePct.length]}% of budget`);
        } else if (nextPendingIndex >= 0) {
          parts.push(`status=next window ${formatTrancheWindow(dcaWindows[nextPendingIndex].windowStart, dcaWindows[nextPendingIndex].windowEnd)}`);
        } else {
          parts.push('status=all tranches complete');
        }
      }
      const costBasisParts = walletCostBasis
        .filter((cb) => cb.openQty > 0)
        .map((cb) => `${cb.unit}: avg cost ${fmt(cb.avgCostEgp)} EGP, open qty ${cb.openQty}`);
      if (costBasisParts.length) parts.push(`cost_basis=[${costBasisParts.join('; ')}]`);
      return parts.join(', ');
    })();
```

- [ ] **Step 6: Inject `dcaContext` into the prompt and add the conditional `dca_read` schema field**

In `src/App.tsx`, the prompt template currently has the `walletContext` injection followed directly by the "ANALYSIS DEPTH AND STYLE" line (lines 1096-1097). Insert the DCA line between them:

```ts
${walletContext ? `HIS PHYSICAL WALLET (what he actually owns today): ${walletContext}. Current value: ~${fmt(walletIntlValue)} EGP at the international price${walletEgyptValue !== null ? `, ~${fmt(walletEgyptValue)} EGP at the live Egyptian market price` : ''}. Write wallet_read as a fresh re-evaluation of THIS SPECIFIC holding given today's read — is it well-positioned given the scenario reassessment above, should he add, hold, or trim, and note if the international and Egyptian-market valuations of it diverge meaningfully.` : ''}
${dcaContext ? `HIS DCA (dollar-cost-averaging) PLAN: ${dcaContext}. Write dca_read as a concrete recommendation tied to the ACTUAL installment status above — if a tranche window is open, say so explicitly and whether today's read supports executing it on schedule or waiting a few days within the window; if the next window is in the future, say there's no action needed yet; reference his real average cost basis if given, and never suggest a tranche size beyond what his stated total_investment_egp and tranche_split actually allow.` : ''}
```

Then, in the schema block (after Task 3's edits, around lines 1105-1106), the current conditional-field pattern reads:

```ts
  "egp_read": "<how the EGP side of the hedge is doing, in ${langName}>"${walletContext ? `,\n  "wallet_read": "<re-evaluation of his physical wallet given today's read, in ${langName}>"` : ''}${watch ? `,\n  "watchlist_read": "<named walk-through of the watchlist variables and whether your research still backs the user's signal on each, in ${langName}>"` : ''}
```

Change to insert the `dca_read` conditional between `wallet_read` and `watchlist_read`:

```ts
  "egp_read": "<how the EGP side of the hedge is doing, in ${langName}>"${walletContext ? `,\n  "wallet_read": "<re-evaluation of his physical wallet given today's read, in ${langName}>"` : ''}${dcaContext ? `,\n  "dca_read": "<concrete DCA recommendation tied to his actual installment status and cost basis, in ${langName}>"` : ''}${watch ? `,\n  "watchlist_read": "<named walk-through of the watchlist variables and whether your research still backs the user's signal on each, in ${langName}>"` : ''}
```

- [ ] **Step 7: Add `dca_read` to `normalizeAIResult`**

In `normalizeAIResult` (`src/App.tsx:210-244`), add after the `walletRead` line:

```ts
  const dcaRead = typeof source.dca_read === 'string' && source.dca_read.trim() ? source.dca_read : fallback.dca_read;
```

And add it to the returned object, between `wallet_read` and `watchlist_read`:

```ts
    wallet_read: walletRead,
    dca_read: dcaRead,
    watchlist_read: watchlistRead,
```

- [ ] **Step 8: Give the fallback analysis a `dca_read` when a plan exists**

In `buildFallbackAnalysis` (`src/App.tsx:1014-1064`), add after the `wallet_read` field (which ends with `: undefined,` around line 1050):

```ts
      dca_read: dcaPlan.data
        ? (state.lang === 'ar'
            ? 'ده تحليل بديل محلي — راجع تبويب خطة الدخول التدريجي مباشرة عشان تعرف حالة الدفعة الحالية.'
            : 'This is a local fallback analysis — check the DCA Plan tab directly for your current tranche status.')
        : undefined,
```

- [ ] **Step 9: Render `dca_read` in the UI**

In `src/App.tsx`, the render tree currently has, in order: `weights` block, `tranche2` block, `egp_read` block, `wallet_read` block (lines 1613-1630), then `watchlist_read` block. Insert a `dca_read` block between `wallet_read` and `watchlist_read`:

```tsx
                    {state.ai.data.dca_read ? (
                      <div>
                        <div className="section-label gold-text" style={{ marginBottom: 6 }}>{t.aiDcaH}</div>
                        <div className="soft-text" style={{ fontSize: 15, lineHeight: 1.8 }}>{state.ai.data.dca_read}</div>
                      </div>
                    ) : null}
```

- [ ] **Step 10: Add translation keys**

Arabic `t` object, right after `aiWalletH: 'إعادة تقييم المحفظة',`:

```
aiDcaH: 'قراءة خطة الدخول التدريجي',
```

English `t` object, right after `aiWalletH: 'WALLET RE-EVALUATION',`:

```
aiDcaH: 'DCA PLAN READ',
```

- [ ] **Step 11: Manual verification**

Run: `npm run dev`, open the app:
1. With a DCA plan configured and a provider active, run Analyze. Confirm a "DCA PLAN READ" / "قراءة خطة الدخول التدريجي" section appears and references the actual tranche/installment status shown on the DCA tab.
2. Delete/reset the DCA plan (or test on a fresh account with none configured) and confirm the section does not appear and the prompt/schema simply omits `dca_read` (check the Network tab request body for `/api/analyze` — the prompt string should have no `HIS DCA` line).
3. With wallet transactions recorded (nonzero cost basis), confirm the DCA read or its context references the average cost basis correctly (cross-check against the numbers on the Wallet tab's "Profit/loss vs. what you paid" section).

- [ ] **Step 12: Commit**

```bash
git add server/routes/repairAnalysisJson.mjs tests/server/repair-analysis-json.test.mjs src/App.tsx
git commit -m "feat: wire DCA plan and cost-basis data into the analyst prompt"
```

---

### Task 5: Structure the numeric cockpit-state context as JSON instead of hand-written prose

**Files:**
- Modify: `src/App.tsx` — the prompt template's opening context line (`analyze()`, ~line 1091)

**Interfaces:**
- No new interfaces — this is a pure prompt-text change with no schema or type impact. Independent of Tasks 1-4; can be done in any order relative to them (placed last here because it's the lowest-priority item of the slice, per the earlier recommendation).

This is the smallest, lowest-value item in this slice, included because it was explicitly recommended: move the "LIVE COCKPIT STATE" line from hand-formatted prose into a small JSON object built the same way the schema-instruction block already is — so numeric context is machine-generated and future context-packet work (e.g. later adding portfolio/target fields) has a pattern to extend rather than more prose to hand-edit. This is intentionally **not** a full Layer-C context-packet rewrite (see "Deferred from the spec" above) — only the single line that was pure prose gets converted.

- [ ] **Step 1: Convert the LIVE COCKPIT STATE line to inline JSON**

In `src/App.tsx`, the prompt currently opens (line 1091):

```ts
    const prompt = `You are a senior precious-metals strategist advising a Cairo-based CIO. LIVE COCKPIT STATE - XAU/USD: ${state.spot}; USD/EGP: ${state.egp}; weighted target: ${Math.round(weightedTarget)}.
```

Change to:

```ts
    const cockpitState = {
      xau_usd: state.spot,
      usd_egp: state.egp,
      weighted_target_usd: Math.round(weightedTarget),
    };
    const prompt = `You are a senior precious-metals strategist advising a Cairo-based CIO. LIVE COCKPIT STATE (JSON): ${JSON.stringify(cockpitState)}.
`;
```

Note the trailing template-literal newline and the fact that the rest of the template literal (starting with `CURRENT SCENARIO FRAMEWORK...` on the next line) is unaffected — only the first line's construction changes, from a hand-interpolated string to a `JSON.stringify` call over a small typed object. Since `prompt` is declared with backtick continuation across many lines in the original (`src/App.tsx:1091-1107` is a single template literal), take care to keep this as the literal's opening line — do not close the template literal early. The safest edit is: replace only the substring `LIVE COCKPIT STATE - XAU/USD: ${state.spot}; USD/EGP: ${state.egp}; weighted target: ${Math.round(weightedTarget)}.` with `LIVE COCKPIT STATE (JSON): ${JSON.stringify(cockpitState)}.`, keeping the surrounding backtick-string structure completely intact, and add the `const cockpitState = {...};` declaration on its own line immediately before `const prompt = ...`.

- [ ] **Step 2: Manual verification**

Run: `npm run dev`, open the app, go to the AI Analyst tab, open the browser Network tab, click Analyze, and inspect the outgoing `/api/analyze` request body's `prompt` field. Confirm it now contains `LIVE COCKPIT STATE (JSON): {"xau_usd":...,"usd_egp":...,"weighted_target_usd":...}.` and that the analysis still returns and renders normally (the rest of the prompt and schema are untouched, so this should have no functional effect beyond the text of that one line).

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "refactor: emit LIVE COCKPIT STATE as JSON instead of hand-formatted prose"
```

---

### Task 6: Surface `validationWarnings` in the frontend

**Files:**
- Modify: `src/api/llmProviders.ts:115-122` (`analyzeViaBackend` return type)
- Modify: `src/App.tsx` — `analyze()` (destructure the new field), render tree (footer line, ~line 1637-1639)

**Interfaces:**
- Consumes: `validationWarnings: string[]` from Task 2's `/api/analyze` response.

Closes the loop on Task 2 — a warning that's computed server-side but never shown anywhere is not load-bearing. This surfaces it minimally, in the existing disclaimer footer, without building a dedicated warnings panel.

- [ ] **Step 1: Update the `analyzeViaBackend` type**

In `src/api/llmProviders.ts`, change:

```ts
export async function analyzeViaBackend(prompt: string): Promise<{ text: string; usedWebSearch: boolean }> {
```

to:

```ts
export async function analyzeViaBackend(prompt: string): Promise<{ text: string; usedWebSearch: boolean; validationWarnings: string[] }> {
```

- [ ] **Step 2: Thread `validationWarnings` through `analyze()` and into state**

In `src/App.tsx`, the `AppState['ai']` shape needs a place to hold this — find its type definition (search for `ai: {` inside the `AppState` type near line 69-onwards) and add `validationWarnings: string[]` alongside the existing `usedWebSearch`/`providerLabel` fields, mirroring their optionality.

In `analyze()`, the destructuring at line 1110:

```ts
      const { text, usedWebSearch } = await analyzeViaBackend(prompt);
```

Change to:

```ts
      const { text, usedWebSearch, validationWarnings } = await analyzeViaBackend(prompt);
```

And in the `setState` call that stores the successful result (lines 1134-1145), add `validationWarnings` alongside `usedWebSearch`:

```ts
      setState((prev) => ({
        ...prev,
        ai: {
          loading: false,
          error: null,
          data: parsed,
          at: new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
          applied: false,
          usedWebSearch,
          validationWarnings,
          providerLabel: `${activeProvider.label} · ${activeProvider.model}`,
        },
      }));
```

In the `catch` block's `setState` call (lines 1160-1171), add `validationWarnings: []` alongside the existing `usedWebSearch: false`.

- [ ] **Step 3: Render warnings in the footer**

In `src/App.tsx`, the existing footer line (lines 1637-1639):

```tsx
                    <div className="muted-text font-mono" style={{ fontSize: 13, borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
                      {state.ai.at || ''} {state.ai.providerLabel ? `· ${state.ai.providerLabel}` : ''} {state.ai.usedWebSearch ? '+ web search' : ''} · {t.aiDisc}
                    </div>
```

Change to add a warnings line above it, only when there are any:

```tsx
                    {state.ai.validationWarnings && state.ai.validationWarnings.length > 0 ? (
                      <div className="down-text" style={{ fontSize: 13, lineHeight: 1.6 }}>
                        {state.lang === 'ar' ? 'تنبيه فحص تلقائي: ' : 'Automated check flagged: '}
                        {state.ai.validationWarnings.join(' · ')}
                      </div>
                    ) : null}
                    <div className="muted-text font-mono" style={{ fontSize: 13, borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
                      {state.ai.at || ''} {state.ai.providerLabel ? `· ${state.ai.providerLabel}` : ''} {state.ai.usedWebSearch ? '+ web search' : ''} · {t.aiDisc}
                    </div>
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev`. This is hard to trigger organically (it needs a real model to actually violate the weights-sum-to-100 rule or hallucinate an evidence ID), so verify via a temporary local check instead: in the browser console on the AI Analyst tab, after an analysis has completed, run:
```js
// simulate what setState would do, to visually confirm rendering only —
// do not commit this, it's a manual check, not a code change
```
Actually the fastest real check: temporarily edit `checkWeightsSum` in `server/routes/validateAnalysis.mjs` to always return a fake warning (e.g. `return ['TEST WARNING']`), restart the dev server, click Analyze, confirm the red warning line renders above the footer, then revert that temporary edit (`git checkout -- server/routes/validateAnalysis.mjs` or manually undo it) before committing.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — no server test depends on the frontend, and no frontend test harness exists to break.

- [ ] **Step 6: Commit**

```bash
git add src/api/llmProviders.ts src/App.tsx
git commit -m "feat: surface validation warnings from the analyst response in the UI"
```

---

## Self-Review Notes

- **Spec coverage of this slice's own scope:** evidence citation requirement (§4) → Task 1; app-side deterministic checks (§11, narrowed to the two most actionable) → Task 2; confidence rules (§3.4) → Task 3; DCA/cost-basis personalization (§5) → Task 4; machine-generated context vs. hand-assembled prose (§2 Layer C, narrowed) → Task 5; warnings must actually reach the user to be load-bearing → Task 6.
- **Placeholder scan:** no "TBD"/"handle appropriately" steps; Task 4 Step 3 explicitly tells the executor what to do if the first test doesn't fail as expected, with a concrete fallback test rather than "adjust as needed."
- **Type/name consistency check:** `dca_read`, `confidence`, `confidence_reasons`, `AIConfidenceLevel`, `validationWarnings`, `cockpitState` are spelled identically everywhere they're introduced and consumed across Tasks 3-6. `EXPECTED_KEYS` ordering is kept consistent between Task 3 and Task 4 (Task 4 extends the exact array Task 3 produced, called out explicitly in Task 4 Step 1).
