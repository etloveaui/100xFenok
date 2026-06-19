# Data Spine Program

Date: 2026-06-19
Status: P0 inventory shell, DRAFT/UNVERIFIED until the measured inventory gates pass.

## Purpose

Data Spine is the umbrella program that connects the current 100x market data
work with feno-data, feno-data-remote, and feno-value without turning every
follow-up into one mega-epic.

The spine has two layers:

1. Contract layer: provider roles, provenance, freshness, parity, fallback, and
   disagreement policy.
2. Consumer layer: 100x UI surfaces, feno-data reads, feno-data-remote reads,
   and feno-value provider adapters consuming the contract-served data.

The contract layer is load-bearing. UI work may continue in parallel only when
it consumes data already emitted through the DataPack or a documented API route.

## Non-Negotiables

- DRAFT/UNVERIFIED sections are not authoritative.
- The v0 per-field contract is not frozen until the P0 inventory is complete.
- "Use all data" means every served value needs source/provenance/freshness
  context, not merely a larger UI.
- feno-value must keep independent golden-output gates; provider changes cannot
  be driven by UI deadlines.
- Korean filing summaries are a separate LLM/cost/verification track.

## P0 Inventory Snapshot

Measured locally on 2026-06-19 from `data/` in this repo.

Command:

```sh
find data -type f | sed 's#^data/##' | awk -F/ '{count[$1]++} END {for (k in count) print k, count[k]}' | sort
```

| Data area | File count | Current role | P0 status |
|---|---:|---|---|
| `computed/` | 6,452 | normalized market facts, audits, signals | MEASURED |
| `stockanalysis/` | 5,396 | ETF universe/detail, stock overview, financial candidates, surfaces | MEASURED |
| `yf/` | 1,822 | Yahoo quote/history/funds/stock context | MEASURED |
| `global-scouter/` | 1,086 | stock analyzer rows, forward/revision data | MEASURED |
| `slickcharts/` | 570 | direct index membership, returns, dividends, movers | MEASURED |
| `sec-13f/` | 79 | superinvestor holdings and analytics | MEASURED |
| `sentiment/` | 15 | AAII/CNN/CFTC/VIX/MOVE/crypto sentiment | MEASURED |
| `macro/` | 11 | FRED/FDIC/OECD/PMI style macro mirrors | MEASURED |
| `benchmarks/` | 9 | benchmark valuation/time-series context | MEASURED |
| `damodaran/` | 9 | specialist valuation factors | MEASURED |
| `calendar/` | 4 | USD calendar mirror | MEASURED |
| `indices/` | 4 | index snapshots | MEASURED |
| `admin/` | 4 | admin/data-lab metadata | MEASURED |
| `yardney/` | 2 | Yardeni model mirror | MEASURED |

Note: `data/README.md` still reports older headline counts. The measured file
inventory above is the current P0 baseline until the catalog README is refreshed.

## StockAnalysis / ETF Coverage Baseline

Measured from `data/stockanalysis/index.json` and
`data/computed/market_data_audit.json`.

| Metric | Value | P0 status |
|---|---:|---|
| ETF universe records | 5,280 | MEASURED |
| ETF candidate symbols | 5,347 | MEASURED |
| ETF detail files | 5,265 | MEASURED |
| ETF detail coverage | 98.47% | MEASURED |
| Primary StockAnalysis detail coverage | 85.64% | MEASURED |
| Yahoo fallback ETF detail files in market facts | 686 | MEASURED |
| StockAnalysis stock detail files | 40 | MEASURED |
| StockAnalysis financial candidate files | 40 | MEASURED |
| Backfill hard errors | 0 | MEASURED |
| Backfill expected 404 rows | 723 | MEASURED |
| Backfill ready for finalize | true | MEASURED |

## Current Parity / Disagreement Baseline

Measured from `data/computed/market_source_parity.json`.

| Metric | Value |
|---|---:|
| Inspected ticker files | 6,445 |
| Fields with parity checks | 19 |
| Multi-candidate field rows | 25,396 |
| Agreement rows | 12,354 |
| Value-drift rows | 10,039 |
| Stale rows | 2,163 |
| Sign-divergence rows | 716 |
| Percent-scale warnings | 124 |

Sample top disagreements already prove that parity alerts need an action policy:

| Ticker | Field | Selected source | Other source | Diagnosis |
|---|---|---|---|---|
| TDSB | `return_1m` | `stockanalysis.detail.performance` -0.2240 | `stockanalysis.etf_screener.performance` +0.2244 | sign_divergence |
| FXB | `return_1y` | `yf.history_1y` +1.2328 | `yf` -1.2296 | sign_divergence |
| GDXW | `return_3m` | `yf.history_1y` -6.8462 | `stockanalysis.detail.history` +6.7927 | sign_divergence |

P1 must define, per field: authority, fallback chain, tolerance band, and the
served-value action when providers disagree beyond tolerance.

## Direct Provider Fetch Leak Inventory

P0 grep command:

```sh
rg -n "stockanalysis\\.com|slickcharts\\.com|query[12]\\.finance\\.yahoo|finance\\.yahoo\\.com|yfinance" \
  100xfenok-next/src admin ib scripts --glob '!**/node_modules/**'
```

### Allowed collectors / fetchers

These files intentionally contact upstream providers and should remain outside
normal UI rendering paths:

- `scripts/fetch-yf-finance.py`
- `scripts/fetch-stockanalysis.py`
- `scripts/probe-stockanalysis-financials.py`
- `scripts/build-quarter-closes.py`
- `scripts/fetch-sentiment.mjs`
- `scripts/scrapers/*.py`

### Product/runtime leak candidates to classify

These should become either contract-served routes or documented legacy
exceptions. This list is MEASURED but the action per file is DRAFT/UNVERIFIED.

| File | Provider | Current shape | P0 classification |
|---|---|---|---|
| `100xfenok-next/src/lib/server/ticker.ts` | Yahoo chart API | Next server route fetches Yahoo directly | DRAFT: classify as live quote gateway or migrate behind Data Spine |
| `ib/ib-total-guide-calculator.html` | Yahoo chart API | legacy browser calculator via CORS proxy | DRAFT: legacy exception or sunset/migrate |
| `ib/ib-helper/apps-script/yahoo-quotes.gs` | Yahoo chart API | GAS quote helper | DRAFT: legacy IB exception |
| `admin/market-data/yahoo-quotes.gs` | Yahoo chart API | admin GAS quote helper | DRAFT: admin exception |
| `admin/market-radar/scripts/yahoo-quotes.gs` | Yahoo chart API | admin/radar GAS helper | DRAFT: admin/radar exception |
| `admin/market-radar/scripts/vix.gs` | Yahoo chart API | VIX quote helper | DRAFT: admin/radar exception |
| `100x/daily-wrap/fetcher.py` | yfinance | legacy content fetcher | DRAFT: legacy/publication exception |

Generated/public mirror hits are intentionally excluded from the action list
unless the source file above remains active.

## Consumer Inventory

Known consumers from the current contract note, grep, and CCH skill files:

- 100x UI: `/explore`, `/market-valuation`, `/sectors`, `/screener`,
  `/superinvestors`, `/stock/[ticker]`, `/etfs`, `/etfs/new`,
  `/etfs/[ticker]`, `/market/events`, `/portfolio`.
- Admin/Data Lab: `admin/data-lab` reads manifest, field usage, market audit,
  and StockAnalysis/DataPack quality surfaces.
- feno-data local:
  - exposes `data audit`, `data stockanalysis {etf|stock|financials|surface|coverage}`,
    and the public categories including `computed`, `stockanalysis`, `yf`,
    `slickcharts`, `sec-13f`, `benchmarks`, `macro`, `calendar`, and `yardney`.
  - common paths already include `computed/market_facts`,
    `computed/market_data_audit`, `computed/market_source_parity`,
    `stockanalysis/etfs`, `stockanalysis/stocks`, `stockanalysis/financials`,
    `stockanalysis/surfaces`, `stockanalysis/coverage`, and `yf/finance`.
- feno-data-remote:
  - exposes the same public financial categories except `admin`.
  - bundled helper reads `computed/market_facts`, `computed/market_source_parity`,
    StockAnalysis ETF/stock/financial/surface/coverage payloads, and `yf/finance`
    through Cloudflare data route with GitHub Raw fallback.
- feno-value:
  - priority order already includes Global Scouter, computed market facts,
    Benchmarks, Yahoo/yfinance DataPack, StockAnalysis DataPack, and Damodaran.
  - `DataPackProvider` resolves local `100xFenok/data` first, then public data
    route and GitHub Raw fallback.
  - provider helpers already cover `computed/market_facts`,
    `computed/market_data_audit`, `computed/market_source_parity`, `yf/finance`,
    StockAnalysis ETF universe/screener/new ETF/coverage/stock/financial/surface.
  - `fetch_financial_statement_candidate()` explicitly keeps StockAnalysis
    financials as cross-check candidates only, not DCF inputs.

Evidence:

- `claude-code-hub/docs/products/skills/feno-data/SKILL.md:45-50`
- `claude-code-hub/docs/products/skills/feno-data/SKILL.md:195-212`
- `claude-code-hub/docs/products/skills/feno-data/SKILL.md:320-328`
- `claude-code-hub/docs/products/skills/feno-data-remote/SKILL.md:24-38`
- `claude-code-hub/docs/products/skills/feno-data-remote/SKILL.md:45-60`
- `claude-code-hub/docs/products/skills/feno-value/SKILL.md:167-181`
- `claude-code-hub/docs/products/skills/feno-value/scripts/providers/datapack.py:122-154`
- `claude-code-hub/docs/products/skills/feno-value/scripts/providers/datapack.py:316-377`
- `claude-code-hub/docs/products/skills/feno-value/scripts/core/policy.py:303-356`

P0 still needs a dataset/file-level consumer map. The skill-level inventory
above is MEASURED, but per-file consumer coverage remains DRAFT/UNVERIFIED.

## Draft Contract Matrix

This matrix is intentionally DRAFT/UNVERIFIED. It records the expected contract
shape, not the frozen v0 policy.

| Field group | Candidate authority | Fallback / cross-check | Disagreement action |
|---|---|---|---|
| Stock quote/latest | computed market facts | Yahoo, StockAnalysis quote, ticker route | DRAFT/UNVERIFIED |
| ETF holdings/swap rows | StockAnalysis ETF detail | issuer CSV later, Yahoo funds data | DRAFT/UNVERIFIED |
| ETF quote/history | Yahoo history or market facts | StockAnalysis detail history/performance | DRAFT/UNVERIFIED |
| Direct index constituents | SlickCharts | StockAnalysis ETF proxies SPY/QQQ/DIA | DRAFT/UNVERIFIED |
| Stock forward estimates/revisions | Global Scouter | Yahoo, StockAnalysis overview | DRAFT/UNVERIFIED |
| Stock financial statements | Yahoo current, SEC EDGAR future | StockAnalysis financial candidates | DRAFT/UNVERIFIED |
| 13F holdings/positions | SEC EDGAR converted DataPack | market facts enrichment | DRAFT/UNVERIFIED |
| Market events | StockAnalysis surfaces | Yahoo/SEC later | DRAFT/UNVERIFIED |
| Macro/valuation factors | FRED/Yardeni/Damodaran/Benchmark Excel | none or source-specific mirrors | DRAFT/UNVERIFIED |

## Phase Gates

### P0 Done

- Dataset inventory lists source path, emitter, freshness/asOf, provenance
  status, and current consumers.
- Direct-provider fetch leaks are measured by grep and classified.
- At least one sample disagreement report is attached from local parity output.
- All unfilled contract sections remain marked DRAFT/UNVERIFIED.

### P1 Done

- Enumerated per-field authority/fallback/tolerance/disagreement action matrix.
- Provider promotion policy is documented.
- Served values expose source/provenance/freshness.
- Direct provider exceptions are either documented or converted to contract
  routes.

### B Done

- Enumerated fields are within tolerance or intentionally flagged.
- Every served value has provenance.
- Data Lab can show freshness, parity, and unresolved disagreement status.

### A Done

- 100x features consume only contract-served data or explicitly documented
  legacy exceptions.
- No unexplained direct Yahoo/StockAnalysis/SlickCharts provider fetch remains
  in product runtime.
- Dedicated StockAnalysis routes vs service-map overlap has a decided IA policy.

### feno-value Gate

- Frozen input snapshot and output golden are paired.
- Rebaseline requires explicit approval.
- Provider expansion cannot auto-regenerate baselines.

## Open Design Decisions

1. StockAnalysis dedicated routes vs service-map overlap:
   - DRAFT/UNVERIFIED: decide whether ETF/market-event dedicated pages stay
     parallel to Explore, or whether Explore becomes a navigation summary only.
2. Live quote route policy:
   - DRAFT/UNVERIFIED: decide whether `/api/ticker` is a sanctioned live quote
     gateway or must be fully backed by scheduled DataPack data.
3. Data catalog refresh:
   - DRAFT/UNVERIFIED: reconcile `data/README.md` counts with measured current
     data counts.
4. Korean filing summaries:
   - DRAFT/UNVERIFIED: separate LLM track with cost/provider/anchor validation.

## Next P0 Work

1. Build a dataset-by-dataset inventory table:
   `dataset -> emitter -> schedule -> asOf/freshness -> provenance -> consumers`.
2. Turn the direct-provider leak table into actionable backlog rows.
3. Extend parity policy from alert-only to action-bearing disagreement rules.
4. Add feno-data/feno-data-remote/feno-value consumer evidence from the
   claude-code-hub skill files before changing those skills.
5. Decide the StockAnalysis route vs service-map IA before expanding A-phase UI.
