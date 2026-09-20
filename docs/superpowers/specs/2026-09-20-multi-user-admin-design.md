# Multi-user with admin-only Settings — Design

**Date:** 2026-09-20
**Status:** Draft for review (approved section by section in conversation)

## Goal

Turn Gold Cockpit from a single-user app into a multi-user one. Every
approved user can use every screen with their own private data. Only the
admin can open **Settings** (which today contains only the AI model
configuration) and manage users. Everyone's analyses run on the admin's AI
configuration, with a per-user daily cap protecting the admin's credits.

## Decisions (from the brainstorm)

| Question | Decision |
|---|---|
| Data ownership | Each user has their own wallet, DCA plan, tranches, scenario weights, watchlist and alerts. |
| Account creation | Anyone can register; the account is `pending` until the admin approves it. |
| AI usage | One system-wide AI configuration (the admin's active provider). Each regular user has a daily analysis cap the admin can change; the admin is unlimited. |
| First admin | Created once per machine by `node scripts/create-admin.mjs <email>`, which converts the existing `default@local` user (keeping all its data). No first-visit setup page. |
| Session mechanism | Server-side sessions in Postgres + HttpOnly cookie. |

## Current state (why this is architectural)

- `server/index.mjs` calls `ensureDefaultUser(pool)` once at boot and passes
  that single `userId` into ten router factories. There is no login.
- The only access control is an optional shared `GOLD_COCKPIT_API_KEY`
  header check (`server/auth.mjs`), which the browser never sends.
- Most tables already carry `user_id` (watchlist_items, scenarios, tranches,
  alert_rules, llm_providers, dca_plan, wallet_*, ai_shared_usage,
  egypt/international price history is global market data).
- The Settings tab renders only `AIModelSettingsManager`, so "Settings" and
  "AI model configuration" are the same surface.
- The client keeps some state in `localStorage` under one global key
  (`gold-cockpit-state-v1`), which would leak between users on a shared
  browser.

## Data model (migrations 0024+)

- `users`: add `password_hash TEXT`, `role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('admin','user'))`, `status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending','active','disabled'))`,
  `daily_ai_limit INTEGER NOT NULL DEFAULT 3`.
- New `sessions`: `id UUID PK`, `user_id UUID → users ON DELETE CASCADE`,
  `token_hash TEXT UNIQUE NOT NULL` (SHA-256 of the cookie token — the raw
  token is never stored), `expires_at TIMESTAMPTZ`, `created_at`.
- At most one admin is required, but the schema allows several.
- Personal tables are unchanged. `llm_providers` rows belong to the admin
  user; analysis selects the active provider of the (single) admin.
- `ai_shared_usage` (existing, `UNIQUE (user_id, used_on)`) is reused as the
  per-user daily counter. **Behaviour change:** today it is written only when
  the active provider type is `shared`; it must now be written for **every**
  regular-user analysis regardless of provider type. The env-based
  `SHARED_AI_DAILY_LIMIT` is retired in favour of `users.daily_ai_limit`.
  The `shared` provider type itself keeps working.
- Emails are stored lower-cased and compared case-insensitively.

## Server

### Auth (open routes)

- `POST /api/auth/register` `{email, password, display_name}` → creates a
  `pending` user; no session. Passwords: minimum 8 characters.
- `POST /api/auth/login` `{email, password}` → sets the session cookie.
  `pending` → 403 "waiting for admin approval"; `disabled` → 403 "account
  disabled"; unknown email and wrong password return the same 401.
- `POST /api/auth/logout` → deletes the session, clears the cookie.
- `GET /api/auth/me` → `{id, email, display_name, role, daily_ai_limit,
  ai_used_today}` or 401.
- Login and register are rate-limited per IP (in-memory, small window).

### Access control

- `requireAuth` middleware on every other `/api/*` route: reads the cookie,
  looks up the session by token hash, checks `expires_at` and that the
  user's `status` is `active` **on every request** (so disabling a user locks
  them out immediately), and sets `req.user`.
- Routers stop taking a boot-time `userId`; handlers use `req.user.id`.
  Shared market-data routes (egypt/international prices, software review)
  require login but are not user-scoped.
- `requireAdmin` (403 otherwise) guards the whole `/api/llm-providers` group
  and the admin routes below.
- The old `GOLD_COCKPIT_API_KEY` middleware is removed.

### Admin routes

- `GET /api/admin/users` (status, role, today's usage, limit)
- `POST /api/admin/users/:id/approve` — sets `active` and provisions the
  user's defaults (`ensureDefaultScenarios/Tranches/DcaPlan/WalletHoldings`,
  now called per user).
- `POST /api/admin/users/:id/disable`, `/enable`
- `PATCH /api/admin/users/:id` — `daily_ai_limit` only.
- `POST /api/admin/users/:id/reset-password` — admin supplies a new password.
- The admin cannot disable or demote themselves. No user deletion.

### Analysis

`POST /api/analyze` is available to every active user. The server resolves
the admin's active provider, rejects a regular user who has reached
`daily_ai_limit` with a clear error (HTTP 429), and records usage after a
successful call. `GET /api/analyze/quota` reports used/limit for the current
user. Both the v2 and compact v3 paths use the same gate.

### Security

- `scrypt` (Node `crypto`) with a random per-user salt, compared with
  `timingSafeEqual`.
- Session token: 32 random bytes; cookie `HttpOnly; SameSite=Lax; Path=/`,
  `Secure` when the request arrived over HTTPS (honouring
  `X-Forwarded-Proto`); 30-day lifetime.
- All mutating routes are non-GET and JSON-only; SameSite=Lax is the CSRF
  defence.
- Startup refuses to run if no admin exists, printing the
  `create-admin.mjs` instruction, so the app is never open without an admin.

## Client

- **Login/register screen** when `/api/auth/me` returns 401; registration
  ends on a "waiting for admin approval" message. Follows the existing
  Arabic/English and dark/light choices.
- **Gating:** Settings is removed from `Sidebar` and the mobile `BottomNav`
  More sheet for non-admins, and the tab renders nothing for them (server
  enforcement is authoritative).
- **Users panel** (admin only) below `AIModelSettingsManager` in the Settings
  tab: table of users with status, today's count, limit; actions Approve,
  Disable/Enable, edit limit, Reset password; a pending-count badge.
- **Identity:** name + Logout in the sidebar footer and the More sheet; the
  Analyst screen shows "N of M analyses used today" for regular users and a
  clear message at the limit.
- **Per-user browser storage:** state key becomes
  `gold-cockpit-state-v1:<userId>`. On the admin's first login the legacy
  `gold-cockpit-state-v1` value is moved to the admin's key so nothing is
  lost.
- Any 401 mid-session returns the app to the login screen.

## Migration and rollout

- Migrations apply with `npm run migrate` (already run by
  `scripts/db-import.sh`).
- `scripts/create-admin.mjs <email>` prompts for a password, then converts
  the `default@local` user into the admin (role `admin`, status `active`,
  email and hash set), preserving its data; on an empty database it creates
  a fresh admin and its defaults.
- Implementation order, each step leaving the app working and tests green:
  1. Migrations and `create-admin.mjs`.
  2. Password hashing, sessions, `requireAuth`/`requireAdmin`, auth routes.
  3. Routers switched to `req.user.id`; existing server tests updated.
  4. Admin routes, per-user provisioning, daily cap and quota.
  5. Client login screen, gating, per-user storage, 401 handling.
  6. Users panel.

## Testing

- Every non-auth route returns 401 without a session; every admin route
  returns 403 for a regular user.
- Isolation: user A cannot read or modify user B's wallet, DCA plan, tranches,
  scenarios, watchlist or alerts.
- `pending` and `disabled` users cannot log in; disabling invalidates an
  existing session on its next request.
- Daily cap: the (N+1)th analysis is refused, the admin is exempt, usage is
  counted for every provider type, and a failed analysis does not consume
  quota.
- Admin cannot disable or demote themselves; wrong password and unknown email
  are indistinguishable.
- Password hash/verify, session expiry, logout invalidation, rate limiting.
- Client: Settings hidden for regular users, login screen on 401, storage
  keyed by user, legacy state migrated for the admin.
- The existing 358 tests keep passing after the router-construction tests are
  updated.

## Out of scope

Password-reset emails, social login, users changing their own email or
password (admin reset only), user deletion, multiple organisations.

## Risks and notes

- Step 3 touches about ten routers and their tests; it is mechanical but
  wide, hence its own step.
- Provider API keys stay in the database as plaintext (unchanged); the
  attack surface shrinks because only the admin can read them.
- The analysis prompt and validator are unaffected.
