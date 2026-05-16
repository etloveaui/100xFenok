# SEC 13F Data

> **Source**: SEC EDGAR
> **Update**: Quarterly
> **Files**: 43 (30 investors + 3 index + 10 analytics)
> **Version**: 3.3.2

---

## Overview

Institutional holdings data from SEC 13F filings. Tracks 30 major investors' portfolio positions across 29 quarters through 2026-Q1 where filings are available (accumulate mode). The configured Greenlight/Einhorn CIK currently has no SEC 13F after 2023-Q4.

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
    ├── enhanced_consensus.json # Weighted consensus
    ├── conviction_entries.json # Conviction + new position cross-reference
    └── multi_quarter_trends.json # Multi-quarter streaks + snapshots
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
    "version": "3.3.2",
    "generated_at": "2026-05-16T...",
    "quarters_covered": ["2026-Q1", "2025-Q4", "..."],
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
        "quarter": "2026-Q1",
        "filing_date": "2026-05-15",
        "aum_total": 263095703570.0,
        "holdings_count": 90,
        "top_10_weight": 0.6802,
        "holdings": [
          {
            "ticker": "ALLY",
            "name": "ALLY FINL INC",
            "shares": 12719675,
            "market_value": 498992850.0,
            "weight": 0.0019,
            "sector": "Financials",
            "enrichment_source": "fallback"
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

*Last Updated: 2026-05-16*
