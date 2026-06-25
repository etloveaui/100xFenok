# PLAN — Design System Remodel (P2 full migration active)

> Status: **ACTIVE — P2 W3 deployed 2026-06-25**. The earlier P16 thin slice is complete and
> superseded by the owner-approved full migration track. Current operating rule: keep the public
> product surfaces service-safe while moving the app through a staged token migration, with Codex
> implementing, Claude gating, and Kimi/AGY/MMD used for independent map/visual checks as needed.

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

**Phase 1 — Current P2 migration loop:**
- W0 token foundation: shipped via Tailwind v4 `@theme` plus token QA guard.
- W1 CSS token migration: shipped; nav assertion follow-up tracked separately.
- W2 component color cleanup: shipped; component-level raw semantic color drift reduced.
- W3 Tailwind palette alias remap: shipped and deployed. Named Tailwind families now map through
  semantic tokens in `globals.css`, with explicit fixed exceptions for dark surfaces and live badges.
- W4 dark flip: next. First intentionally visible design change; use MMD tabular insertion map and
  AGY per-screen acceptance criteria.
- W5 polish/governance: next after W4. Lock remaining high-risk drift with QA/docs and prepare the
  next productized surface migration.

**Interactivity (parallel, deferred):**
- Price charts Chart.js → Lightweight Charts (free crosshair, smaller); dashboards → ECharts.
- ⌘K command palette; motion token system (value flash, smooth transitions). INP ≤ 200ms guard.

## Research references (for the implementer)

- Vercel `design.md` (single-file token spec, exact stack match) · IBM Carbon (8px scale + type sets)
- Tailwind v4 `@theme` tokens (3-tier primitive/semantic/component) · shadcn/ui + TanStack Table
- TradingView Lightweight Charts · DESIGN.md format · Playwright/Chromatic + Deslint CI gates
- Full per-stream findings live in the 2026-06-24 research transcripts.

## Out of scope (now)

shadcn/TanStack adoption, a broad component rewrite, and full visual-regression CI are still deferred
until W4/W5 prove the service-safe migration path. The current priority is not new feature breadth:
it is making the existing service feel coherent, resilient, and productizable without breaking live
data, public routes, or the data-state contract.

## Deployment Ledger

- W1: `70544b72a` code, `32480df1f` metadata, `d5cfa08b7` deployed metadata.
- W2: `6aaa302d5` code, `e8756fd98` metadata, `52339772b` lane-map docs,
  `71f87a44e` deployed metadata, `a77322495` final metadata.
- W3: `b0b484380` code, `18d79a48c` metadata, `491ecf03c` deployed metadata,
  `376a1bbc2` final metadata after remote data rebase. Live deploy:
  `https://100xfenok.etloveaui.workers.dev`, Cloudflare Version ID
  `7fbd66f7-bf5f-4f85-84f5-4ba4b9a223b6`.
