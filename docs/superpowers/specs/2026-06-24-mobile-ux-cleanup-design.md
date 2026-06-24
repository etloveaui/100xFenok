# Mobile UX Cleanup — Design Spec

> Status: design approved; ready for implementation plan
> Scope: public 100xFenok product surfaces in `100xfenok-next`
> Goal: move the product from "desktop shrink" to mobile-first retail finance UX

## Background

Parallel UI/UX audits found that 100xFenok currently feels stitched-together on mobile:

- AppShell bottom tab bar squeezes 7 items into a 7-column grid, forcing 9px labels on narrow screens.
- Several key pages (`/screener`, `/superinvestors`, `/portfolio`, `/stock/[ticker]`, `/etfs/[ticker]`) expose desktop tables with `min-w-[620px]` or more and no mobile card alternative.
- Touch targets are below WCAG/W3C guidelines (e.g. screener expand toggle ~16px, portfolio delete button text-only).
- Desktop shell uses non-standard `zoom: 1.25` for perceived density.
- Multiple competing design systems (V1 Tailwind, V2/V3/V4 home styles, AppShell `fnk-*`, legacy embeds) make incremental UI fixes inconsistent.

## Design Decision

Apply **Phase 1: mobile surface cleanup** before any design-system rewrite. This delivers the fastest user-visible improvement with the smallest blast radius.

- **Approach A (quick wins)** + **Approach B (mobile card views)** in sequence.
- **Approach C (shared responsive-table primitive)** is deferred to Phase 2.

## Phase 1 Scope

### 1. AppShell mobile bottom tab bar

**Current state**
- 7 tabs: Explore, Market, Sectors, ETF, Screener, Superinvestors, Portfolio
- `grid-template-columns: repeat(7, ...)` with `text-[10px]` and `text-[9px]` under 360px.

**Change**
- Collapse to 5 tabs: **Explore**, **Market**, **Screener**, **Portfolio**, **More**.
- Move **Sectors**, **ETF**, **Superinvestors** under **More**.
- Keep label minimum `11px` on all supported widths; never go below.
- Preserve current active-state styling and TransitionLink behavior.

**Files**
- `src/components/shell/AppShell.tsx` (tab list)
- `src/styles/app-shell.css` (grid + font-size media query)

### 2. Remove `zoom: 1.25`

**Current state**
- `src/styles/app-shell.css:48-50` zooms the entire shell 125% at `min-width: 1280px`.

**Change**
- Delete the `zoom` rule.
- Compensate by bumping desktop font/space tokens where needed, but avoid changing mobile.

**Files**
- `src/styles/app-shell.css`

### 3. Screener mobile card view

**Current state**
- 52 columns; mobile shows a card but with dense 9px labels, 3-column estimate grids, and a tiny `+/-` expand toggle.
- PER band graph uses `min-w-[176px]` and can overflow the card.

**Change**
- Redesign `MobileStockCard` to show a compact headline row:
  - ticker, name, action badge, price/change, market cap.
- Expandable body shows only the most useful 4-5 metrics for the active preset (e.g. PER, PBR, dividend, 12M return, guru holders).
- Replace 3-column estimate grid with a single-row "FY+1~+3" mini table only when expanded.
- Expand toggle: make the entire card header tappable or a 44×44px button.
- PER band: use a fluid width (`w-full`) and clamp text.

**Files**
- `src/app/screener/ScreenerClient.tsx` (MobileStockCard, estimate cell, expand logic)
- `src/app/screener/screener.css` if mobile card styles exist

### 4. Portfolio mobile card view

**Current state**
- Holdings table `min-w-[640px]` with no mobile alternative.
- Add-holding inputs are narrow (`w-20`/`w-24`) and delete button is text-only.

**Change**
- Add a `MobileHoldingCard` list for narrow viewports.
- Each card shows ticker, name, current price, shares, weight, P&L.
- Edit/Delete actions become 36×36px icon buttons.
- Add-holding form stacks vertically on mobile.

**Files**
- `src/app/portfolio/PortfolioClient.tsx`

### 5. Stock detail tab scroll affordance

**Current state**
- `.stock-tabs` hides scrollbars; users may not notice more tabs exist.
- Tab markup is duplicated in multiple branches.

**Change**
- Add a right-edge fade/shadow indicator when tabs overflow.
- (Optional but recommended) de-duplicate tab markup into a single `StockTabs` component if the duplication is still present.

**Files**
- `src/styles/app-shell.css` (`.stock-tabs`)
- `src/app/stock/[ticker]/StockDetailClient.tsx` (tab rendering branches)

### 6. Superinvestors table scroll affordance (Phase 1)

**Current state**
- `min-w-[720px]` and `min-w-[480px]` tables.

**Change**
- Wrap scrollable tables with `role="region"`, `tabIndex={0}`, and a visible scroll-hint shadow.
- Full mobile card view is Phase 2.

**Files**
- `src/app/superinvestors/SuperinvestorsClient.tsx`

### 7. Touch target pass

**Targets**
- Screener expand toggle: 44×44px.
- Portfolio delete/edit: 36×36px minimum.
- Screener filter checkboxes: `min-w-5 min-h-5`.
- AppShell top-bar icon buttons: ensure 44×44px.

## Non-Goals (Phase 1)

- Full design-system unification (V1~V4, legacy embeds).
- Converting `/alpha-scout`, `/ib`, `/posts`, `/vr` from iframe/native variants into a single shell.
- New charts or visualizations.
- Desktop layout redesign beyond removing `zoom`.

## Success Criteria

1. Mobile viewport (375px) bottom tab labels are not truncated or wrapped awkwardly.
2. Lighthouse mobile tap-target audit shows no overlapping/undersized targets on `/screener` and `/portfolio`.
3. `/screener` and `/portfolio` mobile views have no horizontal page overflow (`document.documentElement.scrollWidth <= window.innerWidth`).
4. `npx tsc --noEmit`, `npm run build`, `npm run qa:copy` pass.
5. Playwright mobile smoke passes on `/`, `/screener`, `/portfolio`, `/stock/NVDA`, `/etfs/SPY`.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Users used to 7-tab layout lose direct access | Keep tab order logical; put the 2 least-used primary destinations in "More" |
| Screener card view reduces information density | Show the 4-5 most relevant metrics per preset; keep full table on desktop |
| Removing `zoom` makes desktop feel too small | Bump desktop type/space tokens slightly; measure before/after |
| Duplicated tab markup refactor grows scope | De-dupe only if low-risk; otherwise just add scroll affordance |

## Related Findings (for Phase 2)

- Design-token fragmentation across `globals.css`, `app-shell.css`, `design-v2.css`, `theme-c.css`.
- Legacy iframe embed pages (`/market`, `/alpha-scout`, `/ib`, `/posts`) break shell continuity.
- Home page branches into V1~V4 via query params.
- Color semantics drift (`#1aa86f` vs `#047857` vs Tailwind emerald).

## References

- Audit agent reports (2026-06-24) — parallel review of public routes, design system, mobile/responsive, modern finance UX patterns.
- `src/components/shell/AppShell.tsx`
- `src/styles/app-shell.css`
- `src/app/screener/ScreenerClient.tsx`
- `src/app/portfolio/PortfolioClient.tsx`
- `src/app/stock/[ticker]/StockDetailClient.tsx`
- `src/app/superinvestors/SuperinvestorsClient.tsx`

## Implementation Closeout Notes

- Implemented as Phase 8 of the public surface cleanup plan.
- More is mobile-only and intentionally not part of the shared desktop `NAV`.
- Portfolio mobile cards use the current local holding schema (`ticker`, `shares`, `avg_cost`) and only surface company labels from the existing stock connection index; cards now expose edit/delete actions with 36px targets.
- Stock tab scroll affordance is conditional on measured overflow and the duplicated tab markup is now centralized in `StockDetailClient`.
- P10 hardening adds `qa:mobile-ux` to lock the Phase 1 contract: five mobile tabs, no page-level horizontal overflow, screener checkbox/expand touch targets plus collapsed-card density, portfolio edit/delete action target size, stock tab overflow affordance, and superinvestor Insights scroll-region affordance.
- Kimi P10 challenge anchor `fh-20260624-082-km-6ddf068f` accepted as next-slice routing signal: finish P10 cleanup, then prioritize `/macro-chart` P1a.5 mobile layout + share URL completion.
- Kimi near-peer audit anchor: `fh-20260624-037-km-7d2e4eec`.
