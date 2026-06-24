# Data Spine P1 Policy

Date: 2026-06-19
Last revalidated: 2026-06-23
Status: PARTIALLY RATIFIED BY V0; remaining direct-fetch backlog stays open.

## Purpose

P1 turns the P0 inventory into a reproducible data trust contract. It does not
add UI features. It defines how duplicated provider values are selected,
compared, flagged, or blocked.

## Reproduce

```sh
python3 scripts/audit-data-spine-p1.py
python3 scripts/audit-data-spine-p1.py --json
python3 scripts/audit-data-spine-v0.py
python3 scripts/audit-data-spine-v0.py --json
python3 scripts/test_data_spine_policy.py
python3 scripts/test_data_spine_gas_quote_gateway.py
```

## Policy SSOT

| Policy layer | Source of truth | Status |
|---|---|---|
| authority/fallback order | `scripts/build-market-facts.py FIELD_SOURCE_POLICY` | implemented |
| tolerance/action policy | `scripts/data_spine_policy.py V0_FIELD_POLICY` | ratified by V0 |
| current disagreement counts | `data/computed/market_source_parity.json` + `scripts/audit-data-spine-p1.py` | generated snapshot |
| V0 decisions | `DATA_SPINE_V0_RATIFICATION_20260619.md` + `scripts/audit-data-spine-v0.py` | ratified |

Do not hand-edit field tolerance values in this document. Update
`scripts/data_spine_policy.py`, then rerun the commands above.

## Guardrails

- Implemented resolver order wins unless a future document marks a `PROPOSED CHANGE`.
- Every served value must expose source and freshness/provenance.
- Disagreement actions use the five parity categories:
  `agreement`, `value_drift`, `stale`, `sign_divergence`, `scale_mismatch`.
- Tolerance is per field. No global tolerance.
- `sign_divergence` and unresolved `scale_mismatch` are action-bearing, not
  informational only.
- `return_3m` is authority-only until a dedicated formula/source fix lands.

## Current Parity Snapshot

Measured from `data/computed/market_source_parity.json`, generated at
`2026-06-21T00:43:25Z`. These numbers are a snapshot; rerun the P1 audit after
each data refresh.

| Metric | Value |
|---|---:|
| Inspected ticker files | 6,445 |
| Fields with parity checks | 19 |
| Multi-candidate field rows | 26,629 |
| Agreement | 22,309 |
| Value drift | 1,841 |
| Stale | 1,953 |
| Sign divergence | 418 |
| Scale mismatch | 108 |

## V0-Resolved P1 Items

| Item | V0 decision | Evidence |
|---|---|---|
| field tolerance matrix | ratified; shared in `scripts/data_spine_policy.py` | `scripts/test_data_spine_policy.py` locks P1/V0 parity |
| `return_3m` | `authority_only_until_dedicated_fix` | `DATA_SPINE_V0_RATIFICATION_20260619.md` |
| `public.report_metadata` | keep intentional placeholder for future automated report publishing | `DATA_SPINE_V0_RATIFICATION_20260619.md` |
| `DS-P1-001` / `ticker.ts` | `quote.v1` product-runtime quote gateway contract; provider internals remain sanctioned live exception | `DATA_SPINE_V0_RATIFICATION_20260619.md` + `100xfenok-next/src/lib/quote-contract.ts` |

## Direct Fetch Backlog

`DS-P1-001` now has a `quote.v1` API contract at the Next runtime boundary. Its
internal Yahoo/worker fetch is still the sanctioned live exception until a full
Data Spine live-quote service exists. The remaining rows are not closed by V0
and stay as migration, legacy exception, or sunset candidates.

| ID | File | Provider | Current shape | Target | Priority |
|---|---|---|---|---|---|
| `DS-P1-001` | `100xfenok-next/src/lib/server/ticker.ts` + `100xfenok-next/src/lib/quote-contract.ts` | Yahoo query1 + ticker worker behind `/api/ticker` | product-runtime `quote.v1` gateway | quote contract ratified; provider internals remain sanctioned live exception until Data Spine live-quote service exists | P1-high |
| `DS-P1-002` | `100x/daily-wrap/fetcher.py` | Yahoo yfinance + FRED | deprecated legacy Daily Wrap publication PoC | CLOSED 2026-06-22: sunset; future Daily Wrap automation should use Data Spine/report contracts | P2 |
| `DS-P1-003` | `admin/market-data/yahoo-quotes.gs` | 100x quote.v1 + Yahoo OHLC + Yahoo query1 fallback | admin GAS quote helper routed through quote.v1 with OHLC preservation | ROUTED 2026-06-22: quote.v1 primary plus Yahoo OHLC enrichment; legacy Yahoo fallback remains until admin tool retirement or Data Spine live quote replacement | P2 |
| `DS-P1-004` | `admin/market-radar/scripts/yahoo-quotes.gs` | 100x quote.v1 + Yahoo OHLC + Stooq + GOOGLEFINANCE | market-radar GAS quote helper with Prices sheet OHLC preservation | ROUTED 2026-06-22: quote.v1 primary plus Yahoo OHLC enrichment; Stooq/GOOGLEFINANCE remain deeper fallback | P2 |
| `DS-P1-005` | `admin/market-radar/scripts/vix.gs` | Yahoo query1 + GitHub contents API | deprecated market-radar VIX GAS backup | sunset documented; replaced by scheduled sentiment collector | CLOSED 2026-06-22 |
| `DS-P1-006` | `ib/ib-helper/apps-script/yahoo-quotes.gs` | CNBC primary + 100x quote.v1 fallback + Yahoo OHLC + Stooq + GOOGLEFINANCE | IB helper GAS live quote helper with CNBC quality preserved | ROUTED 2026-06-22: CNBC remains primary for pre/post-market quality; quote.v1 is first fallback before direct Yahoo | P2 |
| `DS-P1-007` | `ib/ib-total-guide-calculator.html` | 100x same-origin ticker API | live embed consumes ratified server quote gateway | CLOSED 2026-06-22: browser Yahoo/CORS proxy removed; future quote-service migration stays under `DS-P1-001` | P2 |
| `DS-P1-008` | `scripts/fetch-yf-finance-v0.py` | Yahoo yfinance | deprecated old 10-ticker PoC collector | sunset documented; replaced by scheduled YF v2 collector | CLOSED 2026-06-22 |
| `DS-P1-009` | `100xfenok-next/src/app/api/data/route.ts` | local `data/macro/tga.json` mirror + Treasury FiscalData fallback | legacy `treasury-tga` API facade | CONTRACTED 2026-06-23: static DataPack mirror is primary; live FiscalData remains fallback only when the mirror is unavailable, and the route now exposes `treasury-tga.v1` state/freshness metadata | P2 |

## Next Execution Plan

Order is risk-first, not table-order:

1. `DS-P1-005` closed 2026-06-22: `admin/market-radar/scripts/vix.gs` is now a
   deprecated local GAS backup only. The runtime replacement is the scheduled
   sentiment collector (`scripts/fetch-sentiment.mjs` via
   `.github/workflows/fetch-sentiment.yml`), which writes both
   `data/sentiment/vix.json` and
   `100xfenok-next/public/data/sentiment/vix.json`.
2. `DS-P1-008` closed 2026-06-22: `scripts/fetch-yf-finance-v0.py` is an unused
   10-ticker PoC. The runtime collector is `scripts/fetch-yf-finance.py` via
   `.github/workflows/fetch-yf-finance.yml`; the v0 PoC now fails closed unless
   explicitly run with `--allow-deprecated-v0` for historical reproduction.
3. `DS-P1-002` closed 2026-06-22: `100x/daily-wrap/fetcher.py` is not called by
   repo-local workflows or Next runtime; it now fails closed unless
   `--allow-deprecated-fetcher` is passed for historical manual reproduction.
4. `DS-P1-003/004/006` routed 2026-06-22: admin/IB GAS helpers now consume the
   shared quote.v1 gateway where safe, while legacy providers remain as
   intentional fallback because quote.v1 does not yet carry OHLC fields and IB
   still needs CNBC pre/post-market quality. The two admin quote helpers enrich
   OHLC from Yahoo after quote.v1 succeeds so their return shape stays stable.
   `DS-P1-007` is closed: the live
   `/infinite-buying` embedded HTML now calls the same-origin 100x ticker API
   instead of a browser Yahoo/CORS provider path.
5. `DS-P1-009` contracted 2026-06-23: `/api/data?dataset=treasury-tga` reads
   the scheduled `data/macro/tga.json` mirror first and keeps FiscalData as a
   fallback only. The route now returns `schemaVersion: "treasury-tga.v1"`,
   `dataset`, `lastUpdated`, `staleAfter`, and a shared `DataState` payload so a
   fallback response is visible to consumers instead of being an implicit source
   string. The scheduled emitter is `.github/workflows/fetch-treasury-tga.yml`.

### DS-P1-001 Contract Slice (2026-06-22)

- Runtime boundary: `/api/ticker/{symbol}` and `/api/ticker?symbol={symbol}` now
  share `QUOTE_CONTRACT_VERSION = "quote.v1"`, symbol validation, and cache
  policy from `100xfenok-next/src/lib/quote-contract.ts`.
- Server provider: `100xfenok-next/src/lib/server/ticker.ts` returns
  `QuotePayload` with `schemaVersion`, `source`, and `fetchedAt`; Yahoo query1
  and ticker-worker remain internal providers only.
- Consumers: dashboard sector/index rows, sector ETF data, footer ticker bar,
  admin live tools, and the IB embed consume the same `/api/ticker` gateway.
- Guard: `npm run qa:quote-contract` checks the route contract, GAS quote helper
  routing, consumer type imports, and IB mirror so browser-side Yahoo/proxy
  fetches do not reappear.

### Static Stock Analyzer Consumer Slice (2026-06-22)

- Runtime boundary: product UI consumers now route the static
  `global-scouter/core/stocks_analyzer.json` dataset through
  `100xfenok-next/src/features/stock-analyzer/data/static-data-provider.ts`,
  and `computed/stock_action_summary.json` through
  `100xfenok-next/src/features/stock-analyzer/data/action-summary-provider.ts`,
  instead of each surface re-reading and normalizing the raw JSON shape.
- Consumers converted: screener data hook, ticker typeahead, Explore watchlist
  strip, portfolio price lookup, stock detail page analyzer preload, screener
  action enrichment, Explore stock workbench, and Explore action candidates.
- Provider behavior: the provider merges `stocks_analyzer.json` with
  the normalized action summary, exposes `source_date`, and both providers use a
  short in-memory TTL cache for same-session dedupe while keeping the underlying
  fetch `no-store` so refreshed data applies after cache expiry or page reload.
- Guard: targeted ESLint on the six touched files, full `tsc --noEmit`, and grep
  now show no product-runtime `stocks_analyzer.json` or
  `stock_action_summary.json` fetch outside the provider boundary.

### DS-P1-009 Treasury Route Slice (2026-06-22 / 2026-06-23)

- Runtime boundary: `/api/data?dataset=treasury-tga&start=YYYY-MM-DD` keeps its
  existing `source` + `data` response shape but now serves from
  `/data/macro/tga.json` first.
- Fallback: direct Treasury FiscalData is retained only when the static mirror is
  missing or empty, so scheduled DataPack refresh is the normal path.
- State contract: 2026-06-23 added `treasury-tga.v1`, `lastUpdated`,
  `staleAfter`, and `state`. DataPack responses return `state.status="ready"`;
  successful FiscalData fallback responses also return `state.status="ready"` so
  public screens do not imply incomplete data, while `source` and
  `reason="mirror_unavailable_or_empty"` preserve the mirror-outage provenance
  for ops/admin review.
- Scheduled mirror: `.github/workflows/fetch-treasury-tga.yml` now writes both
  `data/macro/tga.json` and `100xfenok-next/public/data/macro/tga.json`, then
  runs `npm --prefix 100xfenok-next run qa:treasury-contract` before committing
  the data. This prevents the public route mirror from drifting behind the source
  DataPack on the next scheduled refresh.
- Guard: `rg` found no current product consumer for the legacy route; it remains
  available as a compatibility facade. `npm run qa:treasury-contract` locks the
  route contract and source/public TGA mirror parity.

### 2026-06-23 residual direct-provider recheck

Quote and Treasury are contracted/routed. The next residual rows are separate
legacy/runtime cleanup items, not part of the quote/Treasury slice:

- `tools/asset/multichart.html` + `tools/asset/config.js`: browser Stooq /
  Alpha Vantage fallback and public config key exposure. Migrate to a DataPack or
  first-party chart API before this tool is promoted.
- `admin/design-lab/charts/v*.html`: prototype chart pages with direct Stooq
  proxy fetches. Retire if unused; otherwise route through a first-party data
  boundary.
- `tools/macro-monitor/shared/data-fetcher.js`: CLOSED 2026-06-24 for FDIC;
  the browser external fallback was removed and the module now consumes the
  same-origin `/data/macro/fdic-tier1.json` DataPack only.
- `admin/market-radar/scripts/{cnn,cnn-components,cftc,move}.gs`: legacy
  sentiment writers with direct provider calls. Either absorb into scheduled
  collectors or mark sunset like `vix.gs`.
- feno-value direct valuation-engine providers remain tracked outside this repo;
  no direct feno-value provider call was found in the 100x Next runtime.

### DS-P1-005 Closeout Evidence (2026-06-22)

- Legacy source: `admin/market-radar/scripts/vix.gs` directly fetched Yahoo
  chart data and wrote `data/sentiment/vix.json` through the GitHub contents API.
- Replacement collector: `scripts/fetch-sentiment.mjs` declares that it replaces
  the manual Apps Script path (`cnn.gs` / `vix.gs`), fetches `^VIX`, merges by
  date, and dual-writes the repo SSOT plus the Next public mirror.
- Schedule: `.github/workflows/fetch-sentiment.yml` runs the sentiment collector
  on weekdays after US close and commits `data/sentiment/*.json` plus
  `100xfenok-next/public/data/sentiment/*.json`.
- Consumers remain unchanged: Home, Market Valuation, Regime, Macro Monitor, and
  computed signals all read `/data/sentiment/vix.json`; none need the GAS
  writer itself.
- Disposition: `sunset`. Keep the GAS file only as a disabled historical backup;
  do not create a new Apps Script trigger from it.

### DS-P1-008 Closeout Evidence (2026-06-22)

- Legacy source: `scripts/fetch-yf-finance-v0.py` was a 10-ticker yfinance PoC
  writing `data/yf/finance/{TICKER}.json`; it was not a full universe collector.
- Runtime replacement: `.github/workflows/fetch-yf-finance.yml` calls
  `scripts/fetch-yf-finance.py`, then rebuilds summary and mirror artifacts.
- Consumers remain unchanged: stock and portfolio surfaces consume the generated
  `/data/yf/finance/{ticker}.json` contract, not the v0 script.
- Disposition: `sunset`. The v0 file is retained only for historical
  reproduction and fails closed unless `--allow-deprecated-v0` is provided.

### DS-P1-002~007 Legacy Classification Evidence (2026-06-22)

- `DS-P1-002`: `100x/daily-wrap/fetcher.py` is not called by current workflows
  or Next runtime. It also used a FRED mock fallback when `FRED_API_KEY` was
  missing, so it is sunset and retained only for manual historical reproduction.
- `DS-P1-003`: `admin/market-data/yahoo-quotes.gs` is documented as a standalone
  Market Data Apps Script WebApp helper; it now tries `/api/ticker` quote.v1
  first, enriches OHLC from Yahoo, and keeps Yahoo as fallback.
- `DS-P1-004`: `admin/market-radar/scripts/yahoo-quotes.gs` is a Market Radar
  GAS/Sheet helper for live quote lookup and price-sheet updates; it uses
  quote.v1 for price fields and Yahoo OHLC enrichment so Prices sheet
  high/low/open/volume do not degrade.
- `DS-P1-006`: `ib/ib-helper/apps-script/yahoo-quotes.gs` is documented as the
  IB Helper Apps Script price API; CNBC remains primary, with quote.v1 as first
  fallback before direct Yahoo until an AA/IB contract route exists.
- `DS-P1-007`: `ib/ib-total-guide-calculator.html` is embedded by the live Next
  `/infinite-buying` page. Its browser Yahoo/CORS fetch path was removed on
  2026-06-22; it now consumes `/api/ticker/{symbol}`, which is the ratified
  server quote gateway tracked by `DS-P1-001`.

For every row, the closeout must include:

- grep/runtime evidence for current consumers;
- one of `migrate`, `explicit_exception`, or `sunset`;
- docs update and a lightweight verification command;
- no new direct provider fetch outside the ratified gateway or scheduled
  collectors.

## Exit Criteria

- `scripts/audit-data-spine-p1.py` and `scripts/audit-data-spine-v0.py` consume
  the same shared policy constants.
- `scripts/test_data_spine_policy.py` passes and blocks future P1/V0 drift.
- `scripts/test_data_spine_gas_quote_gateway.py` passes and blocks GAS quote
  helpers from drifting away from quote.v1 or IB CNBC-primary ordering.
- Current parity counts regenerate from `market_source_parity.json`; they are not
  manually maintained here.
- Direct-fetch rows now have a concrete disposition: `DS-P1-002/005/008` are
  closed as `sunset`; `DS-P1-007` is closed as `migrated`;
  `DS-P1-003/004/006` are `routed_exception` paths with quote.v1 plus
  intentional legacy fallbacks.
