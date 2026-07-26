# Gold Cockpit · غرفة عمليات الذهب

**Status: MVP complete (v1.2) → moving to application.**

A bilingual (Arabic/English) gold-hedge management application for EGP-denominated investors. The MVP proved the full loop in a single HTML file; this repository now graduates it into a maintainable, installable product.

## What the MVP does today

- **Live market board** — XAU/USD from a 4-source fallback chain, USD/EGP from a 2-source chain, with per-source diagnostics on failure. Derives ounce in EGP, 24k/22k/21k/18k gram prices, and the gold pound.
- **Egyptian market calibration** — one tap fetches actual local 21k/24k dealer prices via live search and auto-adjusts the premium so every number matches the real market.
- **دولار الصاغة (gold-market dollar)** — local 24k gram EGP ÷ (ounce USD ÷ 31.1035), live, with its spread over the official rate. The truest scoreboard for an EGP hedge.
- **Interactive chart** — today / week / month, price gridlines, time axis, touch crosshair with exact price-at-point.
- **Scenario engine** — three probability-weighted scenarios with auto-rebalancing sliders and a live weighted target that flags when spot exits all bands.
- **DCA tranche tracker** — 40/35/25 plan with per-tranche amounts, gram equivalents, and position valuation.
- **Karat purchase calculator** — any EGP amount → what it buys per karat, plus whole gold pounds and change.
- **Editable watchlist** — add/delete thesis variables with tap-to-cycle status; persists locally; feeds the AI context.
- **AI analyst (gold-expert methodology)** — sends full cockpit state to Claude with web search under an institutional-analyst system prompt. Returns trends, suggested weights (one-tap apply), a tranche verdict with trigger condition, the EGP read, **conflicting signals, a justified confidence level, and an invalidation condition**. Beginner/expert explanation modes; responds in the UI language.

## Documentation map

| File | Purpose |
|---|---|
| `README.md` | This file — project overview and status |
| `INSTRUCTIONS.md` | Setup, daily workflow, feature guide, troubleshooting |
| `UI_GUIDELINES.md` | The app's design system, derived from the PayMint design language |
| `IMPLEMENTATION_PLAN.md` | Concrete engineering plan: MVP → installable app |
| `DEVELOPMENT_PLAN.md` | The original strategic phase roadmap (context) |
| `index.html` | The MVP — remains deployable and is the behavioral reference |

## Architecture (MVP) — the migration baseline

One file, zero dependencies: vanilla JS, single state object `S`, full re-render with focus/caret preservation, CSS logical properties for RTL/LTR from one stylesheet, SVG chart drawn by hand. Every function in it maps to a module in the app structure — see `IMPLEMENTATION_PLAN.md` §2.

Data and AI calls: free keyless price feeds; direct browser → Anthropic API with the user's own key (`anthropic-dangerous-direct-browser-access`), never stored in code. `pause_turn` continuation, truncated-response retry, 90s hard timeout, race-based (clone-safe) rather than AbortController.

## Security model

- API key entered at runtime; optional localStorage persistence on the user's own device only
- No backend until Phase 3 of the plan; at that point the key moves server-side behind a Worker secret
- Page calls only: price feeds, Google Fonts, api.anthropic.com
- Position/budget data never leaves the browser except inside the analyst prompt under the user's own account

## Disclaimer

Personal analysis tool — not financial advice. Built-in allocation rule: gold at 15–25% of total wealth, maximum.
