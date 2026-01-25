# Global Scouter Data

> **Source**: Global Scouter Tool (internal)
> **Update**: On-demand
> **Files**: 1,248
> **Version**: v2.1.0

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
│   └── detail/              # Individual stock profiles (1,243 files)
│       ├── AAPL.json
│       ├── MSFT.json
│       └── ...
├── etfs/                    # 🆕 v2.1.0
│   └── index.json           # ETF/Index data (23 items)
└── indicators/              # 🆕 v2.1.0
    └── economic.json        # Economic indicators (1,046 records)
```

## File Counts

| Folder | Files |
|--------|-------|
| core/ | 3 |
| stocks/detail/ | 1,243 |
| etfs/ | 1 |
| indicators/ | 1 |
| **Total** | 1,248 |

## Schema

### stocks/detail/{SYMBOL}.json

```json
{
  "symbol": "AAPL",
  "profile": {
    "name": "Apple Inc.",
    "sector": "Technology",
    "industry": "Consumer Electronics"
  },
  "metrics": {
    "pe": 28.5,
    "pb": 45.2,
    "roe": 0.85
  }
}
```

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

// Get individual stock
const aapl = await fetch(`${BASE}/stocks/detail/AAPL.json`).then(r => r.json());

// Get ETFs (v2.1.0)
const etfs = await fetch(`${BASE}/etfs/index.json`).then(r => r.json());

// Get Economic Indicators (v2.1.0)
const indicators = await fetch(`${BASE}/indicators/economic.json`).then(r => r.json());
```

---

*Last Updated: 2026-01-25*
