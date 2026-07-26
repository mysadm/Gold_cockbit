# Flutter Mobile App — Design Spec

Status: approved
Date: 2026-07-26

## Goal

Build a Flutter mobile app (iOS + Android) in a new `flutter_app/` folder at the repo root, replicating all functionality of the existing Gold Cockpit web app (Preact + Express + Postgres), backed by the same database via REST, and using the same LLM provider configuration for the AI analyst feature.

## Context (as of this design)

- Backend: Express server (`server/`) with routes for `llm-providers`, `analyze`, `egypt-prices` only, all behind a shared `x-api-key` middleware (`server/auth.mjs`), operating against a single default user (`ensureDefaultUser.mjs`) — no login system exists.
- Database (`migrations/0001`–`0009`): tables for `users`, `price_snapshots`, `feed_diagnostics`, `watchlist_items`, `scenarios`, `tranches`, `alert_rules`, `llm_providers`. Of these, **`scenarios`, `tranches`, `watchlist_items`, `alert_rules` have no REST routes yet** — the web app (`src/App.tsx`) manages this data as local component state only, not persisted server-side.
- **`price_snapshots` is unused** — nothing writes to it. The web app fetches live gold/FX prices client-side, on each load, via a fallback chain against external free APIs: gold-api.com, goldprice.org, Binance (PAXGUSDT), jsdelivr currency-api, er-api.com. No server involvement.
- `gold-cockpit.html` (the original single-file MVP) has a known XSS issue (LLM response fields inserted via unescaped `innerHTML`) — not relevant to Flutter, noted here only because it motivated re-checking how AI responses get rendered.

## Scope

### 1. Backend additions (Express + Postgres)

Add REST routes for the four DB-backed features that currently lack them, following the exact pattern of the existing `llmProviders.mjs` route (Router, `createApiKeyAuthMiddleware()`, public-column allowlist, parameterized `db.query`, scoped to the shared `userId`):

- **`server/routes/scenarios.mjs`** — `GET /api/scenarios` (list), `PATCH /api/scenarios/:id` (update band_low/band_high/weight_pct/probability_pct/sort_order) — maps to `scenarios` table.
- **`server/routes/tranches.mjs`** — `GET /api/tranches` (list), `PATCH /api/tranches/:id` (status, amount_egp, gram_equivalent, purchased_at) — maps to `tranches` table.
- **`server/routes/watchlist.mjs`** — `GET /api/watchlist`, `POST /api/watchlist`, `PATCH /api/watchlist/:id`, `DELETE /api/watchlist/:id` — maps to `watchlist_items` table.
- **`server/routes/alertRules.mjs`** — `GET /api/alert-rules`, `POST /api/alert-rules`, `PATCH /api/alert-rules/:id`, `DELETE /api/alert-rules/:id` — maps to `alert_rules` table.

No changes to `price_snapshots`, auth model, or the existing three routes. Each new router is mounted in `server/index.mjs` alongside the existing ones.

### 2. Flutter app

**Folder**: `flutter_app/` — self-contained Flutter project at repo root.

**Stack**: Riverpod (state management), `dio` (HTTP client), `flutter_secure_storage` (API base URL / key persistence), `shared_preferences` (UI prefs: language, theme).

**Structure**:

```
flutter_app/
  lib/
    core/
      api_client.dart       # dio instance, x-api-key interceptor, configurable base URL
      config.dart           # base URL / key storage via secure_storage, defaults
      price_feed/           # fallback-chain price fetchers (gold-api, goldprice, binance, jsdelivr, er-api)
    features/
      market/               # live board: spot, EGP, karats, gold pound, دولار الصاغة, chart
      scenarios/             # scenario engine: weights, bands, weighted target — via /api/scenarios
      tranches/               # DCA tranche tracker — via /api/tranches
      watchlist/               # editable watchlist — via /api/watchlist
      calculator/               # karat purchase calculator (pure client-side math, no API)
      ai_analyst/               # prompt builder + POST /api/analyze + result rendering
      llm_providers/            # /api/llm-providers CRUD + activation, settings screen
      egypt_prices/              # GET /api/egypt-prices calibration
    l10n/                    # ar/en strings, mirrors the `T` translation object in src/App.tsx
    app.dart, main.dart
  test/
```

Each `features/<name>/` has its own `data/` (repository calling the API client or price feed), `application/` (Riverpod providers/notifiers), `presentation/` (screens/widgets) — independently testable, no cross-feature coupling beyond shared `core/`.

**Auth model**: no login screen. App connects to the API using the shared `x-api-key` header and operates as the single default user, matching current web app behavior exactly.

**Platforms**: iOS + Android (Flutter default cross-platform target).

**API hosting**: server currently runs locally only. Base URL is user-configurable (stored via `flutter_secure_storage`) so it can point to a deployed host later; defaults to localhost/LAN IP for development.

### Data flow

Screens read Riverpod providers → providers call feature repositories → repositories call either:
- `dio` against the Express API, for DB-backed features (scenarios, tranches, watchlist, alert_rules, llm_providers, analyze, egypt_prices), or
- the local price-feed fallback chain, for live market data (mirrors the web app's chain exactly, same source order and fallback behavior).

The AI analyst screen builds the same structured prompt as `src/App.tsx` (cockpit state + scenario weights + watchlist context), POSTs it to `/api/analyze`, and renders the JSON response fields (`one_liner`, `trends`, `weights_reasoning`, `tranche2`, `egp_read`) as plain Flutter `Text` widgets. Flutter has no `innerHTML`-equivalent sink, so the injection class of bug present in `gold-cockpit.html` does not reproduce here structurally.

### Error handling

- A `dio` interceptor catches network/timeout errors uniformly across repositories.
- Each screen shows an inline retry state on failure.
- Price feed failures surface which specific source failed (per-source diagnostics), matching the web app's existing fallback-chain UX rather than a generic "error" message.
- If the API base URL/key isn't configured, the app shows a setup prompt instead of crashing or silently failing.

### Testing

- Widget tests for each feature's presentation layer.
- Unit tests for repositories/providers with mocked `dio` (via `mocktail` or dio's built-in mock adapter).
- No integration tests against a live server in CI — matches the existing `vitest` scope in the JS backend (route/unit-level, not live-server integration).

## Out of scope

- Real authentication / multi-user support.
- Persisting price snapshots server-side (`price_snapshots` stays unused).
- Fixing the `gold-cockpit.html` XSS issue (tracked separately, not part of this project).
