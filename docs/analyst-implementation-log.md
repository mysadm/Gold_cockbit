# Analyst pipeline implementation record

Pre-implementation checkpoint: `f249485`, tag `checkpoint/pre-analyst-pipeline-v2`.

## Baseline (Task 0)

- Synthetic fixture only; no customer portfolio or credentials stored.
- Existing suite: 44 files / 299 tests passed (135.79 seconds).
- Existing system prompt: 5,716 characters; runtime including synthetic snapshot: 9,082 characters.
- Combined instructions and snapshot: 14,798 characters, approximately 3,700 tokens using characters / 4; excludes search snippets. This is not measured provider token usage.
- Hosted/local live baseline and final comparison will be recorded at Task 8 if endpoints are available.

## Review refinements

Tasks 1–2: 13 cache/evidence unit tests and 24 route integration tests passed. Production build passed with an existing generated CSS `:where()` warning. Sources are filtered to HTTP(S), search metadata is additive, and partial results survive individual query failures.

- Keep partial evidence; one unavailable facet must not discard the other results.
- Scope cache entries to a hash of the search credential as well as query/recency, without logging credentials.
- Preserve v2/legacy clients while v3 remains opt-in. A supported protocol does not guarantee that every model produces valid financial analysis.

## Tasks 3–5 checkpoint

- Snapshot schema 2 carries separate gold/FX retrieval timestamps, alignment and previous validated analysis. Alignment also requires freshness, not merely two equally stale quotes. Retrieval timestamps do not prove the underlying feed's observation time.
- Server owns the compact prompt; legacy clients continue using the preserved legacy policy. Web negotiates the contract and never constructs/sends its legacy prompt on v3.
- Shared deterministic v3 validation is reused by the web parser: bounded fields, known evidence IDs, unchanged fallback weights, consistent changes, no raw URLs, DCA ceilings, and recent matching prior state for no-material-change.
- Explicit analysis still calls the model when search is unavailable, per the approved no-call deferral. Only insufficient-evidence responses can pass without evidence.
- One corrective retry; invalid or truncated results fall back safely with the validation failure preserved. Cancellation never replaces the prior validated analysis.
- 75 focused and route tests passed, including parser/alignment regressions. Build passes; existing CSS warning remains.
- Evidence-ID membership is a structural check, not proof that a claim is true. Free-form financial prose and source relevance still need human evaluation.
