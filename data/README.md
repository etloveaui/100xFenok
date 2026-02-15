# Data Catalog

> **Last Updated**: 2026-02-16
> **Total Files**: 1,841 JSON files
> **Update Rules**: `.claude/rules/data-documentation.md`

---

## Sources Overview

| Folder | Files | Update Frequency | Source |
|--------|-------|------------------|--------|
| [benchmarks/](benchmarks/DEV.md) | 7 | Weekly | Bloomberg Terminal |
| [damodaran/](damodaran/README.md) | 4 | Yearly | NYU Stern (Damodaran) |
| [global-scouter/](global-scouter/README.md) | 1,244 | On-demand | Global Scouter Tool |
| [indices/](indices/README.md) | 2 | Manual | Various |
| [sec-13f/](sec-13f/README.md) | 20 | Quarterly | SEC EDGAR |
| [sentiment/](sentiment/README.md) | 13 | Daily | AAII, Investors Intelligence |
| [slickcharts/](slickcharts/README.md) | 550 | Daily/Weekly/Monthly | SlickCharts.com |

---

## Quick Reference

### Market Data Pipeline (slickcharts/)
- **32 scrapers** via GitHub Actions
- **516 individual stock files** with returns + dividends
- Daily movers, weekly indices, monthly historical

### Valuation Data (benchmarks/, damodaran/)
- Bloomberg Terminal P/E, P/B, ROE (15yr history)
- Damodaran: industries (96 w/ beta, margins, EVA), ERP (178 countries), historical ERP (66 years), credit ratings

### Institutional Data (sec-13f/)
- 13F holdings from major investors
- Quarterly updates

### Sentiment Data (sentiment/)
- AAII sentiment, Investors Intelligence
- 12+ indicators

### Stock Screening (global-scouter/)
- 1,239 stock profiles + ETFs (23) + Economic Indicators (1,048 records)
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

### File Size Guidelines

| Size | Action |
|------|--------|
| < 1MB | Normal handling |
| 1-5MB | Document in README |
| > 5MB | Consider splitting |

---

*See `.claude/rules/data-documentation.md` for auto-update rules*
