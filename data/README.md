# Data Catalog

> **Last Updated**: 2026-04-26
> **Total Files**: 1,723 JSON files
> **Update Rules**: `.claude/rules/data-documentation.md`

---

## Sources Overview

| Folder | Files | Update Frequency | Source |
|--------|-------|------------------|--------|
| [admin/](admin/README.md) | 1 | Hourly | GitHub repository tree |
| [benchmarks/](benchmarks/README.md) | 7 | Weekly | Bloomberg Terminal |
| [calendar/](calendar/README.md) | 1 | Daily / on edit | BujaBot USD Google Calendar |
| [damodaran/](damodaran/README.md) | 4 | Yearly | NYU Stern (Damodaran) |
| [global-scouter/](global-scouter/README.md) | 1,071 | On-demand | Global Scouter Tool |
| [indices/](indices/README.md) | 2 | Manual | Various |
| [macro/](macro/README.md) | 4 | Daily/Weekly/Quarterly | FRED + FDIC |
| [sec-13f/](sec-13f/README.md) | 41 | Quarterly | SEC EDGAR |
| [sentiment/](sentiment/README.md) | 13 | Daily | AAII, Investors Intelligence |
| [slickcharts/](slickcharts/README.md) | 556 | Daily/Weekly/Monthly | SlickCharts.com |

---

## Quick Reference

### Market Data Pipeline (slickcharts/)
- **32 scrapers** via GitHub Actions
- **516 individual stock files** with returns + dividends
- Daily movers, weekly indices, monthly historical

### Valuation Data (benchmarks/, damodaran/)
- Bloomberg Terminal P/E, P/B, ROE (15yr history)
- Benchmarks latest: 30,433 records, 2010-05-28 ~ 2026-04-12, 37 sections, 829 data points per index
- Damodaran: industries (96 w/ beta, margins, EVA), ERP (178 countries), historical ERP (66 years), credit ratings

### Institutional Data (sec-13f/)
- 30 investors' 13F holdings (20Q accumulate mode)
- Analytics: 8 files (consensus, new_positions, buying_pressure, conviction, hhi, turnover, options_hedge, enhanced_consensus)
- Enrichment metadata: sector/cap/filing-return coverage + source mix
- Quarterly updates

### Macro Banking Data (macro/)
- FRED banking series: daily, weekly, quarterly
- FDIC Tier1 capital ratio quarterly history
- Root compatibility files are still published during migration

### Calendar Data (calendar/)
- USD macro, FOMC, FOMC minutes, 13F filing deadline, and market calendar events
- Google Calendar remains the operational alert source; JSON mirror is for feno-data and public reads

### Sentiment Data (sentiment/)
- AAII sentiment, Investors Intelligence
- 12+ indicators

### Stock Screening (global-scouter/)
- 1,066 stock profiles + ETFs (23) + Economic Indicators (1,056 records)
- **v2.2.0**: Extended fields (eps_consensus, growth_consensus, per_bands, fiscal_month)
- v2.1.0: Added etfs/index.json, indicators/economic.json
- On-demand updates

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
