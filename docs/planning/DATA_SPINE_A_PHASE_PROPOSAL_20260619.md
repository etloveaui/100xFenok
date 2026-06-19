# Data Spine A-Phase Proposal

Date: 2026-06-19
Status: PROPOSAL; do not implement until user approval.

## Guardrails

- A-phase consumes contract-served DataPack/API data only.
- No new direct Yahoo, StockAnalysis, SlickCharts, SEC, or other provider fetch.
- V0 tolerances apply to surfaced values.
- `return_3m` remains `yf.history_1y` authority-only until a dedicated fix.
- Explore is a summary/navigation surface; detailed workflows belong on
  dedicated pages.

## Proposed Order

1. IA guard: freeze the service-map rule before adding more Explore content.
   Explore should route to dedicated pages, not become a mixed detail dump.
2. 13F / superinvestors deepening: SEC 13F DataPack only. Add clearer
   provenance, 45-day lag language, sector/ticker drilldowns, and conviction
   views.
3. `/regime` dedicated page: use computed signals, market valuation,
   macro/sentiment, Damodaran, and Yardeni DataPack surfaces.
4. StockAnalysis surfaces after IA: new ETFs, IPO/actions/earnings, ETF history,
   and industry pages as contract-served surfaces.
5. Korean filing summaries last: generated feno-edgar artifacts with source
   links/anchors, LLM cost controls, and verification gates. No live UI LLM API.

## First Reviewable Slice

Start with 13F / superinvestors once the user approves A-phase execution. It has
the clearest existing DataPack foundation and the lowest direct-provider risk.
