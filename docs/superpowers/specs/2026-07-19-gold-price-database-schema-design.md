# Gold Price Database Schema — Design

**Status:** Approved for implementation
**Date:** 2026-07-19
**Relates to:** IMPLEMENTATION_PLAN.md Milestone 4 (backend/database introduction)

## Purpose

Introduce a Postgres database (local install on this Mac for now) to hold gold/FX price history and per-user application state, replacing localStorage-only persistence for the data that benefits from real querying, history, and eventual multi-user support.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Database engine | Postgres, local install | Already installed on this machine; real SQL for range queries/aggregation over price history |
| Normalization strategy | Hybrid | Normalize anything queried/aggregated or that is per-user state (snapshots, users, watchlist, scenarios, tranches, alert rules). Use `jsonb` only for genuinely variable, rarely-filtered shapes (feed diagnostic detail, alert-rule config). |
| User scope | Multi-user from the start | `users` table with `user_id` foreign keys on all per-user tables, even though the app is currently single-user client-side. |
| Price snapshot retention | Keep everything, no expiry | Storage cost is negligible at 30-min interval granularity; no downsampling/cleanup job needed. |
| Ingestion | Scheduled local script | A script (outside this schema's scope) runs periodically, fetches from the same 4-source gold / 2-source FX chains as the MVP, and inserts rows. |

## Tables

### `users`
Single account record. Supports future multi-user even though the app is single-user today.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | `DEFAULT gen_random_uuid()` |
| email | TEXT UNIQUE NOT NULL | |
| display_name | TEXT | |
| preferred_lang | TEXT NOT NULL DEFAULT 'en' | CHECK IN ('ar','en') |
| theme | TEXT NOT NULL DEFAULT 'light' | CHECK IN ('light','vault') |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

### `price_snapshots`
Global market data — one price is true for everyone, not scoped to a user.

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | |
| fetched_at | TIMESTAMPTZ NOT NULL | indexed DESC — primary query axis (history/range) |
| xau_usd | NUMERIC(12,4) NOT NULL | |
| usd_egp | NUMERIC(12,4) NOT NULL | |
| gram_24k_egp | NUMERIC(12,4) NOT NULL | |
| gram_22k_egp | NUMERIC(12,4) NOT NULL | |
| gram_21k_egp | NUMERIC(12,4) NOT NULL | |
| gram_18k_egp | NUMERIC(12,4) NOT NULL | |
| gold_pound_egp | NUMERIC(12,4) NOT NULL | |
| souq_dollar_egp | NUMERIC(12,4) | nullable — depends on calibration having run |
| souq_spread_pct | NUMERIC(8,4) | nullable |
| calibration_premium_pct | NUMERIC(8,4) | nullable |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | row insert time, distinct from `fetched_at` |

Index: `idx_price_snapshots_fetched_at ON price_snapshots (fetched_at DESC)`

### `feed_diagnostics`
One row per source per pull attempt (gold has 4 sources, FX has 2), including failed attempts.

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | |
| snapshot_id | BIGINT REFERENCES price_snapshots(id) ON DELETE CASCADE | nullable — a fully-failed pull may produce no snapshot row |
| feed_type | TEXT NOT NULL | CHECK IN ('gold','fx') |
| source_name | TEXT NOT NULL | |
| success | BOOLEAN NOT NULL | |
| latency_ms | INTEGER | nullable |
| error_message | TEXT | nullable |
| attempted_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| detail | JSONB | raw response snippet / status code, variable shape per source |

Indexes: `idx_feed_diagnostics_snapshot_id ON (snapshot_id)`, `idx_feed_diagnostics_attempted_at ON (attempted_at DESC)`

### `watchlist_items`
Per-user thesis variables (editable watchlist feature).

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | |
| user_id | UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE | |
| label | TEXT NOT NULL | CHECK (char_length(label) <= 40), matches MVP's 40-char cap |
| status | TEXT NOT NULL | tap-to-cycle status value |
| sort_order | INTEGER NOT NULL DEFAULT 0 | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

Index: `idx_watchlist_items_user_id ON (user_id, sort_order)`

### `scenarios`
Per-user probability-weighted scenario bands (scenario engine).

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | |
| user_id | UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE | |
| name | TEXT NOT NULL | |
| band_low | NUMERIC(12,4) | |
| band_high | NUMERIC(12,4) | |
| weight_pct | NUMERIC(5,2) NOT NULL | CHECK (weight_pct BETWEEN 0 AND 100) |
| probability_pct | NUMERIC(5,2) | |
| sort_order | INTEGER NOT NULL DEFAULT 0 | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

Index: `idx_scenarios_user_id ON (user_id)`

Note: the sum-to-100 invariant across a user's scenarios stays application-enforced (already unit-tested per IMPLEMENTATION_PLAN.md §3), not a DB constraint — Postgres CHECK constraints can't easily express a cross-row sum.

### `tranches`
Per-user DCA tranche tracker (40/35/25 plan).

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | |
| user_id | UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE | |
| tranche_number | SMALLINT NOT NULL | CHECK (tranche_number BETWEEN 1 AND 3) |
| plan_pct | NUMERIC(5,2) NOT NULL | 40 / 35 / 25 |
| amount_egp | NUMERIC(14,2) | |
| gram_equivalent | NUMERIC(12,4) | |
| status | TEXT NOT NULL DEFAULT 'pending' | CHECK IN ('pending','triggered','filled') |
| purchased_at | TIMESTAMPTZ | nullable until filled |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

Index: `idx_tranches_user_id ON (user_id)`

### `alert_rules`
Per-user alert configuration (delivery mechanism is out of scope — Milestone 4 hasn't built Telegram/web-push yet; this table only stores what the user has configured).

| Column | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | |
| user_id | UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE | |
| rule_type | TEXT NOT NULL | CHECK IN ('band_edge','egp_move','tranche_window') |
| config | JSONB NOT NULL | shape varies per rule_type |
| active | BOOLEAN NOT NULL DEFAULT TRUE | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

Index: `idx_alert_rules_user_id ON (user_id)`

## Out of scope (explicitly deferred)

- **`alert_events`** (a log of triggered alerts) — speculative until the M4 delivery mechanism (Telegram bot / web push) is actually built. Add when that feature is designed.
- **LLM provider settings** (Ollama/ChatGPT/Claude selection) — separate feature, to be brainstormed and specced independently.
- Retention/downsampling policy for `price_snapshots` — explicitly not needed per user decision (keep everything).
- `updated_at` auto-update triggers — implementation detail (standard Postgres `BEFORE UPDATE` trigger function) to be handled in the implementation plan, not the schema design.

## Testing considerations (for the implementation plan)

- Migration applies cleanly to a fresh Postgres database.
- FK cascade behavior: deleting a user removes their watchlist/scenarios/tranches/alert_rules but never touches `price_snapshots`.
- `feed_diagnostics.snapshot_id` correctly nullable for failed pulls.
- Check constraints reject out-of-range values (e.g. `weight_pct` > 100, invalid `rule_type`).
