# Data Catalog

> **Last Updated**: 2026-06-14
> **Total Files**: 2,840 JSON files
> **Update Rules**: `.claude/rules/data-documentation.md`

---

## Sources Overview

| Folder | Files | Update Frequency | Source |
|--------|-------|------------------|--------|
| [admin/](admin/README.md) | 1 | Hourly | GitHub repository tree |
| [benchmarks/](benchmarks/README.md) | 7 | Weekly | Bloomberg Terminal |
| computed/ | 4 | Generated | Cross-source computed signals |
| [calendar/](calendar/README.md) | 2 | Daily / on edit | BujaBot USD Google Calendar |
| [damodaran/](damodaran/README.md) | 7 | Yearly + ERP interim | NYU Stern (Damodaran) |
| [global-scouter/](global-scouter/README.md) | 1,080 | On-demand | Global Scouter Tool |
| [indices/](indices/README.md) | 2 | Manual | Various |
| [macro/](macro/README.md) | 9 | Daily/Weekly/Monthly/Quarterly | FRED + FDIC + OECD + PMI |
| [sec-13f/](sec-13f/README.md) | 47 | Quarterly | SEC EDGAR |
| [sentiment/](sentiment/README.md) | 13 | Daily/Weekly | AAII, CNN, CFTC, CBOE, Alternative.me |
| [slickcharts/](slickcharts/README.md) | 568 | Daily/Weekly/Monthly | SlickCharts.com |
| [yardney/](yardney/README.md) | 1 | Weekly | Yardeni model workbook |
| [yf/](yf/README.md) | 1,100 | Daily / on-demand | Yahoo Finance |

---

## Quick Reference

### Market Data Pipeline (slickcharts/)
- **32 scrapers** via GitHub Actions
- **516 individual stock files** with returns + dividends
- Daily movers, weekly indices, monthly historical

### Valuation Data (benchmarks/, damodaran/)
- Bloomberg Terminal P/E, P/B, ROE (15yr history)
- Benchmarks latest: 30,441 records, 2010-07-23 ~ 2026-06-05, 37 sections, 829 S&P 500 data points
- Benchmarks v3.8: `summaries.json` includes 1W/1M/3M/6M/YTD and yearly source summaries for price, EPS, PER, PBR, and ROE (2,353 non-null values + 52 null placeholders)
- Damodaran: industries (96 w/ beta, margins, EVA), extended US industry metrics (11 datasets), non-US regional metrics (7 regions x 17 datasets), ERP (178 countries, Apr 2026), historical ERP (66 years), credit ratings
- Yardney: S&P 500 fair value model, 1,872 weekly records, latest 2026-06-05 fair value 6,284.32 and premium +17.49%

### Institutional Data (sec-13f/)
- 30 tracked investors' 13F holdings, with 2026-Q1 included where filed (29Q accumulate mode; Einhorn last filed 2023-Q4 and is flagged `is_stale`)
- v3.4.0 rebuild: per-filing value-unit normalization (thousands/dollars 1000x fix), 30/30 CIK→entity mappings audited and corrected, 13F-HR/A amendment merge
- Analytics: 11 files, including normalized `consensus`, `by_ticker`, and `ticker_aliases` diagnostics
- Enrichment metadata: sector/cap/filing-return coverage + source mix
- Quarterly updates

### Macro Data (macro/)
- FRED banking series: daily, weekly, quarterly
- FDIC Tier1 capital ratio quarterly history
- Activity surveys: 924 records; OECD CLI through 2026-04, major-country manufacturing/services PMI and ISM components through 2026-05
- Root compatibility files are still published during migration

### Calendar Data (calendar/)
- USD macro, FOMC, FOMC minutes, 13F filing deadline, and market calendar events
- Google Calendar remains the operational alert source; JSON mirror is for feno-data and public reads

### Sentiment Data (sentiment/)
- AAII, CNN Fear & Greed, CFTC S&P 500 futures positioning, VIX/MOVE, crypto fear & greed
- 13 indicators

### Stock Screening (global-scouter/)
- 1,066 stock profiles + ETFs (23) + Economic Indicators (1,063 records) + raw preservation files (9)
- **v2.3.0**: Raw source-sheet preservation + FY+1~FY+3 forward/revision detail extensions
- v2.2.0: Extended fields (eps_consensus, growth_consensus, per_bands, fiscal_month)
- v2.1.0: Added etfs/index.json, indicators/economic.json
- On-demand updates

### Yahoo Finance (yf/)
- 1,098 finance payloads plus `_summary.json` and `quarter_closes.json`
- Universe includes stock detail symbols, scouter ETFs, sector/major ETFs, and portfolio symbols
- `_summary.json` is rebuilt from local files so stale fetch failures do not hide available data

---

## API Endpoints

Base URL: `https://100xfenok.pages.dev/data/`

```javascript
// Example: Get S&P 500 holdings
const sp500 = await fetch('https://100xfenok.pages.dev/data/slickcharts/sp500.json').then(r => r.json());

// Example: Get AAPL individual data
const aapl = await fetch('https://100xfenok.pages.dev/data/slickcharts/stocks/AAPL.json').then(r => r.json());
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
