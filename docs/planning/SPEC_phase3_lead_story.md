# SPEC: Phase 3 — Lead Story (zero-input entry)

> Architect: Claude (right-top %1623). Implementor: Codex (left-top %1622).
> Parent spec: `docs/planning/v5_master_design.md` §2 (connected UX), §5 (phase order).
> Scope: `?v5=1` + `fenok_design_version=v5` cookie ONLY. V1 (`/`) untouched. Light-only. No backend/cron regression.
> Status: **READY** — Wave-1 audit (Codex) + data recon (MiMo) + AGY guardrails folded in. All open questions resolved.
> Date: 2026-06-26

---

## 0. Goal (one line)

Home v5 lands with **zero input** straight into "today's lead story" and lets the user walk the graph in 4 hops — reusing edges v5 already loads, not new directory tiles.

## 1. Component contract — `LeadStoryCard`

- New file: `src/components/connected/LeadStoryCard.tsx` (beside `ConnectedView.tsx`).
- **Mount: `HomeV5Client.tsx:808-810`** — after `V5MarketPulse`, before `v5-layout`. Preserves the 30s read order (MarketNow → ReadingHero → MarketPulse first), then zero-input story BEFORE the dense main-column cards.
- **AGY width cap: ≤25% desktop viewport width**, sits below Reading Hero. Must never overwrite or sit above the global market verdict headline.
- Server-driven where possible; client only for hop interaction.

```
Props:
  story: LeadStory | null      // null => render nothing (graceful-degrade)
States:
  resolved : auto-picked ticker + 4 hops ready
  degraded : no eligible mover OR data missing => card hidden, console unaffected
```

## 2. Auto-select algorithm (deterministic, no live fetch)

1. Candidate movers = `/data/slickcharts/discovery-summary.json` gainers/losers (already consumed by `StockWorkbenchCard.tsx:86-93`, gainers/losers at `:226-227`, shape at `discovery-summary.json:27-43`). StockAnalysis `market_gainers.json` is table-shaped — use existing flatten helper `MarketEventSurfacesCard.tsx:187-193` if that source is needed.
2. Filter to tickers WITH a 13F edge (`loadByTickerHolders(ticker)` → non-empty `holder_details`; `connected-loaders.ts:96-138`). Two-hop payoff needs holders.
3. Tie-break: largest abs % move, then most holders. Deterministic — NO `Math.random`.
4. None qualify → `degraded` (card hidden). Never block the console.

## 3. Four-hop narrative (inline on home, page jump only at hop 4)

| Hop | Question | Edge / source |
|-----|----------|---------------|
| 1 왜 | price + driver | today's move %, event tag (market_events) |
| 2 누가 | who holds it | `loadByTickerHolders` (13F two-hop reuse) |
| 3 ETF | who carries it | ETF exposure edge (existing ETF loader) |
| 4 공시 | what's filed | EDGAR Korean summary if present, else link-out |

- **AGY HARD: NO auto-expand.** All 4 hops render **step-by-step on user click only** — never auto-open the full trail.
- Hops 1–3 inline (drawer/accordion, depth tones per master §3). Hop 4 = explicit `[전체 보기 →]` only.
- Breadcrumb via `useTraversalTrail` (session-scope, no backend). Trail wiring pattern: `HomeV5Client.tsx:512-516`(provider), `:526`(hook), `:555-568`(push). Provider API `useTraversalTrail.tsx:23-29,52-77,107-112`.

## 4. `buying_pressure` annotation (only new data wiring)

- `loadBuyingPressure()` → `{ byTicker: Map, raw }` (`connected-loaders.ts:208-247`, path `/data/sec-13f/analytics/buying_pressure.json`). 1579 tickers present.
- Key quality is mixed → use `.byTicker` **only after ticker normalization/match** (valid example HRL at `buying_pressure.json:45-50`).
- Strictly graceful-degrade: no match → hop renders without pressure annotation, never errors.

## 5. Guardrails (master §4 + AGY ratified)

- **Market Now cockpit exempt** — lead card must not overlay or push the 30s read.
- **Entity-only links** — ticker / institution names clickable; %, price, metrics (VIX/10Y) = solid text.
- **≤3 links per card** · 250ms peek delay · mobile = tap toggle.
- **≤25% desktop viewport width**, below Reading Hero.
- Single risk to kill: turning the premium 30s cockpit into a hyperlink DB tool.

## 6. Acceptance criteria

- `/?v5=1` home renders `LeadStoryCard` (resolved) and walks 4 hops with zero input, click-by-click.
- Data absent → `degraded`, card hidden, console + V1 intact.
- `npm run build` PASS · `qa:tokens` / `qa:routes` / `qa:freshness` PASS · `/` (V1) behavior byte-identical.
- AGY anti-clutter review ≥ "Pro" before commit.

## 7. Verification protocol (Claude gate)

1. Codex implements from this spec, runs local `npm run build` + Playwright, reports `file:line`.
2. Claude headless render: `npm run start` (fresh port 3090+) + `chrome --headless=new --screenshot` → Read.
3. AGY anti-clutter pass.
4. Claude scoped commit (reset → scoped add → `git diff --cached --name-only` verify → commit) → push → Worker deploy monitor.

## 8. Resolved (was open) — all closed by Wave-1

- [x] Mover source = `/data/slickcharts/discovery-summary.json` gainers/losers (MiMo+Codex).
- [x] `buying_pressure` exists: `/data/sec-13f/analytics/buying_pressure.json`, 1579 tickers, `loadBuyingPressure().byTicker` (Codex `:208-247`).
- [x] Mount slot = `HomeV5Client.tsx:808-810` after V5MarketPulse (Codex audit).
- [x] No shared `<TickerChip>` yet → extract `src/components/TickerChip.tsx` in **Phase 4** (Codex).
- [x] AGY: lead card below Reading Hero, ≤25% width, NO auto-expand (step-by-step click).
