# 100x Market Data - Apps Script

Real-time market data service for 100xFenok main page (v17.8).

> **Architecture**: Standalone GAS project + Dedicated Google Sheet
> **Not related to**: IB Helper GAS (separate project)

## Files

| File | Version | Purpose |
|------|---------|---------|
| `market-data.gs` | v1.1.0 | Main application: indices, sectors, VIX, WebApp, sheet management |
| `yahoo-quotes.gs` | v1.1.0 | Yahoo Finance API wrapper + time-based market state (adapted from IB Helper) |

## WebApp API

### Endpoints

| URL | Response |
|-----|----------|
| `/exec` | All data (indices + sectors + VIX + regime) |
| `/exec?type=indices` | Major indices only (^GSPC, ^IXIC, ^DJI) |
| `/exec?type=sectors` | 11 sector ETFs only |
| `/exec?type=vix` | VIX + market regime |
| `/exec?callback=fn` | JSONP wrapper |

### Response Schema

```json
{
  "indices": {
    "^GSPC": { "name": "S&P 500", "price": 6050.25, "change": 25.3, "changePercent": 0.42, "marketState": "REGULAR" },
    "^IXIC": { "name": "NASDAQ", "price": 19750.8, "change": -45.2, "changePercent": -0.23, "marketState": "REGULAR" },
    "^DJI": { "name": "Dow Jones", "price": 44200.5, "change": 120.7, "changePercent": 0.27, "marketState": "REGULAR" }
  },
  "sectors": {
    "XLK": { "name": "Technology", "bloombergKey": "information_technology", "price": 232.45, "change": 1.2, "changePercent": 0.52, "marketState": "REGULAR" },
    "XLF": { "name": "Financials", "bloombergKey": "financials", "price": 48.32, "change": -0.15, "changePercent": -0.31, "marketState": "REGULAR" }
  },
  "vix": {
    "price": 15.8, "change": -0.5, "changePercent": -3.06,
    "regime": { "label": "Growth", "color": "green" },
    "marketState": "REGULAR"
  },
  "marketState": "REGULAR",
  "timestamp": "2026-02-11T15:30:00.000Z",
  "version": "1.0.0"
}
```

## Sector ETF Mapping

| # | ETF | Sector | Bloomberg Key |
|---|-----|--------|---------------|
| 1 | XLK | Technology | information_technology |
| 2 | XLF | Financials | financials |
| 3 | XLV | Healthcare | health_care |
| 4 | XLE | Energy | energy |
| 5 | XLI | Industrials | industrials |
| 6 | XLC | Communication | communication_services |
| 7 | XLY | Consumer Disc. | consumer_discretionary |
| 8 | XLP | Consumer Staples | consumer_staples |
| 9 | XLRE | Real Estate | real_estate |
| 10 | XLB | Materials | materials |
| 11 | XLU | Utilities | utilities |

## Market Regime Logic

| VIX Range | Label | Color |
|-----------|-------|-------|
| < 20 | Growth | Green |
| 20-25 | Neutral | Blue |
| 25-30 | Defensive | Orange |
| > 30 | Risk-Off | Red |

## Deployment Guide

### Step 1: Create Google Sheet

1. Create new Google Sheet: **"100x-Market-Data"**
2. Extensions → Apps Script

### Step 2: Add Script Files

**File 1: yahoo-quotes.gs**
1. In Apps Script editor, click + → Script
2. Name: `yahoo-quotes`
3. Paste content from `yahoo-quotes.gs`

**File 2: market-data.gs**
1. Replace default `Code.gs` content (or rename)
2. Paste content from `market-data.gs`

### Step 3: Test

1. Select function: `testFetchAll`
2. Click Run (grant permissions when prompted)
3. Check Execution log for JSON output

### Step 4: Deploy WebApp

1. Deploy → New deployment
2. Type: Web app
3. Settings:
   - Description: "100x Market Data v1.0.0"
   - Execute as: Me
   - Who has access: Anyone
4. Deploy → Copy URL
5. Test: Open URL in browser

### Step 5: Setup Auto-Update

1. Select function: `setupTrigger`
2. Click Run
3. Verify: Triggers tab shows `updateMarketDataSheet` every 5 min

## Sheet Structure

### Indices
```
| Symbol | Name | Price | Change | Change% | MarketState | Updated |
```

### Sectors
```
| Symbol | Name | BloombergKey | Price | Change | Change% | MarketState | Updated |
```

### VIX
```
| Price | Change | Change% | Regime | RegimeColor | MarketState | Updated |
```

## Functions Reference

### market-data.gs

| Function | Purpose | Run |
|----------|---------|-----|
| `fetchAll()` | Get all market data | Internal |
| `fetchIndices()` | Get ^GSPC, ^IXIC, ^DJI | Internal |
| `fetchSectors()` | Get 11 sector ETFs | Internal |
| `fetchVIX()` | Get VIX + regime | Internal |
| `doGet(e)` | WebApp endpoint | Auto (HTTP GET) |
| `updateMarketDataSheet()` | Write to sheets | Auto (trigger) / Manual |
| `setupTrigger()` | Enable 5-min auto-update | Once |
| `removeTrigger()` | Disable auto-update | As needed |

### yahoo-quotes.gs

| Function | Purpose | Run |
|----------|---------|-----|
| `yahooGetQuote(symbol)` | Fetch single ticker | Internal |
| `yahooGetQuotes(symbols)` | Fetch multiple tickers | Internal |
| `yahooBestPrice(quote)` | Get best price by market state | Internal |

## Version History

- **v1.1.0** (2026-02-11): Time-based `getMarketState()` — fix UNKNOWN marketState (IB Helper proven solution)
- **v1.0.0** (2026-02-11): Initial release — 3 indices, 11 sector ETFs, VIX, WebApp, sheet management

## Related

- **Master Plan**: `docs/planning/main-v17.8-rebuild-master.md`
- **IB Helper GAS**: `ib/ib-helper/apps-script/` (separate project, do not mix)
- **Market Radar GAS**: `admin/market-radar/scripts/` (trigger-only, no WebApp)
