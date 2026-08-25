# Data Catalog

> **Last Updated**: 2026-08-25
> **Total Files**: 30,493 JSON files
> **Update Rules**: `.claude/rules/data-documentation.md`

---

## Sources Overview

| Folder | Files | Update Frequency | Source |
|--------|-------|------------------|--------|
| [admin/](admin/README.md) | 1 | Hourly | GitHub repository tree |
| [benchmarks/](benchmarks/README.md) | 7 | Weekly | Bloomberg Terminal |
| computed/ | 6,569 | Generated | Cross-source computed signals and RIM input payloads |
| [calendar/](calendar/README.md) | 2 | Daily / on edit | BujaBot USD Google Calendar |
| [damodaran/](damodaran/README.md) | 7 | Yearly + ERP interim | NYU Stern (Damodaran) |
| [global-scouter/](global-scouter/README.md) | 1,084 | On-demand | Global Scouter Tool |
| [indices/](indices/README.md) | 2 | Manual | Various |
| [macro/](macro/README.md) | 10 | Daily/Weekly/Monthly/Quarterly | FRED + FDIC + OECD + PMI |
| [sec-13f/](sec-13f/README.md) | 82 | Quarterly | SEC EDGAR |
| [sentiment/](sentiment/README.md) | 13 | Daily/Weekly | AAII, CNN, CFTC, CBOE, Alternative.me |
| [slickcharts/](slickcharts/README.md) | 568 | Daily/Weekly/Monthly | SlickCharts.com |
| [yardney/](yardney/README.md) | 1 | Weekly | Feno Yardeni: FRED WAAA/WBAA + Bloomberg-sourced benchmark price/EPS |
| [yf/](yf/README.md) | 1,100 | Weekly / on-demand | Yahoo Finance |

---

## Quick Reference

### Market Data Pipeline (slickcharts/)
- **32 scrapers** via GitHub Actions
- **516 individual stock files** with returns + dividends
- Daily movers, weekly indices, monthly historical

### Valuation Data (benchmarks/, damodaran/)
- Bloomberg Terminal P/E, P/B, ROE (15yr history)
- Benchmarks latest: 32,209 records, 2010-01-01 ~ 2026-08-21, 38 sections (micro_sectors +과창판 STAR50), 869 S&P 500 data points (DEC-275 history-preservation merge)
- Benchmarks v3.8: `summaries.json` includes 1W/1M/3M/6M/YTD and yearly source summaries for price, EPS, PER, PBR, and ROE (2,403 non-null values + 67 null placeholders)
- Damodaran: industries (96 w/ beta, margins, EVA), extended US industry metrics (11 datasets), non-US regional metrics (7 regions x 17 datasets), ERP (178 countries, Apr 2026), historical ERP (66 years), credit ratings
- Yardney: Feno Yardeni S&P 500 fair value model, 1,894 weekly public valuation records through 2026-08-14, latest fair value 6,341.71 and premium +22.77%; raw bond-yield components are excluded from public payloads
- RIM inputs: `computed/rim-index/inputs.json` is a preserved quarantined snapshot mirrored to Next public data; automatic RIM execution was retired under DEC-302, and the standalone scripts remain manual research tools rather than a freshness claim

- 60 tracked investors' 13F holdings across 31 quarters through 2026-Q2 where filed
- Current-quarter analytics cohort: 56/60 investors; `ackman`, `einhorn`, `scion`, and `vanguard` are stale-excluded until fresh filings arrive
- v3.4.0 schema contract: per-filing value-unit normalization (thousands/dollars 1000x fix), CIK→entity audit, 13F-HR/A amendment merge
- Analytics: 15 files, including normalized `consensus`, `by_ticker`, `ticker_aliases`, `guru_holders_index`, `trades_ranking`, `portfolio_views`, and the separate factor-exposure summary
- Enrichment metadata: sector 71.9%, industry 65.6%, market-cap 65.8%, filing-return 18.1% coverage after local YF backfill
- Quarterly updates

### Macro Data (macro/)
- FRED banking series: daily, weekly, quarterly; the daily collector now also requests Korea 10Y government yield (`IRLTLT01KRM156N`) for RIM inputs
- FDIC Tier1 capital ratio quarterly history
- Activity surveys: 934 records; OECD CLI through 2026-06, major-country manufacturing/services PMI and ISM components through 2026-07
- Root compatibility files are still published during migration

### Calendar Data (calendar/)
- USD macro, FOMC, FOMC minutes, 13F filing deadline, and market calendar events
- Google Calendar remains the operational alert source; JSON mirror is for feno-data and public reads

### Sentiment Data (sentiment/)
- AAII, CNN Fear & Greed, CFTC S&P 500 futures positioning, VIX/MOVE, crypto fear & greed
- 13 indicators

### Stock Screening (global-scouter/)
- 1,066 stock profiles + ETFs (22) + Economic Indicators (1,073 records) + raw preservation files (9)
- **v2.4.0**: 2026-08-23 weekly refresh (2026-08-21 source); screener artifacts rebuilt from this export; 1,073 indicators
- v2.3.0: Raw source-sheet preservation + FY+1~FY+3 forward/revision detail extensions
- v2.2.0: Extended fields (eps_consensus, growth_consensus, per_bands, fiscal_month)
- v2.1.0: Added etfs/index.json, indicators/economic.json
- On-demand updates

### Yahoo Finance (yf/)
- 1,098 finance payloads plus `_summary.json` and `quarter_closes.json`
- Universe includes stock detail symbols, scouter ETFs, sector/major ETFs, and portfolio symbols
- `_summary.json` is rebuilt from local files so stale fetch failures do not hide available data
- v2 fetch contract adds bounded quote, holder, analyst, filing/news, event, insider, mutual-fund, and 1Y history blocks; option chains and share-count history are explicit backfill flags until runtime validated

---

## API Endpoints

Base URL: `https://100xfenok.etloveaui.workers.dev/data/`

```javascript
// Example: Get S&P 500 holdings
const sp500 = await fetch('https://100xfenok.etloveaui.workers.dev/data/slickcharts/sp500.json').then(r => r.json());

// Example: Get AAPL individual data
const aapl = await fetch('https://100xfenok.etloveaui.workers.dev/data/slickcharts/stocks/AAPL.json').then(r => r.json());
```

---

## Maintenance

### When Adding New Data

1. Add JSON file to appropriate folder
2. Update folder's README.md file catalog
3. Update this file's count if significant
4. Record in `docs/CHANGELOG.md`

### Macro Canonical Path

- Banking and FDIC macro files now live under `data/macro/`
- Consumers should read `data/macro/*`

### File Size Guidelines

| Size | Action |
|------|--------|
| < 1MB | Normal handling |
| 1-5MB | Document in README |
| > 5MB | Consider splitting |

---

*See `.claude/rules/data-documentation.md` for auto-update rules*
