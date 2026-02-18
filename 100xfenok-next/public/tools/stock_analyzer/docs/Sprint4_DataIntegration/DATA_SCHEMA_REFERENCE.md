# Data Schema Reference

**Project**: Stock Analyzer - 100xFenok
**Purpose**: Quick reference for all data structures
**Date**: 2025-10-18

---

## JSON Structure Overview

```json
{
  "metadata": {
    "source": "Global Scouter CSV Pipeline",
    "totalCompanies": 6176,
    "technicalDataCompanies": 1250,
    "lastUpdated": "2025-10-18"
  },
  "data": {
    "main": [...],        // 6,176 companies (M_Company base)
    "technical": {
      "T_EPS_C": [...],   // 1,250 companies (EPS data)
      "T_Growth_C": [...],// 1,250 companies (Growth data)
      "T_Rank": [...],    // 1,250 companies (Ranking data)
      "T_CFO": [...],     // 1,264 companies (Cash Flow data)
      "T_Correlation": [...] // 1,249 companies (Correlation data)
    }
  }
}
```

---

## 1. Main Data Schema (data.main)

**Source**: M_Company.csv
**Record Count**: 6,176 companies
**Primary Key**: `Ticker`

### Core Fields

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| Ticker | String | "NVDA" | Stock ticker symbol (PRIMARY KEY) |
| Corp | String | "NVIDIA" | Company name |
| Exchange | String | "NASDAQ" | Stock exchange |
| WI26 | String | "반도체" | Industry sector (Korean) |
| 결산 | String | "Jan" | Fiscal year end month |
| 설립 | Number | 1998.0 | Founding year |
| Price | String | "187.62" | Current stock price |
| (USD mn) | Number | 4559166.0 | Market capitalization (USD millions) |

### Valuation Metrics

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| ROE (Fwd) | Number | 0.7943 | Forward Return on Equity (decimal) |
| OPM (Fwd) | Number | 0.656 | Forward Operating Profit Margin (decimal) |
| PER (Fwd) | Number | 31.69 | Forward Price-to-Earnings Ratio |
| PBR (Fwd) | Number | 19.45 | Forward Price-to-Book Ratio |

### Performance Metrics (Price Changes)

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| W | Number | 0.0529 | Weekly price change (decimal) |
| 1 M | Number | 0.0996 | 1-month price change |
| 3 M | Number | 0.1774 | 3-month price change |
| 6 M | Number | 0.8430 | 6-month price change |
| 12 M | Number | 0.5272 | 12-month price change |
| W.1 | Number | -0.0224 | Weekly change (secondary) |
| 1 M.1 | Number | -0.0596 | 1-month change (secondary) |
| 3 M.1 | Number | 0.0171 | 3-month change (secondary) |
| 6 M.1 | Number | -0.4879 | 6-month change (secondary) |
| 12 M.1 | Number | 0.0807 | 12-month change (secondary) |
| W.2 | Number | 0.0295 | Weekly change (tertiary) |
| 1 M.2 | Number | 0.0295 | 1-month change (tertiary) |
| 3 M.2 | Number | 0.1699 | 3-month change (tertiary) |
| 6 M.2 | Number | 0.2282 | 6-month change (tertiary) |
| 12 M.2 | Number | 0.5871 | 12-month change (tertiary) |

### Historical Data Points (Date Columns)

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| 45933 | Number | 5.92 | Data point at date 45933 (Excel date) |
| 45926.0 | Number | 5.75 | Data point at date 45926 |
| 45903.0 | Number | 5.75 | Data point at date 45903 |
| 45841.0 | Number | 5.06 | Data point at date 45841 |
| 45750.0 | Number | 4.82 | Data point at date 45750 |
| 45568.0 | Number | 3.73 | Data point at date 45568 |

**Note**: Excel date format (days since 1900-01-01)

---

## 2. EPS Data Schema (data.technical.T_EPS_C)

**Source**: T_EPS_C.csv
**Record Count**: 1,250 companies
**Primary Key**: `Ticker`
**Used By**: EPSAnalytics module

### Core Fields (Inherited)

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| Ticker | String | "NVDA" | Stock ticker (matches main data) |
| Corp | String | "NVIDIA" | Company name |
| Exchange | String | "NASDAQ" | Exchange |
| WI26 | String | "반도체" | Sector |
| (USD mn) | Number | 4559166.0 | Market cap |

### EPS Metrics

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| EPS | Number | 4.49 | Current Earnings Per Share |
| EPS (Fwd) | Number | 6.39 | Forward EPS estimate |
| EPS (Nxt) | Number | 7.37 | Next period EPS estimate |
| EPS성장(1Y) | Number | 0.128 | 1-year EPS growth rate (decimal) |
| EPS성장(3Y) | Number | 0.0082 | 3-year EPS growth rate |
| EPS성장(5Y) | Number | null | 5-year EPS growth rate (if available) |

### Profitability Metrics

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| ROE | Number | 0.7943 | Return on Equity (current) |
| ROE (Fwd) | Number | 0.7943 | Forward ROE |
| 수익률 | Number | 0.656 | Profit margin |

### Valuation Context

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| PER (Oct-25) | String | "46.45" | PER at specific date |
| PER (1~5) | String | "PER (2)" | PER quintile ranking |
| % | Number | 0.1544 | PER percentage change |
| PBR (Oct-25) | String | "35.72" | PBR at specific date |
| PBR (1~5) | String | "PBR (5)" | PBR quintile ranking |
| %.1 | Number | -0.0358 | PBR percentage change |

### Historical EPS Data

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| 45933.0 | Number | 4.49 | EPS at date 45933 |
| 45926.0 | Number | 4.49 | EPS at date 45926 |
| ... | ... | ... | Multiple historical data points |

---

## 3. Growth Data Schema (data.technical.T_Growth_C)

**Source**: T_Growth_C.csv
**Record Count**: 1,250 companies
**Primary Key**: `Ticker`
**Used By**: GrowthAnalytics module

### Core Fields (Inherited)

Same as EPS Data Schema

### Growth Metrics (7-Year)

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| Sales (7) | Number | 0.0025 | 7-year sales CAGR (decimal) |
| OP (7) | Number | 0.0032 | 7-year operating profit CAGR |
| EPS (7) | Number | 0.0028 | 7-year EPS CAGR |

### Growth Metrics (3-Year)

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| Sales (3) | Number | 0.0078 | 3-year sales CAGR |
| OP (3) | Number | 0.0115 | 3-year operating profit CAGR |
| EPS (3) | Number | 0.0104 | 3-year EPS CAGR |

### Growth Volatility (7-Year)

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| Sales (7).1 | Number | 0.0012 | 7-year sales volatility |
| OP (7).1 | Number | 0.0013 | 7-year OP volatility |
| EPS (7).1 | Number | 0.0019 | 7-year EPS volatility |

### Growth Volatility (3-Year)

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| Sales (3).1 | Number | 0.0037 | 3-year sales volatility |
| OP (3).1 | Number | 0.0047 | 3-year OP volatility |
| EPS (3).1 | Number | 0.0069 | 3-year EPS volatility |

### Growth Consistency (7-Year)

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| Sales (7).2 | String | "0.5253" | 7-year sales consistency score |
| OP (7).2 | String | "0.7339" | 7-year OP consistency score |
| EPS (7).2 | String | "0.7134" | 7-year EPS consistency score |

### Growth Consistency (3-Year)

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| Sales (3).2 | String | "0.3490" | 3-year sales consistency score |
| OP (3).2 | String | "0.3789" | 3-year OP consistency score |
| EPS (3).2 | String | "0.3584" | 3-year EPS consistency score |

---

## 4. Ranking Data Schema (data.technical.T_Rank)

**Source**: T_Rank.csv
**Record Count**: 1,250 companies
**Primary Key**: `Ticker`
**Used By**: RankingAnalytics module

### Core Fields (Inherited)

Same as EPS Data Schema

### Composite Rankings

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| Quality | Number | 50 | Overall quality ranking |
| Value | Number | 1398 | Overall value ranking |
| Momentum | Number | null | Overall momentum ranking |

### Forward Growth Metrics

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| FY+1 / FY 0 | Number | 0.5272 | FY+1 vs FY0 growth rate |
| FY+2 / FY+1 | Number | 0.4232 | FY+2 vs FY+1 growth rate |
| FY+3 / FY+2 | Number | 0.1534 | FY+3 vs FY+2 growth rate |
| F0←F+1 | Number | -0.0034 | Forward adjustment |

### Growth Rankings

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| Sales (3) | String | "0.3490" | 3-year sales growth ranking/score |
| EPS 성장성 | Number | null | EPS growth ranking |
| 매출 성장성 | Number | 0.3490 | Sales growth ranking |

### Valuation Rankings

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| PEG (Oct-25) | Number | 1.3311 | Price/Earnings-to-Growth ratio |
| % PER (Avg) | Number | -0.1556 | PER relative to average |
| % PBR (Avg) | Number | 0.4527 | PBR relative to average |
| PER+PBR | Number | 1398.0 | Combined valuation score |
| PER (Avg) | Number | 55.01 | Average PER |
| PBR (Avg) | String | "24.59" | Average PBR |

### Price Targets

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| EPS (Oct-25) | String | "4.039" | Expected EPS |
| Price | String | "222.19" | Target price (PER-based) |
| Return | String | "0.1843" | Expected return (PER-based) |
| BPS (Oct-25) | String | "5.252" | Book value per share |
| Price.1 | String | "129.15" | Target price (PBR-based) |
| Return.1 | String | "-0.3116" | Expected return (PBR-based) |

---

## 5. CFO Data Schema (data.technical.T_CFO)

**Source**: T_CFO.csv
**Record Count**: 1,264 companies
**Primary Key**: `Ticker`
**Used By**: CFOAnalytics module

### Core Fields (Inherited)

Same as EPS Data Schema

### Cash Flow Time Series

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| FY-4 | Number | 1234.56 | Cash flow 4 years ago |
| FY-3 | Number | 1456.78 | Cash flow 3 years ago |
| FY-2 | Number | 1678.90 | Cash flow 2 years ago |
| FY-1 | Number | 1890.12 | Cash flow 1 year ago |
| FY 0 | Number | 2000.00 | Current fiscal year cash flow |
| FY+1 | Number | 2200.00 | Next fiscal year (estimated) |
| FY+2 | Number | 2400.00 | 2 years ahead (estimated) |
| FY+3 | Number | 2600.00 | 3 years ahead (estimated) |

### Key Metrics

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| CCC (FY 0) | Number | 56.17 | Cash Conversion Cycle (days) |
| OPM (Fwd) | Number | 0.656 | Forward Operating Profit Margin |
| ROE (Fwd) | Number | 0.7943 | Forward Return on Equity |

### Additional Context

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| 현재가 | Number | 187.62 | Current price (Korean label) |
| (USD mn) | Number | 4559166.0 | Market cap |

---

## 6. Correlation Data Schema (data.technical.T_Correlation)

**Source**: T_Correlation.csv
**Record Count**: 1,249 companies
**Primary Key**: `Ticker`
**Used By**: CorrelationEngine module

### Core Fields

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| Ticker | String | "NVDA" | Stock ticker (PRIMARY KEY) |
| Corp | String | "NVIDIA" | Company name |
| Exchange | String | "NASDAQ" | Exchange |
| WI26 | String | "반도체" | Sector |
| (USD mn) | Number | 4559166.0 | Market cap |

### Price Data (for Correlation Calculation)

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| 주가 | Number | 187.62 | Current price (used for correlation matrix) |

**Note**: CorrelationEngine builds pairwise correlation matrix from price data during initialization.

---

## Data Type Reference

### Numeric Formats

| Format | Example | Description |
|--------|---------|-------------|
| Decimal (Growth Rate) | 0.0529 | Multiply by 100 for percentage (5.29%) |
| Decimal (Ratio) | 0.7943 | Direct decimal value (79.43% as ROE) |
| Integer | 1250 | Count or ranking |
| String Number | "187.62" | Number stored as string (convert for math) |
| Excel Date | 45933 | Days since 1900-01-01 |

### String Formats

| Format | Example | Description |
|--------|---------|-------------|
| Ticker | "NVDA" | 1-5 character stock symbol |
| Company Name | "NVIDIA" | Full company name |
| Sector | "반도체" | Industry sector (Korean) |
| Month | "Jan" | Fiscal year end month |

### Null Handling

| Value | Meaning |
|-------|---------|
| null | No data available |
| 0 | Zero value (valid data) |
| "" | Empty string (missing data) |

---

## Data Enrichment Pattern

All analytics modules follow this pattern to link technical data with main company data:

```javascript
// Step 1: Load technical data
const technicalData = integratedJson.data.technical.T_XXX;

// Step 2: Create company map
const companyMap = new Map(
    dataManager.companies.map(c => [c.Ticker, c])
);

// Step 3: Enrich technical data
const enrichedData = technicalData.map(item => {
    const company = companyMap.get(item.Ticker);
    return {
        ...item,                              // All technical fields
        corpName: company?.corpName,          // From main data
        price: company?.Price,                // From main data
        marketCap: company?.['(USD mn)']      // From main data
    };
});
```

---

## Field Naming Conventions

### English Fields
- Used for code-level references
- Examples: `Ticker`, `Corp`, `Exchange`, `Price`

### Korean Fields
- Used for display labels and some data fields
- Examples: `결산` (fiscal year end), `설립` (founding year), `수익률` (profit margin)

### Mixed Conventions
- Some fields use both (e.g., `WI26` for sector name in Korean)
- Column names may be Excel date numbers (e.g., `45933`)

---

## Common Data Operations

### Parse Growth Rate (0-1 to Percentage)

```javascript
function parseGrowth(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = parseFloat(value);
    if (isNaN(num)) return null;
    // Convert 0-1 range to percentage
    if (Math.abs(num) <= 1) return num * 100;
    return num;
}
```

### Parse String Number

```javascript
function parseStringNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return parseFloat(value);
    return null;
}
```

### Parse Ranking

```javascript
function parseRank(value) {
    const num = parseInt(value);
    if (isNaN(num)) return null;
    return num;
}
```

---

## Quick Reference: Field Counts

| Dataset | Core Fields | Metric Fields | Historical Fields | Total |
|---------|-------------|---------------|-------------------|-------|
| Main | 8 | 4 | 50+ | ~62 |
| T_EPS_C | 8 | 10 | 30+ | ~48 |
| T_Growth_C | 8 | 18 | 20+ | ~46 |
| T_Rank | 8 | 20 | 10+ | ~38 |
| T_CFO | 8 | 11 | 0 | ~19 |
| T_Correlation | 5 | 1 | 0 | ~6 |

---

**Schema End**

**Related Documents**:
- SPRINT4_DATA_INTEGRATION_ANALYSIS.md (Full analysis)
- SPRINT4_DATA_FLOW_DIAGRAM.md (Visual diagrams)
- SPRINT4_INTEGRATION_SUMMARY.md (Executive summary)
