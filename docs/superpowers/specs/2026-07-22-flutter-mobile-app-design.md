# Gold Cockpit Flutter Mobile App — Design

## Goal

Ship a Flutter app (Android + iOS, single Dart codebase) that mirrors Gold Cockpit's core functionality, matching its visual identity and bilingual (Arabic/English, RTL/LTR) support.

## Decisions already made

- **Framework**: Flutter (installed on this Mac via Homebrew). Android build target first; iOS deferred until Xcode is installed by the user (Apple requires the App Store install, which cannot be automated).
- **Backend**: reuse the existing Express + Postgres backend as-is. No provider logic gets reimplemented in Dart.
- **Backend hosting**: Fly.io, once needed (see Milestone ordering below).
- **First milestone scope**: read-only core (price board, karat calculator, weighted target, scenarios) before AI Analyst, Settings, or Watchlist.

## Key finding that reorders the roadmap

Auditing `server/index.mjs` and `src/App.tsx` shows the backend only mounts two routers: `/api/llm-providers` and `/api/analyze`. The price board, calculator, target, and scenarios tabs read/write `window.localStorage` and call public third-party price APIs directly from the browser — they never touch the Express backend. This means:

- **Milestone A (Flutter scaffold + read-only core) has no backend dependency at all.** It can ship standalone, calling the same public APIs directly from the phone.
- **Milestone B (Fly.io deployment) is only a prerequisite for Milestone C (AI Analyst + Settings)**, not for Milestone A.

Revised order: **A → B → C**, instead of the originally assumed B → A.

## Milestone A — Flutter scaffold + read-only core (no backend needed)

**New directory**: `mobile/` at the repo root, a standalone Flutter project (`gold_cockpit_mobile`).

**Architecture**:
- **State management**: Riverpod (`flutter_riverpod`) — one provider per domain area (prices, scenario weights, settings), mirroring the single `AppState` object pattern already used in `src/App.tsx`.
- **Local persistence**: `shared_preferences`, using the same JSON shape currently stored under `STORAGE_KEY`/`MONITORS_KEY`/`LEVEL_KEY` in `src/App.tsx`, so a future "import your web data" path is trivial.
- **Networking**: `http` package, calling the exact same public endpoints already used in `App.tsx` (gold-api.com, goldprice.org, Binance PAXGUSDT, jsdelivr currency API, open.er-api.com), with the same timeout/fallback chain.
- **Domain logic**: `lib/domain.dart`, a straight Dart port of `src/domain.ts` (`rebalanceScenarioWeights`, `calculateWeightedTarget`, `calculateKaratBreakdown`), with `flutter test` unit tests mirroring the existing Vitest cases for the same functions.
- **i18n**: `flutter_localizations` + `intl`, ARB files for `en`/`ar`, `Directionality`/`MaterialApp.locale` driving RTL for Arabic — same content as the `T` translation object in `App.tsx`, ported key-for-key.
- **Theming**: `ThemeData` (light + "vault" dark) built from the tokens documented in `UI_GUIDELINES.md` — brand green `#00B240`, scenario colors `#4E8F7B`/`#C9A227`/`#B4482E`, fonts Cairo/IBM Plex Mono/Carlito (bundled as Flutter assets).
- **Screens** (bottom nav or tab bar, matching the web app's tab order): Home/Price Board, Karat Calculator, Weighted Target, Scenarios.

**Testing**: `flutter test` for domain logic (port of existing Vitest suite) and basic widget tests per screen (renders, responds to input). No integration/E2E in this milestone.

**Definition of done**: app builds and runs in the Android emulator, all four core screens functional, weights/spot price/karat calc persist across restarts, UI matches light/dark themes, Arabic toggle flips layout to RTL and translates all visible strings.

## Milestone B — Deploy the existing backend to Fly.io

Needed only once Milestone C starts (AI Analyst / Settings need a backend the phone can reach over the internet — `localhost` doesn't work from a physical phone or most emulator configs).

- `fly.toml` + a `Dockerfile` wrapping the existing `server/` (Node/Express) app, `PORT` from `SERVER_PORT`.
- `fly postgres create`, attached to the app; `DATABASE_URL` and any LLM API keys set via `fly secrets set`.
- Migrations (`db/migrate.mjs`, files in `migrations/`) run via a `release_command` in `fly.toml` on each deploy.
- Add CORS middleware to `server/index.mjs` (currently has none — fine for same-origin Vite dev proxy, not fine for a phone hitting a public URL cross-origin).
- Verify via `curl` against the live Fly URL before touching the Flutter side.

## Milestone C — AI Analyst + Settings in Flutter

- New screens: AI Analyst (POSTs to `${apiBaseUrl}/api/analyze`, renders the same weighted-scenario/tranche/EGP-read structure as the web app), Settings (CRUD against `/api/llm-providers`, mirrors `src/api/llmProviders.ts`).
- `apiBaseUrl` supplied at build time via `--dart-define=API_BASE_URL=https://<fly-app>.fly.dev`, not hardcoded, so builds can point at a local dev server or the deployed one.
- No API-key handling needed client-side — the backend already excludes `api_key` from all responses (`PUBLIC_COLUMNS` in `server/routes/llmProviders.mjs`).

## Later (not designed yet)

Watchlist, DCA tracker, push notifications for price alerts, app store distribution (Google Play / TestFlight/App Store).

## Out of scope for this spec

- Any change to the existing web app's behavior.
- Authentication/multi-user support (both web and mobile continue to use the single `default@local` user).
- iOS-specific work (build config, signing, TestFlight) until Xcode is installed.
