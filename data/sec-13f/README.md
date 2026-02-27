# SEC 13F Data

> **Source**: SEC EDGAR
> **Update**: Quarterly
> **Files**: 41 (30 investors + 3 index + 8 analytics)
> **Version**: 3.2.0

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
    ├── conviction.json    # High-conviction positions
    ├── hhi.json           # Concentration (HHI)
    ├── turnover.json      # Quarter turnover
    ├── options_hedge.json # Options hedge ratio
    └── enhanced_consensus.json # Weighted consensus
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
    "version": "3.2.0",
    "generated_at": "2026-02-27T00:37:14Z",
    "quarters_covered": ["2025-Q4", "2025-Q3", "..."],
    "data_latency_note": "13F filings may be delayed up to 45 days after quarter end",
    "enrichment_coverage": {
      "sector": 0.20,
      "industry": 0.00,
      "market_cap": 0.00,
      "price_at_filing": 0.93,
      "return_since_filing": 0.93
    }
  },
  "investor": {
    "name": "Warren Buffett",
    "entity": "Berkshire Hathaway Inc",
    "cik": "0001067983",
    "group": "value",
    "filings": [
      {
        "quarter": "2025-Q4",
        "filing_date": "2026-02-17",
        "aum_total": 274160086701.0,
        "holdings_count": 110,
        "top_10_weight": 0.6528,
        "holdings": [
          {
            "ticker": "AAPL",
            "name": "APPLE INC",
            "shares": 61542988,
            "market_value": 16731076718.0,
            "weight": 0.061,
            "sector": "Technology",
            "enrichment_source": "fallback",
            "price_at_filing": 263.88,
            "price_latest": 271.98,
            "return_since_filing_pct": 3.0705,
            "return_as_of": "2026-02-26",
            "price_source": "yahoo"
          }
        ]
      }
    ]
  }
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

*Last Updated: 2026-02-27*
