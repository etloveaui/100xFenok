# SEC 13F Data

> **Source**: SEC EDGAR
> **Update**: Quarterly
> **Files**: 20

---

## Overview

Institutional holdings data from SEC 13F filings. Tracks major investors' portfolio positions.

## Structure

```
sec-13f/
├── summary.json           # Aggregated holdings summary
├── by_sector.json         # Holdings grouped by sector
├── by_ticker.json         # Holdings grouped by ticker
└── investors/             # Individual investor files (17 files)
    ├── buffett.json       # Berkshire Hathaway
    ├── ackman.json        # Pershing Square
    ├── dalio.json         # Bridgewater
    └── ...
```

## Investors Tracked

| Investor | Fund |
|----------|------|
| buffett | Berkshire Hathaway |
| ackman | Pershing Square |
| dalio | Bridgewater Associates |
| druckenmiller | Duquesne Family Office |
| cohen | Point72 |
| griffin | Citadel |
| fisher | Fisher Investments |
| fidelity | Fidelity |
| asness | AQR Capital |
| hohn | TCI Fund |
| and 7 more... | |

## Schema

### investors/{name}.json

```json
{
  "investor": "Warren Buffett",
  "fund": "Berkshire Hathaway",
  "filing_date": "2025-11-14",
  "total_value": 285000000000,
  "holdings": [
    {
      "ticker": "AAPL",
      "shares": 905560000,
      "value": 168000000000,
      "weight": 59.0
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
```

---

*Last Updated: 2026-01-10*
