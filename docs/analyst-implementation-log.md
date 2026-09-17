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

Task 2 checkpoint: `910ddef`, tag `checkpoint/analyst-task-2`.
Task 5 checkpoint: `57d61b2`, tag `checkpoint/analyst-task-5`.

## Tasks 6–8 review stage

- Web renders compact status, trigger, invalidation, evidence implications, reads, source metadata and an application-computed target. Apply requires successful validation and preserves zero/decimal weights exactly.
- Compact adapters default to 4,096 completion tokens, clamp configuration to 1,024–8,192, report usage/truncation, and propagate request cancellation. Legacy limits remain unchanged. OpenAI parameter compatibility was checked against official documentation; the reference is linked in the benchmark review.
- Numeric DCA limits are now explicit application/server calculations; no allowance is assigned to a closed/future window. Arabic requests reject English-only prose rather than accepting syntactically valid but wrong-language results.
- Missing usage stays unknown; reported retry usage is aggregated. Shared requests still consume the normal quota count even if a provider omits token usage.
- Cache telemetry is request-local. A selection bug was fixed so an unselected third result in an earlier facet cannot suppress a selected result in a later facet.
- Task 7 deliberately takes the approved rollout-hold alternative: no Flutter production contract migration. The environment setting is unset locally, which defaults to v2. `.env.example` explicitly documents v2.
- Flutter's generated caches retained an old iCloud checkout path. Moved `.dart_tool` and `build` to `/tmp/gold-flutter-cache.SLF2XG` (recoverable generated-cache backup), then rebuilt them. No application source was removed.
- Two Flutter widget tests had off-screen targets; test-only scrolling fixes produced 72/72 passing tests. Model-list unit tests now mock DNS as well as fetch, preventing live DNS delays from contaminating subsequent mocks.
- Live smoke tests and limitations are in `docs/analyst-benchmark-review.md`. The 50% output-token target is not met, local Ollama timed out, and sample reasoning still requires review. V3 is not activated by this checkpoint.
- Removed a credential-like value from the checked-in environment example without changing actual configured credentials. If genuine, it should be rotated; removing it here does not remove it from Git history.

Final verification on frozen code: `npm test` passed 49 files / 353 tests
(97.19s); Flutter passed 72 tests; `npm run build` and `git diff --check`
passed. The production build still reports the pre-existing generated CSS
`:where()` warning. Task 8 is saved as `checkpoint/analyst-task-8`; this marks
the implementation/review handoff, not approval for production activation.
