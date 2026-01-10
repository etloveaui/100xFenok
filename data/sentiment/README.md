# Sentiment Data

> **Source**: AAII, CNN, CFTC, Alternative.me
> **Update**: Daily/Weekly
> **Files**: 13

---

## Overview

Market sentiment indicators from various sources for the 100x Market Radar.

## File Catalog

### AAII Sentiment

| File | Description | Update |
|------|-------------|--------|
| `aaii.json` | AAII Investor Sentiment Survey | Weekly |

### CNN Fear & Greed

| File | Description | Update |
|------|-------------|--------|
| `cnn-fear-greed.json` | Fear & Greed Index (0-100) | Daily |
| `cnn-components.json` | 7 component indicators | Daily |
| `cnn-breadth.json` | Market Breadth | Daily |
| `cnn-momentum.json` | Market Momentum | Daily |
| `cnn-put-call.json` | Put/Call Ratio | Daily |
| `cnn-safe-haven.json` | Safe Haven Demand | Daily |
| `cnn-strength.json` | Stock Price Strength | Daily |
| `cnn-junk-bond.json` | Junk Bond Demand | Daily |

### CFTC COT

| File | Description | Update |
|------|-------------|--------|
| `cftc-sp500.json` | S&P 500 futures positioning | Weekly |

### Other

| File | Description | Update |
|------|-------------|--------|
| `vix.json` | CBOE Volatility Index | Daily |
| `move.json` | MOVE Bond Volatility Index | Daily |
| `crypto-fear-greed.json` | Crypto Fear & Greed | Daily |

## Schema

### cnn-fear-greed.json

```json
{
  "updated": "2026-01-10T06:00:00Z",
  "value": 45,
  "rating": "Fear",
  "previous_close": 48,
  "week_ago": 52,
  "month_ago": 38,
  "year_ago": 65
}
```

### aaii.json

```json
{
  "updated": "2026-01-09",
  "bullish": 38.5,
  "neutral": 32.1,
  "bearish": 29.4,
  "bull_bear_spread": 9.1
}
```

## Usage

```javascript
const BASE = 'https://100xfenok.pages.dev/data/sentiment';

// Get Fear & Greed
const fng = await fetch(`${BASE}/cnn-fear-greed.json`).then(r => r.json());
console.log(`Fear & Greed: ${fng.value} (${fng.rating})`);

// Get AAII
const aaii = await fetch(`${BASE}/aaii.json`).then(r => r.json());
console.log(`Bullish: ${aaii.bullish}%`);
```

## Related

- Widget: `tools/macro-monitor/` (100x Market Radar)
- Reference: `docs/references/market-sentiment-summary.md`

---

*Last Updated: 2026-01-10*
