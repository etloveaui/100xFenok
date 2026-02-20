# SEC 13F Data

> **Source**: SEC EDGAR
> **Update**: Quarterly
> **Files**: 37 (30 investors + 3 index + 4 analytics)
> **Version**: 3.0.1

---

## Overview

Institutional holdings data from SEC 13F filings. Tracks 30 major investors' portfolio positions across 20+ quarters (accumulate mode).

## Structure

```
sec-13f/
├── summary.json           # Aggregated holdings summary
├── by_sector.json         # Holdings grouped by sector
├── by_ticker.json         # Holdings grouped by ticker
├── investors/             # Individual investor files (30 files)
│   ├── buffett.json       # Berkshire Hathaway
│   ├── druckenmiller.json # Duquesne Family Office
│   ├── dalio.json         # Bridgewater Associates
│   └── ...
└── analytics/             # Derived metrics
    ├── consensus.json     # Cross-investor consensus score
    ├── new_positions.json # Newly initiated positions
    ├── buying_pressure.json # Net buying/selling pressure
    └── conviction.json    # High-conviction positions
```

## Investors Tracked (30)

| Category | Investors |
|----------|-----------|
| Value (10) | buffett, marks, klarman, greenblatt, einhorn, pabrai, gayner, russo, miller, fidelity |
| Macro (4) | druckenmiller, soros, dalio, tudor |
| Hedge (4) | griffin, cohen, hohn, laffont |
| Tiger Cubs (3) | halvorsen, coleman, mandel |
| Activist (3) | ackman, icahn, peltz |
| Event-Driven (3) | tepper, loeb, singer |
| Quant (2) | fisher, asness |
| Growth (1) | wood |

## Schema

### investors/{name}.json

```json
{
  "metadata": {
    "version": "3.0.1",
    "quarters_covered": ["2025-Q4", "2025-Q3", "..."]
  },
  "investor": {
    "name": "Warren Buffett",
    "entity": "Berkshire Hathaway Inc",
    "cik": "0001067983",
    "group": "value"
  },
  "filings": [
    {
      "quarter": "2025-Q4",
      "filing_date": "2026-02-14",
      "aum_total": 266000000000,
      "holdings_count": 110,
      "top_10_weight": 0.89,
      "holdings": [
        {
          "ticker": "AAPL",
          "name": "Apple Inc",
          "shares": 300000000,
          "value": 69000000000,
          "weight": 0.26,
          "change": "DECREASED"
        }
      ]
    }
  ]
}
```

## Usage

```javascript
const BASE = 'https://100xfenok.pages.dev/data/sec-13f';

// Get summary
const summary = await fetch(`${BASE}/summary.json`).then(r => r.json());

// Get specific investor
const buffett = await fetch(`${BASE}/investors/buffett.json`).then(r => r.json());

// Get analytics
const consensus = await fetch(`${BASE}/analytics/consensus.json`).then(r => r.json());
```

---

*Last Updated: 2026-02-20*
