# SlickCharts Data

> **Source**: [SlickCharts](https://www.slickcharts.com/)
> **Pipeline**: `.github/workflows/slickcharts.yml`
> **Schedule**: Daily at 6:00 AM UTC

## Files

| File | Description | Refresh |
|------|-------------|---------|
| `treasury.json` | US Treasury rates (14 maturities) | Daily |
| `sp500.json` | S&P 500 holdings (503 stocks) | Daily |

## Schema

### treasury.json

```json
{
  "updated": "2026-01-09T06:00:00Z",
  "source": "slickcharts",
  "rates": [
    {"maturity": "10 Yr", "rate": 4.58, "change": -0.02}
  ]
}
```

### sp500.json

```json
{
  "updated": "2026-01-09T06:00:00Z",
  "source": "slickcharts",
  "count": 503,
  "holdings": [
    {
      "rank": 1,
      "company": "Nvidia",
      "symbol": "NVDA",
      "weight": 7.15,
      "price": 184.59,
      "change": -0.45,
      "changePercent": -0.25
    }
  ]
}
```

## Usage

### JavaScript (Frontend)

```javascript
const BASE = 'https://100xfenok.pages.dev/data/slickcharts';

// Get 10Y Treasury rate
const treasury = await fetch(`${BASE}/treasury.json`).then(r => r.json());
const rate10Y = treasury.rates.find(r => r.maturity === '10 Yr').rate;

// Get S&P 500 symbols
const sp500 = await fetch(`${BASE}/sp500.json`).then(r => r.json());
const symbols = sp500.holdings.map(h => h.symbol);
```

### Python (Backend)

```python
import requests

BASE = 'https://100xfenok.pages.dev/data/slickcharts'
treasury = requests.get(f'{BASE}/treasury.json').json()
sp500 = requests.get(f'{BASE}/sp500.json').json()
```

## Manual Run

```bash
# Run all scrapers
python scripts/scrapers/sp500-scraper.py --output data/slickcharts/sp500.json --pretty
python scripts/scrapers/treasury-scraper.py --output data/slickcharts/treasury.json --pretty
```

## Reference

- Planning: `docs/planning/slickcharts-data-pipeline.md`
- Decision: DEC-097
