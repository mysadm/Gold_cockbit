# Cockpit Theme Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for this plan) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Note on verification style:** this plan reskins CSS/design tokens, not logic — there is no meaningful unit test for "is this panel the right shade of brown." Each step's verification is a visual check in the browser (via `npm run dev` at `localhost:3577`) plus `npx tsc -b` and `npm test` to catch any accidental breakage, rather than a vitest assertion. This is a deliberate, scoped deviation from the usual write-test-first pattern — it does not apply to non-visual code in this codebase.

**Goal:** Reskin the running app (currently a light "vault"-toggle theme with teal accents, DM Sans/Cairo/DM Serif Display fonts) to the new **Cockpit** dark theme delivered in `gold-cockpit-theme-package/` (Figma file `r6S18zHKPYtBWhztJqk9cH`) — amber-gold accents, Tajawal for Arabic text, JetBrains Mono for every numeric readout — replacing the existing theme entirely (no light/vault toggle survives).

**Architecture:** The app's entire visual language already flows through a small, centralized set of CSS custom properties (`--bg`, `--surface`, `--gold`, `--text`, etc., defined once in `src/styles.css`) and a handful of shared utility classes/primitives (`Card`, `SectionLabel`, `Hairline`, `ChangeTag` in `src/ui/primitives.tsx`; `.instrument-card`, `.btn-primary`, `.btn-outline`, `.nav-item`, `.section-label`, `.tag-up`/`.tag-down`, `.live-dot`, `.font-mono`, `.font-display` in `src/styles.css`) used **hundreds of times** across the ~2,600-line `src/App.tsx`. This plan exploits that: instead of touching every screen's JSX, it ports the Cockpit theme's actual pixel/color values from `gold-cockpit-theme-package/css/tokens.css` and `components.css` onto the **existing variable and class names**, so every current and future screen picks up the new look automatically. JSX changes are limited to the handful of places (`src/ui/Sidebar.tsx`, the root layout wrapper, the AI panel, `index.html`) where the new design's structure genuinely differs from the old one (removing the theme toggle, adding the AI panel's glow treatment, an app-wide Arabic font switch).

**Tech Stack:** Preact + TypeScript (Vite), plain CSS custom properties (Tailwind v4 is imported in `src/styles.css` but this app doesn't use Tailwind utility classes in JSX — see `grep -c "className=\"[a-z-]*:"` returning 0 — so this reskin touches plain CSS only, no Tailwind config).

**Spec:** `gold-cockpit-theme-package/README.md`, `gold-cockpit-theme-package/css/tokens.css`, `gold-cockpit-theme-package/css/components.css`, `gold-cockpit-theme-package/html/{mobile-market,desktop-dashboard}.html` (static reference renders — open these directly in a browser throughout this work to compare against).

## Global Constraints

- **Scope is reskin-only** (per team decision): the existing single-sidebar-at-every-width layout (`src/ui/Sidebar.tsx`, always rendered, no responsive breakpoint) is kept as-is structurally. The theme package's separate mobile bottom-tab-bar design (`mobile-market.html`) is **not** built in this plan — it's a distinct, larger follow-up ("build the responsive mobile bottom-nav") the team explicitly deferred.
- **The Cockpit theme replaces the existing themes entirely** (per team decision): remove the `light`/`vault` toggle, the `Theme` type, `state.theme`, and the sun/moon toggle button. `src/styles.css`'s `:root` block becomes the only palette; delete the `.theme-vault` override block.
- Never touch the `.legacy-ui { ... }` block at the bottom of `src/styles.css` (lines 252-394) — it's a separately-scoped, pre-existing legacy stylesheet for old embedded markup, unrelated to this reskin, out of scope.
- Every new color/spacing/type value must come from `gold-cockpit-theme-package/css/tokens.css` or `components.css` — no inventing new hex values. Where the source package doesn't define an equivalent (documented per-case below, e.g. `.btn-outline`, `--surface-hover`), derive it from the same token family and say so in the commit, rather than guessing a new color.
- Keep English-language mode's font (`--font-sans`, DM Sans) unchanged — the Cockpit theme package is Arabic/RTL-first and only specifies a font for "Arabic UI text"; this plan applies Tajawal when the app is in Arabic mode and leaves English mode's typography alone.
- RTL behavior is unaffected by this plan — the app already renders `dir="rtl"` in Arabic mode today, and every rule ported from `components.css` is plain flexbox with no hardcoded left/right, matching the source package's own RTL note (§5 of its README).

---

## File Structure

- Modify: `src/styles.css` — replace the `:root` token block (Task 1), delete `.theme-vault` (Task 3), rewrite the shared component rules `.instrument-card`, `.nav-item`, `.btn-primary`, `.btn-outline`, `.section-label`, `.tag-up`/`.tag-down`, `.live-dot` (+ its keyframes), `.hairline`, `.font-display` (Task 2), add `.instrument-card--ai` (Task 4).
- Modify: `src/ui/Sidebar.tsx` — remove the theme-toggle button and its now-unused `vault`/`toggleTheme` props, resize the logo mark, convert nav items from `<div onClick>` to real `<button>`s with `aria-current` (Task 3).
- Modify: `src/App.tsx` — remove `Theme` type/`state.theme` field/`theme-vault` class usage, add the Arabic-font switch on the root wrapper (Task 3), apply `.instrument-card--ai` to the AI Analyst panel (Task 4).
- Modify: `index.html` — update `<meta name="theme-color">` to the new accent color (Task 1).
- No test files change — this is a CSS/token-only visual change with no unit-testable logic; verification is manual (Task 5) plus the existing suite staying green as a regression guard.

---

## Task 1: Fonts + core color/spacing tokens

**Files:**
- Modify: `src/styles.css:1-35` (font `@import`s, `@theme` block, `:root` block)
- Modify: `index.html:6` (`theme-color` meta)

**Interfaces:**
- Produces: every existing `var(--bg)`, `var(--surface)`, `var(--gold)`, etc. reference elsewhere in the codebase now resolves to the Cockpit palette. No new variable names — Task 2 depends on these values being in place first.

- [ ] **Step 1: Replace the font imports and `@theme` font tokens**

In `src/styles.css`, replace lines 1-13:

```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700;800&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');

@import 'tailwindcss';

@theme {
  --font-display: 'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;
  --font-sans: 'DM Sans', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;
  --font-arabic: 'Tajawal', system-ui, sans-serif;
}
```

Rationale for each change from the current file: `DM Serif Display` is dropped (Task 2 repoints `.font-display`'s four call sites — the hero ounce price, the weighted-target price, and the two DCA tranche numbers — from serif to mono, matching the theme package's "every numeric readout is JetBrains Mono" rule, so no rule still needs the serif face). `Cairo` is replaced by `Tajawal` (the theme package's mandated Arabic face). `JetBrains Mono`'s weights gain `700`/`800` (the package's price-display and eyebrow-adjacent mono values use up to 800; the old app only ever used up to 600). `--font-display` now points at the mono stack instead of the serif one, for the same reason as above.

- [ ] **Step 2: Replace the `:root` color/spacing tokens**

Replace lines 15-35 (the `:root` block, stopping before `.theme-vault`):

```css
:root {
  --bg: #0d0c0a;
  --surface: #1a1611;
  --elevated: #211c15;
  --surface-hover: #211c15; /* the source Figma tokens define no separate hover step —
                                components.css's own :hover rules (e.g. .gc-nav-item:hover)
                                reuse the "elevated" bg-2 value, so this does too */
  --gold: #b8841f;         /* accent-gold-strong: primary buttons, big price readout */
  --gold-bright: #f2b33d;  /* accent-gold: icons, small accents, focus rings */
  --gold-dim: rgba(184, 132, 31, 0.55);
  --gold-glow: #241d10;    /* accent-gold-bg: a real pre-tinted panel fill in the source
                               tokens, not a computed alpha — used for active-nav-item and
                               AI-panel backgrounds */
  --gold-border: #4a3d28;  /* border-strong */
  --text: #f2ecdd;
  --text-soft: #a69b85;
  --text-muted: #6e6552;
  --border: #332a1c;       /* border-default */
  --border-solid: #332a1c; /* the source tokens have one border color, not a translucent/solid pair */
  --up: #3ed598;
  --up-bg: #132621;
  --down: #e5533d;
  --down-bg: #2a1712;
  --sidebar-w: 232px;
}
```

Every value here is copied verbatim from `gold-cockpit-theme-package/css/tokens.css`'s `:root` block (bg-0/1/2, border-default/strong, text-primary/secondary/tertiary, accent-gold/-strong/-bg, status-live/-live-bg/-alert/-alert-bg) — cross-check side by side if in doubt.

Delete the `.theme-vault { ... }` block (old lines 37-49) entirely — Task 3 removes its last usage from `App.tsx`; deleting the CSS block now means nothing referencing the class does anything, which is fine since Task 3 lands in the same work session.

- [ ] **Step 3: Update the browser theme-color meta tag**

In `index.html`, line 6, change:

```html
<meta name="theme-color" content="#f2b33d" />
```

(was `#00B240`, a leftover from an older green branding that didn't even match the app's prior blue-ish `--gold: #3a9ec2` — this now matches the new accent-gold token exactly.)

- [ ] **Step 4: Verify**

Run `npm run dev`, open `localhost:3577`. Expect: the page background, panels, and text are now dark/amber instead of light/teal, even though most component shapes haven't changed yet (Task 2 handles that) — this step is purely a "did the token swap take effect" check. Also open `gold-cockpit-theme-package/html/desktop-dashboard.html` directly in a second tab and compare the background/text/gold hues side by side.

- [ ] **Step 5: Commit**

```bash
git add src/styles.css index.html
git commit -m "feat: swap theme tokens to the Cockpit palette and fonts"
```

---

## Task 2: Rewrite the shared component CSS rules

**Files:**
- Modify: `src/styles.css:70-260` (approximately — `.instrument-card`, `.nav-item`, `.btn-primary`, `.btn-outline`, `.section-label`, `.tag-up`/`.tag-down`, `.live-dot` + `@keyframes pulse-dot`, `.hairline`, `.font-display`)

**Interfaces:**
- Consumes: the tokens from Task 1.
- Produces: no new class names — every existing consumer in `App.tsx`/`Sidebar.tsx`/`primitives.tsx` is affected without being edited.

- [ ] **Step 1: Panels — `.instrument-card`**

Replace:

```css
.instrument-card {
  background: linear-gradient(145deg, var(--surface) 0%, var(--elevated) 100%);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow:
    inset 0 1px 0 var(--gold-border),
    0 2px 8px rgba(0, 0, 0, 0.25);
}

.instrument-card:hover {
  border-color: var(--gold-dim);
  box-shadow:
    inset 0 1px 0 var(--gold-border),
    0 4px 16px rgba(0, 0, 0, 0.3);
  transition: all 0.2s ease;
}
```

with:

```css
.instrument-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 6px 18px -4px rgba(0, 0, 0, 0.45);
}
```

This matches `.gc-panel` in `components.css` exactly (flat fill, `--gc-radius-lg`, `--gc-shadow-panel`). The gradient fill, inset top-highlight, and hover lift are dropped — the source design's panels are flat and static; there's no `.gc-panel:hover` rule to port.

- [ ] **Step 2: Navigation — `.nav-item`**

Replace:

```css
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size:17px;
  font-weight: 500;
  color: var(--text-muted);
  transition: all 0.15s ease;
  border: 1px solid transparent;
  white-space: nowrap;
}

.nav-item:hover {
  background: var(--elevated);
  color: var(--text-soft);
  border-color: var(--border);
}

.nav-item.active {
  background: var(--gold-glow);
  color: var(--gold);
  border-color: var(--gold-border);
}
```

with:

```css
.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  font-family: inherit;
  color: var(--text-soft);
  background: none;
  border: none;
  text-align: start;
  white-space: nowrap;
}

.nav-item:hover {
  background: var(--elevated);
  color: var(--text);
}

.nav-item.active {
  background: var(--gold-glow);
  color: var(--gold-bright);
  font-weight: 700;
}

.nav-item:focus-visible {
  outline: 2px solid var(--up);
  outline-offset: -2px;
}
```

Matches `.gc-nav-item` / `.gc-nav-item[aria-current="page"]` — note the active state's text color is `var(--gold-bright)` (the brighter accent, `#f2b33d`), not `var(--gold)` (`#b8841f`), matching the source's `.gc-nav-item[aria-current] { color: var(--gc-color-accent-gold); }`. The `background: none`/`border: none`/`text-align: start`/`width: 100%` additions exist because Task 3 converts the underlying element from a `<div onClick>` to a real `<button>` (a plain `<button>` otherwise renders with browser-default chrome and centered text) — without that conversion, the `:focus-visible` ring added here would never fire, since a `<div>` with no `tabIndex` never receives keyboard focus at all. The old app had no keyboard-focus ring on nav items, and no way to reach one by keyboard either.

- [ ] **Step 3: Buttons — `.btn-primary` and `.btn-outline`**

Replace:

```css
.btn-primary {
  background: var(--gold);
  color: #0e1210;
  font-weight: 600;
  font-size:17px;
  padding: 11px 20px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
  letter-spacing: 0.02em;
}

.btn-primary:hover {
  background: var(--gold-bright);
  box-shadow: 0 0 12px var(--gold-dim);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-outline {
  background: transparent;
  color: var(--gold);
  font-weight: 500;
  font-size:17px;
  padding: 10px 18px;
  border-radius: 6px;
  border: 1px solid var(--gold-border);
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-outline:hover {
  background: var(--gold-glow);
  border-color: var(--gold-dim);
}
```

with:

```css
.btn-primary {
  background: var(--gold);
  color: var(--bg);
  font-weight: 700;
  font-size: 15px;
  padding: 12px 20px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  box-shadow: 0 0 14px 0 rgba(242, 179, 61, 0.35);
  letter-spacing: 0.02em;
}

.btn-primary:hover { filter: brightness(1.08); }
.btn-primary:active { filter: brightness(0.95); }

.btn-primary:focus-visible {
  outline: 2px solid var(--gold-bright);
  outline-offset: 2px;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* .gc-btn-outline has no equivalent in the source package (it only ships a
   primary button) — this keeps the old structure but recolors it using the
   same token roles the source uses for .gc-nav-item's inactive/hover pair,
   since a secondary button and an inactive nav item play the same visual
   role (quiet control, gold on hover/active) in this palette. */
.btn-outline {
  background: transparent;
  color: var(--gold-bright);
  font-weight: 500;
  font-size: 15px;
  padding: 10px 18px;
  border-radius: 6px;
  border: 1px solid var(--gold-border);
  cursor: pointer;
}

.btn-outline:hover {
  background: var(--gold-glow);
  border-color: var(--gold-bright);
}

.btn-outline:focus-visible {
  outline: 2px solid var(--gold-bright);
  outline-offset: 2px;
}
```

`.btn-primary` now matches `.gc-btn-primary` precisely, including the always-on gold glow shadow (not just on hover, as the old rule had it) and the `:focus-visible`/`:active` states the source defines. `.btn-outline` is the one component in this task without a source-package equivalent; the comment inline documents that it's an extrapolation, not a literal spec value, per this plan's Global Constraints.

- [ ] **Step 4: Eyebrow label — `.section-label`**

Replace:

```css
.section-label {
  font-size:14px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}
```

with:

```css
.section-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: none;
  color: var(--text-soft);
}
```

Matches `.gc-eyebrow` — notably the source label is **not** uppercased (Arabic text doesn't have a meaningful "uppercase," and the source explicitly sets `text-transform: none`), smaller (11px vs 14px), and uses the secondary (not tertiary/muted) text color.

- [ ] **Step 5: Status tags and live dot**

Replace:

```css
.tag-up {
  background: var(--up-bg);
  color: var(--up);
  font-family: var(--font-mono);
  font-size:15px;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid rgba(90, 158, 122, 0.2);
}

.tag-down {
  background: var(--down-bg);
  color: var(--down);
  font-family: var(--font-mono);
  font-size:15px;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid rgba(158, 90, 90, 0.2);
}

.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--up);
  animation: pulse-dot 2s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(90, 158, 122, 0.5); }
  50% { opacity: 0.75; box-shadow: 0 0 0 4px rgba(90, 158, 122, 0); }
}
```

with:

```css
.tag-up {
  background: var(--up-bg);
  color: var(--up);
  font-family: var(--font-mono);
  font-size: 13px;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid rgba(62, 213, 152, 0.2);
}

.tag-down {
  background: var(--down-bg);
  color: var(--down);
  font-family: var(--font-mono);
  font-size: 13px;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid rgba(229, 83, 61, 0.2);
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--up);
  animation: pulse-dot 2s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(62, 213, 152, 0.5); }
  50% { opacity: 0.75; box-shadow: 0 0 0 4px rgba(62, 213, 152, 0); }
}
```

Same structure as before, recolored to the new `--up`/`--down` hues (`#3ed598`/`#e5533d`) — the source package's `.gc-status-dot` is 8px with no pulse animation, but this app's live-updating price context is exactly what a pulse communicates, so the animation is kept (an intentional, documented deviation, not an oversight).

- [ ] **Step 6: Hairline and hero-number font**

Replace:

```css
.hairline {
  height: 1px;
  background: var(--border);
}
```

with (unchanged structurally — `--border`'s value already changed in Task 1, so this needs no edit beyond confirming it's still just `background: var(--border);`). **Skip this sub-step if `git diff` shows no change needed** — it's called out only so the reviewer explicitly checks it, not because a rule edit is expected.

Replace:

```css
.font-display { font-family: var(--font-display); }
```

with:

```css
.font-display { font-family: var(--font-display); font-weight: 800; }
```

`--font-display` already points at JetBrains Mono after Task 1; this adds the explicit `800` weight the source's `display/price-lg` style specifies (DM Serif Display had no comparable "extra-bold" concept, so the old rule never needed a weight). This one rule change updates all four `.font-display` call sites in `App.tsx` (the hero ounce price, the weighted-target price, and the two DCA tranche numbers) from serif to bold mono with no JSX edits.

- [ ] **Step 7: Verify**

Run `npm run dev`. Walk every screen in the sidebar (Market, Calculator, Target, Scenarios, Egypt, Analyst, DCA Plan, Watchlist, Wallet, Settings) and confirm: panels are flat dark cards with rounded corners (not gradient), the primary CTA buttons glow gently and brighten on hover, nav items highlight in amber-gold when active, section eyebrows are small/non-uppercase, and the big price numbers (Market screen ounce price, Target screen weighted price, DCA tranche percentages) render in bold monospace instead of serif.

- [ ] **Step 8: Commit**

```bash
git add src/styles.css
git commit -m "feat: restyle shared panels, buttons, nav items and labels to the Cockpit spec"
```

---

## Task 3: Remove the light/vault theme toggle; apply Tajawal in Arabic mode

**Files:**
- Modify: `src/App.tsx` (the `Theme` type, `AppState.theme`, its initial value, the `vault`/`theme-vault` usage in the root render, and the props passed to `Sidebar`)
- Modify: `src/ui/Sidebar.tsx` (remove the toggle button and its now-unused props; resize the logo mark)

**Interfaces:**
- Consumes: `--gold-strong`-equivalent tokens from Task 1 (no new tokens needed).
- Produces: `Sidebar`'s prop signature shrinks — `vault` and `toggleTheme` are removed. Any other caller of `Sidebar` (there is only the one, in `App.tsx`) must be updated in the same commit.

- [ ] **Step 1: Remove the `Theme` type and `state.theme` field in `src/App.tsx`**

Delete the type definition (around line 53):

```ts
type Theme = 'light' | 'vault';
```

Remove the `theme: Theme;` field from the `AppState` type (around line 82) and the `theme: 'light',` entry from the initial state object (around line 189). A pre-existing `localStorage` blob from before this change may still contain a `theme` key — that's harmless: `loadState()` parses it into an object that's spread into the new `AppState` shape, and an extra, no-longer-read key on that object is simply ignored (no migration code needed, per this codebase's own convention: `loadState`'s comments already describe similarly ignoring stale pre-v2 shapes rather than writing a migration).

- [ ] **Step 2: Update the root render in `src/App.tsx`**

Find (around line 1244-1259):

```tsx
  const ar = state.lang === 'ar';
  const vault = state.theme === 'vault';
  const sidebarScreen: ScreenKey = activeTab === 'market' ? 'home' : (activeTab as ScreenKey);
  const screenTitle = NAV_LABELS[sidebarScreen][ar ? 'ar' : 'en'];

  return (
    <div className={vault ? 'theme-vault' : ''} style={{ height: '100vh', display: 'flex', background: 'var(--bg)' }} dir={ar ? 'rtl' : 'ltr'}>
      <Sidebar
        screen={sidebarScreen}
        setScreen={(s) => setActiveTab(s)}
        ar={ar}
        vault={vault}
        toggleTheme={() => setState((prev) => ({ ...prev, theme: prev.theme === 'vault' ? 'light' : 'vault' }))}
        toggleLang={toggleLang}
        liveLabel={`LIVE · $${fmt(state.spot)}`}
      />
```

Replace with:

```tsx
  const ar = state.lang === 'ar';
  const sidebarScreen: ScreenKey = activeTab === 'market' ? 'home' : (activeTab as ScreenKey);
  const screenTitle = NAV_LABELS[sidebarScreen][ar ? 'ar' : 'en'];

  return (
    <div style={{ height: '100vh', display: 'flex', background: 'var(--bg)', fontFamily: ar ? 'var(--font-arabic)' : 'var(--font-sans)' }} dir={ar ? 'rtl' : 'ltr'}>
      <Sidebar
        screen={sidebarScreen}
        setScreen={(s) => setActiveTab(s)}
        ar={ar}
        toggleLang={toggleLang}
        liveLabel={`LIVE · $${fmt(state.spot)}`}
      />
```

The added `fontFamily` on the root wrapper is the one genuinely new behavior in this task: today, `body`'s global `font-family: var(--font-sans)` (DM Sans) applies even in Arabic mode almost everywhere — only one `<h1>` in the whole file overrides it. This wrapper-level override cascades Tajawal to every element in Arabic mode (English mode is unaffected, since `var(--font-sans)` there is identical to what `body` already sets — the inline style is a no-op for `en`). This directly delivers the theme package's "Tajawal for all Arabic UI text" requirement without touching every individual text element.

- [ ] **Step 3: Remove the toggle button and resize the logo mark in `src/ui/Sidebar.tsx`**

Remove `vault` and `toggleTheme` from the destructured props and the type signature:

```tsx
export function Sidebar({
  screen,
  setScreen,
  ar,
  toggleLang,
  liveLabel,
}: {
  screen: ScreenKey;
  setScreen: (s: ScreenKey) => void;
  ar: boolean;
  toggleLang: () => void;
  liveLabel: string;
}) {
```

Replace the bottom control row (currently a two-button flex row: language toggle + sun/moon theme toggle):

```tsx
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn-outline" style={{ flex: 1, padding: '6px 0', fontSize: 15 }} onClick={toggleLang}>
            {ar ? 'EN' : 'عربي'}
          </button>
          <button className="btn-outline" style={{ flex: 1, padding: '6px 0', fontSize: 15, display: 'flex', justifyContent: 'center' }} onClick={toggleTheme}>
            <Icon name={vault ? 'sun' : 'moon'} size={12} />
          </button>
        </div>
```

with just the language toggle, now full-width:

```tsx
        <button className="btn-outline" style={{ width: '100%', padding: '6px 0', fontSize: 15 }} onClick={toggleLang}>
          {ar ? 'EN' : 'عربي'}
        </button>
```

Resize the logo mark from 28×28 to 30×30 to match `.gc-logo-mark`'s spec (the "✦" glyph is kept rather than switched to the source mockup's "ك" — this app is bilingual and a language-agnostic glyph is the better fit than an Arabic-only letter that would look wrong in English mode):

```tsx
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              background: 'var(--gold)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ color: 'var(--bg)', fontWeight: 800, fontSize: 15 }}>✦</span>
          </div>
```

(`color: '#0e1210'` becomes `color: 'var(--bg)'` — the hardcoded old dark background hex is replaced with the token, so the glyph automatically stays readable against whatever `--gold` resolves to.)

- [ ] **Step 4: Convert nav items from `<div onClick>` to real, keyboard-operable `<button>`s**

Find the nav item loop (around line 100-103):

```tsx
        {SCREEN_ORDER.map((s) => (
          <div key={s} className={`nav-item ${screen === s ? 'active' : ''}`} onClick={() => setScreen(s)}>
            <Icon name={SCREEN_ICONS[s]} size={16} />
            <span>{NAV_LABELS[s][ar ? 'ar' : 'en']}</span>
          </div>
        ))}
```

Replace with:

```tsx
        {SCREEN_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            className={`nav-item ${screen === s ? 'active' : ''}`}
            aria-current={screen === s ? 'page' : undefined}
            onClick={() => setScreen(s)}
          >
            <Icon name={SCREEN_ICONS[s]} size={16} />
            <span>{NAV_LABELS[s][ar ? 'ar' : 'en']}</span>
          </button>
        ))}
```

This is the same accessibility fix the source package's README calls out for its own bottom-nav/sidebar markup ("the original review flagged the nav items as unlabeled, non-keyboard-operable `<div>`s — this new markup fixes that at the same time as the reskin, don't reintroduce `<div onclick>`"). The `active` class is kept (so Task 2's CSS needs no selector changes), and `aria-current="page"` is added alongside it for real assistive-tech semantics, matching `.gc-nav-item[aria-current="page"]`'s own selector in the source `components.css`.

- [ ] **Step 5: Typecheck**

Run `npx tsc -b`. Expect: no errors. (This will catch it immediately if any other file still imports/passes `vault` or `toggleTheme` to `Sidebar`, or still references the removed `<div>` nav-item shape — `grep -rn "toggleTheme\|vault=" src/` should also come back empty before moving on.)

- [ ] **Step 6: Verify**

Run `npm run dev`. Confirm: the sidebar no longer shows a sun/moon button, only the language toggle (now full-width); switching to Arabic visibly changes body text to Tajawal (compare against `gold-cockpit-theme-package/html/mobile-market.html`'s type, which uses the same font); switching back to English is unaffected (still DM Sans, as before this task); clicking a nav item still switches screens; pressing Tab repeatedly from the logo reaches each nav item in order with a visible green focus ring, and pressing Enter/Space on a focused item activates it.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/ui/Sidebar.tsx
git commit -m "feat: remove the light/vault theme toggle; apply Tajawal in Arabic mode"
```

---

## Task 4: AI Analyst panel glow treatment

**Files:**
- Modify: `src/styles.css` (add `.instrument-card--ai`)
- Modify: `src/App.tsx:1637` (the AI Analyst screen's outer `<Card>`)

**Interfaces:**
- Consumes: `--gold-glow`, `--gold-border` tokens from Task 1.
- Produces: `.instrument-card--ai`, an additive class meant to be combined with `.instrument-card` (via the existing `Card` primitive's `className` prop), reserved for this one screen only, per the source package's explicit guidance.

- [ ] **Step 1: Add the glow-panel class**

In `src/styles.css`, add after the `.instrument-card` rule from Task 2:

```css
/* Reserved for the AI Analyst panel only, per the source design's own
   note: this gold-tinted glow is meant to read as "the AI feature," not as
   general panel decoration — don't apply it elsewhere. */
.instrument-card--ai {
  background: var(--gold-glow);
  border-color: var(--gold-border);
  box-shadow: 0 0 14px 0 rgba(242, 179, 61, 0.35);
}
```

Matches `.gc-ai-panel` (`accent-gold-bg` fill, `border-strong` border, gold-glow shadow), layered on top of `.instrument-card`'s base padding/radius/shadow-panel rather than duplicating them.

- [ ] **Step 2: Apply it to the AI Analyst panel**

In `src/App.tsx`, find the AI Analyst screen's outer panel (around line 1637):

```tsx
              <Card>
                <div className="soft-text" style={{ fontSize: 15, marginBottom: 6 }}>
                  {t.aiUsingProvider}: {activeProvider ? `${activeProvider.label} (${providerTypeLabel(activeProvider.provider_type)})` : t.aiNoProvider}
                </div>
```

Change the opening tag to:

```tsx
              <Card className="instrument-card--ai">
```

(`Card`'s existing signature already accepts and forwards a `className`, appending it after `instrument-card` — see `src/ui/primitives.tsx`'s `Card` component — so no primitive changes are needed.)

- [ ] **Step 3: Verify**

Run `npm run dev`, open the Analyst screen. Confirm: only this one panel has the warm gold-tinted background and glow — every other panel in the app (Market, Calculator, Wallet, etc.) still renders as the plain flat `.instrument-card` from Task 2.

- [ ] **Step 4: Commit**

```bash
git add src/styles.css src/App.tsx
git commit -m "feat: give the AI Analyst panel its gold-glow treatment"
```

---

## Task 5: Full visual QA pass

**Files:** none (verification-only task)

- [ ] **Step 1: Side-by-side comparison against the reference builds**

Open `gold-cockpit-theme-package/html/desktop-dashboard.html` and `localhost:3577` in two side-by-side windows. Confirm the background depth (bg-0 vs bg-1 panels), border color, text color hierarchy (primary/secondary/tertiary), and gold accent hue all match.

- [ ] **Step 2: Walk every screen, both languages**

In the running app, click through every sidebar entry (Market, Calculator, Target, Scenarios, Egypt, Analyst, DCA Plan, Watchlist, Wallet, Settings) in both Arabic and English, checking: panels are flat/rounded/dark, primary buttons glow and have a visible focus ring when tabbed to, nav items highlight correctly when active, hero numbers (ounce price, weighted target, DCA tranche %) render bold monospace, the AI panel (and only the AI panel) has the gold-tinted glow, and Arabic text renders in Tajawal while English stays in DM Sans.

- [ ] **Step 3: Regression check**

Run `npx tsc -b` and `npm test`. Expect: both clean/green — this is a CSS-only change, so a failure here would indicate an accidental JSX/type break introduced in Tasks 3-4, not an expected consequence of the reskin.

- [ ] **Step 4: Report findings**

If anything in Steps 1-2 doesn't match the reference, note the specific screen/element and the mismatch — don't silently patch it into a "close enough" value; go back to the relevant task and correct it against the actual token/component source.

---

## Self-Review Notes

- **Spec coverage:** every component the source package's README explicitly maps (`.gc-topbar`→header, `.gc-status-dot`→`.live-dot`/`.tag-up`, `.gc-price-panel`/`.gc-price-display`→`.font-display`+existing price markup, `.gc-table-panel`/`.gc-karat-row`→existing karat rows via `.font-mono`/`--gold` tokens, `.gc-btn-primary`→`.btn-primary`, `.gc-sidebar`/`.gc-nav-item`→`Sidebar.tsx`/`.nav-item`, `.gc-ai-panel`→Task 4) has a corresponding task. `.gc-bottom-nav`/`.gc-tab-btn` (mobile-only) is the one row in that table intentionally not built, per the team's reskin-only scope decision documented in Global Constraints.
- **Placeholder scan:** no TBD/TODO markers; every CSS/TSX block is a complete, copy-pasteable replacement.
- **Type consistency:** `Sidebar`'s prop type and its one call site in `App.tsx` are edited together in Task 3, Step 2-3, so they can't drift; `Card`'s `className` prop (consumed in Task 4) is verified against `src/ui/primitives.tsx`'s actual signature, not assumed.
- **Value provenance:** every hex/px/rem value introduced in Tasks 1-2 and 4 is either copied directly from `gold-cockpit-theme-package/css/tokens.css`/`components.css`, or — for the two cases with no source equivalent (`--surface-hover`, `.btn-outline`) — explicitly flagged inline as a derived/extrapolated value with the reasoning shown, per this plan's Global Constraints ("no inventing new hex values" without saying so).
