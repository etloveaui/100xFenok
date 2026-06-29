# Screener Improvement — Scope (next heavy slice, post-IA)

> **Architect**: Claude. **Implementor**: Codex. **Critic**: AGY. **Recon**: Explore agent (this session).
> **Trigger**: owner fh-105 sequence — after v5 default + IA unification, Screener is the next heavy slice.
> Light-only, V1/?v1=1 intact, v5 30s-cockpit guards apply.

---

## 0. Current state (measured)

`/screener` (ScreenerClient.tsx ~1,669 lines + StockDetailPanel.tsx ~2,017 lines) over **1,066 stocks** via `StaticStockAnalyzerDataProvider`. Already feature-rich:
- Filters: search/sector/country + advanced (PER/fwdPER/growth/yield/ROE/returns/PER-band/signal/connection); PAGE_SIZE=50.
- Column presets: basic/action/connected/value/estimate/momentum/dividend/guru (ScreenerClient:88-138).
- Detail panel: 3s verdict, PER-band chart, EPS-revision pulse, raw financials FY-4..FY+3, price/dividend history, 13F, ETF facts. ErrorBoundary per row.
- Desktop = table (sort headers, inline expand); mobile = cards + separate estimate-trend sections.

## 1. v5 consistency gaps

- **Entity links absent**: ticker has no `/stock/{ticker}` link — only in-page detail expand. Not wired to TickerChip/connected-view. NOTE: Slice 1 deliberately SKIPPED screener cells (Clickable-Excel guard, row is already interactive). So this is a *judgement* item, not an obvious fix.
- **Desktop/mobile divergence**: two separate render paths; v5 explore unifies better.
- **Missing-data inconsistency**: estimate cells show a completeness badge; other fields show only "—".
- **Connection asOf hidden**: ConnectionPills show flags but asOf is title-attr only.

## 2. Improvement candidates (Explore-agent recon)

| ID | Item | Tier | Note |
|----|------|------|------|
| S-UX1 | Mobile filter discoverability — advanced filters hidden behind toggle; show applied-count or surface | P0 | safe, high-value |
| S-UX2 | Mobile density — cards show 4 metrics; expand to 6-8 + fold estimate-trend into card | P0 | safe |
| S-PERF1 | Row virtualization (react-window/virtual) — 50/page renders full DOM, scroll lag | P0 | bigger refactor, perf risk |
| S-DATA1 | Unify missing-data representation (completeness hint across fields, not just estimate) | P1 | |
| S-DATA2 | Surface connection asOf (mini-badge on pills instead of title-only) | P1 | |
| S-ENT1 | Entity link: ticker → /stock OR TickerChip — **tension with Clickable-Excel guard** (row already opens detail) | P1 | AGY call needed |
| S-PERF2 | Filter debounce + apply feedback (skeleton/fade on refilter) | P2 | |
| S-STYLE1 | Unify desktop table + mobile card into one responsive component | P2 | large |

## 3. Recommended slices

- **Slice A (P0 safe UX)**: S-UX1 mobile filter discoverability + S-UX2 mobile density. No data/perf risk, immediate UX win.
- **Slice B (P1 data honesty)**: S-DATA1 missing-data consistency + S-DATA2 connection asOf surfacing. Aligns with the project's data-honesty pattern.
- **Slice C (P0 perf, heavier)**: S-PERF1 virtualization — needs care (sort/expand/selection must survive virtual rows). Gate hard.
- **Deferred / AGY-call**: S-ENT1 entity link (conflicts with Slice-1 Clickable-Excel decision — needs an explicit ruling: ticker-chip vs row-click, not both noisy), S-STYLE1 unify render (large).

## 4. AGY guards

- 30s-cockpit: screener is a power-tool surface, but detail-panel + filters must not bury the scan.
- Clickable-Excel: if S-ENT1 proceeds, the ticker becomes the ONLY new link; metrics stay text. Decide chip vs row-click to avoid double-affordance.
- V1/?v1=1 + Navbar byte-intact; mobile no-overflow.

## 5. Open owner decisions

- Scope depth: Slice A only / A+B / A+B+C / all incl. S-ENT1+S-STYLE1?
- S-ENT1: add ticker→/stock entity link, or keep row-click-only (honor Slice-1 guard)?
- S-PERF1 virtualization: now, or defer until a measured scroll-lag complaint?

## 6. Verification (Claude gate, per slice)

build + qa:tokens + qa:routes · chrome-devtools/curl LIVE (filter, mobile density, no-overflow, detail-panel intact) · MiMo cross-check · scoped commit → worktree push → LIVE re-verify.
