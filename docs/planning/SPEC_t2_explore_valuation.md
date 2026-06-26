# SPEC: T2 — /explore valuation surface (PER-band)

> Architect: Claude (right-top). Implementor: Codex (left-top).
> ROADMAP T2 (data connection, P2). Owner decision (2026-06-26): surface valuation in /explore.
> Scope: /explore + shared PerBandBar. No backend change. Light-only.

---

## 0. Goal

PER-band valuation context is already live in `/screener` but `/explore` has none. Surface it in /explore by **reusing** the existing PerBandBar + bands.ts — no new data, no new band logic.

## 1. Extract PerBandBar (shared)

- PerBandBar is currently inline inside `ScreenerClient.tsx` (not a standalone component). Extract it to `src/components/screener/PerBandBar.tsx` so both /screener and /explore use the same component.
- `bands.ts` (`src/lib/screener/bands.ts`, bandPct/bandClass/bandLabel) is already shared — reuse as-is.
- /screener must render identically after extraction (no visual/behavior change).

## 2. /explore surface

- **StockWorkbenchCard** (explore mover card, gainers/losers rows) is the natural host. Add a compact PER-band mini-bar per mover ticker (or a new `ValuationStrip` card right after StockWorkbenchCard if rows are too dense — Codex's call on cleanest fit).
- Data: `public/data/global-scouter/core/per_bands_index.json` (1,048 tickers, generated 2026-06-25, `{current,min,avg,max}`) matched by ticker. Missing ticker → no bar (graceful-degrade, never error).

## 3. Guards (AGY)

- Entity-only links (ticker chips); the PER-band bar is **visual only, no link**.
- Metric immunity: band numbers stay as text, not linked.
- Don't displace the 30s read — valuation is supplementary context.

## 4. Acceptance

- /explore shows PER-band valuation for mover tickers via the shared PerBandBar.
- /screener renders byte-identical to before (extraction is behavior-neutral).
- `npm run build` PASS · `qa:tokens` PASS · V1 untouched.

## 5. Verification (Claude gate)

1. Codex extracts PerBandBar + wires /explore, runs build + Playwright, reports file:line.
2. Claude chrome-devtools: /explore renders PER-band bars; /screener unchanged.
3. Scoped commit → push → LIVE re-verify.

## 6. Open

- [ ] StockWorkbenchCard row density — mini-bar inline vs separate ValuationStrip (Codex picks).
- [ ] per_bands_index ticker key normalization vs explore mover tickers.
