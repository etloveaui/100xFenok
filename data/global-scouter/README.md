# Global Scouter Data

> **Source**: Global Scouter Tool (internal)
> **Update**: On-demand
> **Files**: 1,247

---

## Overview

Stock screening and research data exported from Global Scouter tool.

## Structure

```
global-scouter/
├── core/                    # Core reference files
│   ├── dashboard.json       # Dashboard configuration
│   ├── metadata.json        # System metadata
│   └── stocks_index.json    # Master stock index
└── stocks/
    └── detail/              # Individual stock profiles (1,244 files)
        ├── AAPL.json
        ├── MSFT.json
        └── ...
```

## File Counts

| Folder | Files |
|--------|-------|
| core/ | 3 |
| stocks/detail/ | 1,244 |
| **Total** | 1,247 |

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

## Usage

```javascript
const BASE = 'https://100xfenok.pages.dev/data/global-scouter';

// Get stock index
const index = await fetch(`${BASE}/core/stocks_index.json`).then(r => r.json());

// Get individual stock
const aapl = await fetch(`${BASE}/stocks/detail/AAPL.json`).then(r => r.json());
```

---

*Last Updated: 2026-01-10*
