# UI Guidelines — Gold Cockpit App

Derived from the PayMint design system (`/paymint-pitch-designer` skill). That skill encodes the canonical brand in slide coordinates; this document translates it into application tokens and components. Where the skill says "never deviate," neither does this file.

## 1. Design tokens

### Colors (mapped from the canonical slide palette)

| Token | Hex | Slide origin | App usage |
|---|---|---|---|
| `--brand` | `#00B240` | Primary Green | Primary actions, active states, positive deltas, brand accent |
| `--brand-2` | `#0E9C3C` | Body Green | Secondary green elements, icons, hover on brand |
| `--brand-tint` | `#E8F7ED` | PayMint column fill | Selected rows, highlighted cards, success surfaces |
| `--ink` | `#1A1A1A` | Header Text | Screen titles, primary headings |
| `--ink-2` | `#414042` | Charcoal | Strong labels, table headers |
| `--text` | `#555555` | Body Text | Paragraphs, values, descriptions |
| `--muted` | `#888888` | Caption | Captions, footnotes, timestamps, empty states |
| `--surface` | `#EFEFEF` | Box Fill | Cards, input fields, chips |
| `--line` | `#C4C4C4` | Separator | Dividers, borders, chart gridlines |
| `--bg` | `#FDFDFD` | Background | App background |
| `--negative` | `#CC0000` | Table ✗ | Negative deltas, risk states, destructive actions |
| `--warn` | `#FF6B35` | Margin line | Watch/amber states, secondary chart series |

> ⚠️ The authoritative green is **`#00B240`** — not `#3DB54A` from the corporate identity PDF, and not the website's `#00C896`. Same rule as the deck. Never deviate.

**Dark mode (vault theme).** The MVP's vault-black + gold identity is retained as the optional dark theme with tokens remapped (`--bg #141110`, `--surface #1D1916`, brand accent `#C9A227`). Default theme for the productized app is the light PayMint theme above; the user can switch. Financial-state colors (positive/negative/warn) keep their meaning in both themes.

### Typography

The deck mandates Calibri as the only font. Calibri is not a licensed web font; the app uses metric-compatible and role-equivalent substitutes:

| Role | Font | Size (mobile) | Weight | Color | Slide origin |
|---|---|---|---|---|---|
| Screen title | Carlito*, system-ui | 22px | 700 | `--ink` | Slide title 22–26pt |
| Section header | Carlito | 14px, letter-spaced | 700 | `--brand` | Section header 14–16pt |
| Body | Carlito | 13–14px | 400 | `--text` | Body 10–12pt |
| **Stat callout** | Carlito | 30–36px | 700 | `--brand` | Big number 28–36pt |
| Numeric/tabular | IBM Plex Mono | 13–15px | 400–500 | `--ink-2` | — (app addition: prices need tabular figures) |
| Arabic | Cairo | matches role | 600/800 | matches role | — (app addition) |
| Caption/footnote | Carlito | 10–11px | 400 | `--muted` | Caption 8–9pt |

\* Carlito is the open, metric-compatible Calibri equivalent (Google Fonts). Numbers inside Arabic text always render LTR in the mono face.

### Spacing & shape

Slide constants translate to an 8px grid: screen padding 16–20px (the 0.45in margin), card padding 16px, card gap 12px (the 0.3in gap), corner radius **8px** on all rounded surfaces (the 0.18in `RECT_RADIUS`), divider 1px `--line`.

### Brand accent bar

The deck places a green bar bottom-right of every slide. App equivalent: a 3px `--brand` top border on the app header (one per screen, not per card). The NXC footer does not carry into the product UI.

## 2. Components

### KPI / stat cards (from Section 7 of the skill)

The price board follows the KPI card row pattern: `--surface` card, 8px radius, big brand-colored number, small `--text` label underneath, centered. The hero cell (ounce USD · EGP) uses `--brand-tint` fill. The دولار الصاغة cell keeps its distinct treatment: `--brand-tint` fill with a 2px `--brand` top border — it is the product's signature number.

### Buttons

- **Primary** (analyze, calibrate): `--brand` fill, white text, 8px radius, full-width on mobile, 44px min height
- **Secondary** (pull prices, apply weights): white fill, 1px `--brand` border, `--brand` text
- **Tertiary/chips** (range tabs, level toggle, watchlist): `--surface` fill; active = `--brand-tint` fill + `--brand` border
- Destructive (delete variable ×): `--muted`, turning `--negative` on press

### Tables (from the competitor-table pattern)

Karat calculator and any comparison tables: header row in `--ink-2` 700, 1px `--line` row dividers, numeric columns right-aligned in mono. Status marks use the deck's chips — ✓ in `--brand`, ✗ in `--negative` — as filled circles, never bare glyphs. Highlighted rows (24k, 21k hedge instruments) get `--brand-tint` fill, exactly like the PayMint column in competitor tables.

### Charts (from Section 3 of the skill, adapted)

- Primary series: `--brand`. Secondary/overlay series: `--warn` (`#FF6B35`) — the deck's margin-line orange
- Direction-coded series (the gold price line) may use green/red for up/down periods; gridlines `--line` at 1px; axis labels `--muted` 10px mono
- **Axis rule carries over**: never let outlier ranges compress the meaningful scale — clamp or split the range and footnote it, as the deck does with 2021–2023 revenue
- Data labels minimum 10px; accepted trade-off from the deck applies: don't fight low-contrast label edge cases, restructure the chart instead

### Logo / IP safety (Section 6 — unchanged)

No third-party logos as images anywhere in the app (payment networks, banks, data sources). Text chips only: rounded rect, brand-appropriate fill, bold white text. Data source credits ("PAXG · Binance") stay as plain mono text.

## 3. Layout system

Mobile-first single column at 520px max, exactly like the MVP. On tablet/desktop ≥900px, adopt the deck's two-column grammar: narrative/controls left, chart/visual right, full-width "outcome" strip below (the weighted target is the app's outcome box).

RTL is first-class: all layout via CSS logical properties (`inline-start`, `text-align:start`); charts and numeric clusters remain LTR islands. The language toggle flips `dir` and re-renders — never a separate stylesheet.

## 4. Motion & feedback

Minimal and functional: 150ms ease on state changes, no decorative animation. Every async action shows its state in place (elapsed seconds on AI calls, per-source diagnostics on feed failures) — the MVP's honesty-first feedback pattern is a design requirement, not an implementation detail.

## 5. QA checklist (adapted from the skill's Section 10)

Run on every release, both languages, both themes:

- No text overflow in any card at 320px width and at 200% font scale
- Brand accent present on the header; correct green (`#00B240`, verified by eyedropper)
- All numerals tabular mono; Arabic digits accepted in every numeric input
- RTL: no mirrored charts, no flipped numbers, chips and × on correct sides
- Charts: gridlines visible in both themes; no compressed axis from outliers
- No third-party logo images; text chips only
- Every async state reachable and honest: loading, partial failure, full failure with diagnostics
- localStorage keys stable across the update (`ghc_key`, `ghc_monitors`, `ghc_calib`, `ghc_level`)
