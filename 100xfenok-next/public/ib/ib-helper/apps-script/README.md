# IB Helper Apps Script

Google Apps Script code for IB Helper automation.

## Files

| File | Version | Purpose |
|------|---------|---------|
| `Code.gs` | v2.9.0 | Order execution, dedupe, triggers, stale-order cleanup, weekend/holiday guard, ExecutionLog, Orders Archive |
| `yahoo-quotes.gs` | v3.0.0 | Price fetching (CNBC/Yahoo/Stooq/GOOGLEFINANCE) + WebApp API |

## Deployment Guide

### Step 1: Open Apps Script

1. Open your Google Sheet (IB Helper data sheet)
2. **Extensions** → **Apps Script**

### Step 2: Create/Replace Files

**File 1: Code.gs**
1. If `Code.gs` exists, delete all content
2. Copy entire content from `apps-script/Code.gs`
3. Paste into Apps Script editor

**File 2: yahoo-quotes.gs**
1. Click **+** next to "Files" → **Script**
2. Name it `yahoo-quotes` (extension added automatically)
3. Copy entire content from `apps-script/yahoo-quotes.gs`
4. Paste into Apps Script editor

### Step 3: Save

Press **Ctrl+S** or click **Save** icon

### Step 4: Deploy WebApp (First time only)

1. Click **Deploy** → **New deployment**
2. Select type: **Web app**
3. Settings:
   - Description: "IB Helper Price API v2.9.0"
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**
5. Copy the Web app URL
6. Update `sheets-sync.js` CONFIG.WEBAPP_URL if changed

### Step 5: Setup Daily Trigger (First time only)

1. In Apps Script, select function: `setupTrigger`
2. Click **Run** (▶️)
3. Grant permissions if prompted
4. Verify: **Triggers** (clock icon) shows daily 09:00 KST

### Step 6: Clean Up Existing Duplicates (One time)

1. Select function: `dedupeOrders`
2. Click **Run** (▶️)
3. Check **Execution log** for: "Removed X duplicate rows"

## Functions Reference

### Code.gs

| Function | Purpose | Run |
|----------|---------|-----|
| `processOrderExecutions()` | Check order executions | Daily auto / Manual |
| `dedupeOrders()` | Remove duplicate orders | Manual / Before execution |
| `setupTrigger()` | Enable daily auto-run | Once |
| `removeTrigger()` | Disable auto-run | As needed |
| `createPricesSheet()` | Create Prices sheet template | Once |
| `writeExecutionLog()` | Write execution results to ExecutionLog sheet | Auto (internal) |
| `archiveOldOrders()` | Archive orders older than 14 days | Auto / Manual menu |

### yahoo-quotes.gs

| Function | Purpose | Run |
|----------|---------|-----|
| `getQuote(symbol)` | Get single ticker price | Internal |
| `getQuotes(symbols)` | Get multiple ticker prices | Internal |
| `doGet(e)` | WebApp endpoint | Auto (HTTP GET) |
| `testDoGet()` | Test WebApp locally | Manual |

## Sheet Structure

### Portfolio (Sheet1)
```
| A: googleId | B: profileId | C: profileName | D: ticker | E: avgPrice | F: holdings | G: totalInvested | H: principal | I: AFTER% | J: LOC% | K: date | L: balance | M: commissionRate | N: divisions | O: revision |
```

### Prices (Sheet2)
```
| A: Ticker | B: Price | C: Close | D: High |
```

Formulas:
- B: `=GOOGLEFINANCE($A2,"price")`
- C: `=INDEX(GOOGLEFINANCE($A2,$C$1,TODAY()-1),2,2)`
- D: `=INDEX(GOOGLEFINANCE($A2,$D$1,TODAY()-1),2,2)`

### Orders (Sheet3)
```
| A: date | B: googleId | C: profileId | D: ticker | E: orderType | F: side | G: price | H: qty | I: total | J: basis | K: execution | L: execDate | M: actualPrice |
```

## Version History

- **v2.9.0** (2026-02-12): CRITICAL execution order fix — `checkExecutions` before `removeStaleOrders`
- **v2.8.1** (2026-02-12): stale cleanup Phase 1 logic simplified (`date < today`)
- **v2.8.0** (2026-02-12): Added `removeStaleOrders()` for stale BUY/SELL cleanup
- **v2.7.0** (2026-02-10): ExecutionLog sheet (auto-log execution results), Orders Archive (14-day rolling), parseOrderDate Korean locale support, archiveOldOrders with data recovery
- **v2.6.0** (2026-02-10): P0 safety guard (close/high/price>0 checks), LockService for processOrderExecutions, BUY→SELL order fix
- **v2.5.0** (2026-02-08): NYSE holiday detection (rule-based), weekend guard, totalInvested commission fix
- **v3.0.0** yahoo-quotes (2026-02-05): CNBC primary source, pre/post market support
- **v2.1.0** (2026-02-04): Added dedupeOrders(), JSONP security filter
- **v2.0.0** (2026-02-04): WebApp API with JSONP support
- **v1.0.0** (2026-02-03): Initial release

## Troubleshooting

### "Prices sheet not found"
Run `createPricesSheet()` or manually create with GOOGLEFINANCE formulas.

### Orders not executing
Check Prices sheet has **High** column (D) for limit sell orders.

### WebApp returns JSON instead of JSONP
Callback must start with `jsonp_cb_` prefix (security filter).
