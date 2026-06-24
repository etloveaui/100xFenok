# PLAN — Design System Remodel (research complete, P16 thin slice active)

> Status: **ACTIVE — P16 started 2026-06-25** (owner greenlit). P16 scope (minimal, additive):
> (1) macro-chart promoted to a rail **차트** tab (owner judged it worth a standalone tab — core
> stock+macro compare tool, fixes the buried-entry problem); (2) **탐색** renamed to **워크벤치**
> while keeping route `/explore`; (3) minimal shared ui primitives consuming EXISTING tokens, applied
> to low-risk high-reuse components first (MacroContextCard / MarketQuickLinks / DataStateNotice).
> The full strangler-fig CSS migration (Phase 1) stays DEFERRED. Codex impl + Claude QA/gate.
> Architect: Claude. Source: 5 parallel research streams (2026-06-24).

## Why (the convergent finding)

Three independent research streams — top-tier product references, design-system methodology,
and a code audit of our own app — all converged on ONE conclusion:

> The "amateur" feel is caused by the **absence of a unified token system (an architecture
> problem), NOT a lack of features.** Stripe / Linear / Vercel look professional because every
> screen is generated from the same small token set.

## Internal audit (the real state)

Our design system EXISTS but is abandoned:
- Spacing scale `--s1..--s10` defined (`app-shell.css:17`) but used in only **7 of 91** TSX files.
- Shared component library is **one primitive** (`ui/Tabs.tsx`); cards/tables/badges/buttons are
  re-implemented per screen.
- **944+ arbitrary `-[Npx]`** values bypass the scale; 4 conflicting card radii in use.
- Token values conflict across files (e.g. `--c-up` differs between globals.css and app-shell.css).

So this is **adoption + reconciliation**, not green-field design — which makes it tractable.

## Plan (Golden Path / paved-road)

**Phase 0 — Foundation (one-time):**
1. Reconcile into ONE token file (color/space/grid/radius/shadow/motion), modeled on Vercel
   `design.md` + IBM Carbon 8px scale + tabular-nums for numerics. Wire via Tailwind v4 `@theme`.
2. Build 4 shared components: Card, Table (TanStack + tabular-nums), Badge, Button.
3. Produce ONE premium "golden screen" with the `frontend-design` skill (candidate: `/screener`).
4. Codify into `DESIGN.md` + CI quality locks: ban arbitrary px/hex (lint), visual regression,
   a11y. This makes misalignment **mechanically impossible**, not eyeballed.

**Phase 1 — Weekly loop (strangler-fig):**
- Migrate one screen/week onto the shared components, deleting one legacy CSS file each time.
- Priority (most inconsistent first): screener → market-valuation → sectors → regime.

**Interactivity (parallel, deferred):**
- Price charts Chart.js → Lightweight Charts (free crosshair, smaller); dashboards → ECharts.
- ⌘K command palette; motion token system (value flash, smooth transitions). INP ≤ 200ms guard.

## Research references (for the implementer)

- Vercel `design.md` (single-file token spec, exact stack match) · IBM Carbon (8px scale + type sets)
- Tailwind v4 `@theme` tokens (3-tier primitive/semantic/component) · shadcn/ui + TanStack Table
- TradingView Lightweight Charts · DESIGN.md format · Playwright/Chromatic + Deslint CI gates
- Full per-stream findings live in the 2026-06-24 research transcripts.

## Out of scope (now)

Full token reconciliation, a broad CSS rewrite, shadcn/TanStack adoption, visual-regression CI,
and screen-by-screen migration are still deferred. P16 is only the owner-approved thin slice:
`워크벤치` naming, the official `차트` rail/mobile entry, and a small additive Surface primitive.
