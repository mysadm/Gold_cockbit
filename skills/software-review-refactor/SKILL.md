---
name: software-review-refactor
description: Coordinate evidence-based software reviews across security, privacy, usability, accessibility, architecture, maintainability, testing, reliability, and performance; consolidate findings into a prioritized report; and produce or implement a safe refactoring plan. Use for repository audits, pre-release reviews, technical-debt assessments, code-quality reviews, security reviews, UX reviews, refactoring proposals, and post-change verification.
---

# Software Review and Refactor

Run a review in two gates: diagnose first, modify only when the user explicitly requests implementation.

## Establish scope

1. Read repository instructions and inspect the working tree without altering unrelated changes.
2. Identify languages, frameworks, entry points, trust boundaries, data stores, build commands, tests, and user-facing surfaces.
3. State review scope, exclusions, assumptions, and commands that may require credentials or external services.
4. Treat generated code, vendored dependencies, build output, and lockfiles as out of scope unless directly relevant.

For a small change, use only relevant review roles. For a repository-wide or pre-release review, use every role in [agent-roles.md](references/agent-roles.md). If subagents are available and authorized, assign independent roles in parallel. Otherwise perform the same passes sequentially and keep their evidence separate.

## Build a baseline

Run the repository's existing formatter/linter, type checker, unit tests, integration tests, and build when safe. Record exact commands and results. Do not install dependencies, start external services, mutate databases, or run destructive scanners without permission.

Inspect version-control status before and after review. Never present pre-existing failures as regressions caused by proposed changes.

## Conduct independent review passes

Give each role the same scope and require:

- findings only when supported by a file/line reference, command output, reproducible behavior, or a clearly labeled inference;
- severity, confidence, impact, evidence, and a concrete recommendation;
- explicit coverage notes when no finding is discovered;
- no edits during the diagnosis gate.

Do not count stylistic preference as a defect. Merge duplicates by root cause, retaining all affected locations.

## Triage

Use these priorities:

- `P0 Critical`: active compromise, destructive data loss, or release-blocking safety issue.
- `P1 High`: exploitable security flaw, major privacy/accessibility failure, common user task blocked, or likely data corruption.
- `P2 Medium`: meaningful reliability, maintainability, performance, or usability defect with a workaround.
- `P3 Low`: localized weakness, cleanup, or defense-in-depth improvement.

Raise priority only when impact and likelihood justify it. Mark uncertain findings `Needs validation` rather than overstating them.

## Produce the review report

Follow [report-template.md](references/report-template.md). Lead with actionable findings ordered by priority. Include positives and clean passes after findings, not instead of findings.

For each proposed change, include the smallest safe modification, affected components, compatibility risk, tests, acceptance criteria, and a rollback or containment approach for high-risk changes. Separate quick fixes from architectural work and identify dependencies between fixes.

## Refactor only after authorization

When the user asks to implement fixes:

1. Select an agreed finding or clearly bounded batch.
2. Add or update a test that exposes the defect when practical.
3. Make the smallest cohesive change; avoid unrelated cleanup.
4. Run targeted checks, then the broader relevant suite.
5. Re-run the affected specialist pass and inspect the diff.
6. Update the report with `Fixed`, `Partially fixed`, `Accepted risk`, or `Deferred` plus verification evidence.

Pause for direction when a fix changes public APIs, data schemas, authentication or authorization behavior, privacy behavior, major UX flows, or deployment architecture beyond the approved scope.

## Completion rules

Do not claim the code is secure, accessible, correct, or production-ready. State what was inspected and what was not. Distinguish passing automated checks from manual review. End with residual risks and the next recommended action.

