# Analyst Data Contract v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the analyst's trust-me-it's-right output with a pipeline where the application computes every number, the model can only make claims it can point evidence at, and the app deterministically rejects, downgrades, or gates on anything it can't verify — before any further prompt-wording work resumes.

**Architecture:** The current pipeline is one hand-assembled prompt string per call, a model response trusted almost as-is, and non-fatal warnings bolted on after the fact. This plan replaces it with four layers, in order: (1) a typed, immutable `AnalysisSnapshot` computed entirely in application code from live state — no arithmetic left to the model; (2) a single evidence-gathering path shared by every provider (Claude's native agentic web-search tool is retired — it is both the main source of unbounded latency and a citation blind spot, since evidence IDs never existed for it); (3) a stricter response schema where every prose field is `{text, evidence_ids}` instead of a bare string, with one primary decision per time horizon; (4) a validator that can hard-fail the response, trigger one corrective re-prompt, and only then compute confidence and gate the UI — confidence is derived from validation outcomes, never taken from the model's own word.

**Tech Stack:** Same as the existing app — Express/Postgres backend (`server/`), Preact/TypeScript frontend (`src/App.tsx` and a new `src/lib/` module), Vitest for tests (server suite already exists; this plan adds the repo's first pure-function frontend/lib tests, which the existing `vitest.config.ts` already picks up with no changes since it has no `include` restriction).

**Spec:** This plan implements the reviewed 10-point recommendation from this conversation (reproduced in full below) plus the pre-existing `ANALYST-PROMPT-ENHANCEMENT-PLAN.md` (repo root) and the already-completed narrower slice at `docs/superpowers/plans/2026-09-15-analyst-prompt-enhancement-slice.md`, which this plan supersedes and extends (its `confidence`, `dca_read`, and evidence-ID groundwork survive into v2, restructured).

### The reviewed recommendation (binding requirements for this plan)

1. Calculate portfolio totals, unit conversions, local premium, scenario targets, and DCA status in application code.
2. Send the model one immutable, timestamped data snapshot.
3. Require strict JSON output with one primary decision per time horizon.
4. Attach a valid evidence ID to every current-market claim, percentage, event, and forecast.
5. Reject responses when weights, portfolio quantities, prices, or DCA installments conflict with the application data.
6. Calculate confidence after validation; unsupported responses must receive low confidence.
7. Disable "Apply weights" whenever evidence or consistency checks fail.
8. Prevent unsupported probabilities and price forecasts from appearing.
9. Add a 45-second timeout, progress stages, cancellation, and retry.
10. Differentiate Expert mode through calculations, sensitivity analysis, assumptions, and evidence — not simply longer text.

## Global Constraints

- **Item 4's literal reading ("every claim") is not mechanically provable** — the plan implements the strongest available approximation: every prose field becomes `{text, evidence_ids}`, and any field whose text contains a bare number/percentage/price pattern with an empty `evidence_ids` array is a **hard validation error**, not a style nit.
- **Item 8 is implemented as detection + confidence penalty + a visible warning, never silent text-mutation.** Programmatically deleting substrings from model prose risks corrupting sentences; refusing to trust an unlinked claim is safer and more honest than surgically editing it.
- **Item 9's 45s budget only becomes achievable after Task 3 retires Claude's native agentic web-search tool.** That tool can run several searches inside one open-ended HTTP call with no visibility until it returns — the actual cause of multi-minute waits today. Every provider, Claude included, must go through the same bounded SerpAPI evidence pack after this plan.
- **Progress stages are elapsed-time-driven synthetic labels on the frontend, not real server-pushed events.** Adding Server-Sent Events or WebSockets for true progress push is out of scope — it's real infrastructure for a cosmetic improvement; elapsed-time labels are honest enough since they don't claim to reflect real backend state, only "roughly where we are."
- **Every provider (`claude`, `shared`, `openai`, `openrouter`, `ollama`, custom) must keep working.** None of them can be assumed to support native structured-output/JSON mode — the JSON-repair safety net (`repairAnalysisJson.mjs`) and the retry-on-validation-failure path (Task 8) are what make weaker providers usable, not a provider-side guarantee.
- **No new backend dependencies, no new database tables/migrations.** This is application-logic and schema work, not infrastructure.
- **All user-visible AI output stays in the requested locale** (`ar-EG` colloquial or English) — this is unchanged from the existing constraint and applies to every new prose field.
- **`suggested_weights` must still sum to 100** for `applyAI()` to work — Task 7 tightens this from a warning to a hard validation error (current ±1 rounding tolerance is preserved as the only allowed slack).

---

## File Structure

- `src/lib/analyst.ts` — **new file.** Everything currently living inside `src/App.tsx`'s `analyze()`/`normalizeAIResult()`/`buildFallbackAnalysis()`/`extractFieldsFromBrokenJson()` moves here, extended for schema v2. `App.tsx` imports from it. This exists because every later task in this plan touches this logic, and doing that inside an already-2500-line file repeatedly is the kind of risk the file-structure guidance exists to avoid.
- `src/lib/analysisSnapshot.ts` — **new file.** Pure functions computing the `AnalysisSnapshot` (portfolio totals, unit conversions, local premium, scenario targets, DCA status) from component state — item 1 and 2 of the recommendation, in one place, unit-tested.
- `tests/client/analysisSnapshot.test.ts` — **new file.** First frontend/lib unit tests in this repo. `vitest.config.ts` has no `include` restriction, so this is picked up by the existing `npm test` with no config change.
- `server/routes/validateAnalysis.mjs` — rewritten for v2: hard-fail checks (weights, evidence-linking, cross-checked amounts) plus `computeConfidence()`.
- `tests/server/validate-analysis.test.mjs` — extended for the new v2 checks.
- `server/routes/analyze.mjs` — adds the retry-on-validation-failure loop; evidence-pack generation becomes unconditional on `isWebSearchEnabled`, no longer gated by provider type.
- `server/providers/dispatch.mjs`, `server/providers/claude.mjs` — native web-search tool path removed (Task 3).
- `src/App.tsx` — imports from `src/lib/analyst.ts` and `src/lib/analysisSnapshot.ts`; render tree updated for the new `{text, evidence_ids}` shape, horizon actions, gating, timeout/progress/cancel UI, and Expert-mode sensitivity table.

---

### Task 1: Extract analyst logic out of `src/App.tsx` into `src/lib/analyst.ts`

**Files:**
- Create: `src/lib/analyst.ts`
- Modify: `src/App.tsx` (remove the extracted code, import from the new module)
- Test: none required — this is a pure extraction with no behavior change; the existing server test suite and a manual `tsc -b`/`vite build` are the verification.

**Interfaces:**
- Produces: `src/lib/analyst.ts` exports everything Tasks 4-6 will extend: the `AIResult` type (and its `AIConfidenceLevel` companion), `normalizeAIResult()`, `buildFallbackAnalysis()`, `extractFieldsFromBrokenJson()`, `tryParseJson()`, `stripJsonFences()`. Exact current signatures (do not change behavior in this task):
  ```ts
  export type AIConfidenceLevel = 'low' | 'medium' | 'high';
  export type AIResult = {
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
  export function normalizeAIResult(payload: unknown, fallback: AIResult): AIResult;
  export function extractFieldsFromBrokenJson(text: string): Record<string, unknown> | null;
  export function stripJsonFences(text: string): string;
  export function tryParseJson(text: string): unknown; // find this helper's current name/location in App.tsx by searching — it wraps JSON.parse with try/catch for the `analyze()` call site
  ```
  `buildFallbackAnalysis` currently closes over several pieces of component state (`state.lang`, `state.weights`, `state.spot`, `walletHasHoldings`, `walletIntlValue`, `walletEgyptValue`, `state.monitors`, `dcaPlan.data`) — rather than exporting it as a closure, change its signature to take those as explicit parameters, since a module-level function should not implicitly depend on a React/Preact component's closure:
  ```ts
  export function buildFallbackAnalysis(input: {
    lang: 'ar' | 'en';
    weights: { deesc: number; base: number; stag: number };
    spot: number;
    weightedTarget: number;
    walletHasHoldings: boolean;
    walletIntlValue: number;
    walletEgyptValue: number | null;
    monitors: { ar: string; en: string; sig: 0 | 1 | 2 }[];
    dcaPlanData: import('../api/dcaPlan').DcaPlan | null;
  }): AIResult;
  ```

- [ ] **Step 1: Move the four functions and the `AIResult`/`AIConfidenceLevel` types verbatim into `src/lib/analyst.ts`**, adjusting only `buildFallbackAnalysis`'s signature as specified above (its internal logic — the `deltaPct` calculation, the bilingual strings, the `dca_read` conditional — is unchanged; only how it receives its inputs changes from closure-capture to parameters).

- [ ] **Step 2: Update `src/App.tsx`'s call site.** Replace `buildFallbackAnalysis(weightedTarget)` with `buildFallbackAnalysis({ lang: state.lang, weights: state.weights, spot: state.spot, weightedTarget, walletHasHoldings, walletIntlValue, walletEgyptValue, monitors: state.monitors, dcaPlanData: dcaPlan.data })`, and add the import: `import { normalizeAIResult, buildFallbackAnalysis, extractFieldsFromBrokenJson, tryParseJson, stripJsonFences, type AIResult, type AIConfidenceLevel } from './lib/analyst';` — remove the old in-file definitions of all of these.

- [ ] **Step 3: Verify no behavior changed.**

Run: `npx tsc -b && npx vite build`
Expected: clean, no errors.

Run: `npm test`
Expected: unchanged pass count from before this task (this touches no server file).

- [ ] **Step 4: Commit**

```bash
git add src/lib/analyst.ts src/App.tsx
git commit -m "refactor: extract analyst response handling out of App.tsx into src/lib/analyst.ts"
```

---

### Task 2: `AnalysisSnapshot` — compute everything in application code

**Files:**
- Create: `src/lib/analysisSnapshot.ts`
- Test: `tests/client/analysisSnapshot.test.ts`

**Interfaces:**
- Consumes: nothing beyond plain JS/TS values passed in — this module has zero dependency on Preact, component state shape, or the DOM, by design (testable in isolation).
- Produces: `AnalysisSnapshot` type and `buildAnalysisSnapshot(input: BuildSnapshotInput): AnalysisSnapshot`, consumed by Task 5's prompt builder and Task 7's validator.

This is items 1 and 2 of the recommendation: every number the model would otherwise have to compute or infer — local premium, the implied "gold-market dollar," wallet totals, DCA window status — is computed here, once, in application code, and handed to the model as a fact, not a homework problem.

- [ ] **Step 1: Write the failing tests**

Create `tests/client/analysisSnapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildAnalysisSnapshot } from '../../src/lib/analysisSnapshot';

const baseInput = {
  generatedAt: '2026-09-15T10:00:00.000Z',
  locale: 'en' as const,
  explanationLevel: 'expert' as const,
  spot: 2650,
  egp: 48.5,
  weightedTarget: 2700,
  scenarios: [
    { key: 'deesc' as const, nameEn: 'Geopolitical Changes', weightPct: 35, priceLo: 2400, priceHi: 2600, thesis: 'Tensions ease' },
    { key: 'base' as const, nameEn: 'Base Case', weightPct: 45, priceLo: 2600, priceHi: 2800, thesis: 'CB buying continues' },
    { key: 'stag' as const, nameEn: 'Stagflation Trap', weightPct: 20, priceLo: 2200, priceHi: 2500, thesis: 'Forced selling' },
  ],
  egypt: null,
  wallet: { hasHoldings: false, holdings: {}, intlValueEgp: 0, egyptValueEgp: null, costBasis: [] },
  dca: null,
  watchlist: [],
};

describe('buildAnalysisSnapshot', () => {
  it('is a plain JSON-serializable object with a schema_version and generated_at', () => {
    const snapshot = buildAnalysisSnapshot(baseInput);
    expect(snapshot.schema_version).toBe('1');
    expect(snapshot.generated_at).toBe('2026-09-15T10:00:00.000Z');
    expect(() => JSON.stringify(snapshot)).not.toThrow();
  });

  it('carries market numbers through untouched', () => {
    const snapshot = buildAnalysisSnapshot(baseInput);
    expect(snapshot.market).toEqual({ xau_usd: 2650, usd_egp: 48.5, weighted_target_usd: 2700 });
  });

  it('omits egypt when no snapshot is available', () => {
    const snapshot = buildAnalysisSnapshot(baseInput);
    expect(snapshot.egypt).toBeNull();
  });

  it('computes the local premium and implied gold-market dollar when Egypt prices are available', () => {
    // 24k sell of 4200 EGP/gram; theoretical intl price = (spot / 31.1035) * usd_egp
    const withEgypt = {
      ...baseInput,
      egypt: {
        retrievedAt: '2026-09-15T09:55:00.000Z',
        rows: [{ karat: '24k' as const, sell: 4200, buy: 4180 }],
      },
    };
    const snapshot = buildAnalysisSnapshot(withEgypt);
    expect(snapshot.egypt).not.toBeNull();
    const theoreticalIntlPerGram = (2650 / 31.1035) * 48.5;
    expect(snapshot.egypt!.implied_gold_market_usd_egp).toBeCloseTo(4200 / (2650 / 31.1035), 2);
    expect(snapshot.egypt!.local_premium_pct).toBeCloseTo(((4200 - theoreticalIntlPerGram) / theoreticalIntlPerGram) * 100, 2);
  });

  it('computes DCA status as open_now when the active window covers now', () => {
    const withDca = {
      ...baseInput,
      dca: {
        mode: 'fixed' as const,
        spacingMonths: 2,
        tranchePcts: [40, 35, 25],
        totalInvestmentEgp: 30000,
        monthlyInvestmentEgp: null,
        trancheStatus: ['done', 'active', 'pending'] as const,
        activeIndex: 1,
        nextPendingIndex: 2,
        windowStart: '2026-08-01T00:00:00.000Z',
        windowEnd: '2026-10-01T00:00:00.000Z',
      },
    };
    const snapshot = buildAnalysisSnapshot(withDca);
    expect(snapshot.dca).toEqual({
      mode: 'fixed',
      spacing_months: 2,
      tranche_split_pct: [40, 35, 25],
      monthly_investment_egp: null,
      total_investment_egp: 30000,
      status: 'open_now',
      window: { start: '2026-08-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
      active_tranche_index: 1,
    });
  });

  it('computes DCA status as next_window when nothing is active yet', () => {
    const withDca = {
      ...baseInput,
      dca: {
        mode: 'recurring' as const,
        spacingMonths: 1,
        tranchePcts: null,
        totalInvestmentEgp: null,
        monthlyInvestmentEgp: 5000,
        trancheStatus: ['pending'] as const,
        activeIndex: -1,
        nextPendingIndex: 0,
        windowStart: '2026-10-01T00:00:00.000Z',
        windowEnd: '2026-11-01T00:00:00.000Z',
      },
    };
    const snapshot = buildAnalysisSnapshot(withDca);
    expect(snapshot.dca!.status).toBe('next_window');
    expect(snapshot.dca!.active_tranche_index).toBeNull();
    expect(snapshot.dca!.monthly_investment_egp).toBe(5000);
    expect(snapshot.dca!.total_investment_egp).toBeNull();
  });

  it('rounds computed percentages and prices to 2 decimal places, never emitting float noise', () => {
    const withEgypt = {
      ...baseInput,
      egypt: { retrievedAt: '2026-09-15T09:55:00.000Z', rows: [{ karat: '24k' as const, sell: 4213.37, buy: 4180 }] },
    };
    const snapshot = buildAnalysisSnapshot(withEgypt);
    const str = JSON.stringify(snapshot.egypt!.local_premium_pct);
    expect(str.split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/analysisSnapshot.test.ts`
Expected: FAIL — "Cannot find module '../../src/lib/analysisSnapshot'".

- [ ] **Step 3: Implement `src/lib/analysisSnapshot.ts`**

```ts
const OZ_GRAMS = 31.1035;

export type SnapshotScenario = {
  key: 'deesc' | 'base' | 'stag';
  nameEn: string;
  weightPct: number;
  priceLo: number;
  priceHi: number;
  thesis: string;
};

export type SnapshotEgyptInput = {
  retrievedAt: string;
  rows: { karat: '24k' | '22k' | '21k' | '18k' | 'gold_pound'; sell: number; buy: number }[];
};

export type SnapshotWalletInput = {
  hasHoldings: boolean;
  holdings: Record<string, number>;
  intlValueEgp: number;
  egyptValueEgp: number | null;
  costBasis: { unit: string; avgCostEgp: number; openQty: number; realizedEgp: number }[];
};

export type SnapshotDcaInput = {
  mode: 'fixed' | 'recurring';
  spacingMonths: number;
  tranchePcts: number[] | null;
  totalInvestmentEgp: number | null;
  monthlyInvestmentEgp: number | null;
  trancheStatus: readonly ('done' | 'active' | 'pending')[];
  activeIndex: number;
  nextPendingIndex: number;
  windowStart: string | null;
  windowEnd: string | null;
};

export type BuildSnapshotInput = {
  generatedAt: string;
  locale: 'ar' | 'en';
  explanationLevel: 'beginner' | 'expert';
  spot: number;
  egp: number;
  weightedTarget: number;
  scenarios: SnapshotScenario[];
  egypt: SnapshotEgyptInput | null;
  wallet: SnapshotWalletInput;
  dca: SnapshotDcaInput | null;
  watchlist: { id: string; label: string; signal: 'supportive' | 'watch' | 'risk' }[];
};

export type AnalysisSnapshot = {
  schema_version: '1';
  generated_at: string;
  locale: 'ar' | 'en';
  explanation_level: 'beginner' | 'expert';
  market: { xau_usd: number; usd_egp: number; weighted_target_usd: number };
  scenarios: { key: string; name_en: string; weight_pct: number; price_lo: number; price_hi: number; thesis: string }[];
  egypt: {
    retrieved_at: string;
    rows: { karat: string; sell: number; buy: number }[];
    implied_gold_market_usd_egp: number | null;
    local_premium_pct: number | null;
  } | null;
  wallet: {
    has_holdings: boolean;
    holdings: Record<string, number>;
    value_intl_egp: number;
    value_egypt_egp: number | null;
    cost_basis: { unit: string; avg_cost_egp: number; open_qty: number; realized_egp: number }[];
  };
  dca: {
    mode: 'fixed' | 'recurring';
    spacing_months: number;
    tranche_split_pct: number[] | null;
    monthly_investment_egp: number | null;
    total_investment_egp: number | null;
    status: 'open_now' | 'next_window' | 'all_complete';
    window: { start: string; end: string } | null;
    active_tranche_index: number | null;
  } | null;
  watchlist: { id: string; label: string; signal: 'supportive' | 'watch' | 'risk' }[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildEgypt(input: SnapshotEgyptInput | null, spot: number, egp: number): AnalysisSnapshot['egypt'] {
  if (!input) return null;
  const row24k = input.rows.find((r) => r.karat === '24k');
  const theoreticalIntlPerGram = (spot / OZ_GRAMS) * egp;
  const impliedRate = row24k && theoreticalIntlPerGram > 0 ? row24k.sell / (spot / OZ_GRAMS) : null;
  const premiumPct = row24k && theoreticalIntlPerGram > 0
    ? ((row24k.sell - theoreticalIntlPerGram) / theoreticalIntlPerGram) * 100
    : null;
  return {
    retrieved_at: input.retrievedAt,
    rows: input.rows.map((r) => ({ karat: r.karat, sell: r.sell, buy: r.buy })),
    implied_gold_market_usd_egp: impliedRate === null ? null : round2(impliedRate),
    local_premium_pct: premiumPct === null ? null : round2(premiumPct),
  };
}

function buildDca(input: SnapshotDcaInput | null): AnalysisSnapshot['dca'] {
  if (!input) return null;
  const status: 'open_now' | 'next_window' | 'all_complete' =
    input.activeIndex >= 0 ? 'open_now' : input.nextPendingIndex >= 0 ? 'next_window' : 'all_complete';
  return {
    mode: input.mode,
    spacing_months: input.spacingMonths,
    tranche_split_pct: input.tranchePcts,
    monthly_investment_egp: input.monthlyInvestmentEgp,
    total_investment_egp: input.totalInvestmentEgp,
    status,
    window: input.windowStart && input.windowEnd && status !== 'all_complete'
      ? { start: input.windowStart, end: input.windowEnd }
      : null,
    active_tranche_index: input.activeIndex >= 0 ? input.activeIndex : null,
  };
}

export function buildAnalysisSnapshot(input: BuildSnapshotInput): AnalysisSnapshot {
  return {
    schema_version: '1',
    generated_at: input.generatedAt,
    locale: input.locale,
    explanation_level: input.explanationLevel,
    market: { xau_usd: input.spot, usd_egp: input.egp, weighted_target_usd: input.weightedTarget },
    scenarios: input.scenarios.map((s) => ({
      key: s.key,
      name_en: s.nameEn,
      weight_pct: s.weightPct,
      price_lo: s.priceLo,
      price_hi: s.priceHi,
      thesis: s.thesis,
    })),
    egypt: buildEgypt(input.egypt, input.spot, input.egp),
    wallet: {
      has_holdings: input.wallet.hasHoldings,
      holdings: input.wallet.holdings,
      value_intl_egp: round2(input.wallet.intlValueEgp),
      value_egypt_egp: input.wallet.egyptValueEgp === null ? null : round2(input.wallet.egyptValueEgp),
      cost_basis: input.wallet.costBasis.map((cb) => ({
        unit: cb.unit,
        avg_cost_egp: round2(cb.avgCostEgp),
        open_qty: cb.openQty,
        realized_egp: round2(cb.realizedEgp),
      })),
    },
    dca: buildDca(input.dca),
    watchlist: input.watchlist,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/analysisSnapshot.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analysisSnapshot.ts tests/client/analysisSnapshot.test.ts
git commit -m "feat: compute the analyst's data snapshot entirely in application code"
```

---

### Task 3: Retire Claude's native web-search tool — one evidence path for every provider

**Files:**
- Modify: `server/providers/claude.mjs` (remove the `allowWebSearch`/`withTools` branching)
- Modify: `server/providers/dispatch.mjs` (stop passing `allowWebSearch`)
- Modify: `server/routes/analyze.mjs` (evidence-pack generation no longer conditioned on provider type — only on the existing `isWebSearchEnabled` per-provider toggle)
- Test: `tests/server/claude-provider.test.mjs`, `tests/server/dispatch.test.mjs`, `tests/server/analyze-route.test.mjs`

**Interfaces:**
- Produces: `callClaude({ apiKey, model, prompt, temperature, maxTokens, expectJson, system })` — the `allowWebSearch` parameter is removed entirely (breaking change to this internal function's signature; both call sites in `dispatch.mjs` are updated in this task).

This is the fix for item 9's timeout requirement and closes the gap the last review surfaced ("the evidence machinery is inert for `provider_type: claude`") in one move: Claude's native agentic `web_search` tool can run several searches inside a single open-ended HTTP call with no evidence IDs and no bound on latency. After this task, every provider — Claude included — gets its evidence from the same bounded, ID-tagged SerpAPI pack `analyze.mjs` already builds for non-Claude providers.

- [ ] **Step 1: Simplify `callClaude` in `server/providers/claude.mjs`**

Read the current file first — it has an `allowWebSearch` parameter, a `withTools`-conditional `tools: [{ type: 'web_search_20250305', name: 'web_search' }]` body field, and a try/catch that retries without tools if the tool-enabled call fails. Remove all of it. The function should always call `callAnthropic` with no tools, keeping only the pre-existing "if the response has no `{`, ask for JSON only" retry (that retry is unrelated to search — it exists because a model can respond with commentary before its JSON regardless of tools). The simplified function:

```js
export async function callClaude({ apiKey, model, prompt, temperature, maxTokens, expectJson = true, system }) {
  let messages = [{ role: 'user', content: prompt }];
  const usage = { input_tokens: 0, output_tokens: 0 };
  const addUsage = (d) => {
    if (!d?.usage) return;
    usage.input_tokens += d.usage.input_tokens || 0;
    usage.output_tokens += d.usage.output_tokens || 0;
  };

  let data = await callAnthropic({ apiKey, model, messages, withTools: false, temperature, maxTokens, system });
  addUsage(data);

  let text = extractText(data?.content);
  if (expectJson && !text.includes('{')) {
    messages = [
      ...messages,
      { role: 'assistant', content: data.content },
      { role: 'user', content: 'Output ONLY the final JSON object now.' },
    ];
    data = await callAnthropic({ apiKey, model, messages, withTools: false, temperature, maxTokens, system });
    addUsage(data);
    text = extractText(data?.content);
  }

  return { text, usedWebSearch: false, usage };
}
```

`usedWebSearch` stays in the return shape (set to `false` always now) since callers destructure it — check `dispatch.mjs` and `analyze.mjs` for how it's currently consumed before deciding whether to keep or drop the field; keeping it `false` is simpler than touching every call site's destructuring.

Also remove the now-unused `withTools` parameter handling inside `callAnthropic` if `withTools` is never passed as `true` anywhere after this change — check whether any other caller still passes `withTools: true`; if not, simplify `callAnthropic`'s signature too (drop `withTools`, drop the `if (withTools) body.tools = ...` line).

- [ ] **Step 2: Update `server/providers/dispatch.mjs`**

Find the `if (providerRow.provider_type === 'claude')` block calling `callClaude`. Remove the `allowWebSearch: isWebSearchEnabled(providerRow),` line — `callClaude` no longer accepts that parameter. The `isWebSearchEnabled` export itself stays (it's still consumed by `analyze.mjs` to decide whether to run the SerpAPI evidence pack at all — see Step 3).

The `shared` tier's call site already passes no `allowWebSearch` after `callClaude`'s signature change (it previously passed `allowWebSearch: false` explicitly) — remove that now-nonexistent parameter from that call site too.

- [ ] **Step 3: Update `server/routes/analyze.mjs` — evidence-pack generation for every provider**

Find `NATIVE_SEARCH_PROVIDER_TYPES` and the `usesNativeSearch` variable in the POST handler. Remove `NATIVE_SEARCH_PROVIDER_TYPES` entirely (dead constant after this change) and simplify the condition that decides whether to run `augmentPromptWithSearch`:

Before (current code, paraphrased — read the actual file to match current line content, it has shifted since the version described here):
```js
const usesNativeSearch = NATIVE_SEARCH_PROVIDER_TYPES.has(provider.provider_type);
const webSearchEnabled = isWebSearchEnabled(provider);
if (!usesNativeSearch && webSearchEnabled) {
  const augmented = await augmentPromptWithSearch(prompt);
  effectivePrompt = augmented.prompt;
  injectedWebSearch = augmented.usedWebSearch;
  evidenceIds = augmented.evidenceIds;
}
```

After:
```js
const webSearchEnabled = isWebSearchEnabled(provider);
if (webSearchEnabled) {
  const augmented = await augmentPromptWithSearch(prompt);
  effectivePrompt = augmented.prompt;
  injectedWebSearch = augmented.usedWebSearch;
  evidenceIds = augmented.evidenceIds;
}
```

And the line setting `result.usedWebSearch` — currently conditioned on `if (!usesNativeSearch)` — becomes unconditional (`result.usedWebSearch = injectedWebSearch;` with no `if` around it), since every provider now goes through the same injected-search path.

- [ ] **Step 4: Update tests**

`tests/server/claude-provider.test.mjs`: remove/update any test asserting `allowWebSearch`/tool-use behavior — replace with tests confirming `callClaude` never sends a `tools` field and never retries with tools. Follow the existing file's mocking pattern (search for how `fetch` is stubbed in that file already).

`tests/server/dispatch.test.mjs`: remove any assertion that `callClaude` was called with `allowWebSearch`.

`tests/server/analyze-route.test.mjs`: find the test at `describe('POST /api/analyze — web search augmentation for non-native-search providers', ...)` (its own name is now stale — this task makes search augmentation apply to *every* provider, native or not). Update its describe block name to drop "non-native-search", and find/update the test `'does not search for providers with native web search (claude only...)'` — this test's premise no longer holds; replace it with a test asserting `augmentPromptWithSearch` (and thus `searchWeb`) **is** called for a `claude` provider too, the same as any other provider type, gated only by `isWebSearchEnabled`.

- [ ] **Step 5: Run the full server suite**

Run: `npm test`
Expected: PASS, all tests (count will differ slightly from before this task due to the test changes in Step 4 — confirm 0 failures, not a specific count).

- [ ] **Step 6: Commit**

```bash
git add server/providers/claude.mjs server/providers/dispatch.mjs server/routes/analyze.mjs tests/server/claude-provider.test.mjs tests/server/dispatch.test.mjs tests/server/analyze-route.test.mjs
git commit -m "refactor: retire Claude's native web-search tool, unify evidence gathering across all providers"
```

---

### Task 4: Schema v2 types — `{text, evidence_ids}` claim fields and per-horizon decisions

**Files:**
- Modify: `src/lib/analyst.ts` (extend the types added in Task 1)

**Interfaces:**
- Produces: the types every subsequent task (5, 6, 7, 9, 10, 12) reads and writes against.

```ts
export type ClaimField = { text: string; evidence_ids: string[] };

export type HorizonKey = 'now' | 'next_event' | 'strategic';

export type PrimaryDecisionAction = 'buy' | 'hold' | 'wait' | 'reduce' | 'review' | 'insufficient_evidence';

export type PrimaryDecision = {
  action: PrimaryDecisionAction;
  horizon: HorizonKey;
  headline: string;
  confidence: AIConfidenceLevel;
  reasons: ClaimField[];
};

export type HorizonAction = {
  horizon: HorizonKey;
  action: string;
  condition: string;
};

export type AIResultV2 = {
  schema_version: '2';
  primary_decision: PrimaryDecision;
  horizon_actions: HorizonAction[];
  suggested_weights: { deesc: number; base: number; stag: number };
  weights_reasoning: ClaimField;
  egp_read: ClaimField;
  wallet_read?: ClaimField;
  dca_read?: ClaimField;
  watchlist_read?: ClaimField;
  assumptions: string[];
  missing_inputs: string[];
  validation?: { ok: boolean; errors: string[] }; // attached by the app after validation, never by the model — see Task 8
};
```

- [ ] **Step 1: Add these types to `src/lib/analyst.ts`**, alongside the v1 `AIResult`/`AIConfidenceLevel` types added in Task 1. Do not delete `AIResult` (v1) yet — Task 6 handles the render-tree migration in the same commit as the parser, so both types briefly coexist only within Task 6's own diff, not across commits.

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc -b`
Expected: clean (these are additive type declarations with no consumers yet, so nothing can fail to typecheck against them).

- [ ] **Step 3: Commit**

```bash
git add src/lib/analyst.ts
git commit -m "feat: add schema v2 types — claim fields with evidence IDs, per-horizon decisions"
```

---

### Task 5: Prompt builder v2 — send the snapshot, require schema v2 output

**Files:**
- Modify: `src/lib/analyst.ts` (new exported function `buildAnalysisPrompt`)
- Modify: `src/App.tsx` (`analyze()` calls the new builder instead of assembling the prompt inline)

**Interfaces:**
- Consumes: `AnalysisSnapshot` (Task 2), evidence pack context is still injected server-side (Task 3) — the client-built prompt only carries the snapshot and the schema/instructions; the server's `augmentPromptWithSearch` continues to prepend the evidence block ahead of whatever prompt string the client sends, unchanged in shape from today.
- Produces: `buildAnalysisPrompt(snapshot: AnalysisSnapshot, watchlist: {...}[]): string`, consumed by `analyze()`.

This replaces the current hand-assembled template literal (the one Task 5 of the prior plan partially JSON-ified) with a version built entirely around the snapshot object, and rewrites the schema instructions for the v2 shape.

- [ ] **Step 1: Write `buildAnalysisPrompt` in `src/lib/analyst.ts`**

The function takes the already-computed `AnalysisSnapshot` and produces the prompt string. Structure it in two parts: a fixed instructions block, then the snapshot as JSON. Follow the existing prompt's voice and the localization/beginner-vs-expert branching already present in the current `analyze()` (read it before removing it — the "senior precious-metals strategist" framing, the beginner/expert style paragraph, and the watchlist walk-through instruction are all still correct and should carry over near-verbatim). What changes structurally:

- The opening context line becomes: `` `You are a senior precious-metals strategist advising a Cairo-based CIO. Treat the following DATA SNAPSHOT as ground truth — it was computed by the application, not you; never recompute, override, or second-guess any number in it. Cite it, don't derive from it: ${JSON.stringify(snapshot)}` ``.
- Every existing "use your live web search to verify X" instruction stays (Task 3 means every provider now receives injected, ID-tagged evidence ahead of this prompt regardless of type) — but the citation instruction tightens: **every** `ClaimField.text` that states a number, percentage, price, or dated event must have that claim's supporting `evidence_id`(s) in the field's `evidence_ids` array; a field with no time-sensitive claim in it may have an empty `evidence_ids` array, but never a claim with an empty array.
- The schema block changes to the v2 shape from Task 4. Each `ClaimField`-typed field in the schema instructions is written as:
  ```
  "egp_read": { "text": "<how the EGP side of the hedge is doing, in ${langName}>", "evidence_ids": ["<EV-XXX for every number/date/event stated above, or [] if none>"] }
  ```
  `wallet_read`, `dca_read`, `watchlist_read` keep their existing conditional-inclusion pattern (only present in the schema when the corresponding snapshot section is non-null/there's a watchlist).
  `primary_decision.reasons` is an array of `ClaimField`, 1-3 entries, each the "event AND what it means for him" pattern the current `trends` instruction already asks for — this field replaces `trends` (a bare string array) entirely; do not keep both.
  `horizon_actions` gets its own explicit instruction: "If your action differs across the `now`/`next_event`/`strategic` horizons, list each differing horizon here with its own action and the condition that would trigger a shift; if they don't differ, this array may be empty or contain one entry restating the primary decision — never contradict `primary_decision` without explaining why in `weights_reasoning` or a `horizon_actions` entry's `condition`."
  `assumptions` and `missing_inputs`: "List anything you assumed because the snapshot didn't specify it, and anything you'd need to know to be more confident — an empty array for either is fine and expected when nothing is missing."

- [ ] **Step 2: Update `analyze()` in `src/App.tsx`** to build the `AnalysisSnapshot` (via `buildAnalysisSnapshot` from Task 2, assembling its `BuildSnapshotInput` from the same component state currently scattered across the existing prompt-building code — `state.spot`, `state.egp`, `weightedTarget`, `SCEN_META`/`state.weights`, `egyptSnapshot`, wallet state, `dcaPlan.data`/`tranchePct`/`dcaWindows`/`trancheStatus`, `state.monitors`) and pass it to `buildAnalysisPrompt`. Remove the old inline template-literal prompt construction entirely.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, open the AI Analyst tab, trigger an analysis, and inspect the outgoing `/api/analyze` request body's `prompt` field in the Network tab — confirm it contains a `DATA SNAPSHOT` line with valid JSON matching the `AnalysisSnapshot` shape, and that the schema block asks for the v2 fields.

- [ ] **Step 4: Commit**

```bash
git add src/lib/analyst.ts src/App.tsx
git commit -m "feat: build the analyst prompt from a computed data snapshot with schema v2 instructions"
```

---

### Task 6: Render tree v2 — claim fields, horizon actions, evidence chips

**Files:**
- Modify: `src/lib/analyst.ts` (`normalizeAIResult` rewritten for `AIResultV2`; `buildFallbackAnalysis` produces a v2-shaped fallback; `extractFieldsFromBrokenJson` extracts the new fields)
- Modify: `src/App.tsx` (render tree, `AppState['ai'].data` type)

**Interfaces:**
- Consumes: `AIResultV2`, `ClaimField`, `HorizonAction` (Task 4).
- Produces: nothing further downstream consumes `AIResult` v1 after this task — it can be deleted from `src/lib/analyst.ts` in this same task once nothing references it.

This is the task where the v1 flat-string schema is fully retired in favor of v2. It's the largest single UI task in this plan — size it as one task because splitting the type rewrite from its only consumer (the render tree) would leave an intermediate commit that doesn't typecheck.

- [ ] **Step 1: Rewrite `normalizeAIResult`** to validate and coerce a raw parsed payload into `AIResultV2`, following the exact defensive pattern the current v1 version already uses (check `typeof`/array-ness per field, fall back to the `fallback` parameter's value when a field is missing or malformed) — extend that same pattern to the nested `ClaimField` shape: a `ClaimField` is valid only if `text` is a non-empty string; `evidence_ids` defaults to `[]` if missing or not an array of strings, never fails the whole field. `primary_decision` requires at least `action` (fall back to `'insufficient_evidence'` if the model sent something outside the 6 allowed literals) and `headline`; `confidence` on `primary_decision` is read but — critically — **is not trusted as the rendered value**; Task 9 overwrites it after validation, so `normalizeAIResult` should still parse whatever the model sent (needed as an input to `computeConfidence`) but callers must not render `primary_decision.confidence` directly without passing it through validation first (Task 9 makes this the only path).

- [ ] **Step 2: Rewrite `buildFallbackAnalysis`** to return an `AIResultV2`-shaped fallback: `primary_decision.action = 'insufficient_evidence'`, `horizon: 'now'`, a `headline` and `reasons` carrying today's existing bilingual fallback prose (as a single `ClaimField` with `evidence_ids: []`), `confidence: 'low'`. Preserve the existing `deltaPct`-driven weight-adjustment heuristic for `suggested_weights` — that logic is unrelated to the schema shape and should carry over unchanged.

- [ ] **Step 3: Update `extractFieldsFromBrokenJson`** for the new field names — it now needs to salvage `primary_decision.headline`/`primary_decision.action` (via a nested regex, following the existing pattern already used for `tranche2.verdict`/`tranche2.reasoning` in this function — model that pattern) rather than `one_liner`, and the claim-field text (not the `evidence_ids`, which can't be reliably salvaged from broken JSON — a salvaged claim field should get `evidence_ids: []`, which downstream validation will then correctly treat as unsupported if it contains a number/claim, degrading confidence rather than pretending the salvage was clean).

- [ ] **Step 4: Update `AppState['ai'].data`'s type** (in `src/App.tsx`) from `AIResult | null` to `AIResultV2 | null`.

- [ ] **Step 5: Rewrite the render tree.** Follow the existing render block's structure and CSS class usage (`section-label gold-text`, `soft-text`, the existing conditional-block pattern per field) but adapt to the new shape:
  - Replace the "Quick read" `one_liner` block with `primary_decision.headline`, plus a small `primary_decision.action`/`horizon` badge pair (follow the confidence-badge pattern already in the file for styling — `var(--up)`/`var(--down)`/`var(--text)` color-coding, this time keyed on `action` rather than `confidence`: e.g. `buy`/`reduce` as attention colors, `hold`/`wait` as neutral, `review`/`insufficient_evidence` as the down/warning color).
  - Replace the `trends` list with `primary_decision.reasons` — each item renders `.text`, and in Expert mode only, its `evidence_ids` as small inline chips (e.g. `[EV-001]` as a `muted-text font-mono` span) — Beginner mode renders just the text, matching the existing beginner/expert differentiation pattern.
  - Add a `horizon_actions` block (Expert mode only, following the recommendation's item 10) rendering each entry's `horizon`/`action`/`condition` as a small table or list.
  - Every remaining `ClaimField`-typed section (`weights_reasoning`, `egp_read`, `wallet_read`, `dca_read`, `watchlist_read`) renders `.text` the same way as before, with the same Expert-mode evidence-chip treatment as `reasons`.
  - Add `assumptions`/`missing_inputs` rendering, Expert mode only (bulleted lists, following the existing list-rendering pattern used for `trends` before this task removed it).

- [ ] **Step 6: Delete the v1 `AIResult` type** from `src/lib/analyst.ts` once `tsc -b` confirms nothing references it.

- [ ] **Step 7: Verify**

Run: `npx tsc -b && npx vite build`
Expected: clean.

- [ ] **Step 8: Manual verification**

Run: `npm run dev`, trigger an analysis with a working provider, confirm: the primary decision renders with an action/horizon badge, reasons show as a list, Expert mode reveals evidence chips/horizon actions/assumptions, Beginner mode hides them, and the fallback path (disconnect the provider) still renders a sensible `insufficient_evidence` card.

- [ ] **Step 9: Commit**

```bash
git add src/lib/analyst.ts src/App.tsx
git commit -m "feat: render the v2 schema — primary decision, horizon actions, evidence chips"
```

---

### Task 7: Validator v2 — hard-fail checks

**Files:**
- Modify: `server/routes/validateAnalysis.mjs`
- Modify: `tests/server/validate-analysis.test.mjs`

**Interfaces:**
- Consumes: parsed `AIResultV2`-shaped object, `rawText`, `evidenceIds` (unchanged from v1), plus the new `snapshot: AnalysisSnapshot` (Task 2) for cross-checking claimed amounts against real bounds.
- Produces: `validateAnalysis({ parsed, rawText, evidenceIds, snapshot }): { ok: boolean; errors: string[] }` — replaces the v1 `validateAnalysis(...): string[]` signature. `ok: false` is what Task 8's retry loop keys on.

This is item 5 of the recommendation, made real: weights, unlinked numeric claims, and DCA amounts that don't match the snapshot are no longer warnings — they're `ok: false`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/server/validate-analysis.test.mjs` (the v1 tests for `checkWeightsSum`'s warning behavior are superseded — update them to assert `ok`/`errors` instead of a bare warnings array; the file's existing test names and scenarios are a reasonable starting point, adapted to the new return shape):

```js
import { describe, it, expect } from 'vitest';
import { validateAnalysis, computeConfidence } from '../../server/routes/validateAnalysis.mjs';

const baseSnapshot = { dca: null };

describe('validateAnalysis (v2)', () => {
  it('returns ok:true for a clean v2 response', () => {
    const parsed = {
      primary_decision: { action: 'hold', horizon: 'now', headline: 'x', confidence: 'medium', reasons: [{ text: 'steady', evidence_ids: [] }] },
      suggested_weights: { deesc: 30, base: 45, stag: 25 },
      egp_read: { text: 'fine', evidence_ids: [] },
    };
    const result = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: [], snapshot: baseSnapshot });
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('hard-fails when suggested_weights does not sum to 100', () => {
    const parsed = { suggested_weights: { deesc: 30, base: 45, stag: 20 }, primary_decision: { action: 'hold', horizon: 'now', headline: 'x', confidence: 'low', reasons: [] } };
    const result = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: [], snapshot: baseSnapshot });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('suggested_weights sums to 95, not 100');
  });

  it('hard-fails a claim field stating a percentage with no evidence_ids', () => {
    const parsed = {
      primary_decision: { action: 'hold', horizon: 'now', headline: 'x', confidence: 'high', reasons: [] },
      suggested_weights: { deesc: 33, base: 34, stag: 33 },
      egp_read: { text: 'the pound weakened 3% this week', evidence_ids: [] },
    };
    const result = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: ['EV-001'], snapshot: baseSnapshot });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('egp_read'))).toBe(true);
  });

  it('does not fail a claim field with no numeric content and empty evidence_ids', () => {
    const parsed = {
      primary_decision: { action: 'hold', horizon: 'now', headline: 'x', confidence: 'medium', reasons: [] },
      suggested_weights: { deesc: 33, base: 34, stag: 33 },
      egp_read: { text: 'the pound is broadly stable', evidence_ids: [] },
    };
    const result = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: [], snapshot: baseSnapshot });
    expect(result.ok).toBe(true);
  });

  it('hard-fails a cited evidence ID that was never supplied', () => {
    const parsed = {
      primary_decision: { action: 'hold', horizon: 'now', headline: 'x', confidence: 'medium', reasons: [] },
      suggested_weights: { deesc: 33, base: 34, stag: 33 },
      egp_read: { text: 'rates held steady', evidence_ids: ['EV-999'] },
    };
    const result = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: ['EV-001'], snapshot: baseSnapshot });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('EV-999'))).toBe(true);
  });

  it('hard-fails when dca_read states an EGP amount exceeding the plan\'s actual investment cap', () => {
    const parsed = {
      primary_decision: { action: 'hold', horizon: 'now', headline: 'x', confidence: 'medium', reasons: [] },
      suggested_weights: { deesc: 33, base: 34, stag: 33 },
      dca_read: { text: 'deploy 50000 EGP into this tranche', evidence_ids: [] },
    };
    const snapshot = { dca: { mode: 'fixed', total_investment_egp: 30000, monthly_investment_egp: null } };
    const result = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: [], snapshot });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('dca_read'))).toBe(true);
  });

  it('does not fail a dca_read amount within the plan\'s cap', () => {
    const parsed = {
      primary_decision: { action: 'hold', horizon: 'now', headline: 'x', confidence: 'medium', reasons: [] },
      suggested_weights: { deesc: 33, base: 34, stag: 33 },
      dca_read: { text: 'deploy 12000 EGP into this tranche', evidence_ids: [] },
    };
    const snapshot = { dca: { mode: 'fixed', total_investment_egp: 30000, monthly_investment_egp: null } };
    const result = validateAnalysis({ parsed, rawText: JSON.stringify(parsed), evidenceIds: [], snapshot });
    expect(result.ok).toBe(true);
  });

  it('returns ok:false with a specific error when parsed is null', () => {
    const result = validateAnalysis({ parsed: null, rawText: 'not json', evidenceIds: [], snapshot: baseSnapshot });
    expect(result).toEqual({ ok: false, errors: ['response was not valid JSON'] });
  });
});

describe('computeConfidence', () => {
  it('returns the model confidence unchanged when there are no errors and coverage is high', () => {
    expect(computeConfidence({ modelConfidence: 'high', errors: [], evidenceCoverageRatio: 1 })).toBe('high');
  });

  it('downgrades to low whenever there are any validation errors, regardless of model confidence', () => {
    expect(computeConfidence({ modelConfidence: 'high', errors: ['x'], evidenceCoverageRatio: 1 })).toBe('low');
  });

  it('caps at medium when evidence coverage is below 50%, even with no errors', () => {
    expect(computeConfidence({ modelConfidence: 'high', errors: [], evidenceCoverageRatio: 0.3 })).toBe('medium');
  });

  it('never raises confidence above what the model itself reported', () => {
    expect(computeConfidence({ modelConfidence: 'low', errors: [], evidenceCoverageRatio: 1 })).toBe('low');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/validate-analysis.test.mjs`
Expected: FAIL — current `validateAnalysis` returns a bare array, not `{ok, errors}`, and `computeConfidence` doesn't exist yet.

- [ ] **Step 3: Rewrite `server/routes/validateAnalysis.mjs`**

```js
// Deterministic validation over an analysis response. Unlike v1, hard
// failures here are meant to block the response (see analyze.mjs's
// retry-then-downgrade loop) rather than ride along as warnings — this is
// the application-side enforcement the model itself cannot be trusted to
// do (ANALYST-PROMPT-ENHANCEMENT-PLAN.md §11, and the reviewed recommendation
// this file implements: reject on conflict, don't just flag it).

const WEIGHTS_SUM_TOLERANCE = 1; // absorbs Math.round() rounding, not real drift
const CLAIM_FIELD_KEYS = ['weights_reasoning', 'egp_read', 'wallet_read', 'dca_read', 'watchlist_read'];
const NUMBER_OR_PERCENT_RE = /(\d{1,3}(?:[.,]\d+)?\s?%)|(\$\s?\d[\d,]*(?:\.\d+)?)|(\b\d[\d,]{2,}(?:\.\d+)?\s?(?:EGP|جنيه)\b)/;

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

function checkClaimField(key, field, knownIds, errors) {
  if (!field) return;
  const text = fieldText(field);
  const ids = fieldEvidenceIds(field);
  if (NUMBER_OR_PERCENT_RE.test(text) && ids.length === 0) {
    errors.push(`${key} states a number/percentage/price with no evidence_ids attached`);
  }
  const unknown = ids.filter((id) => !knownIds.has(id));
  if (unknown.length > 0) {
    errors.push(`${key} cites evidence ID(s) not in the supplied search results: ${unknown.join(', ')}`);
  }
}

function checkClaimFields(parsed, evidenceIds) {
  const errors = [];
  const known = new Set(evidenceIds || []);
  for (const key of CLAIM_FIELD_KEYS) checkClaimField(key, parsed?.[key], known, errors);
  const reasons = parsed?.primary_decision?.reasons;
  if (Array.isArray(reasons)) {
    reasons.forEach((reason, i) => checkClaimField(`primary_decision.reasons[${i}]`, reason, known, errors));
  }
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
    ...checkClaimFields(parsed, evidenceIds),
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/validate-analysis.test.mjs`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add server/routes/validateAnalysis.mjs tests/server/validate-analysis.test.mjs
git commit -m "feat: validator v2 — hard-fail on weight/evidence/DCA-amount violations, compute confidence post-validation"
```

---

### Task 8: Retry-then-downgrade loop in `analyze.mjs`

**Files:**
- Modify: `server/routes/analyze.mjs`
- Modify: `tests/server/analyze-route.test.mjs`

**Interfaces:**
- Consumes: `validateAnalysis` and `computeConfidence` (Task 7), a `snapshot` field now included in the request body from the frontend (see Step 1 — the client must send the `AnalysisSnapshot` alongside the prompt so the server can validate against it without re-deriving it).
- Produces: the `/api/analyze` response gains `validation: { ok: boolean, errors: string[] }` (replacing the v1 `validationWarnings: string[]` field) and the returned `text`'s parsed `primary_decision.confidence` is now always the app-computed value, never the raw model value.

This is items 5 and 6 made concrete: one corrective re-prompt on hard failure, then a forced downgrade — never a silent pass-through of an invalid response.

- [ ] **Step 1: Accept `snapshot` in the request body.** `router.post('/', ...)` currently destructures `{ prompt }` from `req.body`. Change to `{ prompt, snapshot }`. Update `src/App.tsx`'s `analyzeViaBackend` call site (and its type in `src/api/llmProviders.ts`) to send `{ prompt, snapshot }` instead of `{ prompt }` — the snapshot was already built in Task 5's `analyze()` changes; this just threads it to the request body too, alongside the prompt (which already contains the same snapshot serialized inline — sending it separately as structured data is what lets the server validate against it without re-parsing the prompt string).

- [ ] **Step 2: Add the retry-then-downgrade loop.** Find where `validationWarnings` is currently computed (search for `validateAnalysis(` in the file) and replace that block:

```js
      let parsedForValidation = (() => {
        try {
          return JSON.parse(extractBraces(text) || text);
        } catch {
          return null;
        }
      })();
      let validation = validateAnalysis({ parsed: parsedForValidation, rawText: text, evidenceIds, snapshot });

      if (!validation.ok) {
        // One corrective re-prompt, mirroring the existing "output only
        // JSON" retry pattern already used for malformed responses — the
        // model gets one chance to fix the exact errors found, not a
        // free-form do-over.
        const correctionPrompt = `Your previous response failed these checks:\n${validation.errors.map((e) => `- ${e}`).join('\n')}\nReturn a corrected JSON object that fixes every listed issue. Do not introduce new numbers, dates, or claims beyond what you already stated or what the supplied evidence/snapshot support.`;
        const retryResult = await runProviderAnalysis(provider, `${effectivePrompt}\n\n${correctionPrompt}`);
        let retryText = retryResult.text;
        if (!isParseableJson(retryText)) {
          const repaired = repairAnalysisJson(retryText);
          if (repaired) retryText = JSON.stringify(repaired);
        }
        const retryParsed = (() => {
          try {
            return JSON.parse(extractBraces(retryText) || retryText);
          } catch {
            return null;
          }
        })();
        const retryValidation = validateAnalysis({ parsed: retryParsed, rawText: retryText, evidenceIds, snapshot });
        if (retryValidation.ok) {
          text = retryText;
          parsedForValidation = retryParsed;
          validation = retryValidation;
        } else {
          // Still failing after one correction attempt — force a safe,
          // honest result rather than rendering an unverified analysis.
          validation = retryValidation;
          if (parsedForValidation && typeof parsedForValidation === 'object') {
            parsedForValidation.primary_decision = {
              ...(parsedForValidation.primary_decision || {}),
              action: 'insufficient_evidence',
            };
            text = JSON.stringify(parsedForValidation);
          }
        }
      }

      const modelConfidence = parsedForValidation?.primary_decision?.confidence;
      const claimFields = [parsedForValidation?.weights_reasoning, parsedForValidation?.egp_read, parsedForValidation?.wallet_read, parsedForValidation?.dca_read, parsedForValidation?.watchlist_read, ...(Array.isArray(parsedForValidation?.primary_decision?.reasons) ? parsedForValidation.primary_decision.reasons : [])].filter(Boolean);
      const fieldsWithClaims = claimFields.filter((f) => NUMBER_OR_PERCENT_RE_FOR_COVERAGE.test(f?.text || ''));
      const fieldsWithEvidence = fieldsWithClaims.filter((f) => Array.isArray(f?.evidence_ids) && f.evidence_ids.length > 0);
      const evidenceCoverageRatio = fieldsWithClaims.length === 0 ? 1 : fieldsWithEvidence.length / fieldsWithClaims.length;
      const confidence = computeConfidence({ modelConfidence, errors: validation.errors, evidenceCoverageRatio });
      if (parsedForValidation && typeof parsedForValidation === 'object' && parsedForValidation.primary_decision) {
        parsedForValidation.primary_decision.confidence = confidence;
        text = JSON.stringify(parsedForValidation);
      }
```

Add the import: `import { validateAnalysis, computeConfidence } from './validateAnalysis.mjs';` (replacing the v1 `validateAnalysis`-only import), and export a `NUMBER_OR_PERCENT_RE` from `validateAnalysis.mjs` for reuse here rather than redefining the pattern in two files — add `export` to that constant in Task 7's file and import it here as `NUMBER_OR_PERCENT_RE_FOR_COVERAGE` (or just name it consistently and import it directly; avoid a second, possibly-drifting copy of the same regex).

- [ ] **Step 3: Update the response** — the `res.json({ ...result, text, validationWarnings })` line becomes `res.json({ ...result, text, validation })`.

- [ ] **Step 4: Update tests.** `tests/server/analyze-route.test.mjs`'s `validationWarnings`-asserting tests (from the prior plan) need updating to the new `validation: { ok, errors }` shape. Add new tests: (a) a hard-validation-failure response where the mocked `runProviderAnalysis` is set up (via `mockResolvedValueOnce`/`mockResolvedValueOnce` sequencing) to return an invalid response first and a corrected valid one on the retry call — assert the route returns the corrected text and `validation.ok === true`, and assert `runProviderAnalysis` was called twice; (b) a response that fails validation on both the original and the retry — assert `primary_decision.action` in the returned `text` is forced to `'insufficient_evidence'` and `validation.ok === false`; (c) a clean response that never needed a retry — assert `runProviderAnalysis` was called exactly once.

- [ ] **Step 5: Run the full server suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/analyze.mjs server/routes/validateAnalysis.mjs tests/server/analyze-route.test.mjs src/App.tsx src/api/llmProviders.ts
git commit -m "feat: retry once on hard validation failure, then force insufficient_evidence; compute confidence post-validation"
```

---

### Task 9: Gate "Apply weights" on validation state

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `AppState['ai'].data.validation` (threaded through from Task 8's response shape — add `validation: { ok: boolean; errors: string[] } | null` to `AppState['ai']`, mirroring how `validationWarnings` was added in the prior plan).

Item 7 of the recommendation.

- [ ] **Step 1: Thread `validation` through `analyze()`'s destructuring and both `setState` calls**, the same way the prior plan threaded `validationWarnings` (find that prior work in `git log` for the exact pattern — destructure from `analyzeViaBackend`'s result, set on success, set to a safe default `{ ok: true, errors: [] }`... no — on the catch path there is no server validation to report, so use `null` there, matching how `providerLabel`/`usedWebSearch` already distinguish "no data" from "known-bad data").

- [ ] **Step 2: Gate the Apply button.** Find `applyAI()` and its calling `<button>` element. Change the button's `disabled` condition from its current state (disabled only while `state.ai.loading`) to also disable when `state.ai.data?.validation?.ok === false` or `state.ai.data?.primary_decision?.action === 'insufficient_evidence'`. Add a short inline explanation next to the disabled button (bilingual, following the existing `down-text`-class warning pattern) stating why it's disabled — e.g. "Disabled: this analysis failed validation" / "معطّل: التحليل ده فشل في التحقق".

- [ ] **Step 3: Manual verification.** Temporarily force `validateAnalysis` to always return `ok: false` (a local, uncommitted edit), run `npm run dev`, trigger an analysis, confirm the Apply button is disabled with the explanation visible, then revert the temporary edit.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: disable Apply weights when the analysis fails validation"
```

---

### Task 10: Timeout, cancellation, progress stages, retry (frontend)

**Files:**
- Modify: `src/api/llmProviders.ts` (`analyzeViaBackend` gains an `AbortSignal` parameter)
- Modify: `src/App.tsx` (`analyze()` wires up the timeout/cancel/progress state machine)

**Interfaces:**
- Produces: `analyzeViaBackend(prompt: string, snapshot: AnalysisSnapshot, signal?: AbortSignal): Promise<{...}>`.

Item 9. The 45s budget is realistic after Task 3 (no more open-ended native search); this task adds the user-facing controls around it.

- [ ] **Step 1: Add `signal` support to `analyzeViaBackend`.** Pass it straight through to the underlying `fetch` call's `options.signal`.

- [ ] **Step 2: Add timeout + cancel + progress state to `AppState['ai']`.** Add `elapsedMs: number` (or derive it from a `startedAt: number | null` timestamp instead of polling — prefer storing `startedAt` and computing elapsed at render time via a `setInterval`-driven tick, to avoid a state field that needs updating every render frame).

- [ ] **Step 3: In `analyze()`,** create an `AbortController`, store it (component-level `let` or a ref-equivalent — Preact hooks: use `useRef` if not already imported, following how other mutable-across-renders values are handled elsewhere in this file), start a `setTimeout(() => controller.abort(), 45000)`, and pass `controller.signal` to `analyzeViaBackend`. On abort (catch a `DOMException` named `AbortError` specifically, distinct from other fetch failures), set a distinct error state ("Analysis timed out after 45s" / bilingual) with a visible "Retry" action rather than the generic error message path.

- [ ] **Step 4: Add a visible Cancel button** while `state.ai.loading` is true, calling `controller.abort()` directly (reachable from the same scope `analyze()` runs in — if `analyze()` is re-entrant/re-invoked per click, the controller needs to live somewhere that survives across the function's async boundary but is reachable by a button rendered during the pending state; a `useRef<AbortController | null>` on the component is the standard fit here).

- [ ] **Step 5: Add elapsed-time-driven progress-stage labels.** A small pure function, e.g. `progressStageLabel(elapsedMs: number, lang: 'ar'|'en'): string`, mapping bucketed elapsed time to a label — `0-5000` → "Preparing context" / "بيحضّر السياق", `5000-20000` → "Gathering evidence" / "بيجمع الأدلة", `20000-40000` → "Analyzing" / "بيحلل", `40000+` → "Finalizing" / "بيخلّص". Render this label next to the loading spinner while `state.ai.loading` is true, driven by a `setInterval` tick (500ms is enough resolution) that re-renders only while loading, cleared on completion/cancel/unmount.

- [ ] **Step 6: Manual verification.** Run `npm run dev`, trigger an analysis, confirm the progress label changes over time, confirm Cancel actually aborts the in-flight request (Network tab shows the request cancelled), and confirm a forced short timeout (temporarily lower `45000` to `2000` for this check only, then revert) surfaces the distinct timeout error with a working Retry action.

- [ ] **Step 7: Commit**

```bash
git add src/api/llmProviders.ts src/App.tsx
git commit -m "feat: add a 45s timeout, cancellation, retry, and progress-stage labels to analysis requests"
```

---

### Task 11: Expert mode — sensitivity table, assumptions, evidence list

**Files:**
- Create: `src/lib/sensitivity.ts`
- Test: `tests/client/sensitivity.test.ts`
- Modify: `src/App.tsx` (Expert-mode render block)

**Interfaces:**
- Produces: `computeSensitivityTable(input: { spot: number; egp: number; walletHoldingsEgpAt24k: number /* grams-equivalent at 24k, or however the existing wallet math already normalizes units — reuse whatever conversion the Wallet tab already does rather than reinventing it */ }, movesPct?: number[]): { xau_usd_move_pct: number; usd_egp_move_pct: number; wallet_value_egp: number }[]`.

Item 10, completed: Expert mode differentiates through a real computed table, not more prose.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { computeSensitivityTable } from '../../src/lib/sensitivity';

describe('computeSensitivityTable', () => {
  it('computes wallet EGP value at each combination of XAU/USD and USD/EGP moves', () => {
    const table = computeSensitivityTable({ spot: 2650, egp: 48.5, gramsAt24k: 100 }, [-10, 0, 10]);
    // at 0% move: value = (2650/31.1035) * 48.5 * 100
    const base = (2650 / 31.1035) * 48.5 * 100;
    const baseRow = table.find((r) => r.xau_usd_move_pct === 0 && r.usd_egp_move_pct === 0);
    expect(baseRow?.wallet_value_egp).toBeCloseTo(base, 0);
  });

  it('produces one row per combination of the given move percentages', () => {
    const table = computeSensitivityTable({ spot: 2650, egp: 48.5, gramsAt24k: 50 }, [-10, 10]);
    expect(table.length).toBe(4); // 2 x 2 combinations
  });

  it('returns an empty table when gramsAt24k is zero (no holdings to size)', () => {
    const table = computeSensitivityTable({ spot: 2650, egp: 48.5, gramsAt24k: 0 });
    expect(table).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/sensitivity.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `src/lib/sensitivity.ts`**

```ts
const OZ_GRAMS = 31.1035;
const DEFAULT_MOVES_PCT = [-10, -5, 0, 5, 10];

export function computeSensitivityTable(
  input: { spot: number; egp: number; gramsAt24k: number },
  movesPct: number[] = DEFAULT_MOVES_PCT
): { xau_usd_move_pct: number; usd_egp_move_pct: number; wallet_value_egp: number }[] {
  if (input.gramsAt24k <= 0) return [];
  const rows: { xau_usd_move_pct: number; usd_egp_move_pct: number; wallet_value_egp: number }[] = [];
  for (const xauMove of movesPct) {
    for (const egpMove of movesPct) {
      const spot = input.spot * (1 + xauMove / 100);
      const egp = input.egp * (1 + egpMove / 100);
      const value = (spot / OZ_GRAMS) * egp * input.gramsAt24k;
      rows.push({ xau_usd_move_pct: xauMove, usd_egp_move_pct: egpMove, wallet_value_egp: Math.round(value * 100) / 100 });
    }
  }
  return rows;
}
```

Check how the existing Wallet tab already normalizes mixed holdings (oz/g24/g21/g18/pounds) into a single 24k-gram-equivalent figure before computing `walletIntlValue` — reuse that exact conversion logic (do not reimplement karat-fraction math here; import or replicate the established constants from wherever `WalletHoldings`/`fmt`/the karat fractions live in `App.tsx`, matching the file's existing `f: 1 | 22/24 | 0.875 | 0.75` pattern seen in the karat table).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/sensitivity.test.ts`
Expected: PASS.

- [ ] **Step 5: Render the sensitivity table, Expert mode only, alongside `assumptions`/`missing_inputs`** (added to the render tree in Task 6; if that task rendered them as plain lists already, this task adds the sensitivity table as a small grid/table component near them, using the existing table-styling patterns already present elsewhere in the file, e.g. the wallet cost-basis table).

- [ ] **Step 6: Commit**

```bash
git add src/lib/sensitivity.ts tests/client/sensitivity.test.ts src/App.tsx
git commit -m "feat: add a computed sensitivity table to Expert mode"
```

---

## Self-Review Notes

- **Spec coverage:** item 1/2 → Task 2; item 3 → Tasks 4-6; item 4 → Tasks 4, 5, 7 (structural claim-field requirement + hard-fail detection, with the "not literally provable per-sentence" caveat stated in Global Constraints); item 5 → Task 8; item 6 → Tasks 7 (computeConfidence) + 8 (wiring); item 7 → Task 9; item 8 → Task 7's `checkClaimFields` (detection) + Task 8's confidence-coverage penalty (consequence), explicitly not text-mutation, per Global Constraints; item 9 → Task 3 (what makes it achievable) + Task 10 (the UX itself); item 10 → Task 6 (horizon actions, assumptions, evidence chips) + Task 11 (sensitivity table).
- **Placeholder scan:** no bare "TBD"/"handle appropriately" steps. Tasks with large surface area (6, 10, 11) are given exact function signatures, concrete examples, and explicit pointers to the existing pattern to follow in the file, rather than either full verbatim JSX (impractical at this scope, and the file's own render tree is the better source of truth for exact styling at execution time) or vague direction.
- **Type consistency:** `ClaimField`, `AIResultV2`, `HorizonAction`, `PrimaryDecision`, `AnalysisSnapshot`, `validateAnalysis({parsed, rawText, evidenceIds, snapshot})`, `computeConfidence({modelConfidence, errors, evidenceCoverageRatio})` are named and shaped identically everywhere they're introduced (Tasks 2, 4, 7) and consumed (Tasks 5, 6, 8, 9, 11).
- **Sequencing:** Task 3 (retire native search) is placed before Task 5 (new prompt) deliberately — the prompt's citation instructions in Task 5 assume every provider has an evidence pack, which is only true after Task 3. Task 6 must follow Task 4 immediately in execution (types before their only consumer) even though they're separate tasks — flagged in Task 6's own text.
