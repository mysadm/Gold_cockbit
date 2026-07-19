# LLM Provider "Test Connection" Button — Design

**Status:** Approved for implementation
**Date:** 2026-07-19
**Relates to:** `docs/superpowers/specs/2026-07-19-llm-settings-page-design.md`

## Purpose

Let a user verify a provider's credentials/endpoint actually work before saving it, directly from the add/edit form in the Settings tab.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Placement | Add/edit form only, not on saved cards | User confirmed: test what's currently typed in, before committing to Save |
| What "test" proves | A real round-trip through the actual provider (not just reachability) | Only a real call proves the URL/key/model combination genuinely works |
| Route | New `POST /api/llm-providers/test` on the existing router | Takes form fields directly (no DB row required), so an unsaved form can be tested |
| Test payload | Fixed prompt `"Reply with only the single word: OK"` | Cheapest possible real call; response text isn't parsed as JSON, just shown as proof of a working round trip |
| Dispatch reuse | Calls the existing `runProviderAnalysis()` (same code path as `/api/analyze`) | No new adapter logic — proves the exact same path the real Analyze button uses |

## Backend

`server/routes/llmProviders.mjs` gains one new route:

```
POST /api/llm-providers/test
body: { provider_type, base_url, api_key, model }
```

- Success: `200 { text: string }` — the provider's raw reply.
- Failure: mirrors `/api/analyze`'s pattern — `502 { error: string }` on a provider-call failure.
- No database read/write — the row shape is built entirely from the request body and handed to `runProviderAnalysis`.

## Frontend

- `src/api/llmProviders.ts` gains `testProvider(input): Promise<{ text: string }>`.
- The Settings add/edit form gets a "Test" button. On click, it builds the same type-normalized payload `saveProvider` already builds (base_url/api_key nulled per `provider_type`), calls `testProvider`, and shows an inline "Testing…" → success (provider's reply, truncated) or error message near the button.
- New translation keys (`ar`/`en`): test button label, "testing" state, and the success/error message prefixes.
- New CSS: `.settings-success` (green) alongside the existing `.settings-error` (red).

## Out of scope

- A Test button on already-saved provider cards.
- Any retry/timeout behavior beyond what the adapters already implement.
- Persisting test history or logging test attempts.
