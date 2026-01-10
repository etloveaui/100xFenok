# SlickCharts Data

> **Source**: [SlickCharts](https://www.slickcharts.com/)
> **Pipeline**: `.github/workflows/slickcharts-*.yml` (4 workflows)
> **Scrapers**: `scripts/scrapers/` (36 files)
> **Last Updated**: 2026-01-10

---

## Overview

| Category | Files | Update |
|----------|-------|--------|
| Index Holdings | 3 | Weekly |
| Index Returns | 3 | Monthly |
| Index Performance | 3 | Monthly |
| Index Yields | 3 | Monthly |
| Index Analysis | 5 | Monthly |
| Daily Movers | 2 | Daily |
| Rates | 3 | Daily |
| Crypto | 3 | Daily/Monthly |
| Portfolios | 2 | Weekly |
| Individual Stocks | 516 | Monthly |
| **Total** | **550** | - |

---

## File Catalog

### Index Holdings (Weekly)

| File | Description | Scraper |
|------|-------------|---------|
| `sp500.json` | S&P 500 (503 stocks) | sp500-scraper.py |
| `nasdaq100.json` | Nasdaq 100 (102 stocks) | nasdaq100-scraper.py |
| `dowjones.json` | Dow Jones 30 | dowjones-scraper.py |

### Index Returns (Monthly)

| File | Description | Scraper |
|------|-------------|---------|
| `sp500-returns.json` | S&P 500 annual returns (97 years) | sp500-returns-scraper.py |
| `nasdaq100-returns.json` | Nasdaq 100 returns (41 years) | nasdaq100-returns-scraper.py |
| `dowjones-returns.json` | Dow Jones returns (141 years) | dowjones-returns-scraper.py |

### Index Performance (Monthly)

| File | Description | Scraper |
|------|-------------|---------|
| `sp500-performance.json` | S&P 500 YTD, 1Y, 5Y, 10Y | sp500-performance-scraper.py |
| `nasdaq100-performance.json` | Nasdaq 100 performance | nasdaq100-performance-scraper.py |
| `dowjones-performance.json` | Dow Jones performance | dowjones-performance-scraper.py |

### Index Yields (Monthly)

| File | Description | Scraper |
|------|-------------|---------|
| `sp500-yield.json` | S&P 500 dividend yield history | sp500-yield-scraper.py |
| `nasdaq100-yield.json` | Nasdaq 100 yield history | nasdaq100-yield-scraper.py |
| `dowjones-yield.json` | Dow Jones yield history | dowjones-yield-scraper.py |

### Index Analysis (Monthly)

| File | Description | Scraper |
|------|-------------|---------|
| `sp500-analysis.json` | S&P 500 weights, sectors | sp500-analysis-scraper.py |
| `nasdaq100-analysis.json` | Nasdaq 100 analysis | nasdaq100-analysis-scraper.py |
| `sp500-marketcap.json` | Market cap distribution | sp500-marketcap-scraper.py |
| `nasdaq100-ratio.json` | P/E ratio history | nasdaq100-ratio-scraper.py |
| `sp500-drawdown.json` | Drawdown history (99 years) | sp500-drawdown-scraper.py |

### Daily Movers (Daily, Cumulative)

| File | Description | Scraper |
|------|-------------|---------|
| `gainers.json` | Top gainers (90-day history) | gainers-scraper.py |
| `losers.json` | Top losers (90-day history) | losers-scraper.py |

### Rates (Daily)

| File | Description | Scraper |
|------|-------------|---------|
| `treasury.json` | US Treasury rates (14 maturities) | treasury-scraper.py |
| `mortgage.json` | Mortgage rates (cumulative) | mortgage-scraper.py |
| `inflation.json` | Inflation data | inflation-scraper.py |

### Crypto (Daily/Monthly)

| File | Description | Scraper |
|------|-------------|---------|
| `currency.json` | Top 100 cryptos ($3.1T market cap) | currency-scraper.py |
| `btc-returns.json` | Bitcoin annual returns (13 years) | btc-returns-scraper.py |
| `eth-returns.json` | Ethereum annual returns (10 years) | eth-returns-scraper.py |

### Portfolios (Weekly)

| File | Description | Scraper |
|------|-------------|---------|
| `magnificent7.json` | Magnificent 7 stocks | magnificent7-scraper.py |
| `etf.json` | 11 popular ETFs (ARK + Index) | etf-scraper.py |

### Individual Stocks (Monthly)

| File | Description | Scraper |
|------|-------------|---------|
| `universe.json` | All 516 tickers from indices | membership-tracker.py |
| `membership-changes.json` | Index composition changes | membership-tracker.py |
| `symbols-all.json` | Current metrics for all stocks | symbol-scraper.py |
| `stocks-returns.json` | 47-year annual returns | symbol-returns-scraper.py |
| `stocks-dividends.json` | 13-year dividend history | symbol-dividend-scraper.py |
| `stocks-dividends-recent.json` | Recent 5 years dividends | stock-aggregator.py |
| `stocks-dividends-historical.json` | Historical dividends (pre-2021) | stock-aggregator.py |
| `stocks/{SYMBOL}.json` | 516 individual stock files | stock-aggregator.py |

---

## Individual Stock Schema (stocks/AAPL.json)

```json
{
  "symbol": "AAPL",
  "name": "Apple Inc.",
  "current": {
    "price": 185.45,
    "pe": 28.5,
    "eps": 6.51,
    "dividend": 1.00,
    "yield": 0.54
  },
  "metrics_history": [
    {"date": "2026-01-10", "pe": 28.5, "eps": 6.51}
  ],
  "returns": [
    {"year": 2025, "return": 35.2},
    {"year": 2024, "return": 28.1}
  ],
  "dividends": [
    {"date": "2025-11-14", "amount": 0.25}
  ]
}
```

---

## GitHub Actions Workflows

| Workflow | Schedule | Scrapers |
|----------|----------|----------|
| `slickcharts-daily.yml` | 6:00 UTC | gainers, losers, treasury, currency, mortgage |
| `slickcharts-weekly.yml` | 7:00 UTC (Mon) | sp500, nasdaq100, dowjones, magnificent7, etf, berkshire |
| `slickcharts-monthly.yml` | 8:00 UTC (1st) | 22 returns/performance/yields/analysis scrapers |
| `slickcharts-history.yml` | 9:00 UTC (1st) | membership-tracker, symbol-returns, symbol-dividend, stock-aggregator |
| `slickcharts-symbols.yml` | 7:30 UTC (Mon) | symbol-scraper (matrix: 4 batches) |

---

## Usage Examples

### JavaScript (Frontend)

```javascript
const BASE = 'https://100xfenok.pages.dev/data/slickcharts';

// Get Treasury rates
const treasury = await fetch(`${BASE}/treasury.json`).then(r => r.json());
const rate10Y = treasury.rates.find(r => r.maturity === '10 Yr').rate;

// Get individual stock
const aapl = await fetch(`${BASE}/stocks/AAPL.json`).then(r => r.json());
console.log(aapl.current.pe, aapl.returns.length);

// Get all symbols
const universe = await fetch(`${BASE}/universe.json`).then(r => r.json());
console.log(universe.tickers.length); // 516
```

### Python (Backend)

```python
import requests

BASE = 'https://100xfenok.pages.dev/data/slickcharts'

# Get S&P 500 returns history
returns = requests.get(f'{BASE}/sp500-returns.json').json()
print(f"Years: {len(returns['returns'])}")
```

---

## Manual Run

```bash
# Run individual scraper
python scripts/scrapers/sp500-scraper.py --output data/slickcharts/sp500.json --pretty

# Run with cumulative mode (daily scrapers)
python scripts/scrapers/gainers-scraper.py --cumulative --output data/slickcharts/gainers.json

# Run stock aggregator
python scripts/scrapers/stock-aggregator.py \
  --metrics data/slickcharts/symbols.json \
  --dividends data/slickcharts/stocks-dividends.json \
  --output-dir data/slickcharts/stocks/
```

---

## References

- Planning: `docs/planning/slickcharts-data-pipeline.md`
- Decision: DEC-097 (initial), DEC-102 (workflow triggers)
- BACKLOG: #142-#152

---

*Last Updated: 2026-01-10*
