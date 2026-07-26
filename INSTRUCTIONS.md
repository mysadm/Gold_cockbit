# Instructions · دليل التشغيل — v1.2 (MVP) 

> App-phase note: this guide covers the deployed MVP (`index.html`), which remains the live product during the migration described in `IMPLEMENTATION_PLAN.md`. UI conventions for the app build live in `UI_GUIDELINES.md`.

## 1. First-time setup (10 minutes)

### Host the page — mandatory

The tool must run from a real web address. Two environments that look like they work but don't:

- **Opening the file directly** (`file://`) — browsers block all network requests
- **The file preview inside the Claude app** — a viewer, not a browser; calls fail with errors like "The object can not be cloned"

Setup, once:

1. github.com → **New repository** → name it (e.g. `gold-cockpit`) → Public → Create
2. **Add file → Upload files** → upload `index.html` → Commit
3. **Settings → Pages** → *Deploy from a branch* → `main` / root → Save
4. Open `https://<username>.github.io/gold-cockpit` in **Safari or Chrome**
5. Phone: Share → **Add to Home Screen**

Updating: upload the new `index.html` over the old one; hard-refresh after.

### API key (AI analyst + market calibration)

1. console.anthropic.com → **API Keys** → **Create Key** → copy immediately (shown once)
2. Confirm **Billing** has credit — a few cents per analysis/calibration
3. Paste in the AI Analyst section; tick "remember on this device" only on your own device

The key goes browser → Anthropic directly; never in code, never on another server.

## 2. Price panel

- Inputs: XAU/USD, USD/EGP, premium % — editable, Arabic digits accepted
- **⟳ Pull live market**: 4-source gold chain, 2-source FX chain; the stamp names the serving source; diagnostics list per-source errors on failure
- Board: ounce in USD and EGP, 24k/21k/18k grams, gold pound — premium-inclusive

### ⚖ Calibrate from the Egyptian market

Computed prices can drift 2–5% from dealer quotes on volatile days. Calibrate (needs the key) fetches actual 21k + 24k local prices, auto-adjusts the premium so everything matches the market, fills the soug-dollar cell, and persists with timestamp + source. **Calibrate before any buying decision.**

### دولار الصاغة — the gold-market dollar

**Local 24k gram EGP ÷ (ounce USD ÷ 31.1).** The rate the gold market actually trades on — usually tracks the parallel market. The green cell shows it live with its spread over the official rate: the hedge's real scoreboard.

## 3. Chart

Today (15-min) / week (2h) / month (12h). Price gridlines, four time marks. **Touch and drag**: crosshair + card with the exact price and time at your finger; lift to dismiss. Binance PAXG primary; daily fallback labels itself.

## 4. Scenarios & weighted target

Drag any slider — the others rebalance to 100. The big number is the probability-weighted target; when spot exits all bands the tool says so: re-examine weights, don't ignore.

## 5. Watchlist variables

Tap to cycle داعم/مراقبة/خطر. Add anything (≤40 chars, Enter or أضف); delete anything with ×. Persists locally; feeds the analyst automatically. **A variable gets a status; a scenario gets a probability** — scenarios carry price targets, variables are monitored signals.

## 6. AI analyst — gold-expert inside

Sends the full cockpit state to Claude with web search under the gold-expert institutional methodology. Returns: one sharp state-of-the-hedge line, 3–4 market-moving trends, suggested weights (one-tap apply), a Tranche 2 verdict with an explicit trigger, the EGP read — plus **conflicting signals, a justified confidence level, and an invalidation condition** (the "if X happens, discard this analysis" line).

Levels: مبتدئ defines every term and translates each point into EGP consequences; خبير is sharp and technical. A live seconds counter runs; hard stop at 90s.

## 7. Calculator & tranches

Any EGP amount → grams per karat + whole gold pounds and change; 24k/21k highlighted (the hedge instruments — 18k jewelry loses its premium on resale). Tranches: 40/35/25 with amounts, gram equivalents, statuses, and position valuation.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Everything fails / "object can not be cloned" | Claude-app preview or `file://` | GitHub Pages URL in Safari/Chrome |
| "Feeds unreachable" + full list | Same, or no connectivity | Hosted URL; diagnostics name each failure |
| One feed fails | Blocked on your network | Chain skips it automatically |
| Stamp: `jsdelivr-daily` | Real-time sources unreachable | Daily accuracy; re-pull before executing |
| Chart "today" nearly empty | Binance blocked → daily fallback | Week/month fine; M4 of the plan solves it permanently |
| Typed variable vanished | Fixed in v1.2 | Update build |
| AI counter passes 90 | Slow search round | Auto-aborts; retry |
| Error mentions `credit`/`billing` | API balance empty | Top up in console |
| `401`/`authentication` | Wrong/revoked key | Re-paste or recreate |
| Calibration wants a key | Not set | Same key field serves both |

## 9. Reading the numbers honestly

- The weighted target is a **compass, not a forecast** — a wide gap vs. spot means someone's odds are wrong; find out whose before deploying money.
- **Judge the hedge in EGP.** The soug dollar is the scoreboard.
- **Calibrate before buying, not after** — the computed-vs-market gap is exactly the slippage that erodes entries.
- **Note the invalidation condition** in every analysis, and actually act on it if it triggers.
- The AI suggests; you decide.
