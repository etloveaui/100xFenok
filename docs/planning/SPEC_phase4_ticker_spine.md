# SPEC: Phase 4 — Ticker Spine (TickerChip everywhere + reverse edges)

> Architect: Claude (right-top %1623). Implementor: Codex (left-top %1622).
> Parent: `docs/planning/v5_master_design.md` §5 (Phase 4 = 척추 완성).
> Scope: `?v5=1` + cookie ONLY. V1 untouched. Light-only. No backend regression.
> Status: READY — MiMo Phase-4 recon + Codex audit folded in.
> Date: 2026-06-26

---

## 0. Goal

Make every ticker on v5 a clickable junction (not a dead label), so the graph is walkable from anywhere — plus surface the reverse edges (which ETFs carry a stock, which holders/back-rails point in).

## 1. Shared `<TickerChip>` extraction (foundation)

- New file: `src/components/TickerChip.tsx` (general, NOT connected-only — Codex recommendation).
- Wraps `TransitionLink` + `ROUTES.stock` (`routes.ts:31`) + `normalizeForRouteTicker` (`ticker.ts:21`). Guard with `isValidRouteTicker` before linking.
- Props: `{ ticker: string; label?: string; variant?: "pill" | "inline" }`.
- Degrade: invalid/unroutable ticker → render plain text, never a broken link.

## 2. Replace inline ticker surfaces (MiMo recon — 9+ spots)

| Spot | file:line | action |
|------|-----------|--------|
| StockWorkbench row | `StockWorkbenchCard.tsx:187` | **fix hardcoded `/stock/${ticker}`** → TickerChip/ROUTES.stock (this is a latent bug) |
| ConnectedView pills | `ConnectedView.tsx:151-163,181-193` | TickerChip variant=pill |
| TickerTypeahead rows | `TickerTypeahead.tsx:271-275` | TickerChip |
| LeadStoryCard | `LeadStoryCard.tsx` | reuse where tickers appear |
| Superinvestors nav, macro-chart link, ExternalSourceLinks | (MiMo list) | TickerChip where a ticker is the entity |

## 3. ETF reverse panel (incoming edge)

- "Which ETFs carry this ticker" = `getSingleStockEtfsForStock()` (`stock-index.ts:158`), data exists (e.g. NVDA ↔ 9 ETFs). Already rendered as ETF pills in ConnectedView — promote to an explicit reverse panel on the stock/ticker page.

## 4. Junction back-rail (reverse edges, no dead ends)

- Reverse-edge data (incoming holders / ETFs / index membership) all loadable via `connected-loaders.ts` (13F holders + investor holdings + buying pressure). 2-hop junction (NVDA→holder→that holder's other holdings) already proven in Phase 2.
- Every drawer/panel gets a back-rail to its incoming edges so no peek is a dead end.

## 5. Guardrails (AGY — "clickable Excel" limit, HARD)

- **Column-only**: TickerChip allowed only in primary identity columns (Symbol column, Holder Name column).
- **Text inline immunity**: in plain narrative sentences, symbols stay unstyled raw text — hover underline only, NO background pill.
- **Metric immunity**: numbers, currency, %, indices (VIX/10Y) NEVER carry a TickerChip or link.

## 6. Acceptance

- Tickers clickable from screener/ETF/13F/stock surfaces via one shared component; `/stock/{ticker}` resolves through ROUTES (no hardcoded paths left — grep `/stock/\${` returns 0 in v5 surfaces).
- ETF reverse panel renders incoming ETF edges; back-rail present on drawers.
- Invalid ticker → plain text, no broken nav.
- `npm run build` PASS · V1 untouched · AGY guard review ≥ "Pro".

## 7. Verification (Claude gate)

1. Codex implements TickerChip + replacements, runs build + Playwright, reports file:line.
2. Claude headless render of a stock/screener surface (clickable chips, no broken links).
3. AGY anti-"clickable-Excel" pass (column-only / metric immunity).
4. Claude scoped commit → push → Worker deploy monitor.

## 8. Open

- [ ] Order of replacement: extract TickerChip first, then migrate spots incrementally (one PR per cluster to keep scope reviewable).
- [ ] `StockWorkbenchCard.tsx:187` hardcoded path — fix in the same pass as the chip migration.
