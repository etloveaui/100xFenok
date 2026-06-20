# Data Spine Program

Date/status: 2026-06-19; P0 inventory measured, P1 passed, v0 ratification RATIFIED.

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

Current durable P0 inventory artifacts:
`DATA_SPINE_P0_INVENTORY_20260619.md` and
`scripts/audit-data-spine-inventory.py`. The script is the read-only baseline
for `dataset -> emitter -> schedule -> asOf/freshness -> provenance -> consumers`,
separating runtime consumers, pipeline references, and repo-local workflow
evidence.

Current headline: 28 dataset groups, 15,451 root JSON files, and 15,505 public
JSON files. `data/README.md` still reports older headline counts; use the P0
inventory artifact for current counts until the catalog README is refreshed. The
0 root-only / 54 public-only delta is accounted for through `benchmarks` and
`public.report_metadata`; consumer guard later found `public.report_metadata`
is live-consumed. User decision: KEEP as an intentional placeholder for a
future report-publishing pipeline; revival is deferred until automation exists.

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

V0 ratification: `DATA_SPINE_V0_RATIFICATION_20260619.md` +
`scripts/audit-data-spine-v0.py`; authority/fallback still mirrors
`scripts/build-market-facts.py`, while tolerance uses measured spread
distributions.

## Direct Provider Fetch Leak Inventory

P0 grep command:

```sh
rg -n "stockanalysis\\.com|slickcharts\\.com|query[12]\\.finance\\.yahoo|finance\\.yahoo\\.com|yfinance" \
  100xfenok-next/src admin ib scripts 100x \
  --glob '!**/node_modules/**' --glob '*.{py,ts,tsx,js,jsx,gs,html,mjs}'
```

Raw result: 59 hits across 50 unique files. The table below groups every hit by
file/pattern and separates real fetchers from tests and string-only references.

### Classified grep output

| Hits | File / pattern | Match type | P0 classification |
|---:|---|---|---|
| 1 | `100xfenok-next/src/lib/server/ticker.ts` | live provider fetch | DRAFT: classify as sanctioned live quote gateway or migrate behind Data Spine |
| 1 | `ib/ib-total-guide-calculator.html` | legacy browser/provider fetch through CORS proxy | DRAFT: legacy exception or sunset/migrate |
| 1 | `ib/ib-helper/apps-script/yahoo-quotes.gs` | legacy GAS provider fetch | DRAFT: legacy IB exception |
| 1 | `admin/market-data/yahoo-quotes.gs` | admin GAS provider fetch | DRAFT: admin exception |
| 1 | `admin/market-radar/scripts/yahoo-quotes.gs` | admin/radar GAS provider fetch | DRAFT: admin/radar exception |
| 1 | `admin/market-radar/scripts/vix.gs` | admin/radar GAS provider fetch | DRAFT: admin/radar exception |
| 3 | `100x/daily-wrap/fetcher.py` | legacy content fetcher / dependency hints | DRAFT: legacy publication exception |
| 1 | `scripts/fetch-yf-finance.py` | allowed scheduled collector | Allowed collector |
| 1 | `scripts/fetch-stockanalysis.py` | allowed scheduled collector | Allowed collector |
| 1 | `scripts/probe-stockanalysis-financials.py` | allowed read-only probe | Allowed collector/probe |
| 2 | `scripts/build-quarter-closes.py` | allowed generated-data builder using yfinance | Allowed collector |
| 2 | `scripts/fetch-sentiment.mjs` | allowed generated-data builder using Yahoo chart API | Allowed collector |
| 37 | `scripts/scrapers/*.py` | allowed SlickCharts scrapers | Allowed collector |
| 3 | `scripts/fetch-yf-finance-v0.py` | old PoC fetcher | DRAFT: archive/sunset candidate |
| 1 | `scripts/test_fetch_stockanalysis_fixtures.py` | test fixture string | Test/string reference, not a fetch leak |
| 1 | `scripts/test_fetch_yf_finance_selection.py` | test stub string | Test/string reference, not a fetch leak |
| 1 | `scripts/build-market-facts.py` | source/provenance string reference | Build string reference, not a fetch leak |

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

Evidence as of 2026-06-19:

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

SSOT relationship:

- Implemented-now resolver behavior lives in
  `DESIGN_market_data_source_contract_20260617.md` under `Resolver Policy` and
  mirrors `scripts/build-market-facts.py`.
- The matrix below is the future Data Spine v0 target to ratify after P0
  inventory and P1 disagreement-policy work.
- If this matrix conflicts with the implemented resolver policy before v0
  ratification, the implemented resolver policy wins.

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

## Proposed Phase Gates

These gates are proposed. They become ratified only when P1 freezes the v0
contract and the disagreement policy.

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
   - **RESOLVED by DEC-246 (2026-06-20)**: dedicated pages own their surfaces; Explore is preview-only. Cross-route ownership SSOT = `FORGE_feno_data_market_ia_20260612.md` (Placement Map), NOT service-map. Industry→`/sectors`, filings→stock `공시` tab, ETF families→`/etfs` segments, shared market 3-tab nav. UI plan is NOT duplicated here — see DEC-246.
2. Live quote route policy:
   - RATIFIED: `ticker.ts` is a sanctioned live-gateway exception until a
     Data Spine live-quote service exists.
3. Data catalog refresh:
   - DRAFT/UNVERIFIED: reconcile `data/README.md` counts with measured current
     data counts.
4. Korean filing summaries:
   - DRAFT/UNVERIFIED: separate LLM track with cost/provider/anchor validation.
   - Surface/route RESOLVED by DEC-246 (stock `공시` tab first; NVDA pilot → `/stock/NVDA?tab=filings`; by-ticker manifest). Cost/provider/scaling stays user-gated.

## Next P0 Work

1. Keep Daily Wrap report metadata; defer revival until report automation exists.
2. Add feno-data/feno-data-remote/feno-value consumer evidence from CCH skills.
3. Review `DATA_SPINE_A_PHASE_PROPOSAL_20260619.md` before A-phase UI.
4. Revisit low-sample `total_assets` and `forward_pe` authority-only candidates.
