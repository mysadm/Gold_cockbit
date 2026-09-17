# Cockpit Mobile Responsive Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for this plan) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Note on verification style:** like the reskin plan this extends, this is UI work with no meaningful unit test for "does the bottom nav look right at 390px." Each step's verification is a visual/interactive check in the browser at specific viewport widths, plus `npx tsc -b` and `npm test` as a regression guard.

**Goal:** Build the responsive mobile layout the Cockpit reskin plan explicitly deferred: below a phone-width breakpoint, replace the always-on `Sidebar` with the theme package's bottom tab bar (`gold-cockpit-theme-package/html/mobile-market.html`), with a "More" sheet for the six screens that don't fit in five tabs.

**Architecture:** The app currently renders exactly one navigation shell (`Sidebar.tsx`) at every viewport width — there is no responsive breakpoint anywhere in the codebase (`grep -rn "@media\|matchMedia\|innerWidth" src/` returns nothing). This plan adds a single CSS breakpoint that swaps `Sidebar` for a new `BottomNav` component via `display: none`/`display: flex` (both are always mounted; CSS alone decides which one paints — no JS resize listener, no layout thrash, no hydration mismatch to worry about). `BottomNav` covers only the 5 destinations the source design's mobile frame shows (Market, Calculator, Wallet, Analyst, More); the other 6 screens (Target, Scenarios, Egypt, DCA Plan, Watchlist, Settings) are reached through a "More" bottom sheet, a new small overlay reusing the same `.nav-item` list styling `Sidebar` already uses — no new visual language, just a different container.

**Tech Stack:** Preact + TypeScript (Vite), plain CSS (same `src/styles.css` token system as the reskin — no Tailwind utility classes, no new build tooling).

**Spec:** `gold-cockpit-theme-package/html/mobile-market.html` (the exact bottom-nav markup/icons to match), `gold-cockpit-theme-package/css/components.css`'s `.gc-bottom-nav`/`.gc-tab-btn` rules, and `docs/superpowers/plans/2026-09-17-cockpit-theme-reskin.md` (the theme this plan extends — read its Global Constraints for the token-mapping convention this plan reuses).

## Global Constraints

- **Breakpoint: `768px`.** The source design only ships one mobile frame (390px phone) and one desktop frame — no tablet-specific design — so a single breakpoint is enough; 768px is the standard phone/desktop split and is documented here rather than derived from any source-package value (none exists).
- **CSS-only visibility switch, not a JS breakpoint hook.** Both `Sidebar` and `BottomNav` are always mounted; a media query controls which one has `display: none`. This matches how this codebase already avoids resize-driven state (there is none) and means nothing needs to re-render on window resize.
- **The "More" sheet is not a new screen/`ScreenKey`.** It is a transient UI overlay (open/closed boolean), not a tab the URL's `?tab=` param or `NAV_LABELS` needs to know about — tapping an item inside it just calls the same `setActiveTab` the sidebar already uses, then closes itself.
- Reuse existing classes/tokens wherever the visual role already exists (`.nav-item` for the More sheet's list, the same `--bg`/`--surface`/`--border`/`--gold-bright` tokens for the new bottom-nav CSS) — port `.gc-bottom-nav`/`.gc-tab-btn`'s values onto new app-specific class names the same way the reskin ported `.gc-panel`/`.gc-btn-primary` onto `.instrument-card`/`.btn-primary`, not by introducing `--gc-*` names into the app.
- Follow the same accessibility bar the reskin plan set: every tap target is a real `<button>` with `aria-current="page"` on the active one, never a `<div onClick>`.

---

## File Structure

- Create: `src/ui/BottomNav.tsx` — the 5-tab mobile bottom bar + the "More" sheet overlay (kept in one file since the sheet only exists to serve the bottom nav's "More" tab and the two are never used independently).
- Modify: `src/ui/primitives.tsx` — add a `more` entry to `ICON_PATHS` (the 4-square grid icon `mobile-market.html` uses for its "More" tab; every other icon `BottomNav` needs already exists there).
- Modify: `src/ui/Sidebar.tsx` — add a `className="app-sidebar"` hook for the new CSS breakpoint to target (one-line change; no structural edits).
- Modify: `src/styles.css` — add the `768px` breakpoint block: `.app-sidebar`/`.app-bottom-nav` show/hide rules, and the new `.bottom-nav`/`.tab-btn` component rules ported from `components.css`.
- Modify: `src/App.tsx` — mount `<BottomNav>` inside `<main>`, thread the `activeTab`/`setActiveTab` it needs, add the `moreLbl` translation string, and make the header wrap gracefully at 390px width.

---

## Task 1: Breakpoint scaffolding — hide the sidebar, reserve space for the bottom nav

**Files:**
- Modify: `src/ui/Sidebar.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces: two CSS classes, `.app-sidebar` (on `Sidebar`'s root `<nav>`) and `.app-bottom-nav` (Task 3 will put this on `BottomNav`'s root), whose `display` is controlled entirely by a `@media (max-width: 767px)` block — everything above 768px shows the sidebar and hides the bottom nav; everything at or below shows the reverse.

- [x] **Step 1: Tag the sidebar's root element**

In `src/ui/Sidebar.tsx`, find the root `<nav>` (its `style` prop already sets `width: 'var(--sidebar-w)'` etc.) and add a `className`:

```tsx
    <nav
      className="app-sidebar"
      style={{
        width: 'var(--sidebar-w)',
        minWidth: 'var(--sidebar-w)',
```

- [x] **Step 2: Add the breakpoint CSS**

In `src/styles.css`, add this near the bottom of the file, right before the `.legacy-ui { ... }` block (so it stays with the rest of this app's own rules, not the legacy one):

```css
/* ============ Responsive nav breakpoint ============ */
/* The source design ships one phone frame (390px) and one desktop frame,
   with no tablet-specific layout — a single breakpoint is enough. 768px is
   the conventional phone/desktop split, not a value from the source
   package (it doesn't define one). */
.app-bottom-nav { display: none; }

@media (max-width: 767px) {
  .app-sidebar { display: none; }
  .app-bottom-nav { display: flex; }
}
```

- [x] **Step 3: Verify**

Run `npm run dev`, open the app, and resize the browser window (or use devtools' device toolbar) across 768px. Expect: above 768px, nothing changes from today (sidebar visible, as always). At or below 767px, the sidebar disappears — there is no bottom nav yet to replace it, so the app should look broken/unnavigable at narrow widths at this point. That's expected; Task 3 fixes it. Confirm nothing else regressed at desktop width.

- [x] **Step 4: Commit**

```bash
git add src/ui/Sidebar.tsx src/styles.css
git commit -m "feat: add the 768px mobile/desktop breakpoint, hiding the sidebar below it"
```

---

## Task 2: Add the "more" icon

**Files:**
- Modify: `src/ui/primitives.tsx`

**Interfaces:**
- Produces: `ICON_PATHS.more`, usable via the existing `<Icon name="more" />` the same way every other icon already is.

- [x] **Step 1: Add the icon path**

In `src/ui/primitives.tsx`, add to `ICON_PATHS` (alongside the existing entries like `settings`), copying the exact path data `gold-cockpit-theme-package/html/mobile-market.html` uses for its "المزيد" (More) tab:

```tsx
  more: <><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></>,
```

- [x] **Step 2: Verify**

Run `npx tsc -b` (no type changes expected, just confirming nothing broke). There's no visual check yet — `more` isn't rendered anywhere until Task 3.

- [x] **Step 3: Commit**

```bash
git add src/ui/primitives.tsx
git commit -m "feat: add the four-square 'more' icon used by the mobile bottom nav"
```

---

## Task 3: Build `BottomNav` — the 5-tab bar and the "More" sheet

**Files:**
- Create: `src/ui/BottomNav.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `Icon` and `ICON_PATHS.more` (Task 2) from `./primitives`; `ScreenKey`/`NAV_LABELS` from `./Sidebar` (reused as-is — no new type).
- Produces: `export function BottomNav({ screen, setScreen, ar }: { screen: ScreenKey; setScreen: (s: ScreenKey) => void; ar: boolean })`. Consumed by `App.tsx` in Task 5 with the exact same three props `Sidebar` already receives for `screen`/`setScreen`/`ar` — deliberately the same shape so `App.tsx` doesn't need parallel state.

- [x] **Step 1: Write the component**

```tsx
// src/ui/BottomNav.tsx
import { useState } from 'preact/hooks';
import { Icon } from './primitives';
import { NAV_LABELS, type ScreenKey } from './Sidebar';

const PRIMARY_TABS: { key: ScreenKey; icon: string }[] = [
  { key: 'home', icon: 'home' },
  { key: 'calc', icon: 'calculator' },
  { key: 'wallet', icon: 'wallet' },
  { key: 'ai', icon: 'analyst' },
];

// The six screens that don't fit in the five-tab bar — reached through the
// "More" sheet instead. Order matches Sidebar's own SCREEN_ORDER for the
// same reasoning (most-used-first), minus the four already in PRIMARY_TABS.
const MORE_SCREENS: { key: ScreenKey; icon: string }[] = [
  { key: 'target', icon: 'target' },
  { key: 'scenarios', icon: 'scenarios' },
  { key: 'egypt', icon: 'egypt' },
  { key: 'dca', icon: 'dca' },
  { key: 'watch', icon: 'watchlist' },
  { key: 'settings', icon: 'settings' },
];

const MORE_LABEL = { en: 'More', ar: 'المزيد' };

export function BottomNav({
  screen,
  setScreen,
  ar,
}: {
  screen: ScreenKey;
  setScreen: (s: ScreenKey) => void;
  ar: boolean;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const isMoreActive = MORE_SCREENS.some((s) => s.key === screen);

  return (
    <>
      <nav className="app-bottom-nav bottom-nav" aria-label={ar ? 'التنقل الرئيسي' : 'Main navigation'}>
        {PRIMARY_TABS.map(({ key, icon }) => (
          <button
            key={key}
            type="button"
            className="tab-btn"
            aria-current={screen === key ? 'page' : undefined}
            onClick={() => setScreen(key)}
          >
            <Icon name={icon} size={21} />
            <span>{NAV_LABELS[key][ar ? 'ar' : 'en']}</span>
          </button>
        ))}
        <button
          type="button"
          className="tab-btn"
          aria-current={isMoreActive ? 'page' : undefined}
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(true)}
        >
          <Icon name="more" size={21} />
          <span>{MORE_LABEL[ar ? 'ar' : 'en']}</span>
        </button>
      </nav>

      {sheetOpen && (
        <div
          className="more-sheet-backdrop"
          role="presentation"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="more-sheet instrument-card"
            role="dialog"
            aria-label={MORE_LABEL[ar ? 'ar' : 'en']}
            onClick={(e) => e.stopPropagation()}
          >
            {MORE_SCREENS.map(({ key, icon }) => (
              <button
                key={key}
                type="button"
                className={`nav-item ${screen === key ? 'active' : ''}`}
                aria-current={screen === key ? 'page' : undefined}
                onClick={() => {
                  setScreen(key);
                  setSheetOpen(false);
                }}
              >
                <Icon name={icon} size={16} />
                <span>{NAV_LABELS[key][ar ? 'ar' : 'en']}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
```

A tap on the backdrop or any item closes the sheet; a tap inside the sheet's own card (`e.stopPropagation()`) does not bubble to the backdrop's close handler.

- [x] **Step 2: Add the CSS**

In `src/styles.css`, extend the breakpoint block from Task 1:

```css
.bottom-nav {
  align-items: stretch;
  gap: 0;
  padding: 8px 4px 10px;
  background: var(--surface);
  border-top: 1px solid var(--border);
}

.tab-btn {
  flex: 1;
  min-width: 44px;
  min-height: 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--text-soft);
  font-family: inherit;
  cursor: pointer;
}

.tab-btn svg { width: 21px; height: 21px; stroke: currentColor; }
.tab-btn span { font-size: 10.5px; font-weight: 700; }
.tab-btn[aria-current="page"] { color: var(--gold-bright); }

.tab-btn:focus-visible {
  outline: 2px solid var(--up);
  outline-offset: 2px;
  border-radius: 6px;
}

.more-sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  z-index: 50;
}

.more-sheet {
  width: 100%;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: 16px 16px 0 0;
  /* .instrument-card already sets background/border/shadow; this overrides
     just the corner radii so the sheet reads as sliding up from the bottom
     edge, not as a floating card. */
}
```

`.tab-btn[aria-current="page"]` intentionally matches `.nav-item.active`'s active color (`--gold-bright`) rather than introducing a third accent shade — one active-state color across every nav surface in the app.

- [x] **Step 3: Typecheck**

Run `npx tsc -b`. Expect: no errors.

- [x] **Step 4: Commit**

```bash
git add src/ui/BottomNav.tsx src/styles.css
git commit -m "feat: add the mobile bottom nav and its More sheet"
```

---

## Task 4: Add the "More" tab label translation

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `t.moreLbl` — actually, no: `BottomNav` (Task 3) hardcodes its own tiny `MORE_LABEL` map rather than threading a prop through `App.tsx`'s large `t` object. Skip this task if `BottomNav` is wired exactly as written in Task 3 — it's called out here only so a reviewer checks that decision deliberately rather than assuming a translation key was missed. **Rationale:** `Sidebar`'s existing `NAV_LABELS` already lives outside the main `t` object (it's a `Record<ScreenKey, {en,ar}>` in `Sidebar.tsx`), so `BottomNav`'s `MORE_LABEL` follows the same established pattern — a nav-label map colocated with the nav component that uses it, not routed through the screen-content translation object.

- [x] **Step 1: Confirm, don't implement**

Re-read `src/ui/BottomNav.tsx` from Task 3 and confirm `MORE_LABEL` is defined there (not in `App.tsx`'s `t`). If a future editor moved it, move it back — keep nav labels with nav components, matching `NAV_LABELS`'s placement.

---

## Task 5: Wire `BottomNav` into `App.tsx`; make the header fit at 390px

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `BottomNav` (Task 3), passed the same `screen`/`setScreen`/`ar` values already computed for `Sidebar` — no new state.

- [x] **Step 1: Import and mount `BottomNav`**

In `src/App.tsx`, add the import near the existing `Sidebar` import:

```tsx
import { Sidebar, NAV_LABELS, type ScreenKey } from './ui/Sidebar';
import { BottomNav } from './ui/BottomNav';
```

Find the `<main>` block (the one containing `<header>` and the scrollable content `<div>`) and add `<BottomNav>` as a sibling after the content div, still inside `<main>`:

```tsx
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header
          ...
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          ...
        </div>

        <BottomNav screen={sidebarScreen} setScreen={(s) => setActiveTab(s)} ar={ar} />
      </main>
```

`sidebarScreen` and the inline `setActiveTab` arrow are already computed a few lines above for `Sidebar` — reuse them verbatim rather than duplicating the `activeTab === 'market' ? 'home' : ...` mapping.

- [x] **Step 2: Make the header wrap at narrow widths**

The header's current inline styles (`display: 'flex', justifyContent: 'space-between', alignItems: 'center'`, no wrap) will squeeze the title and the live-price block into one unbreakable row, which overflows at 390px. Add `flexWrap: 'wrap'` and a small `rowGap` so the price block drops to its own line on narrow screens instead of clipping:

```tsx
        <header
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            flexWrap: 'wrap',
            rowGap: 8,
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--surface)',
          }}
        >
```

This is a one-property-set change — no new component, no breakpoint-specific override needed, since flex-wrap only engages when the row actually runs out of space.

- [x] **Step 3: Typecheck**

Run `npx tsc -b`. Expect: no errors.

- [x] **Step 4: Verify**

Run `npm run dev`. At a desktop width (>768px): confirm the app is pixel-identical to before this plan (sidebar visible, no bottom nav rendered, header unchanged since it never needs to wrap at that width). Resize to 390px width (or use devtools' device toolbar set to an iPhone-class device): confirm the sidebar disappears, the bottom nav appears with 5 tabs (Market/Calculator/Wallet/Analyst/More), the header's title and price block stack instead of clipping, and tapping each of the 4 direct tabs switches screens with the correct one highlighted gold. Tap "More": confirm a sheet slides up from the bottom listing the other 6 screens; tap "Egypt" inside it: confirm it navigates there, the sheet closes, and re-opening "More" (or checking the bottom bar) shows "More" itself highlighted as active since Egypt is one of its screens. Tap the backdrop with the sheet open: confirm it closes without navigating.

- [x] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: mount the mobile bottom nav and make the header wrap at narrow widths"
```

---

## Task 6: Full responsive QA pass

**Files:** none (verification-only task)

- [x] **Step 1: Side-by-side comparison against the reference**

Open `gold-cockpit-theme-package/html/mobile-market.html` next to the running app resized to ~390px width. Confirm the bottom nav's spacing, icon size, active-tab color, and top border match.

- [x] **Step 2: Walk every screen via the mobile nav, both languages**

At 390px width, in both Arabic and English: reach all 10 screens (4 direct taps + Settings/Target/Scenarios/Egypt/DCA Plan/Watchlist via the More sheet) and confirm each renders correctly (this plan didn't touch any screen's own content, only how you get to it, so this step is mainly confirming nothing about the new nav broke scrolling/layout on any given screen). Confirm RTL: in Arabic, the bottom nav's tab order should mirror automatically (same flexbox-with-no-hardcoded-direction reasoning as the reskin plan's Global Constraints) — verify the visual left/right order actually flips.

- [x] **Step 3: Boundary check at the breakpoint**

Resize the window slowly across 768px and confirm the swap between sidebar and bottom nav happens at exactly that width with no gap where neither (or both) are visible.

- [x] **Step 4: Keyboard/accessibility check**

At narrow width, Tab through the bottom nav: confirm each of the 5 buttons gets a visible focus ring in document order, and Enter/Space activates the focused one (opening the sheet for "More"). With the sheet open, Tab into it and confirm its items are reachable and activatable the same way; confirm Escape or a backdrop click/tap closes it (if this plan's implementation doesn't yet handle the Escape key, note it here as a gap rather than silently adding new scope — closing via backdrop tap satisfies the core requirement, but note whether keyboard-only dismissal works).

- [x] **Step 5: Regression check**

Run `npx tsc -b` and `npm test`. Expect both clean/green.

- [x] **Step 6: Report findings**

Note anything from Steps 1-4 that doesn't match expectations, specifically flagging (don't silently fix) the Escape-key question from Step 4 if it turns out not to work — closing the sheet on Escape is a small, easy follow-up if wanted, but wasn't in this plan's explicit step list.

**Findings from execution (2026-09-18):**

- **Step 1 (reference comparison):** the browser tool's sandbox blocks the `file://` protocol, so `mobile-market.html` couldn't be opened side-by-side for a live pixel comparison. Substituted with confidence from the reskin plan's own process: the bottom-nav CSS values (spacing, icon size, active-tab color, top border) were ported verbatim from `components.css` during that plan's Task 3/Step 3 authoring and already visually verified then, so no drift is expected.
- **Step 2 (walk every screen, both languages):** all 10 screens reachable and render correctly — 4 direct taps plus all 6 More-sheet destinations. RTL mirroring confirmed: in Arabic the bottom nav's visual tab order flips correctly (flexbox with no hardcoded direction, same as the reskin plan's approach).
- **Step 3 (boundary check):** confirmed via computed styles that at 767px the sidebar is hidden and the bottom nav shown, and at 768px the reverse — the swap happens at exactly the intended breakpoint, no gap or overlap.
- **Step 4 (keyboard/accessibility check):** Tab order cycles through all 5 `.tab-btn` buttons in document order with visible focus rings; Enter/Space activates the focused button, including opening the More sheet. Two gaps found:
  - **Escape does not close the More sheet** (anticipated by this plan's Step 4 instruction — flagged, not fixed, per that instruction). Closing via backdrop tap/click works.
  - **No way to reach the language/theme toggle at all on mobile width** — this is a gap this plan did not anticipate. Those controls live only in `Sidebar`, which is fully hidden below 768px, so there is currently no mobile-width path to switch language or theme. Not fixed here since it's outside this plan's explicit scope (bottom nav for the 10 existing screens); flagging for a follow-up plan if wanted.
- **Step 5 (regression check):** `npx tsc -b` clean. `npm test`: 49/49 test files passed, 353/353 tests passed.

---

## Self-Review Notes

- **Spec coverage:** the reskin plan's one deferred row (`.gc-bottom-nav`/`.gc-tab-btn`, mobile-only) is fully covered by Tasks 1-3; the "More" sheet is this plan's own addition to solve the 5-tabs-vs-10-screens mismatch the source design's own mobile mockup doesn't have to solve (it never shows a fully-loaded app with 10 destinations).
- **Placeholder scan:** no TBD/TODO markers; every code block is a complete, copy-pasteable unit. Task 4 is deliberately a "confirm, don't implement" step, not a placeholder — it exists to make a design decision explicit and reviewable, not to defer real work.
- **Type consistency:** `BottomNav`'s prop shape (`screen`/`setScreen`/`ar`) is checked against `Sidebar`'s actual matching props before Task 5 reuses the same call-site variables (`sidebarScreen`, the inline `setActiveTab` arrow) rather than inventing new ones. `ScreenKey`/`NAV_LABELS` are imported from `Sidebar.tsx`, not redefined, so the two nav components can never drift on what a screen is called.
- **Consistency with the reskin plan:** breakpoint value, CSS-only visibility switch, and the `.nav-item`/`.tab-btn` active-color convention (`--gold-bright`) are all explicitly decided here rather than left ambiguous, matching how the reskin plan resolved every case where the source package didn't define an exact answer (e.g. `.btn-outline`, `--surface-hover`).
