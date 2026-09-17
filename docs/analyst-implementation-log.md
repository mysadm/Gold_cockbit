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
