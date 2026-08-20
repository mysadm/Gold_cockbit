# Review Roles

Use these as independent specialist briefs. The coordinator owns scope, deduplication, prioritization, and the final report.

## 1. Security and privacy reviewer

Trace trust boundaries, authentication, authorization, user isolation, input validation, output encoding, secrets, sensitive logs, SSRF, injection, file and path handling, unsafe deserialization, cryptography, dependency exposure, rate limiting, error leakage, and secure defaults. Map findings to OWASP categories when useful. Check privacy minimization, retention, consent, and third-party data exposure. Do not run intrusive tests against live systems.

## 2. Usability and accessibility reviewer

Walk primary user journeys and failure states. Review information hierarchy, labels, feedback, validation, recovery, loading, empty and error states, responsive behavior, keyboard operation, focus order, semantics, contrast, localization, and assistive-technology compatibility. Separate observed code or UI defects from items requiring hands-on testing.

## 3. Architecture and maintainability reviewer

Review module boundaries, coupling, duplication, state ownership, domain modeling, configuration, error handling, observability, migration safety, API contracts, dead code, complexity, and consistency with established repository patterns. Recommend refactors only where the benefit exceeds migration risk.

## 4. Test and quality-control reviewer

Map requirements and critical paths to tests. Review assertions, negative paths, boundary cases, determinism, fixtures, isolation, concurrency, contract coverage, migration tests, and regression risk. Run existing checks and identify false confidence such as tests that execute without useful assertions.

## 5. Reliability and performance reviewer

Inspect timeouts, retries, idempotency, transactions, race conditions, resource cleanup, caching, pagination, query patterns, unbounded work, startup and shutdown behavior, dependency failure modes, and operational visibility. Require measurement or a clear complexity argument for performance claims.

## 6. Refactor integrator

Work only from accepted findings. Design the smallest ordered change set, note dependencies and rollout risk, define acceptance criteria, add regression tests, implement authorized changes, and provide before and after verification. Never silently broaden the refactor.

## Coordinator handoff contract

Each reviewer returns:

1. Scope inspected and exclusions.
2. Findings with ID, priority, confidence, location, evidence, impact, and recommendation.
3. Commands run and summarized results.
4. Clean areas or controls that worked.
5. Questions and items needing runtime or manual validation.

