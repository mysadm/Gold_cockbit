# Unified Evidence + Token-Efficient Analyst Pipeline — v2 Review Plan

**Status:** Proposed for review — do not implement until approved

**Supersedes:** The first version of this plan, which covered only search caching, search status, and the evidence glossary

**Related:** `docs/superpowers/plans/2026-09-15-analyst-data-contract-v2.md`

> **Execution note:** After approval, implement this plan in order and use TDD for each contract change. Prefer one continuous implementation session because the work repeatedly touches `server/routes/analyze.mjs`, `src/lib/analyst.ts`, and `src/App.tsx`. Preserve the existing uncommitted changes in `server/webSearch.mjs` and `src/App.tsx`; reconcile them rather than overwriting them.

## 1. Goal

Make Gold Cockpit analysis faster, cheaper, more consistent across models, and easier to audit without weakening the existing safety checks.

The final architecture must enforce this division of responsibility:

```text
Application and server
  live data + timestamps + calculations + source ownership
  + evidence selection + validation + presentation
                         |
                         v
AI model
  material evidence interpretation + scenario reassessment
  + one portfolio decision + trigger + invalidation
```

The model must not calculate weighted targets, Egyptian target prices, premiums, cost basis, P&L, DCA limits, or source URLs. Those are deterministic application responsibilities.

## 2. Why this is a new version

The original plan solved three real problems:

1. repeated SerpAPI calls produced different evidence for back-to-back model comparisons;
2. the UI could not explain why web search was unavailable;
3. evidence URLs were discarded after prompt construction.

This version keeps those improvements and adds the prompt/runtime proposal reviewed on 2026-09-17:

- retain the long analyst methodology as a design specification, not a runtime prompt;
- use a short, stable, provider-neutral system prompt;
- send a compact but complete application snapshot;
- give the model a bounded evidence pack owned by the server;
- require a small JSON response containing judgment, not arithmetic;
- add previous-versus-current context without prematurely skipping explicit user-requested analyses;
- add deterministic timestamp-alignment metadata before interpreting Egyptian premium/discount;
- reduce output limits only after the smaller contract is proven across models.

## 3. Current strengths that must be preserved

Do not regress these existing behaviors:

- The server gathers the same evidence for `claude`, `shared`, `openai`, `openrouter`, `ollama`, and `custom` providers.
- Current external evidence is tagged with server-created `EV-XXX` IDs.
- The model never gets authority to invent a valid evidence ID.
- `validateAnalysis` checks evidence references, weight totals, and DCA limits.
- An invalid answer receives at most one corrective retry.
- A second validation failure forces `primary_decision.action = "insufficient_evidence"`.
- Confidence is computed/capped by the server and can never be raised above the model's own confidence.
- The Apply Weights action is disabled for failed validation.
- The app works when search is disabled or unavailable.
- Arabic and English output remain supported.
- No implementation may depend on a provider's native web-search, tool-calling, prompt-caching, or structured-output feature.

## 4. Model-neutrality requirements

The same logical request and response contract must work with all configured provider types.

### Required common denominator

- Plain system text plus plain user text.
- JSON requested through instructions, not a provider-specific schema API.
- Existing defensive JSON extraction/repair retained for weaker and local models.
- Lowercase ASCII enum values and English JSON keys.
- No assumption that a model can browse, call tools, preserve conversation state, or return citations automatically.
- No model-supplied URL is trusted or rendered.
- Evidence IDs are short and stable within one analysis request.
- Optional fields are omitted only when their corresponding snapshot context is absent.

### Provider-specific optimizations

Provider-native JSON schemas, prompt caching, tool use, or reasoning controls may be added later as optional adapters. They must not change the canonical prompt semantics or response shape.

## 5. Token and latency budgets

Token counts differ between model families, so tests should enforce deterministic character and item budgets while runtime telemetry records provider-reported tokens when available.

Initial budgets:

| Component | Budget |
|---|---:|
| Stable system prompt | no more than 3,600 characters |
| Runtime instructions, excluding snapshot/evidence | no more than 2,500 characters |
| Evidence sources injected | at most 10 |
| Snippet length per source | at most 320 characters |
| Model-produced evidence items | at most 3 |
| Default completion limit | 4,096 tokens |
| Configurable completion limit | clamp to 1,024–8,192 tokens |
| Corrective retries | at most 1 |

Targets to measure against a checked-in baseline fixture:

- at least 35% lower median input tokens;
- at least 50% lower median output tokens;
- no increase in validation-failure rate;
- a cached evidence run avoids all SerpAPI network calls;
- cached-run median wall time improves by at least 20% in the same environment.

The percentage targets are review metrics, not reasons to weaken evidence coverage or validation.

## 6. Target request flow

```text
Web or Flutter client sends AnalysisSnapshotV2
                    |
                    v
Server checks provider/search settings
                    |
                    v
Five fixed facet searches run in parallel
  -> cache by query + recency mode
  -> keep partial successes
  -> deduplicate and bound evidence
                    |
                    v
Server builds one provider-neutral runtime prompt
  compact system prompt
  + DATA_SNAPSHOT
  + EVIDENCE_PACK
  + compact JSON contract
                    |
                    v
Selected model returns AnalystResultV3
                    |
                    v
Parse/repair -> validate -> one correction attempt
                    |
                    v
Server computes final confidence and returns
result + validation + searchStatus + evidenceSources
                    |
                    v
UI renders source metadata from the server,
never URLs copied by the model
```

The model receives the same prompt and evidence regardless of provider type. Differences between model outputs should therefore come from model reasoning, not different search data or provider-specific instructions.

## 7. Contracts proposed for review

### 7.1 AnalysisSnapshotV2

Upgrade the application snapshot from schema version `1` to `2`.

```ts
type AnalysisSnapshotV2 = {
  schema_version: '2';
  generated_at: string;
  locale: 'ar' | 'en';
  explanation_level: 'beginner' | 'expert';

  market: {
    xau_usd: number;
    usd_egp: number;
    weighted_target_usd: number;
    retrieved_at: string | null;
  };

  price_alignment: {
    aligned: boolean;
    premium_reliable: boolean;
    age_gap_minutes: number | null;
    max_gap_minutes: 60;
  };

  scenarios: Array<{
    key: 'deesc' | 'base' | 'stag';
    name_en: string;
    weight_pct: number;
    price_lo: number;
    price_hi: number;
    thesis: string;
  }>;

  egypt: ExistingEgyptSnapshot | null;
  wallet: ExistingWalletSnapshot;
  dca: ExistingDcaSnapshot | null;
  watchlist: ExistingWatchlistSnapshot;

  previous_analysis: {
    generated_at: string;
    action: string;
    confidence: 'low' | 'medium' | 'high';
    suggested_weights: { deesc: number; base: number; stag: number };
  } | null;
};
```

Rules:

- `market.retrieved_at` is set only after a successful live market pull.
- `egypt.retrieved_at` remains the timestamp supplied by the Egypt-price endpoint.
- `price_alignment` is calculated by the application, never by the model.
- `premium_reliable` is `true` only when both timestamps exist and their gap is at most 60 minutes.
- `previous_analysis` is the last successfully validated analysis, not the last attempted request.
- Do not add an `available_cash` field until the product actually collects and persists it. Missing cash may be reported through `missing_inputs`; it must not be invented from DCA budget.

### 7.2 AnalystResultV3

Use a smaller output contract while retaining the information needed for a decision.

```ts
type AnalystStatus =
  | 'material_change'
  | 'no_material_change'
  | 'insufficient_evidence';

type AnalystResultV3 = {
  schema_version: '3';
  status: AnalystStatus;

  primary_decision: {
    action: 'buy' | 'hold' | 'wait' | 'reduce' | 'review' | 'insufficient_evidence';
    horizon: 'now' | 'next_event' | 'strategic';
    headline: string;
    confidence: 'low' | 'medium' | 'high';
    next_trigger: string;
    invalidation: string;
  };

  evidence: Array<{
    evidence_id: string;
    scenario_effect: 'deesc' | 'base' | 'stag' | 'mixed' | 'neutral';
    strength: 'low' | 'medium' | 'high';
    implication: string;
  }>;

  suggested_weights: {
    deesc: number;
    base: number;
    stag: number;
  };

  weight_changes: Array<{
    scenario: 'deesc' | 'base' | 'stag';
    from: number;
    to: number;
    evidence_ids: string[];
  }>;

  reads: {
    egp: string;
    wallet?: string;
    dca?: string;
    watchlist?: string;
  };

  assumptions: string[];
  missing_inputs: string[];
};
```

Contract rules:

- Keep the existing action enum in v3. `ADD` and `TAKE_PROFIT` are product-level action changes and are not introduced by a prompt optimization plan.
- Keep categorical confidence. Do not use fabricated precision such as `72%`.
- `evidence` contains at most three items.
- Every `evidence_id` and every `weight_changes[].evidence_ids` entry must exist in the supplied evidence pack.
- `reads` may interpret application snapshot values but must not introduce new external facts.
- The model never returns source names, publication dates, or URLs; the server owns those.
- For `no_material_change`, suggested weights must equal the snapshot weights and `weight_changes` must be empty.
- For `insufficient_evidence`, the primary action must be `insufficient_evidence` and confidence must be `low`.
- The application calculates the new weighted target after validating suggested weights. The model does not return a target.

### 7.3 Search response metadata

Keep `usedWebSearch` for backward compatibility and add:

```ts
type SearchStatus =
  | 'ok'
  | 'partial'
  | 'disabled'
  | 'no_api_key'
  | 'no_results'
  | 'failed';

type EvidenceSource = {
  id: string;
  title: string;
  link: string;
  date: string;
};
```

`partial` means at least one facet search failed and at least one produced usable evidence. Partial evidence is more useful and more honest than discarding every successful result because one query timed out.

## 8. Compact production prompts

### 8.1 System prompt

Replace the runtime contents of `server/prompts/goldMarketAnalyst.mjs` with the following compact policy. Move the long institutional methodology into a documentation reference before deleting it from runtime.

```text
You are the decision layer for Gold Hedge Cockpit, advising one Egyptian
gold investor. Produce a specific portfolio decision, not a market briefing.

The supplied DATA_SNAPSHOT is application-computed ground truth. Never
recompute or override its prices, targets, premiums, wallet values, cost
basis, DCA amounts, or scenario arithmetic.

The supplied EVIDENCE_PACK is the only source of current external facts.
Refer to sources only by their EV-XXX IDs. Never invent evidence IDs,
prices, events, dates, or URLs.

Analyze only developments that could materially change the scenario weights,
the Egyptian-gold interpretation, or the investor's next action. Use at most
three evidence items.

Use exactly the scenario keys supplied in the snapshot. Start from the
supplied weights and change them only when material evidence justifies it.
Suggested weights must total 100. Do not alter scenario price bands or
calculate a weighted target.

Treat global gold, USD/EGP, and local premium as separate effects. If
price_alignment.premium_reliable is false, do not draw a strong conclusion
from the displayed premium or discount.

Base the decision on supplied holdings, cost basis, and DCA status. A watch
level is a reassessment trigger, not an automatic purchase. Never recommend
an amount above a supplied DCA limit.

Return one supported action, categorical confidence, the next trigger, and
an invalidation condition. Use the requested language. Return valid JSON
only using the runtime schema.
```

### 8.2 Runtime prompt

Build the runtime prompt on the server after search completes so it knows whether an evidence pack actually exists. The client should send structured state, not author the final model instruction.

```text
Analyze DATA_SNAPSHOT using only EVIDENCE_PACK for current external facts.

Compare previous_analysis with the current snapshot when previous_analysis
exists. Report only material changes. If evidence does not justify changing
the prior decision or weights, return status=no_material_change and preserve
the supplied weights. If current evidence is absent or inadequate for a safe
decision, return status=insufficient_evidence.

External facts belong only in evidence[]. The reads fields may interpret
DATA_SNAPSHOT values but may not introduce new external facts. Keep every
string concise. Return exactly AnalystResultV3 JSON with no markdown.

DATA_SNAPSHOT
<compact JSON>

EVIDENCE_PACK
<EV-XXX, title, date, bounded snippet; never include a URL in model-visible text>

OUTPUT_SCHEMA
<minified structural example generated from the v3 contract>
```

Do not tell the model to “use your live web search.” The model has no search tool in this architecture; the server supplies the evidence.

## 9. Search and evidence policy

Keep the five current decision facets for this version so prompt optimization does not silently reduce research coverage:

1. gold price/action and current drivers;
2. Fed/rates;
3. central-bank gold demand;
4. geopolitical and energy-shipping risk;
5. Egypt USD/EGP and local gold.

Efficiency comes from caching and bounding the pack, not pretending the model can choose searches.

Implementation policy:

- Run the five searches in parallel with the existing eight-second per-query timeout.
- Use `Promise.allSettled`, not `Promise.all`, so one failure produces `partial` rather than discarding successful evidence.
- Cache only non-empty successful query results for ten minutes.
- Cache key includes the query and the recency-filter version.
- Deduplicate by normalized canonical URL.
- Select at most two results per facet and at most ten overall.
- Truncate each snippet to 320 characters before prompt injection.
- Assign evidence IDs only after deduplication and final ordering.
- Preserve deterministic facet order so two providers run within the TTL receive byte-identical evidence packs.
- Return full source URLs to the UI in `evidenceSources`; do not place URLs in the model prompt or accept URLs from the model output.

## 10. Validation policy for v3

Extend the existing validator instead of replacing it.

Required checks:

1. response is parseable JSON after existing bounded repair;
2. `schema_version === "3"`;
3. status and action are allowed enum values;
4. suggested weights are finite, in range, and total 100;
5. evidence has at most three items;
6. all evidence IDs were supplied by the server;
7. every weight change references at least one supplied evidence ID;
8. `from` equals the corresponding snapshot weight and `to` equals the suggested weight;
9. `no_material_change` preserves weights and has no weight changes;
10. `insufficient_evidence` forces the matching action and low confidence;
11. DCA amounts mentioned in `reads.dca` do not exceed the snapshot limit;
12. no model-produced field contains a raw `http://` or `https://` URL;
13. server confidence calculation can only preserve or lower model confidence;
14. failed validation disables Apply Weights;
15. one failed corrective retry forces a safe `insufficient_evidence` result.

The corrective prompt must list only the validation errors and the compact v3 contract. It must not add new market facts or invite the model to redo the research.

## 11. Implementation tasks

### Task 0 — Baseline and fixtures

**Files:**

- Create `tests/fixtures/analyst-request-v2.json`
- Create `scripts/measure-analysis-prompt.mjs`
- Modify no production behavior

Steps:

- [ ] Capture a representative snapshot containing Egypt, wallet, DCA, and watchlist data with invented test-only values.
- [ ] Generate the current system prompt, runtime prompt, and evidence pack from fixed fixtures.
- [ ] Record characters, words, evidence count, and provider token usage when usage metadata is available.
- [ ] Record validation success and response size for at least one hosted model and one local/OpenAI-compatible model.
- [ ] Check in only synthetic fixtures; never check in real holdings, API keys, or search credentials.

### Task 1 — Cache and bound evidence deterministically

**Files:**

- Create `server/searchCache.mjs`
- Modify `server/webSearch.mjs`
- Modify `server/routes/analyze.mjs`
- Modify `tests/server/web-search.test.mjs`
- Modify `tests/server/analyze-route.test.mjs`

Steps:

- [x] Add a ten-minute in-memory cache keyed by recency version plus query.
- [x] Preserve the existing eight-second fetch timeout currently present as an uncommitted change.
- [x] Never cache rejected or empty searches.
- [x] Use `Promise.allSettled` for facet searches.
- [x] Deduplicate, round-robin by facet, cap at two per facet/ten total, and truncate snippets.
- [x] Return `ok`, `partial`, `no_results`, or `failed` accurately.
- [x] Test cache hits, expiry with fake timers, failures not cached, stable ordering, partial failure, cap enforcement, and identical evidence across provider types.

### Task 2 — Preserve authoritative source metadata

**Files:**

- Modify `server/routes/analyze.mjs`
- Modify `src/api/llmProviders.ts`
- Modify `src/App.tsx`
- Modify relevant server tests

Steps:

- [x] Return `searchStatus` and `evidenceSources` alongside the existing response.
- [x] Keep `usedWebSearch` with unchanged meaning for backward compatibility.
- [x] Store search metadata in `AppState['ai']` and reset it on request failure.
- [x] Explain disabled, unconfigured, empty, partial, and failed search states bilingually.
- [x] Render a source glossary from `evidenceSources` after the analysis.
- [x] Use safe external links (`target="_blank"`, `rel="noopener noreferrer"`).
- [x] Never render a model-produced URL.

### Task 3 — Add snapshot timestamps, alignment, and previous state

**Files:**

- Modify `src/lib/analysisSnapshot.ts`
- Modify `src/App.tsx`
- Modify `tests/client/analysisSnapshot.test.ts`

Steps:

- [ ] Add a persisted ISO market retrieval timestamp set only on successful market pulls.
- [ ] Build `price_alignment` deterministically with the approved 60-minute threshold.
- [ ] Add the last successfully validated analysis as optional `previous_analysis`.
- [ ] Upgrade snapshot schema to `2`.
- [ ] Test aligned, stale, missing-timestamp, and prior-analysis cases.
- [ ] Confirm a failed or cancelled analysis never replaces `previous_analysis`.

### Task 4 — Move runtime prompt construction to the server and compact the system prompt

**Files:**

- Modify `server/prompts/goldMarketAnalyst.mjs`
- Create `server/prompts/buildAnalysisPrompt.mjs`
- Modify `server/routes/analyze.mjs`
- Modify `src/lib/analyst.ts`
- Modify `src/api/llmProviders.ts`
- Create/modify prompt contract tests

Steps:

- [ ] Move the long methodology into `docs/analyst-methodology.md` for reference.
- [ ] Replace the runtime system prompt with the compact prompt in section 8.1.
- [ ] Build the runtime prompt server-side from snapshot plus final evidence pack.
- [ ] Stop instructing the model to use a search capability it does not have.
- [ ] Change the web client to submit structured snapshot data; do not submit a client-authored final prompt.
- [ ] Temporarily continue accepting a legacy `prompt` field for older clients, but mark that path deprecated and never mix it with the v3 snapshot path.
- [ ] Add character-budget tests for system and runtime instruction text.
- [ ] Verify the generated prompt is byte-identical across provider types for the same snapshot/evidence.

### Task 5 — Implement AnalystResultV3 and validation

**Files:**

- Modify `src/lib/analyst.ts`
- Modify `server/routes/validateAnalysis.mjs`
- Modify `server/routes/analyze.mjs`
- Create/modify focused v3 parser tests
- Modify `tests/server/validate-analysis.test.mjs`
- Modify `tests/server/analyze-route.test.mjs`

Steps:

- [ ] Add v3 types, parser, normalization, and fallback result.
- [ ] Generate a minified structural schema example for the runtime prompt.
- [ ] Implement every validation rule in section 10.
- [ ] Retain one corrective retry and safe downgrade.
- [ ] Compute final confidence on the server.
- [ ] Add tests for every status invariant and evidence/weight relationship.
- [ ] Fuzz the parser with fenced JSON, preambles, truncated strings, numeric strings, unknown enums, and missing optional reads.

### Task 6 — Render v3 and lower output budget safely

**Files:**

- Modify `src/App.tsx`
- Modify `server/providers/claude.mjs`
- Modify `server/providers/openaiCompatible.mjs`
- Modify provider and frontend tests

Steps:

- [ ] Render material status, concise evidence, scenario arrows, reads, trigger, and invalidation.
- [ ] Calculate and display the resulting weighted target in the application after validation.
- [ ] Preserve the validation warning and Apply Weights gate.
- [ ] Default provider output to 4,096 tokens and clamp configuration to 1,024–8,192.
- [ ] Keep the existing 90-second frontend analysis timeout until measurements justify reducing it.
- [ ] Normalize usage metadata where providers expose it; use `null` where unavailable.
- [ ] Log durations, cache hits, token usage, retry count, provider type, and validation result without logging prompts, holdings, API keys, or full model output.

### Task 7 — Align Flutter or explicitly hold rollout

The Flutter analyst still uses the old v1 prompt/response shape. Production rollout must not silently break it.

**Files:**

- Modify `flutter_app/lib/features/ai_analyst/data/ai_analyst_repository.dart`
- Modify Flutter AI screen/provider tests

Steps:

- [ ] Replace Flutter's client-authored prompt with an `AnalysisSnapshotV2` request.
- [ ] Parse `AnalystResultV3` and source metadata.
- [ ] Render the v3 decision, trigger, invalidation, and evidence sources.
- [ ] Add repository and widget tests.
- [ ] If Flutter cannot be migrated in the same release, keep v3 behind `ANALYST_CONTRACT_VERSION=v2` and do not enable it by default.

### Task 8 — Benchmark and review gate

- [ ] Run focused tests after each task.
- [ ] Run `npm test`, `npm run build`, and Flutter tests before rollout.
- [ ] Run the synthetic fixture through at least: shared Claude, one OpenAI-compatible hosted provider, and Ollama/custom local provider when available.
- [ ] Compare input/output size, search time, model time, total time, retries, validation, and decision consistency with Task 0.
- [ ] Confirm Arabic JSON remains valid and concise.
- [ ] Confirm source links come only from server metadata.
- [ ] Confirm two providers analyzed within ten minutes receive byte-identical evidence.
- [ ] Submit benchmark table and sample anonymized outputs for human review before changing the default contract version.

## 12. Smart Delta Mode — deliberately phase 2

Do not skip the LLM call merely because price movement is small in this version. A small price move can coincide with a material policy or geopolitical event, and the current application does not yet have a reliable event stream independent of search.

Phase 1 behavior:

- an explicit Analyze click still calls the server and the selected model;
- the model may return `no_material_change` using previous analysis plus fresh evidence;
- cached evidence and the compact contract keep that call cheaper;
- the UI preserves the prior decision and weights when status is `no_material_change`.

Only consider no-call Smart Delta after collecting enough validated runs to define safe deterministic rules. A later plan must cover:

- price/FX/local-premium thresholds;
- scenario-band and watch-level crossings;
- evidence freshness and scheduled event windows;
- force-refresh behavior;
- maximum age of a reused decision;
- audit logging explaining why a call was skipped;
- false-negative testing against historical material events.

## 13. Rollout and rollback

Use a temporary server setting:

```text
ANALYST_CONTRACT_VERSION=v2|v3
```

Rollout order:

1. ship additive cache, search status, and source glossary changes;
2. ship snapshot v2 and v3 parsing behind the flag;
3. test the provider matrix and Flutter compatibility;
4. enable v3 for development;
5. review benchmarks and anonymized outputs;
6. make v3 the default only after approval;
7. remove the legacy prompt path in a separate cleanup release.

Rollback is changing the flag back to `v2`. Database rollback is unnecessary because this plan adds no required migration.

## 14. Review decisions required before implementation

Reviewers should explicitly approve or change these decisions:

1. **Timestamp threshold:** 60 minutes for reliable local-premium comparison.
2. **Evidence bound:** two results per facet, ten overall, 320 characters per snippet.
3. **Output bound:** three evidence items and a 4,096-token default completion limit.
4. **Scenario vocabulary:** retain `deesc/base/stag`; do not switch to generic Bear/Base/Bull in this plan.
5. **Action vocabulary:** retain the current six actions; do not add `ADD` or `TAKE_PROFIT` here.
6. **Previous state:** use only the last successfully validated analysis.
7. **Flutter gate:** v3 cannot become default until Flutter is compatible or intentionally excluded from that deployment.
8. **Smart Delta:** postpone call-skipping until a separately reviewed materiality policy exists.

## 15. Definition of done

- Every provider type receives the same compact system prompt, runtime prompt structure, and bounded evidence pack.
- Back-to-back model comparisons reuse identical cached evidence.
- Search failures are visible and partial success is represented honestly.
- The model returns no calculations or source URLs.
- The server validates every applied weight and evidence reference.
- Egyptian premium interpretation respects deterministic timestamp alignment.
- A no-material-change response is safe, renderable, and preserves weights.
- The source glossary is built only from server-owned metadata.
- Web and Flutter compatibility is demonstrated or v3 remains behind the rollout flag.
- Token/latency measurements are reported against the baseline.
- Full automated tests and builds pass.

## 16. Self-review notes

- This plan optimizes the full pipeline, not just prompt wording. Search latency, evidence volume, output size, retries, and client compatibility all affect user-perceived speed.
- It does not trade correctness for speed: search coverage remains at five facets, partial search is explicit, and current validation protections remain.
- It is model-neutral by construction: no native browsing, tool use, JSON-schema API, or prompt-cache behavior is required.
- It keeps deterministic calculations in code and subjective interpretation in the model.
- It avoids false precision by retaining categorical confidence.
- It avoids fabricated source links by never asking the model to return URLs.
- It does not implement Smart Delta prematurely.
