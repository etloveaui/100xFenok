# Global Scouter Data

> **Source**: Global Scouter Tool (internal)
> **Update**: On-demand
> **Files**: 1,246
> **Version**: v2.2.0

---

## Overview

Stock screening, ETF benchmarks, and economic indicators exported from Global Scouter tool.

## Structure

```
global-scouter/
├── core/                    # Core reference files
│   ├── dashboard.json       # Dashboard configuration
│   ├── metadata.json        # System metadata
│   └── stocks_index.json    # Master stock index
├── stocks/
│   └── detail/              # Individual stock profiles (1,241 files)
│       ├── AAPL.json
│       ├── MSFT.json
│       └── ...
├── etfs/                    # v2.1.0
│   └── index.json           # ETF/Index data (23 items)
└── indicators/              # v2.1.0
    └── economic.json        # Economic indicators (1,047 records)
```

## File Counts

| Folder | Files |
|--------|-------|
| core/ | 3 |
| stocks/detail/ | 1,241 |
| etfs/ | 1 |
| indicators/ | 1 |
| **Total** | 1,246 |

## Schema

### stocks/detail/{SYMBOL}.json

```json
{
  "years": ["FY-4", "FY-3", "FY-2", "FY-1", "FY0"],
  "scale": {
    "market_cap": [321626, 612150, 480610, 1519717, 2940514],
    "stock_price": [519.59, 244.86, 195.37, 615.27, 120.07]
  },
  "income_statement": {
    "revenue": [16675, 26914, 26974, 60922, 130497],
    "net_income": [4332, 9752, 4368, 29760, 72880]
  },
  "valuation": {
    "per": [189.0, 63.1, 113.0, 51.1, 40.4],
    "pbr": [19.0, 23.0, 21.8, 35.4, 37.1]
  },
  "estimates": {
    "eps": {"fy1": 4.68, "fy2": 7.70, "fy3": 9.85},
    "revenue": {"fy1": 195000, "fy2": 250000, "fy3": 300000}
  },

  "fiscal_month": "Jan",

  "eps_consensus": {
    "fy_plus_1": 4.68,
    "fy_plus_2": 7.70,
    "fy_plus_3": 9.85
  },

  "growth_consensus": {
    "revenue_7y": 58.4,
    "revenue_3y": 47.3,
    "earnings_7y": 78.7,
    "earnings_3y": 49.9
  },

  "per_bands": {
    "current": 44.97,
    "min_8y": 18.95,
    "avg_8y": 44.97,
    "max_8y": 75.33,
    "source": "S_Valuation"
  }
}
```

### v2.2.0 Extended Fields

| Field | Coverage | Description |
|-------|----------|-------------|
| `fiscal_month` | 100% (1,241) | Fiscal year end month (Jan, Dec, etc.) |
| `eps_consensus` | 100% (1,241) | EPS estimates FY+1/+2/+3 (6-week average) |
| `growth_consensus` | 100% (1,241) | Revenue/Earnings growth 7Y/3Y (%) |
| `per_bands` | 95.7% (1,190) | PER min/avg/max over 8 years |

### etfs/index.json (v2.1.0)

```json
{
  "count": 23,
  "etfs": {
    "SPY": {
      "ticker": "SPY",
      "category": "ETF",
      "market_cap": 614504295227,
      "beta": 1.0,
      "expense_ratio": 0.0945,
      "returns": { "1m": 0.01, "ytd": 0.01, "1y": 0.15, "3y": 0.71 },
      "cagr": { "3y": 0.188, "5y": 0.132, "10y": 0.132 }
    }
  }
}
```

### indicators/economic.json (v2.1.0)

```json
{
  "count": 1046,
  "records": [
    {
      "date": "2026-01-02",
      "t10y": 0.04189,
      "t2y": 0.03477,
      "t10y_2y_spread": 0.00712,
      "hys_us": 0.0283,
      "bei_10y": 0.0225,
      "tips_10y": 0.0194
    }
  ]
}
```

## Usage

```javascript
const BASE = 'https://100xfenok.pages.dev/data/global-scouter';

// Get stock index
const index = await fetch(`${BASE}/core/stocks_index.json`).then(r => r.json());

// Get individual stock (with v2.2.0 extended fields)
const nvda = await fetch(`${BASE}/stocks/detail/NVDA.json`).then(r => r.json());
console.log(nvda.eps_consensus);      // {fy_plus_1: 4.68, fy_plus_2: 7.70, fy_plus_3: 9.85}
console.log(nvda.growth_consensus);   // {revenue_7y: 58.4, earnings_7y: 78.7, ...}
console.log(nvda.per_bands);          // {current: 44.97, min_8y: 18.95, avg_8y: 44.97, max_8y: 75.33}

// Get ETFs (v2.1.0)
const etfs = await fetch(`${BASE}/etfs/index.json`).then(r => r.json());

// Get Economic Indicators (v2.1.0)
const indicators = await fetch(`${BASE}/indicators/economic.json`).then(r => r.json());
```

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.2.0 | 2026-01-25 | Extended fields: fiscal_month, eps_consensus, growth_consensus, per_bands |
| 2.1.0 | 2026-01-10 | Added etfs/index.json, indicators/economic.json |
| 2.0.0 | 2025-12-15 | stocks/detail/ restructured |
| 1.0.0 | 2025-11-01 | Initial release |

---

*Last Updated: 2026-01-30*
