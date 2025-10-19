# T_Chk Schema Analysis - EPS Monitoring Data

**작성일**: 2025-10-19
**Module**: Sprint 4 Module 5 - EPSMonitoringAnalytics
**Data Source**: T_Chk.json
**Records**: 1,250 companies
**Fields**: 77 total (23 metadata + 54 time-series)

---

## 📊 Executive Summary

### Data Overview
```yaml
Purpose: EPS 추정치 변화 추적 및 신뢰도 모니터링
Records: 1,250 companies (Core Universe)
Time Range: 2024-09-27 ~ 2025-10-03 (371 days)
Update Frequency: Daily (54 historical snapshots)
Key Metric: FY (Fiscal Year) EPS forecast changes
```

### Critical Findings
```yaml
⚠️ CRITICAL:
  - 날짜 필드가 Excel serial number (45933 = 2025-10-03)
  - 최신 데이터일수록 null 많음 (39.5%)
  - FY 값은 absolute number (not percentage)
  - CHK = Change rate (변화율)

✅ Quality:
  - Base fields: 완전 populated
  - Time-series: 60.5% populated (756/1250 companies)
  - Data integrity: Good (validated)
```

### Structure
```
T_Chk.json = {
  "data": [
    {
      // Metadata (23 fields)
      "Ticker": "NVDA",
      "Corp": "NVIDIA",
      "FY 0": 2.94,
      "FY+1": 2.95,
      "CHK": -0.0034,

      // Time-series (54 fields, Excel serial dates)
      "45933": 45658,  // 2025-10-03 snapshot
      "45926": 45658,  // 2025-09-26 snapshot
      ...
      "45562.0": 45292.0  // 2024-09-27 snapshot
    }
  ]
}
```

---

## 🔍 Field Catalog (77 fields)

### Group 1: Identity Fields (4 fields)

#### 1. Ticker (string)
```yaml
Description: Stock ticker symbol
Type: string
Required: true
Unique: true
Examples: "NVDA", "AAPL", "MSFT", "GOOGL"
Usage: Primary key for company lookup
```

#### 2. Corp (string)
```yaml
Description: Company name
Type: string
Required: true
Examples: "NVIDIA", "Apple", "Microsoft", "Alphabet"
Usage: Display name, search
```

#### 3. Exchange (string)
```yaml
Description: Stock exchange
Type: string
Required: true
Values: "NASDAQ", "NYSE", "KOSPI", "KOSDAQ"
Usage: Market classification
```

#### 4. WI26 (string)
```yaml
Description: Industry classification (WICS Level 2)
Type: string
Required: true
Examples: "반도체", "소프트웨어", "자동차"
Usage: Industry grouping, sector analysis
```

---

### Group 2: Company Metadata (6 fields)

#### 5. FY O (string)
```yaml
Description: Fiscal year origin (Excel serial)
Type: string (Excel serial number)
Format: "45658" = date
Example: "45658" = 2024-12-31
Usage: Fiscal year reference date
```

#### 6. 설립 (float)
```yaml
Description: Founded year
Type: float
Range: 1900 - 2024
Example: 1998.0 (NVIDIA)
Usage: Company age calculation
```

#### 7. 현재가 (string)
```yaml
Description: Current stock price
Type: string (price as string)
Format: "187.62"
Example: "187.62" (USD)
Usage: Current valuation reference
```

#### 8. 전일대비 (float)
```yaml
Description: Daily change rate
Type: float (ratio)
Range: -1.0 to 1.0
Example: -0.0067 = -0.67%
Usage: Short-term momentum
```

#### 9. 전주대비 (float)
```yaml
Description: Weekly change rate
Type: float (ratio)
Range: -1.0 to 1.0
Example: 0.0 = 0%
Usage: Weekly momentum
```

#### 10. (USD mn) (float)
```yaml
Description: Market capitalization (USD millions)
Type: float
Range: 100+ to 4,000,000+
Example: 4,559,166.0 (NVIDIA ~$4.5T)
Usage: Company size classification
```

---

### Group 3: Financial Metrics (7 fields)

#### 11. ROE (Fwd) (float)
```yaml
Description: Forward Return on Equity
Type: float (ratio)
Range: -1.0 to 2.0
Example: 0.7943 = 79.43%
Usage: Profitability metric
```

#### 12. OPM (Fwd) (float)
```yaml
Description: Forward Operating Profit Margin
Type: float (ratio)
Range: -0.5 to 1.0
Example: 0.6561 = 65.61%
Usage: Operational efficiency
```

#### 13. CCC (FY 0) (float)
```yaml
Description: Cash Conversion Cycle (days)
Type: float (days)
Range: -100 to 500
Example: 56.17 days
Usage: Working capital efficiency
```

---

### Group 4: Valuation Metrics (6 fields)

#### 14. PER (Oct-25) (string)
```yaml
Description: Price-to-Earnings Ratio (as of Oct 2025)
Type: string (number as string)
Range: 5 to 100+
Example: "46.45"
Usage: Valuation benchmark
```

#### 15. PER (1~5) (string)
```yaml
Description: PER quintile classification
Type: string (categorical)
Values: "PER (1)", "PER (2)", "PER (3)", "PER (4)", "PER (5)"
Example: "PER (2)" = 2nd quintile (cheap to expensive)
Usage: Relative valuation classification
```

#### 16. % (float)
```yaml
Description: PER percentile or change rate
Type: float (ratio)
Range: -1.0 to 1.0
Example: 0.1545 = 15.45%
Usage: PER context or change
```

#### 17. PBR (Oct-25) (string)
```yaml
Description: Price-to-Book Ratio (as of Oct 2025)
Type: string (number as string)
Range: 0.5 to 50+
Example: "35.72"
Usage: Book value benchmark
```

#### 18. PBR (1~5) (string)
```yaml
Description: PBR quintile classification
Type: string (categorical)
Values: "PBR (1)", "PBR (2)", "PBR (3)", "PBR (4)", "PBR (5)"
Example: "PBR (5)" = 5th quintile (expensive)
Usage: Relative book value classification
```

#### 19. %.1 (float)
```yaml
Description: PBR percentile or change rate
Type: float (ratio)
Range: -1.0 to 1.0
Example: -0.0359 = -3.59%
Usage: PBR context or change
```

---

### Group 5: EPS Forecast (3 fields) ⭐ CRITICAL

#### 20. Update (string)
```yaml
Description: Last update date (Excel serial)
Type: string (Excel serial number)
Format: "45716" = date
Example: "45716" = 2025-02-25
Usage: Data freshness check
```

#### 21. FY 0 (float) ⭐
```yaml
Description: Current fiscal year EPS forecast
Type: float (absolute EPS value)
Range: -10.0 to 100.0
Example: 2.94 (NVIDIA FY0 EPS = $2.94)
Usage: Base EPS reference
Unit: USD per share
```

#### 22. FY+1 (float) ⭐
```yaml
Description: Next fiscal year EPS forecast
Type: float (absolute EPS value)
Range: -10.0 to 100.0
Example: 2.95 (NVIDIA FY+1 EPS = $2.95)
Usage: Future EPS expectation
Unit: USD per share
```

#### 23. CHK (float) ⭐⭐⭐ KEY METRIC
```yaml
Description: EPS forecast change rate
Type: float (ratio)
Calculation: (FY 0 latest - FY 0 previous) / FY 0 previous
Range: -1.0 to 1.0
Example: -0.0034 = -0.34% (slight downward revision)
Usage: Primary change detection metric
Interpretation:
  - CHK > 0.05: Strong upward revision (bullish)
  - CHK > 0.01: Mild upward revision
  - -0.01 < CHK < 0.01: Stable
  - CHK < -0.01: Mild downward revision
  - CHK < -0.05: Strong downward revision (bearish)
```

---

### Group 6: Time-Series EPS History (54 fields) ⭐⭐⭐ CORE DATA

**Structure**: Excel serial date as field name → FY value

#### Date Field Format
```yaml
Field Names: "45933", "45926", ..., "45562.0"
Date Range: 2025-10-03 → 2024-09-27
Total Days: 371 days
Frequency: Weekly (~7 day intervals)
Count: 54 snapshots
```

#### Date Fields (54 total)
```
Latest → Oldest:

45933     = 2025-10-03  (FY forecast on this date)
45926     = 2025-09-26
45919     = 2025-09-19
45912     = 2025-09-12
45905     = 2025-09-05
45898     = 2025-08-29
45891     = 2025-08-22
45884.0   = 2025-08-15
45877.0   = 2025-08-08
45870     = 2025-08-01
45863.0   = 2025-07-25
45856.0   = 2025-07-18
45849.0   = 2025-07-11
45841.0   = 2025-07-03
45835.0   = 2025-06-27
45828.0   = 2025-06-20
45821.0   = 2025-06-13
45814.0   = 2025-06-06
45807.0   = 2025-05-30
45800.0   = 2025-05-23
45793.0   = 2025-05-16
45786.0   = 2025-05-09
45779.0   = 2025-05-02
45772.0   = 2025-04-25
45764.0   = 2025-04-17
45758.0   = 2025-04-11
45751.0   = 2025-04-04
45744.0   = 2025-03-28
45737.0   = 2025-03-21
45730.0   = 2025-03-14
45723.0   = 2025-03-07
45716.0   = 2025-02-28
45709.0   = 2025-02-21
45702     = 2025-02-14
45695     = 2025-02-07
45688.0   = 2025-01-31
45681.0   = 2025-01-24
45674.0   = 2025-01-17
45667     = 2025-01-10
45660.0   = 2025-01-03  ← 39.5% null starts
45653.0   = 2024-12-27
45646.0   = 2024-12-20
45639.0   = 2024-12-13
45632.0   = 2024-12-06
45625.0   = 2024-11-29
45618.0   = 2024-11-22
45611.0   = 2024-11-15
45604.0   = 2024-11-08
45597.0   = 2024-11-01
45590.0   = 2024-10-25
45583.0   = 2024-10-18
45576.0   = 2024-10-11
45569.0   = 2024-10-04
45562.0   = 2024-09-27  (Oldest)
```

#### Value Interpretation
```yaml
Field: "45933"
Value: 45658 (NOT date, but FY forecast value!)

⚠️ CRITICAL DISCOVERY:
  - Field name = Date of snapshot (Excel serial)
  - Field value = FY forecast AT that date (also Excel serial!)

Example (NVDA):
  "45933": 45658  → On 2025-10-03, FY forecast was 45658
  "45562.0": 45292.0 → On 2024-09-27, FY forecast was 45292

Change: 45658 - 45292 = 366 (forecast increased!)

Calculation:
  Change rate = (45658 - 45292) / 45292 = 0.0080 = 0.80% increase
```

#### Null Pattern
```yaml
Recent dates (2025-01-03 onwards): 39.5% null (494/1250 companies)
Older dates: Better coverage (~60-70% populated)

Reason: Not all companies have recent analyst updates

Impact:
  - Use non-null companies for analysis
  - Filter out companies with >80% null in time-series
  - Focus on actively covered companies (756/1250)
```

---

## 🧮 Key Calculations

### 1. EPS Change Detection

#### 1-Week Change
```javascript
function calculate1WeekChange(company) {
  const latest = company['45933'];  // 2025-10-03
  const week_ago = company['45926'];  // 2025-09-26

  if (!latest || !week_ago) return null;

  return (latest - week_ago) / week_ago;
}
```

#### 1-Month Change
```javascript
function calculate1MonthChange(company) {
  const latest = company['45933'];  // 2025-10-03
  const month_ago = company['45905'];  // ~1 month ago

  if (!latest || !month_ago) return null;

  return (latest - month_ago) / month_ago;
}
```

#### 3-Month Change
```javascript
function calculate3MonthChange(company) {
  const latest = company['45933'];  // 2025-10-03
  const three_months = company['45842'];  // ~3 months

  if (!latest || !three_months) return null;

  return (latest - three_months) / three_months;
}
```

### 2. Trend Analysis

#### Trend Detection Logic
```javascript
function detectTrend(company, window = 4) {
  // Get recent 4 weeks
  const dates = ['45933', '45926', '45919', '45912'];
  const values = dates.map(d => company[d]).filter(v => v !== null);

  if (values.length < 3) return 'insufficient_data';

  // Linear regression slope
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < values.length; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }

  const slope = (values.length * sumXY - sumX * sumY) /
                (values.length * sumX2 - sumX * sumX);

  const avgValue = sumY / values.length;
  const normalizedSlope = slope / avgValue;

  if (normalizedSlope > 0.02) return 'uptrend';
  if (normalizedSlope < -0.02) return 'downtrend';
  return 'stable';
}
```

### 3. Alert Triggers

#### Rapid Change Alert
```javascript
function checkRapidChange(company) {
  const change1w = calculate1WeekChange(company);

  if (!change1w) return null;

  if (Math.abs(change1w) > 0.05) {
    return {
      severity: 'high',
      direction: change1w > 0 ? 'upgrade' : 'downgrade',
      magnitude: Math.abs(change1w),
      message: `EPS forecast ${change1w > 0 ? 'upgraded' : 'downgraded'} by ${(Math.abs(change1w) * 100).toFixed(2)}% in 1 week`
    };
  }

  if (Math.abs(change1w) > 0.02) {
    return {
      severity: 'medium',
      direction: change1w > 0 ? 'upgrade' : 'downgrade',
      magnitude: Math.abs(change1w),
      message: `Moderate EPS revision: ${(change1w * 100).toFixed(2)}%`
    };
  }

  return null;
}
```

---

## 📈 Data Quality Analysis

### Coverage Statistics
```yaml
Total Companies: 1,250
Base Fields (23): 100% populated
Time-Series Fields (54): Variable

Recent Data (45933 ~ 45660):
  - Populated: 756 companies (60.5%)
  - Null: 494 companies (39.5%)
  - Reason: No recent analyst coverage

Historical Data (45660 ~ 45562):
  - Better coverage (70-80%)
  - More stable companies tracked
```

### Null Handling Strategy
```yaml
Filtering:
  - Option 1: Require ≥20% time-series populated (>=11/54 fields)
  - Option 2: Require ≥50% recent data (last 10 snapshots)
  - Recommended: Option 2 (focus on active coverage)

Companies with Active Coverage: ~756/1250 (60.5%)
Companies with Sparse Data: ~494/1250 (39.5%)
```

### Data Validation Rules
```yaml
1. Ticker must be unique
2. FY 0, FY+1 must be numeric or null
3. CHK = (FY 0 - previous FY 0) / previous FY 0
4. Time-series dates descending order
5. Values should be positive for most companies
6. Extreme values (>100 EPS) flag for review
```

---

## 🎯 Module 5 Implementation Guide

### Class Structure
```javascript
class EPSMonitoringProvider extends BaseAnalytics {
  constructor() {
    super();
    this.companies = [];
    this.companyMap = new Map();  // ticker → company
    this.activeCompanies = [];    // companies with recent data
    this.dateFields = [];         // sorted date fields
  }

  async loadFromJSON(path) { }
  processData(rawData) { }
  buildIndexes() { }

  // Core Analytics
  getCompanyByTicker(ticker) { }
  getEPSHistory(ticker) { }
  calculateChangeRate(ticker, period) { }
  detectTrend(ticker, window) { }

  // Alerts
  identifyRapidChanges(threshold) { }
  getUpgradedCompanies(period, minChange) { }
  getDowngradedCompanies(period, minChange) { }

  // Statistics
  getMarketSentiment() { }
  getIndustrySentiment(industry) { }
}
```

### Index Structures
```javascript
buildIndexes() {
  // Ticker index
  for (const company of this.companies) {
    this.companyMap.set(company.Ticker, company);
  }

  // Active companies (≥50% recent data)
  this.activeCompanies = this.companies.filter(c => {
    const recentDates = this.dateFields.slice(0, 10);
    const populated = recentDates.filter(d => c[d] !== null).length;
    return populated >= 5;  // ≥50%
  });

  // Sort date fields
  this.dateFields = Object.keys(this.companies[0])
    .filter(k => k.match(/^\d+(\.\d)?$/))
    .sort((a, b) => parseFloat(b) - parseFloat(a));  // descending
}
```

### Performance Targets
```yaml
Initialization: <3000ms (1,250 companies, 54 dates)
Ticker Lookup: O(1) <1ms
EPS History: O(1) <5ms
Change Calculation: O(k) <10ms (k = window size)
Trend Detection: O(k) <15ms
Market Sentiment: O(n) <200ms (n = active companies)
```

---

## 🔍 Sample Data

### NVIDIA (NVDA)
```json
{
  "Ticker": "NVDA",
  "Corp": "NVIDIA",
  "Exchange": "NASDAQ",
  "WI26": "반도체",
  "설립": 1998.0,
  "(USD mn)": 4559166.0,
  "FY 0": 2.94,
  "FY+1": 2.95,
  "CHK": -0.0034,
  "45933": 45658,
  "45926": 45658,
  "45562.0": 45292.0
}
```

**Analysis**:
- Market cap: $4.5T
- Current FY EPS: $2.94
- Next FY EPS: $2.95
- Recent change: -0.34% (slight downward revision)
- Historical: 45658 → 45292 (increasing trend overall)

---

## 📝 Development Checklist

### Task 5.2: Provider Class
- [ ] EPSMonitoringProvider extends BaseAnalytics
- [ ] loadFromJSON() with date field parsing
- [ ] processData() with Excel serial conversion
- [ ] buildIndexes() with active company filtering

### Task 5.3: Change Detection
- [ ] calculate1WeekChange()
- [ ] calculate1MonthChange()
- [ ] calculate3MonthChange()
- [ ] Null safety for all calculations

### Task 5.4: Trend Analysis
- [ ] detectTrend() with linear regression
- [ ] getTrendStrength() (slope magnitude)
- [ ] getTrendConfidence() (R² calculation)

### Task 5.5: Alert System
- [ ] identifyRapidChanges(threshold = 0.05)
- [ ] getUpgradedCompanies(period, minChange)
- [ ] getDowngradedCompanies(period, minChange)
- [ ] Alert priority classification

### Task 5.6: HTML Integration
- [ ] Module loading in stock_analyzer.html
- [ ] Console testing

### Task 5.7: E2E Testing
- [ ] 30+ test cases
- [ ] Full 1,250 dataset (no .slice())
- [ ] Active companies filtering test
- [ ] Change calculation accuracy
- [ ] Trend detection validation

### Task 5.8: API Documentation
- [ ] 1,000+ lines complete reference
- [ ] All 10+ methods documented
- [ ] Performance section
- [ ] Best practices
- [ ] Troubleshooting

---

## 🚀 Next Steps

1. ✅ **Task 5.1 Complete**: Schema Analysis (이 문서)
2. ⏳ **Task 5.2**: EPSMonitoringProvider Class Design
3. ⏳ **Task 5.3-5.5**: Implementation
4. ⏳ **Task 5.6-5.8**: Integration, Testing, Documentation

**Status**: Ready for Task 5.2!
