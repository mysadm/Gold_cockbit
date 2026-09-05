# Plan: Dynamic Model Discovery for AI Providers

**Status:** Implemented.

**Goal:** Replace the hardcoded `SAMPLE_MODELS` list in `src/lib/aiSettingsAdapter.ts`
with live queries to each provider's actual "list models" API, so the model
dropdown always reflects what's really available instead of a manually
maintained list that silently goes stale (as happened with Gemini's
`gemini-2.0-flash` being retired).

## Decisions made

- **Empty-list fallback:** keep a small hardcoded "last known good" model per
  provider, used only as a fallback when the live fetch fails or returns
  nothing — the dropdown should never be fully empty/stuck.
- **Refresh on key entry:** patch the shared `ai-settings-ui` component so the
  model list also reloads when the API key field loses focus (blur), not just
  on provider change or opening an existing saved connection.

## What was confirmed by probing each provider directly

Every provider this app supports has a real models-list endpoint:

| Provider | Endpoint | Auth |
|---|---|---|
| OpenAI, OpenRouter, Ollama, DeepSeek, Mistral, Groq, Gemini, any custom OpenAI-compatible gateway | `GET {base_url}/models` (standard OpenAI convention) | `Bearer {key}` (OpenRouter's is public — works with no key) |
| Anthropic (Claude) | `GET https://api.anthropic.com/v1/models` (different endpoint/shape) | `x-api-key` + `anthropic-version` header |
| Shared tier | n/a — model is fixed server-side (`claude-haiku-4-5`), no listing needed |

Verified live (with placeholder/no keys, checking path validity via
auth-error-vs-404 status codes):
- Gemini OpenAI-compat `/v1beta/openai/models` → 400 (path valid, needs a real key)
- OpenRouter `/api/v1/models` → 200, public, 396 models, no key required
- Anthropic `/v1/models` → JSON `authentication_error` (path valid)
- DeepSeek / Mistral / Groq / OpenAI `/models` → 401 (path valid, needs a real key)

## Backend changes

1. **`server/providers/listModels.mjs`** (new) — two functions:
   - `listOpenAICompatibleModels({ baseUrl, apiKey })` → GET `/models`, parse
     `data.data.map(m => m.id)`, sorted. Reuses the existing SSRF-safe
     `validateBaseUrl` from `openaiCompatible.mjs` (export it from there).
   - `listAnthropicModels({ apiKey })` → GET Anthropic's models endpoint with
     the right headers (`x-api-key`, `anthropic-version` — reuse the
     `ANTHROPIC_VERSION` constant already defined in `claude.mjs`).
   - `listProviderModels(providerRow)` — dispatches by `provider_type`, same
     branching shape as `runProviderAnalysis` in `dispatch.mjs`. Returns `[]`
     for `shared`.
2. **New routes** in `server/routes/llmProviders.mjs`, mirroring the existing
   `/test` pattern:
   - `POST /api/llm-providers/models` — `{provider_type, base_url, api_key}`
     → `{models: string[]}`, for an unsaved draft.
   - `GET /api/llm-providers/:id/models` — for an existing saved connection,
     reuses its stored key server-side (like `/:id/test` does).
   - Both wrapped in try/catch → `502` with the real provider error message
     on failure (same as `/test`).

## Frontend changes

**`src/lib/aiSettingsAdapter.ts`**:
- Replace `SAMPLE_MODELS`'s per-provider lists with a small fallback map used
  only when the live call fails or returns empty — e.g.
  `gemini: ['gemini-3.6-flash']` as a last resort, not the primary source.
- Rewrite `listModels(providerId, context)`:
  - `context.connectionId` set (editing a saved connection) → call
    `GET /:id/models`.
  - `context.apiKey` set (new/unsaved key typed) → call `POST /models` with
    that key.
  - Neither set (fresh "Add connection", no key yet) → still attempt the
    call (works for OpenRouter/Ollama with no key; fails fast and harmlessly
    for the rest, falls back to the safety-net list).

**`../AI_settings_card/packages/ai-settings-ui`** (local sibling package):
- Add a reload-models call on the API key field's `onBlur`, so "pick provider
  → paste key" refreshes the list without needing to reselect the provider.

## Testing

- Unit tests for `listModels.mjs` (mocked fetch) — success, auth failure,
  empty response, Anthropic's different response shape.
- Route tests for both new endpoints, matching the style of the existing
  `/test` and `/:id/test` tests.
- Manual verification against the real OpenRouter endpoint (public, no key
  needed) as a live smoke test, same way the Gemini fix was verified.

## Explicitly out of scope (unless asked for later)

- No filtering/sorting of OpenRouter's ~396 models beyond alphabetical sort —
  the `<select>` will just be long.
- No caching of model lists — each dropdown open re-fetches. Fine for a
  personal tool; revisit only if it ever feels slow.
