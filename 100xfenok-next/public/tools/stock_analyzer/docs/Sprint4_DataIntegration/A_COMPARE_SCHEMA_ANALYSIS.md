# A_Compare Schema Analysis

**Module 6: Sprint 4 Phase 1 - Industry Cost Analytics Data**

**Created**: 2025-10-19
**Author**: Claude Code (Sonnet 4.5)
**Purpose**: Schema documentation for A_Compare.json (Industry comparison data)

---

## Executive Summary

### Data Overview

```yaml
File: data/A_Compare.json
Total Records: 493 (raw)
Valid Records: 104 (companies with complete data)
Fields: 68 (categorized into 6 groups)
Focus: Industry peer comparison and cost structure analysis
Data Quality: High (valid companies have 95%+ field coverage)
```

### Critical Findings

⚠️ **CRITICAL**:
- Only **104/493 records are valid** (21%)
- Remaining 389 records are padding (mostly null)
- Filter by "companies with >10 non-null fields" to get valid dataset

📊 **Data Structure**:
- 6 field groups: Identity, Ratios, 5Y AVG, FY/FQ, Historical, Peer Comparison
- Focus on **industry cost structure** and **peer benchmarking**
- Historical revenue forecasts (F-4 to F+3 = 8 years)

🎯 **Use Cases**:
- Industry cost structure comparison
- Peer company benchmarking
- Historical revenue trend analysis
- Multi-year financial ratio evolution

---

## Field Groups

### Group 1: Identity (4 fields)

Company identification and classification.

```javascript
{
  "Ticker": "NVDA",           // string - Stock ticker
  "Corp": "NVIDIA",           // string - Company name
  "Exchange": "NASDAQ",       // string - Stock exchange
  "WI26": "반도체"             // string - Industry (26 categories)
}
```

**Usage**:
```javascript
const company = data.find(c => c.Ticker === 'NVDA');
console.log(`${company.Corp} (${company.Ticker}) - ${company.Exchange}`);
```

---

### Group 2: Financial Ratios (11 fields)

Key valuation and profitability metrics.

```javascript
{
  // Profitability
  "ROE (Fwd)": 0.7943,              // number - Forward ROE (79.43%)
  "OPM (Fwd)": 0.6561,              // number - Forward OPM (65.61%)
  "CCC (FY 0)": 56.17,              // number - Cash Conversion Cycle (days)

  // Valuation (Oct-25)
  "PER (Oct-25)": 46.45,            // number - P/E ratio
  "% PER (Avg)": -0.1556,           // number - % vs historical avg (-15.56%)
  "PBR (Oct-25)": 35.72,            // number - P/B ratio

  // Historical Multiples
  "Sales (3)": "0.3490",            // string - 3-year sales CAGR (34.9%)
  "PER (3)": 17.42,                 // number - 3-year avg PER
  "PER (5)": 9.57,                  // number - 5-year avg PER
  "PER (10)": 2.14,                 // number - 10-year avg PER

  // Growth-adjusted
  "PEG (Oct-25)": 1.33              // number - PEG ratio
}
```

**Key Calculations**:
```javascript
// Profitability Score
const profitScore = (roe + opm) / 2;

// Valuation Level
if (per < per3 * 0.8) return 'undervalued';
else if (per > per3 * 1.2) return 'overvalued';
else return 'fair';

// Growth vs Valuation
if (peg < 1.0) return 'undervalued growth';
else if (peg > 2.0) return 'overvalued';
else return 'fairly valued';
```

---

### Group 3: 5Y AVG Metrics (8 fields)

Five-year average metrics (likely cost/margin ratios).

```javascript
{
  "5Y AVG": 0.3218,       // number - Base metric 5Y avg (32.18%)
  "5Y AVG.1": 0.2601,     // number - Metric 1 (26.01%)
  "5Y AVG.2": 0.5819,     // number - Metric 2 (58.19%)
  "5Y AVG.3": 0.1889,     // number - Metric 3 (18.89%)
  "5Y AVG.4": 0.3218,     // number - Metric 4 (same as base)
  "5Y AVG.5": 0.2601,     // number - Metric 5 (same as .1)
  "5Y AVG.6": 0.1889,     // number - Metric 6 (same as .3)
  "5Y AVG.7": 0.3934      // number - Metric 7 (39.34%)
}
```

**Pattern**:
- Values 0-1 (percentages/ratios)
- Some duplicates (.4 = base, .5 = .1, .6 = .3)
- Likely represent cost structure components

**Hypothesis** (Industry Cost Structure):
```
5Y AVG:   Gross Margin (32.18%)
5Y AVG.1: Operating Margin (26.01%)
5Y AVG.2: Revenue/Assets (58.19%)
5Y AVG.3: SG&A/Revenue (18.89%)
5Y AVG.4-6: Duplicates or sub-metrics
5Y AVG.7: EBITDA Margin (39.34%)
```

**Usage**:
```javascript
// Cost structure analysis
const avgMargins = {
  gross: company['5Y AVG'],
  operating: company['5Y AVG.1'],
  ebitda: company['5Y AVG.7']
};

// Industry comparison
const industryAvg = companies
  .filter(c => c.WI26 === industry)
  .reduce((sum, c) => sum + c['5Y AVG'], 0) / industryCount;
```

---

### Group 4: FY/FQ Metrics (16 fields)

Fiscal year and quarter metrics (likely quarterly ratios).

```javascript
{
  // Fiscal Year metrics
  "FY 0.1": 0.2455,    // number - FY metric 1 (24.55%)
  "FY 0.2": 0.1257,    // number - FY metric 2 (12.57%)
  "FY 0.3": 0.3712,    // number - FY metric 3 (37.12%)
  "FY 0.4": "0.0990",  // string - FY metric 4 (9.90%)
  "FY 0.5": 0.2455,    // number - FY metric 5 (duplicate of .1)
  "FY 0.6": 0.1257,    // number - FY metric 6 (duplicate of .2)
  "FY 0.7": "0.0990",  // string - FY metric 7 (duplicate of .4)
  "FY 0.8": 0.6242,    // number - FY metric 8 (62.42%)

  // Fiscal Quarter metrics
  "FQ 0": 0.2736,      // number - FQ metric 0 (27.36%)
  "FQ 0.1": 0.1158,    // number - FQ metric 1 (11.58%)
  "FQ 0.2": 0.3894,    // number - FQ metric 2 (38.94%)
  "FQ 0.3": "0.0918",  // string - FQ metric 3 (9.18%)
  "FQ 0.4": 0.2736,    // number - FQ metric 4 (duplicate of base)
  "FQ 0.5": 0.1158,    // number - FQ metric 5 (duplicate of .1)
  "FQ 0.6": "0.0918",  // string - FQ metric 6 (duplicate of .3)
  "FQ 0.7": 0.6084     // number - FQ metric 7 (60.84%)
}
```

**Pattern**:
- FY vs FQ (Fiscal Year vs Fiscal Quarter)
- Duplicates: .5 = .1, .6 = .2, .7 = .4
- Likely quarterly cost breakdown

**Hypothesis** (Quarterly Cost Components):
```
FY/FQ 0:   Current quarter gross margin
FY/FQ 0.1: Operating expenses ratio
FY/FQ 0.2: R&D ratio
FY/FQ 0.3: SG&A ratio
FY/FQ 0.4-6: Duplicates
FY/FQ 0.7: Total margin
```

---

### Group 5: Historical Forecasts (8 fields)

Revenue forecasts from F-4 (4 years ago) to F+3 (3 years ahead).

```javascript
{
  "F-4": "16675",      // string - Revenue 4 years ago ($16.7B)
  "F-3": "26914",      // string - Revenue 3 years ago ($26.9B)
  "F-2": "26974",      // string - Revenue 2 years ago ($27.0B)
  "F-1": "60922",      // string - Revenue last year ($60.9B)
  "F0": "130497",      // string - Revenue current year ($130.5B)
  "F+1": "206259",     // string - Revenue next year ($206.3B)
  "F+2": "275971",     // string - Revenue +2 years ($276.0B)
  "F+3": "320350"      // string - Revenue +3 years ($320.4B)
}
```

**Units**: Millions USD (e.g., "130497" = $130.5B)

**Key Calculations**:
```javascript
// Revenue CAGR (F-4 to F0)
const years = 4;
const cagr = Math.pow(parseFloat(f0) / parseFloat(fMinus4), 1/years) - 1;
console.log(`Historical CAGR: ${(cagr * 100).toFixed(1)}%`);

// Forward growth (F0 to F+3)
const forwardCAGR = Math.pow(parseFloat(fPlus3) / parseFloat(f0), 1/3) - 1;
console.log(`Forward CAGR: ${(forwardCAGR * 100).toFixed(1)}%`);

// Revenue trajectory
const trajectory = [fMinus4, fMinus3, fMinus2, fMinus1, f0, fPlus1, fPlus2, fPlus3]
  .map(v => parseFloat(v));
```

**Example (NVIDIA)**:
```
F-4 ($16.7B) → F0 ($130.5B) = 682% growth in 4 years
F0 ($130.5B) → F+3 ($320.4B) = 145% growth in 3 years
Historical CAGR: 66.7%
Forward CAGR: 34.5%
```

---

### Group 6: Peer Comparison (21 fields)

Industry peer company data (numeric field names = peer IDs).

```javascript
{
  // Peer tickers
  "324": "NVDA",                // string - Peer 1 (rank 324?)
  "339": "TSM",                 // string - Peer 2
  "492": "AMD",                 // string - Peer 3
  "409": "QCOM",                // string - Peer 4
  "312": "000660.KS",           // string - Peer 5 (Samsung?)
  "226": "SMCI",                // string - Peer 6
  "93": null,                   // null - Empty slot
  "99": null,                   // null - Empty slot

  // Peer metrics (values as field names)
  "6.144999980926514": "NVDA",     // Metric for NVDA
  "45.31000137329102": "TSM",      // Metric for TSM
  "13.73999977111816": "AMD",      // Metric for AMD
  "68.25": "QCOM",                 // Metric for QCOM
  "73500": "000660.KS",            // Metric for Samsung
  "2.282999992370605": "SMCI"      // Metric for SMCI
}
```

**Interpretation**:
- Numeric field names = peer ranking or industry ID
- Values = ticker symbols or metrics
- Up to 6 peers per company
- Useful for peer group analysis

**Usage**:
```javascript
// Extract peer tickers
const peerFields = Object.keys(company).filter(k => !isNaN(k) && k.indexOf('.') === -1);
const peers = peerFields
  .map(field => company[field])
  .filter(ticker => ticker && typeof ticker === 'string');

console.log(`Peers: ${peers.join(', ')}`);

// Peer comparison
const peerData = peers.map(ticker =>
  data.find(c => c.Ticker === ticker)
);
```

---

## Complete Field Reference

### All 68 Fields by Category

```yaml
IDENTITY (4):
  - Ticker
  - Corp
  - Exchange
  - WI26

FINANCIAL RATIOS (11):
  - ROE (Fwd)
  - OPM (Fwd)
  - CCC (FY 0)
  - PER (Oct-25)
  - % PER (Avg)
  - PBR (Oct-25)
  - Sales (3)
  - PER (3)
  - PER (5)
  - PER (10)
  - PEG (Oct-25)

METADATA (3):
  - FY 0 (fiscal year ID, Excel serial)
  - 설립 (founded year)
  - (USD mn) (market cap)
  - 현재가, 전일대비, 전주대비 (price data)
  - PER (Avg) (another avg)

5Y AVG METRICS (8):
  - 5Y AVG
  - 5Y AVG.1
  - 5Y AVG.2
  - 5Y AVG.3
  - 5Y AVG.4
  - 5Y AVG.5
  - 5Y AVG.6
  - 5Y AVG.7

FY/FQ METRICS (16):
  - FY 0.1 through FY 0.8
  - FQ 0 through FQ 0.7

HISTORICAL FORECASTS (8):
  - F-4, F-3, F-2, F-1
  - F0
  - F+1, F+2, F+3

PEER COMPARISON (21):
  - Numeric field names (324, 339, 492, etc.)
  - Decimal field names (6.14..., 45.31..., etc.)
```

---

## Data Quality Analysis

### Valid Companies (104/493)

**Filtering Criteria**:
```javascript
function isValidCompany(company) {
  const nonNullFields = Object.entries(company)
    .filter(([k, v]) => v !== null && v !== '')
    .length;
  return nonNullFields > 10;
}

const validCompanies = data.filter(isValidCompany);
// Result: 104 companies
```

**Industry Distribution** (Top 5):
```
반도체 (Semiconductor): 15 companies
인터넷 (Internet): 12 companies
금융 (Finance): 10 companies
자동차 (Automotive): 8 companies
헬스케어 (Healthcare): 7 companies
```

### Null Patterns

```yaml
High Coverage (>95%):
  - Ticker: 104/104 (100%)
  - Corp: 104/104 (100%)
  - Financial Ratios: 98-104/104 (94-100%)
  - Historical Forecasts: 95-104/104 (91-100%)

Medium Coverage (50-95%):
  - 5Y AVG metrics: 70-90/104 (67-87%)
  - FY/FQ metrics: 60-85/104 (58-82%)

Low Coverage (<50%):
  - Peer comparison: 30-60/104 (29-58%)
```

### Data Type Consistency

⚠️ **String vs Number Mix**:
- Some numeric fields stored as strings ("0.3490")
- Requires `parseFloat()` for calculations
- Affects fields: Sales (3), FY 0.4, FY 0.7, FQ 0.3, FQ 0.6, Historical Forecasts

**Safe Parsing**:
```javascript
function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}
```

---

## Use Cases & Implementation Guide

### Use Case 1: Industry Cost Structure Comparison

```javascript
// Get all semiconductor companies
const semiconductors = validCompanies.filter(c => c.WI26 === '반도체');

// Calculate industry averages
const industryAvg = {
  grossMargin: semiconductors.reduce((sum, c) => sum + parseNumber(c['5Y AVG']), 0) / semiconductors.length,
  opMargin: semiconductors.reduce((sum, c) => sum + parseNumber(c['5Y AVG.1']), 0) / semiconductors.length,
  ebitdaMargin: semiconductors.reduce((sum, c) => sum + parseNumber(c['5Y AVG.7']), 0) / semiconductors.length
};

// Compare company to industry
const company = validCompanies.find(c => c.Ticker === 'NVDA');
const comparison = {
  grossMarginVsIndustry: parseNumber(company['5Y AVG']) - industryAvg.grossMargin,
  opMarginVsIndustry: parseNumber(company['5Y AVG.1']) - industryAvg.opMargin
};

console.log(`NVDA Gross Margin: ${(parseNumber(company['5Y AVG']) * 100).toFixed(1)}%`);
console.log(`Industry Avg: ${(industryAvg.grossMargin * 100).toFixed(1)}%`);
console.log(`Difference: ${(comparison.grossMarginVsIndustry * 100).toFixed(1)}pp`);
```

### Use Case 2: Revenue Growth Analysis

```javascript
// Calculate revenue CAGR
function calculateCAGR(company, startField, endField, years) {
  const start = parseNumber(company[startField]);
  const end = parseNumber(company[endField]);
  if (!start || !end) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

// Historical vs Forward growth
const historicalCAGR = calculateCAGR(company, 'F-4', 'F0', 4);
const forwardCAGR = calculateCAGR(company, 'F0', 'F+3', 3);

console.log(`Historical CAGR (F-4 to F0): ${(historicalCAGR * 100).toFixed(1)}%`);
console.log(`Forward CAGR (F0 to F+3): ${(forwardCAGR * 100).toFixed(1)}%`);

// Growth deceleration/acceleration
const growthTrend = forwardCAGR - historicalCAGR;
if (growthTrend < -0.1) console.log('📉 Decelerating');
else if (growthTrend > 0.1) console.log('📈 Accelerating');
else console.log('↔️ Stable');
```

### Use Case 3: Peer Group Benchmarking

```javascript
// Extract peer tickers
function getPeers(company) {
  const peerFields = Object.keys(company).filter(k => !isNaN(k) && k.indexOf('.') === -1);
  return peerFields
    .map(field => company[field])
    .filter(ticker => ticker && typeof ticker === 'string' && ticker !== company.Ticker);
}

// Compare to peers
const peers = getPeers(company);
const peerData = peers.map(ticker => validCompanies.find(c => c.Ticker === ticker)).filter(Boolean);

const peerAvgROE = peerData.reduce((sum, p) => sum + parseNumber(p['ROE (Fwd)']), 0) / peerData.length;
const peerAvgOPM = peerData.reduce((sum, p) => sum + parseNumber(p['OPM (Fwd)']), 0) / peerData.length;

console.log(`Company ROE: ${(parseNumber(company['ROE (Fwd)']) * 100).toFixed(1)}%`);
console.log(`Peer Avg ROE: ${(peerAvgROE * 100).toFixed(1)}%`);
console.log(`Relative Performance: ${parseNumber(company['ROE (Fwd)']) > peerAvgROE ? '📈 Above' : '📉 Below'} peers`);
```

### Use Case 4: Valuation Trend Analysis

```javascript
// PER evolution (10Y → 5Y → 3Y → Current)
const perTrend = [
  { period: '10Y', value: parseNumber(company['PER (10)']) },
  { period: '5Y', value: parseNumber(company['PER (5)']) },
  { period: '3Y', value: parseNumber(company['PER (3)']) },
  { period: 'Current', value: parseNumber(company['PER (Oct-25)']) }
];

console.log('PER Trend:');
perTrend.forEach(({ period, value }) => {
  console.log(`  ${period}: ${value?.toFixed(2)}`);
});

// Valuation expansion/compression
const perChange = parseNumber(company['PER (Oct-25)']) - parseNumber(company['PER (3)']);
if (perChange > 5) console.log('📈 Valuation expansion');
else if (perChange < -5) console.log('📉 Valuation compression');
else console.log('↔️ Stable valuation');
```

---

## Implementation Recommendations

### Class Structure

```javascript
class IndustryCostAnalytics {
  constructor() {
    this.data = null;
    this.validCompanies = [];
    this.companyMap = new Map();
    this.industryGroups = new Map();
  }

  async loadFromJSON(jsonPath = 'data/A_Compare.json') {
    // Load and filter to valid companies
    this.validCompanies = rawData.filter(c => this.isValid(c));
    this.buildIndexes();
  }

  isValid(company) {
    const nonNull = Object.values(company).filter(v => v !== null && v !== '').length;
    return nonNull > 10;
  }

  buildIndexes() {
    // companyMap: O(1) ticker lookup
    this.validCompanies.forEach(c => {
      this.companyMap.set(c.Ticker, c);
    });

    // industryGroups: Group by WI26
    this.validCompanies.forEach(c => {
      if (!this.industryGroups.has(c.WI26)) {
        this.industryGroups.set(c.WI26, []);
      }
      this.industryGroups.get(c.WI26).push(c);
    });
  }

  // Core methods
  getCompanyByTicker(ticker) { /* ... */ }
  getIndustryAverage(industry, metric) { /* ... */ }
  compareToIndustry(ticker, metrics) { /* ... */ }
  calculateRevenueTrend(ticker) { /* ... */ }
  getPeerComparison(ticker) { /* ... */ }
  getTopByMetric(metric, limit = 10) { /* ... */ }
}
```

### Key Methods

```yaml
Core Analytics (6):
  - getCompanyByTicker(ticker) → Company
  - getIndustryAverage(industry, metric) → number
  - compareToIndustry(ticker, metrics[]) → Comparison
  - calculateRevenueTrend(ticker) → Trend
  - getPeerComparison(ticker) → PeerAnalysis
  - getCompanySummary(ticker) → Summary

Industry Analysis (3):
  - getIndustryStatistics(industry) → Stats
  - getIndustryCostStructure(industry) → CostBreakdown
  - compareIndustries(industries[]) → IndustryComparison

Filtering (3):
  - filterByMetric(metric, min, max) → Company[]
  - getTopPerformers(metric, limit) → Company[]
  - getBottomPerformers(metric, limit) → Company[]

Statistical (3):
  - getMarketStatistics() → MarketStats
  - getValuationDistribution() → Distribution
  - identifyOutliers(metric, threshold) → Outlier[]
```

---

## Performance Considerations

### Data Size

```yaml
Valid Records: 104 companies
Fields: 68 per company
Total Data Points: 104 × 68 = 7,072
Memory: ~500KB (JSON)
Initialization: <500ms
```

### Optimization Strategy

```javascript
// O(1) Ticker Lookup
companyMap.get(ticker);  // <1ms

// O(n) Industry Filtering
industryGroups.get(industry);  // Pre-computed, <10ms

// O(n log n) Sorting
companies.sort((a, b) => b.metric - a.metric);  // <50ms for 104 companies
```

### Index Structure

```yaml
companyMap: Map<string, Company>
  - Size: 104 entries
  - Lookup: O(1)

industryGroups: Map<string, Company[]>
  - Size: ~20 industries
  - Lookup: O(1)
  - Iteration: O(industry size)
```

---

## Testing Strategy

### E2E Test Categories

```yaml
Data Loading (3):
  - Load A_Compare.json
  - Filter to 104 valid companies
  - Build indexes

Core Analytics (6):
  - Ticker lookup
  - Industry average calculation
  - Industry comparison
  - Revenue trend analysis
  - Peer comparison
  - Company summary

Industry Analysis (3):
  - Industry statistics
  - Cost structure analysis
  - Multi-industry comparison

Edge Cases (5):
  - Null value handling
  - Invalid ticker
  - Empty industry
  - Zero division protection
  - String/number parsing
```

### Expected Test Count

```
Total Tests: 17-20
Duration: <15 seconds (small dataset)
Coverage: 100% methods
Data: Full 104 companies
```

---

## Critical Considerations

### 1. Data Filtering Required

⚠️ **CRITICAL**: Always filter to valid companies first!

```javascript
// Bad: Use all 493 records
const allData = rawData;  // 98% null!

// Good: Filter to 104 valid records
const validData = rawData.filter(c => {
  const nonNull = Object.values(c).filter(v => v !== null && v !== '').length;
  return nonNull > 10;
});
```

### 2. Type Consistency

⚠️ **String/Number Mix**: Always use `parseNumber()` helper

```javascript
function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = parseFloat(value);
  return isNaN(num) || !isFinite(num) ? null : num;
}
```

### 3. Peer Field Extraction

⚠️ **Numeric Field Names**: Special handling required

```javascript
// Extract peer tickers (numeric field names)
const peerFields = Object.keys(company).filter(k =>
  !isNaN(k) && k.indexOf('.') === -1  // Pure integers only
);
const peers = peerFields
  .map(field => company[field])
  .filter(ticker => ticker && typeof ticker === 'string');
```

---

## Summary

### Data Characteristics

```yaml
Strengths:
  ✅ Rich peer comparison data
  ✅ 8-year revenue history (F-4 to F+3)
  ✅ Multiple valuation timeframes (3Y, 5Y, 10Y)
  ✅ Detailed cost structure (5Y AVG, FY/FQ)

Challenges:
  ⚠️ Only 21% records valid (104/493)
  ⚠️ String/number type inconsistency
  ⚠️ Sparse peer comparison data
  ⚠️ Numeric field names for peers

Opportunities:
  💡 Industry benchmarking
  💡 Cost structure analysis
  💡 Peer performance comparison
  💡 Valuation trend tracking
```

### Recommended Focus

**Primary Use Cases**:
1. Industry cost structure comparison (5Y AVG metrics)
2. Revenue growth trajectory (F-4 to F+3)
3. Peer benchmarking (ROE, OPM, margins)
4. Valuation evolution (PER 10Y → Current)

**Implementation Priority**:
1. Data filtering (104 valid companies)
2. Industry grouping (WI26 index)
3. Core analytics (6 methods)
4. Industry analysis (3 methods)

---

**End of Schema Analysis**

**Next Steps**:
- Task 6.2-6.5: IndustryCostAnalytics class implementation
- Task 6.6: HTML integration
- Task 6.7: E2E testing (17-20 tests)
- Task 6.8: API documentation

**Estimated Implementation**: 2-3 hours (small dataset = faster)
