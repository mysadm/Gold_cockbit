# LLM Provider Settings Page — Design

**Status:** Approved for implementation
**Date:** 2026-07-19
**Relates to:** IMPLEMENTATION_PLAN.md's AI analyst feature; reuses infrastructure from `docs/superpowers/specs/2026-07-19-gold-price-database-schema-design.md`

## Purpose

Replace the app's hardcoded, single-provider AI analyst (Anthropic Claude only, API key entered inline in the AI Analyst tab, key stored in localStorage) with a settings page that lets the user configure and switch between multiple LLM providers: local Ollama, OpenAI, Claude, and arbitrary OpenAI-compatible "Custom" endpoints.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Provider switching model | Settings page picks one active provider; Analyze always uses whichever is active | Simpler mental model than a per-request dropdown; matches how the user described the feature |
| Settings storage | Postgres, new `llm_providers` table, per-user | Reuses the multi-user DB already built; survives beyond a single browser/device |
| Browser ↔ Postgres bridge | A small local Node/Express API server | Browsers can't speak Postgres directly; this becomes the app's first real backend, earlier than `IMPLEMENTATION_PLAN.md` Milestone 4, but it's the only way to use Postgres from the client |
| User identity | One fixed default user, auto-created on server startup (`INSERT ... ON CONFLICT DO NOTHING`) | No login UI exists yet; this is the seam where real auth slots in later without changing the settings table shape |
| Web-search capability | Declared per `provider_type` in code (a `PROVIDER_CAPABILITIES` map), not user-toggled or DB-stored | Claude supports the `web_search` tool; OpenAI/Ollama/Custom don't in this design. One source of truth avoids a capability flag drifting from what the adapter actually does |
| Provider extensibility | Built-in types (Ollama, OpenAI, Claude) + a generic "Custom OpenAI-compatible" type | Covers the vast majority of "other models" (LM Studio, vLLM, OpenRouter, Groq, etc. all speak the OpenAI chat-completions shape) without a code change per new provider |
| LLM call routing | All provider calls proxied through the backend (`POST /api/analyze`), never called directly from the browser | OpenAI's API has no CORS support for browser calls at all; Ollama blocks cross-origin by default. Routing through the backend solves this for every provider in one place and means API keys never reach the browser — a real security improvement over today's inline key field |

## Components

### 1. Database: `llm_providers` table

New migration `migrations/0009_create_llm_providers.sql`, applied by the existing migration runner (`db/migrate-runner.mjs`) built for the price-data schema — no new migration tooling.

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | |
| user_id | UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE | |
| provider_type | TEXT NOT NULL CHECK (provider_type IN ('ollama', 'openai', 'claude', 'custom')) | |
| label | TEXT NOT NULL | display name, e.g. "Home Ollama" |
| base_url | TEXT | required for `ollama`/`custom`; null for `openai`/`claude` (fixed defaults used) |
| api_key | TEXT | null for `ollama`; plaintext (see Security below) |
| model | TEXT NOT NULL | e.g. `llama3.1`, `gpt-4o`, `claude-sonnet-4-6` |
| is_active | BOOLEAN NOT NULL DEFAULT FALSE | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | reuses the existing `set_updated_at()` trigger function |

Indexes:
- `idx_llm_providers_user_id ON llm_providers (user_id)`
- **Partial unique index** `idx_llm_providers_one_active_per_user ON llm_providers (user_id) WHERE is_active` — enforces "at most one active provider per user" as a real DB constraint (stronger than the app-only sum-to-100 invariant used for `scenarios`).

Web-search capability is deliberately **not** a column — it's a pure function of `provider_type`, computed in code (see Component 3), so there is exactly one place that can get it wrong.

### 2. Backend API server

New `server/index.mjs` — a small Express app reusing `db/connection.mjs` from the price-data schema work. On startup it ensures the default user exists via `INSERT INTO users (email) VALUES ('default@local') ON CONFLICT DO NOTHING`, then uses that user's `id` for every request (no auth header, no session — single fixed identity).

Routes:
- `GET /api/llm-providers` — list all providers for the default user
- `POST /api/llm-providers` — create one (`provider_type`, `label`, `base_url?`, `api_key?`, `model`)
- `PUT /api/llm-providers/:id` — update fields
- `DELETE /api/llm-providers/:id` — remove
- `POST /api/llm-providers/:id/activate` — single transaction: deactivate all of the user's providers, then activate the given `:id`
- `POST /api/analyze` — body `{ prompt: string }`; loads the active provider row, dispatches to the matching adapter (Component 3), returns `{ text: string, usedWebSearch: boolean }`

Vite's dev server proxies `/api/*` to this backend (replacing the current dev-only `/api/anthropic` proxy in `vite.config.ts`). In production, this server fronts all `/api/*` traffic — there is no direct-to-provider browser call path anymore.

### 3. Provider adapters (server-side only)

Two adapters, not four:

- **`server/providers/claude.mjs`** — Anthropic Messages API. Carries over the existing logic already in `src/App.tsx`'s `callAPI`/`analyze`: web-search tool included by default, retry-once-without-tools on failure, JSON-extraction continuation turn if the first reply isn't parseable JSON.
- **`server/providers/openaiCompatible.mjs`** — plain chat-completions request shape, parameterized by `base_url` / `api_key` / `model`. Used for **OpenAI** (`base_url` defaults to `https://api.openai.com/v1`), **Ollama** (`base_url` defaults to `http://localhost:11434/v1`, its OpenAI-compatible endpoint, no `api_key`), and **Custom** (`base_url` and `api_key` both user-supplied). None of these three get the web-search tool.

A `PROVIDER_CAPABILITIES` constant (`server/providers/capabilities.mjs`):
```js
export const PROVIDER_CAPABILITIES = {
  claude: { supportsWebSearch: true },
  openai: { supportsWebSearch: false },
  ollama: { supportsWebSearch: false },
  custom: { supportsWebSearch: false },
};
```
`/api/analyze` consults this to decide whether `claude.mjs` is called with the web-search tool enabled; the other three always call `openaiCompatible.mjs` without it.

### 4. Frontend: Settings page UI

A new `'settings'` entry added to the `TabKey` union in `src/App.tsx`, alongside the existing `home | market | calc | target | scenarios | ai | dca | watch` tabs — same tab-bar pattern, no new navigation concept.

**Layout:** a list of configured provider cards (label, type, model, an "Active" badge on the current one) with **Set active** / **Edit** / **Delete** actions per card, plus an "Add provider" form below the list.

**Add/Edit form fields**, shown conditionally on the selected `provider_type`:
- **Type** — dropdown: Ollama / OpenAI / Claude / Custom
- **Label** — free text (e.g. "Home Ollama")
- **Base URL** — shown for Ollama (prefilled `http://localhost:11434/v1`, editable) and Custom (required, no prefill); hidden for OpenAI/Claude
- **API key** — password-masked input, shown for OpenAI/Claude/Custom; hidden for Ollama
- **Model** — free text (e.g. `llama3.1`, `gpt-4o`, `claude-sonnet-4-6`)

Submitting POSTs/PUTs to `/api/llm-providers`; the card list refetches after any create/update/delete/activate. All new copy follows the existing `T` translation-object pattern (paired `ar`/`en` strings), matching every other tab.

The existing inline Anthropic API-key field in the AI Analyst tab is **removed**. That tab keeps only the Analyze button, the beginner/expert explanation-level toggle, and the results display — provider configuration moves entirely to Settings.

### 5. Analyze flow rewrite

`src/App.tsx`'s `analyze()` keeps its existing prompt-construction logic (cockpit state → prompt string, unchanged) but replaces the direct `fetch('https://api.anthropic.com/...')` call with `POST /api/analyze { prompt }`. The response `{ text, usedWebSearch }` feeds into the **existing** `tryParseJson` / `normalizeAIResult` / `buildFallbackAnalysis` pipeline unchanged — that logic is UI-facing text interpretation and doesn't care which provider produced the text.

Removed from `src/App.tsx`: the `aiKey` state field, `KEY_KEY`/localStorage persistence for it, and the "API key required first" guard — credentials live server-side now. The `aiLevel` (beginner/expert) toggle is unchanged, still in localStorage, since it's a display preference, not a credential.

Error handling keeps the same friendly-message mapping already in place (network failure → local-fallback message, HTTP 5xx → retry suggestion), just sourced from the `/api/analyze` response instead of a raw Anthropic fetch.

## Security

API keys are stored as plaintext `TEXT` in the local Postgres database. This is acceptable for a local, single-user desktop tool (matching the trust model of the current localStorage-based key storage, which is also plaintext), but it is a deliberate simplification: this design does not add encryption-at-rest, and the `llm_providers` table should not be treated as safe to expose beyond the local machine without further hardening.

## Testing considerations (for the implementation plan)

- **DB:** migration test asserting `llm_providers` columns/constraints, plus a test proving the partial unique index actually enforces "activating a new provider deactivates the previous active one" (real transactional behavior, not just schema shape).
- **Backend:** route tests for CRUD + activate against a real test Postgres database (not mocks), and a test confirming `/api/analyze` dispatches to `claude.mjs` vs `openaiCompatible.mjs` based on `provider_type` — the actual outbound HTTP call to each provider is mocked at the network boundary, since tests should not call real OpenAI/Ollama/Claude endpoints.
- **Frontend:** no new Playwright suite required beyond what's already planned in `IMPLEMENTATION_PLAN.md`; manual verification that switching the active provider changes what `/api/analyze` calls.

## Out of scope (explicitly deferred)

- Real authentication/login — single default user only, per the User Identity decision above.
- API key encryption at rest — plaintext, per the Security section above.
- Streaming responses — `/api/analyze` stays request/response, matching today's behavior.
- Any change to the `scenarios`, `tranches`, `watchlist_items`, or `alert_rules` tables from the earlier database work.
- A per-request provider dropdown (rejected in favor of one "active" provider — see Decisions).
- User-editable web-search capability per provider (rejected — capability is fixed by `provider_type` in code, see Decisions).
