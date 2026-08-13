# Gold Cockpit — Improvement Plan

Source: [Gold Cockpit Field Review](https://claude.ai/code/artifact/f35e1bfd-3a16-49db-9d54-6658fbb2d0e3) (small-investor/hedger CX audit, 2026-08-13).

Format note: each item is written for a coding agent to execute with minimal re-exploration —
exact files, exact functions, no narrative. Follow repo conventions already in place: TDD
(failing test → implement → pass), migrations for schema, `Number()` coercion at API boundaries
for NUMERIC/BIGINT columns, `withTransactionClient` pattern in `server/routes/wallet.mjs` for any
multi-statement DB write. Do not re-derive these patterns — read the referenced file's existing
code for the pattern before writing new code.

Ordered smallest-effort-first per user direction — work top to bottom, one item at a time, on
explicit go-ahead. Original value ranking is noted per item as `(was P0/P1/P2)` for reference but
no longer sets the order.

## Queue (small → medium → large)

| # | Item | Effort |
|---|---|---|
| 1 | [Spread / making-charge disclosure](#s1-spread--making-charge-disclosure) | Small |
| 2 | [CSV export of wallet transactions](#s2-csv-export-of-wallet-transactions) | Small |
| 3 | [Cache the Egypt price source + staleness](#s3-cache-the-egypt-price-source--staleness) | Small |
| 4 | [Wire alert rules to Target + DCA](#s4-wire-alert-rules-to-target--dca) | Small |
| 5 | [Cost basis + P&L on the wallet](#s5-cost-basis--pl-on-the-wallet) | Medium |
| 6 | [EGP-hedge-effectiveness metric](#s6-egp-hedge-effectiveness-metric) | Medium |
| 7 | [Port wallet + transactions to Flutter](#s7-port-wallet--transactions-to-flutter) | Medium-Large |
| 8 | [Configurable, open-ended DCA](#s8-configurable-open-ended-dca) | Large |
| 9 | [Default/shared AI tier](#s9-defaultshared-ai-tier) | Large — needs a cost decision first |

Tell me a number (or "next") when ready and I'll execute just that item — TDD where a test file
is named, otherwise implement + manual verify — then report back before moving on.

---

## S1. Spread / making-charge disclosure
*(was P0-3)*

**Goal:** stop the calculator/wallet implying melt value = transaction price.

**Steps:**
1. `src/App.tsx`: near Calculator tab (`t.calcT`, ~line 995) and Wallet valuation table (~line 1410), add one line using existing `<div className="ai-meta">` or `<details>` pattern (see `expGramT`/`expGram` at line 989): "This is melt value at your set premium. Dealers add spread; jewelry (18k) typically adds a manufacturing charge (مصنعية) on top."
2. Optional: make the existing `state.prem` (premium %) field double as a user-editable "all-in markup" with a second optional "manufacturing charge %" input specific to 18k row in `karatRows` (~line 1012).
3. Translation keys: `calcSpreadNote` (ar/en).

**Tests:** none needed (copy-only change unless the optional input is added, in which case follow existing `updateNumber` pattern).

**Effort:** Small.

---

## S2. CSV export of wallet transactions
*(was P0-5)*

**Goal:** let the user get their data out for personal accounting / zakat / tax.

**Steps:**
1. `server/routes/wallet.mjs`: add `GET /api/wallet/transactions/export.csv` — reuse the existing `SELECT ... FROM wallet_transactions` query, stream as `text/csv` (`id,unit,side,amount,price_egp,recorded_at` header row).
2. `src/App.tsx`: add a small "Export CSV" link/button in the Wallet transactions panel (~line 1370, near the history table) — plain `<a href="/api/wallet/transactions/export.csv" download>`.
3. Translation key: `walletExportBtn`.

**Tests:** `tests/server/wallet-transactions-routes.test.mjs` — assert `Content-Type: text/csv` and header row present; assert auth middleware still applies.

**Effort:** Small.

---

## S3. Cache the Egypt price source + staleness
*(was P0-4)*

**Goal:** don't go blank when the `isagha` scrape fails; show last-known price with an age label.

**Files:** `server/isaghaPrices.mjs`, `server/routes/egyptPrices.mjs`.

**Steps:**
1. Add an `egypt_price_cache` table (migration): `id, rows jsonb, fetched_at` — single global row, not per-user.
2. `server/routes/egyptPrices.mjs`: on successful fetch, upsert the cache row. On fetch failure, fall back to the most recent cache row and return it with `stale: true, fetched_at`.
3. `src/App.tsx` Egypt tab (~line 1089-1120): if `egypt.data.stale`, show an amber `ai-status`-style note: "Showing last known prices from {time} — live pull failed."
4. Translation key: `egyptStaleNote`.

**Tests:** `tests/server/egypt-prices-routes.test.mjs` — mock `fetchEgyptGoldPrices` to throw, assert cached fallback returned with `stale: true`; assert first-ever failure with empty cache still returns the existing 502 behavior.

**Effort:** Small.

---

## S4. Wire alert rules to Target + DCA
*(was P0-1)*

**Goal:** notify the user when spot crosses their probability-weighted target, or when a DCA tranche window opens.

**Existing, unused:** `server/routes/alertRules.mjs`, mounted at `/api/alert-rules` in `server/index.mjs:43`. Read its schema/CRUD shape first — do not redesign it, just consume it.

**Steps:**
1. Read `server/routes/alertRules.mjs` fully to learn the existing rule shape (fields, condition types).
2. If it lacks a `target_cross` and `dca_window_open` rule type, extend it (migration + route, following the `wallet.mjs` validation style) — else skip to 3.
3. `src/api/alertRules.ts` (new): thin client, mirror `src/api/wallet.ts` style (`Number()` coercion on NUMERIC fields).
4. In `src/App.tsx`: compute `delta`/`inBand` (already exists near Target tab, ~line 1040) and `trancheStatus`/`dcaWindows` (already exists ~line 592-615) — add a `useEffect` that creates/updates the corresponding alert rule row when these values change, and a small in-app banner/toast when an active rule's condition is newly true (poll on load; no push infra assumed).
5. Add minimal UI in Settings or Target tab: toggle "notify me" per rule.
6. Translation keys: `alertTargetT`, `alertDcaT`, `alertOnLbl`, `alertOffLbl` in both `T.ar`/`T.en`.

**Tests:** extend `tests/server/alert-rules-routes.test.mjs` (create if absent) for any new rule type; no new frontend test infra exists in this repo — skip frontend tests, verify manually via dev server.

**Effort:** Small.

---

## S5. Cost basis + P&L on the wallet
*(was P0-2)*

**Goal:** show gain/loss vs. what the user actually paid, not just vs. last snapshot.

**Data already captured:** `wallet_transactions` (`unit`, `side`, `amount`, `price_egp`, `recorded_at`) via `server/routes/wallet.mjs`. No new columns needed — this is a derived read.

**Steps:**
1. `server/routes/wallet.mjs`: add `GET /api/wallet/cost-basis` that computes, per unit, weighted-average buy price from `wallet_transactions` (buys increase cost pool, sells reduce quantity at average cost — standard moving-average costing) and current open quantity's unrealized P&L against current `intlPrice`/`egyptPrice`. Also sum realized P&L from sell transactions (sell price − average cost at time of sale).
2. `src/api/wallet.ts`: add `fetchWalletCostBasis()` returning `{ unit, avgCostEgp, unrealizedPct, realizedEgp }[]`.
3. `src/App.tsx` Wallet tab: new panel below the existing valuation table — per-unit avg cost, unrealized %, and a total realized P&L line. Reuse `fmt()` and existing green/red delta styling pattern (see `walletIntlChangePct` block, ~line 1450).
4. Translation keys: `walletAvgCostLbl`, `walletUnrealizedLbl`, `walletRealizedLbl`.

**Tests (TDD, write first):** `tests/server/wallet-cost-basis.test.mjs` — cover: single buy then price move (unrealized%), buy+partial sell (realized P&L uses average cost, remaining qty unrealized), multiple buys at different prices (weighted average), sell-all (zero remaining, only realized).

**Effort:** Medium.

---

## S6. EGP-hedge-effectiveness metric
*(was P1-1)*

**Goal:** answer the persona's actual question — did gold protect my EGP savings, not just "is gold up."

**Data already captured:** `wallet_snapshots` (`intl_value_egp`, `egypt_value_egp`, `recorded_at`) via `server/routes/wallet.mjs`.

**Steps:**
1. Decide EGP-inflation/devaluation reference: reuse `state.egp` (current USD/EGP rate the user already maintains) — store it alongside each `wallet_snapshots` row (add `usd_egp_rate NUMERIC` column via migration) so the trend is self-contained.
2. `server/routes/wallet.mjs` snapshot POST: accept/store `usd_egp_rate`.
3. Compute in the frontend (no new endpoint needed): % change in wallet EGP value vs. % change in USD/EGP rate over the same window (using existing `walletTrendChart`/`walletSnapshots` data, ~line 1447-1484) → "your gold hedge outpaced EGP devaluation by X%" or the inverse.
4. Add this as a line in the existing "Wallet value trend" panel.
5. Translation keys: `walletHedgeLbl`, `walletHedgeAheadMsg`, `walletHedgeBehindMsg`.

**Tests:** `tests/server/wallet-routes.test.mjs` — snapshot POST accepts/persists `usd_egp_rate`.

**Effort:** Medium. Depends on S5 being in place first (shares the snapshot/cost-basis data model) — do after S5.

---

## S7. Port wallet + transactions to Flutter
*(was P1-2)*

**Goal:** close the mobile parity gap — wallet is currently web-only.

**Reference implementation (proven, tested):** `src/api/wallet.ts` (API contract), `server/routes/wallet.mjs` (backend, unchanged — just needs a Dart client).

**Steps (mirror existing Flutter feature structure, e.g. `flutter_app/lib/features/tranches/`):**
1. `flutter_app/lib/features/wallet/data/wallet_repository.dart` — Dart port of `src/api/wallet.ts`: `fetchHoldings`, `updateHoldings`, `fetchSnapshots`, `recordSnapshot`, `fetchTransactions`, `recordTransaction`, `updateTransaction`, `deleteTransaction`. Same NUMERIC-as-string coercion concern applies — check how `flutter_app/lib/features/tranches/data/dca_plan_repository.dart` handles it (added this session) and mirror it.
2. `flutter_app/lib/features/wallet/application/wallet_providers.dart` — Riverpod providers, mirror `tranches_providers.dart` structure.
3. `flutter_app/lib/features/wallet/presentation/wallet_screen.dart` — holdings table, transaction form (unit/side/amount/price/date), history list with edit/delete, valuation panel, trend chart (use a lightweight Flutter charting approach consistent with whatever the app already uses elsewhere, or a simple `CustomPainter` line chart mirroring the web's inline-SVG approach).
4. Add `wallet` tab to the app's navigation shell alongside existing tabs.
5. Add AR/EN strings to `flutter_app/lib/l10n/strings.dart` mirroring the web keys already listed in `src/App.tsx` (`walletT`, `walletTx*`, etc.) — same key content, ported.

**Tests:** `flutter_app/test/features/wallet/wallet_repository_test.dart` and `wallet_screen_test.dart`, following the pattern in `flutter_app/test/features/tranches/dca_plan_repository_test.dart` / `tranches_screen_test.dart` (both added this session — read them first as the direct template).

**Effort:** Medium-Large. Consider splitting into repository+providers pass, then a screen pass.

---

## S8. Configurable, open-ended DCA
*(was P2-1)*

**Goal:** replace the fixed 40/35/25 · 3-tranche · 2-month model with user-configurable count/spacing/ratio, including an indefinite monthly mode.

**Current hardcoding:** `src/App.tsx:592-593` (`tranchePct = [40, 35, 25]`, `TRANCHE_SPACING_MONTHS = 2`), backed by `server/routes/dcaPlan.mjs` / `migrations/0010_create_dca_plan.sql` (currently just `start_date`, `total_investment_egp`).

**Steps:**
1. Migration: extend `dca_plan` table with `tranche_pcts NUMERIC[]` (or a normalized `dca_tranches` child table if per-tranche override is wanted later), `spacing_months INTEGER`, `mode TEXT CHECK (mode IN ('fixed','recurring'))`.
2. `server/routes/dcaPlan.mjs`: validate `tranche_pcts` sums to 100 for `fixed` mode; `recurring` mode ignores tranche count and instead generates an open-ended monthly schedule client-side from `start_date` + fixed monthly amount.
3. `src/App.tsx` DCA tab (~line 1193): replace hardcoded array with `dcaPlan.data.tranche_pcts`/`spacing_months`; add UI to edit them (number inputs per tranche + add/remove tranche row) and a mode toggle (Fixed / Recurring monthly).
4. Recurring mode: render an open-ended list (e.g., next 12 upcoming months) instead of a fixed 3-row list.

**Tests:** extend `tests/server/dca-plan-routes.test.mjs` (already exists from this session) for new fields/validation; TDD as with prior DCA work.

**Effort:** Large.

---

## S9. Default/shared AI tier
*(was P2-2)*

**Goal:** make the AI Analyst usable without the user supplying their own paid LLM API key.

**Current gate:** `server/routes/llmProviders.mjs` / `server/routes/analyze.mjs` require an active provider row with a user-supplied `api_key`.

**Steps (requires a product/cost decision before implementation — confirm approach before building):**
1. Decide funding model: operator-supplied shared key with a rate limit (simplest), or a free-tier local model (Ollama) bundled as the zero-config default.
2. If shared key: add a `system`/`shared` provider type in `server/routes/llmProviders.mjs` that reads its API key from a server-side env var (never exposed to client), with a per-user daily call-count limit (new small table or column, e.g. `ai_usage(user_id, date, count)`), enforced in `server/routes/analyze.mjs` before calling the LLM.
3. `src/App.tsx` AI tab: if no user-configured provider exists, fall back to calling analyze with the shared tier and show remaining daily calls instead of the current "No active provider — go to Settings" dead-end (`t.aiNoProvider`).

**Tests:** `tests/server/analyze-routes.test.mjs` — rate-limit enforcement, shared-key path never leaks the key to the client response.

**Effort:** Large — also has an ongoing cost/ops component beyond code (see cost discussion in prior conversation: roughly $0.01–0.04 per analysis call if backed by a hosted model). Confirm funding approach with user before starting.
