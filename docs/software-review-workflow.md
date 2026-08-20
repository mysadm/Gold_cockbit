# Software Review and Refactoring Workflow

The reusable skill lives at `skills/software-review-refactor`.

## How it works

```text
Request and scope
      |
      v
Repository map + baseline checks
      |
      +--> Security/privacy review --------+
      +--> Usability/accessibility review -+
      +--> Architecture/quality review ----+--> Coordinator deduplicates and prioritizes
      +--> Test/QC review -----------------+                 |
      +--> Reliability/performance review -+                 v
                                                   Evidence-based report
                                                            |
                                              user approves selected fixes
                                                            |
                                                            v
                                               Refactor + regression tests
                                                            |
                                                            v
                                                  Independent verification
```

Review and modification are separate gates. A request to review produces findings and recommendations but does not change code. A request to fix authorizes only the selected findings or stated scope.

## Suggested prompts

Full review:

> Use `$software-review-refactor` to review this repository for security, privacy, usability, accessibility, maintainability, testing, reliability, and performance. Do not edit code. Produce a prioritized report with file and line evidence, commands run, limitations, and a staged refactoring roadmap.

Review one change:

> Use `$software-review-refactor` to review the current diff. Focus on security regressions, user-visible behavior, API compatibility, migration risk, and missing tests. Do not edit code.

Implement approved findings:

> Use `$software-review-refactor` to implement findings SEC-01 and QC-02 from the review. Add regression tests, avoid unrelated cleanup, run relevant checks, and update each finding with verification evidence.

## Agent set

The coordinator invokes five independent review perspectives and one implementation role. Small changes may use only relevant roles; repository-wide and release reviews use all roles. Detailed briefs and the reviewer handoff format are in `references/agent-roles.md` inside the skill.

## Skills and tools

The workflow has no mandatory external plugin. It uses repository-native build, lint, test, and analysis tools first. Optional integrations can add depth:

- Codex Security for specialized security analysis.
- GitHub for pull-request context and review comments.
- Sentry for production error evidence.
- PostHog for real usage and journey evidence.
- Figma for comparing implemented UI with source designs.

Connect optional services only when their data is needed and the repository owner approves access. Their absence must appear under report limitations, not be treated as a clean result.

## Installation

Keep the skill in this repository for version control. To make it globally discoverable, copy the complete `skills/software-review-refactor` directory into the active Codex skills directory, preserve its internal structure, then restart or reload Codex if required by the environment.
