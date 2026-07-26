# Implementation Plan — MVP → Application

The MVP (`index.html`, v1.2) is the behavioral specification. Nothing in it is thrown away: every function maps to a module, every quirk it solved (focus preservation, clone-safe timeouts, pause_turn handling, feed fallbacks) is a requirement the app must keep passing.

## 0. Decisions (made, with reasons)

| Decision | Choice | Why |
|---|---|---|
| Framework | **Vite + TypeScript + Preact** | Preact keeps the bundle ~4KB and the mental model close to the MVP's render loop; TS catches the state-shape bugs we hit by hand (garbled edits, stale refs). React-compatible if the team grows. |
| Styling | CSS custom properties + logical properties, no framework | The token system in `UI_GUIDELINES.md` is small; Tailwind would fight the RTL logical-property discipline |
| State | Single store (nanostores or a 30-line custom store) persisted to localStorage | The MVP proved single-state works; keep it |
| App delivery | **PWA first** (manifest + service worker), Capacitor wrap only if store presence is later required | 90% of native feel, zero store friction |
| Hosting | GitHub Pages via Actions (build on push) | Zero cost, already the deploy target |
| Backend | **None until Milestone 4**, then Cloudflare Worker | Alerts and key-proxying are the only features that justify a server |
| AI methodology | gold-expert system prompt shipped as a versioned module (`analyst/goldExpert.ts`) | Same brain as the chat skill; single place to update |

## 1. Repository structure

```
gold-cockpit/
├── index.html                # Vite entry
├── src/
│   ├── main.ts               # boot, store hydration, first fetch
│   ├── store.ts              # S → typed store; localStorage sync (ghc_* keys preserved)
│   ├── i18n/
│   │   ├── ar.ts  en.ts      # the T object, split
│   │   └── index.ts          # lang switching, dir flipping
│   ├── feeds/
│   │   ├── gold.ts           # 4-source chain + timeouts + diagnostics
│   │   ├── fx.ts             # 2-source chain
│   │   └── history.ts        # Binance klines + jsDelivr daily fallback
│   ├── analyst/
│   │   ├── goldExpert.ts     # system prompt (versioned constant)
│   │   ├── client.ts         # clone-safe callAPI, pause_turn, retry, 90s race
│   │   └── calibrate.ts      # Egyptian market calibration
│   ├── domain/
│   │   ├── pricing.ts        # gram/karat/pound math, soug dollar formula
│   │   ├── scenarios.ts      # weights, rebalancing, weighted target
│   │   └── tranches.ts       # DCA math
│   ├── ui/
│   │   ├── PriceBoard.tsx  Chart.tsx  Scenarios.tsx  Tranches.tsx
│   │   ├── Calculator.tsx  Watchlist.tsx  Analyst.tsx
│   │   └── tokens.css        # UI_GUIDELINES tokens, light + vault themes
│   └── pwa/
│       ├── manifest.webmanifest
│       └── sw.ts             # shell cache, stale-price badge offline
├── tests/                    # vitest — see §3
├── .github/workflows/deploy.yml
└── docs/  (README, INSTRUCTIONS, UI_GUIDELINES, this file)
```

## 2. MVP → module mapping (migration checklist)

| MVP function/feature | Destination | Must-keep behaviors |
|---|---|---|
| `S` object + `renderAll` | `store.ts` + components | focus/caret preservation becomes free (no full re-render); transient input rule stays for uncontrolled fields |
| `normNum` | `domain/pricing.ts` | Arabic-Indic digit normalization, comma stripping |
| `fetchGold/fetchEGP/diag` | `feeds/*` | per-source diagnostics surfaced verbatim; 6s per-source timeout |
| `loadChart/renderChart/bindChart` | `Chart.tsx` | crosshair touch, tooltip clamping, nice-step gridlines, direction coloring |
| `setWeight` rebalancing | `domain/scenarios.ts` | sum-to-100 invariant, unit-tested |
| `analyze/callAPI` | `analyst/client.ts` | system prompt, pause_turn continuation, JSON-extraction retry, race timeout (no AbortSignal), elapsed ticker |
| `calibrate` + soug dollar | `analyst/calibrate.ts` + `pricing.ts` | dual-price fetch (21k+24k), premium auto-set, soug = g24/(spot/31.1035) |
| watchlist add/delete | `Watchlist.tsx` | 40-char cap, esc(), persistence, feeds analyst context |
| localStorage keys | `store.ts` | **exact same keys** — users must not lose data on migration |

## 3. Testing (what the MVP taught us to test)

Unit (vitest): pricing math including soug dollar and karat ratios; weight rebalancing invariant; `normNum` with Arabic digits; JSON extraction from noisy analyst text; nice-step gridline picker (the 25→50 gap bug becomes a test case).
Integration (mocked fetch): feed chain fallback order and diagnostics; pause_turn continuation; calibration premium math.
E2E (Playwright, already our habit): continuous typing keeps focus; add/delete variable survives background refresh; chart tooltip at 65% width; language toggle preserves all values; both themes at 320px width.

## 4. Milestones

### M1 — Faithful port (1–2 weekends)
Scaffold, migrate per §2, ship behind the same URL. **Exit test: a user of the MVP notices nothing except speed.** localStorage keys intact.

### M2 — PWA + app polish (1 weekend)
Manifest + icons (vault-gold icon set), service worker (shell cache, offline last-known prices with stale badge), Add-to-Home-Screen prompt, GitHub Actions deploy, light/vault theme toggle per UI_GUIDELINES.

### M3 — The MVP's known gaps (1 weekend)
Offshore-EGP field with official/parallel spread displayed; editable scenario bands and add/delete scenarios (weights engine already generalizes); per-karat premiums; analysis history (last 5, timestamped); price-pull history sparkline.

### M4 — Worker backend (1–2 weekends)
Cloudflare Worker + cron: price snapshots every 30 min to KV (owned intraday history — fixes the daily-fallback weakness); alert rules (band-edge cross, EGP daily move >1%, tranche window opening) delivered via Telegram bot and web push; **API key moves to a Worker secret** behind a personal access token — the browser never holds it again.

### M5 — Distribution decision (optional)
Capacitor wrap + Face ID + native push **only if** App Store presence becomes necessary. Expected outcome: skip.

## 5. Release checklist (every release)

UI_GUIDELINES §5 QA in both languages and themes → E2E suite green → deploy to a preview URL → manual pass on a real iPhone over mobile data (feed chains behave differently than on Wi-Fi) → tag release → update INSTRUCTIONS.md if any user-visible change.

## 6. Risks carried forward

Feed mortality (mitigated by chains now, solved by M4 snapshots); Anthropic API surface changes (pin `anthropic-version`, client.ts is the single seam); Binance regional blocking (chain handles it; M4 removes the dependency); scope creep toward multi-user (explicitly out of scope until a deliberate product decision — see DEVELOPMENT_PLAN Phase 5).
