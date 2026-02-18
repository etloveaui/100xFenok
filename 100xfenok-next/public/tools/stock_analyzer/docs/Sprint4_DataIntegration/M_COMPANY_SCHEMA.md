# M_Company.json - Data Schema Reference

**작성일**: 2025-10-18
**Task**: Module 1 Task 1.1 - Data Schema Analysis
**데이터 소스**: M_Company.csv → M_Company.json

---

## 📊 Overview

**총 레코드 수**: 6,176 companies
**총 필드 수**: 33 fields
**데이터 구조**: `{ metadata, data: [...] }`

**샘플 기업**:
1. NVDA (NVIDIA, NASDAQ, 반도체, $4,559B)
2. MSFT (Microsoft, NASDAQ, 소프트웨어, $3,846B)
3. AAPL (Apple, NASDAQ, IT하드웨어, $3,829B)
4. GOOG (Alphabet C, NASDAQ, 소프트웨어, $2,973B)
5. GOOGL (Alphabet A, NASDAQ, 소프트웨어, $2,973B)

---

## 🏗️ Data Structure

```json
{
  "metadata": {
    "source": "M_Company.csv",
    "recordCount": 6176
  },
  "data": [
    {
      "Ticker": "NVDA",
      "Corp": "NVIDIA",
      "Exchange": "NASDAQ",
      // ... 30 more fields
    }
  ]
}
```

---

## 📋 Field Classification (33 fields)

### 1. Identity Fields (3 fields)

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| **Ticker** | string | ✅ | Stock ticker symbol | "NVDA" |
| **Corp** | string | ✅ | Corporation name | "NVIDIA" |
| **Exchange** | string | ✅ | Stock exchange | "NASDAQ" |

**Validation Rules**:
- Ticker: Non-empty, unique, uppercase
- Corp: Non-empty
- Exchange: One of [NASDAQ, NYSE, KOSPI, KOSDAQ, ...]

---

### 2. Company Information (3 fields)

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| **WI26** | string | ✅ | Industry (Korean) | "반도체" |
| **결산** | string | ⚠️ | Fiscal year end month | "Jan" |
| **설립** | number | ⚠️ | Founding year | 1998.0 |

**Validation Rules**:
- WI26: Non-empty Korean string
- 결산: Month abbreviation (Jan-Dec)
- 설립: Year (1800-2025)

---

### 3. Valuation Fields (2 fields)

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| **Price** | string | ✅ | Current stock price (USD) | "187.62" |
| **(USD mn)** | number | ✅ | Market Cap (millions USD) | 4559166.0 |

**Validation Rules**:
- Price: Numeric string > 0
- (USD mn): Number > 0

**Data Quality Issues**:
- ⚠️ Price is string, should be number
- Need auto-correction: "187.62" → 187.62

---

### 4. Financial Ratios (4 fields)

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| **ROE (Fwd)** | string | ⚠️ | Return on Equity (Forward) | "0.7943" |
| **OPM (Fwd)** | string | ⚠️ | Operating Profit Margin (Fwd) | "0.6561" |
| **PER (Fwd)** | string | ⚠️ | Price-to-Earnings Ratio (Fwd) | "31.69" |
| **PBR (Fwd)** | string | ⚠️ | Price-to-Book Ratio (Fwd) | "19.45" |

**Validation Rules**:
- ROE: -1.0 to 3.0 (decimal format, -100% to 300%)
- OPM: -1.0 to 1.0 (decimal format, -100% to 100%)
- PER: 0 to 1000
- PBR: 0 to 100

**Data Quality Issues**:
- ⚠️ All stored as strings, should be numbers
- Need auto-correction for percentage format
  - 0.7943 → 79.43% (display)
  - 31.69 → 31.69 (already correct)

---

### 5. Performance - Group 1 (5 fields)

**Absolute Returns** (추정)

| Field | Type | Description | Range |
|-------|------|-------------|-------|
| **W** | number | Weekly return | -1.0 to 3.0 |
| **1 M** | number | 1-month return | -1.0 to 3.0 |
| **3 M** | number | 3-month return | -1.0 to 3.0 |
| **6 M** | number | 6-month return | -1.0 to 3.0 |
| **12 M** | number | 12-month return | -1.0 to 3.0 |

**Example (NVDA)**:
- W: 0.0529 (5.29%)
- 1 M: 0.0996 (9.96%)
- 3 M: 0.1775 (17.75%)
- 6 M: 0.8430 (84.30%)
- 12 M: 0.5272 (52.72%)

---

### 6. Performance - Group 2 (5 fields)

**Relative Returns** (추정 - 벤치마크 대비?)

| Field | Type | Description | Range |
|-------|------|-------------|-------|
| **W.1** | number | Weekly relative return | -1.0 to 1.0 |
| **1 M.1** | number | 1-month relative return | -1.0 to 1.0 |
| **3 M.1** | number | 3-month relative return | -1.0 to 1.0 |
| **6 M.1** | number | 6-month relative return | -1.0 to 1.0 |
| **12 M.1** | number | 12-month relative return | -1.0 to 1.0 |

**Example (NVDA)**:
- W.1: -0.0224 (-2.24% vs benchmark)
- 1 M.1: -0.0597 (-5.97%)
- 3 M.1: 0.0172 (1.72%)

---

### 7. Performance - Group 3 (5 fields)

**Industry Relative Returns** (추정 - 산업 평균 대비?)

| Field | Type | Description | Range |
|-------|------|-------------|-------|
| **W.2** | number | Weekly industry relative | -1.0 to 1.0 |
| **1 M.2** | number | 1-month industry relative | -1.0 to 1.0 |
| **3 M.2** | number | 3-month industry relative | -1.0 to 1.0 |
| **6 M.2** | number | 6-month industry relative | -1.0 to 1.0 |
| **12 M.2** | number | 12-month industry relative | -1.0 to 1.0 |

**Example (NVDA)**:
- W.2: 0.0296 (2.96% vs industry)
- 1 M.2: 0.0296 (2.96%)
- 12 M.2: 0.5871 (58.71%)

---

### 8. Historical Data (6 fields)

**Excel Date Serials** (날짜 → 가격 추정)

| Field | Type | Description | Excel Date | Example Value |
|-------|------|-------------|------------|---------------|
| **45933** | number | Price on date | 2025-10-03 | 5.92 |
| **45926.0** | number | Price on date | 2025-09-26 | 5.75 |
| **45903.0** | number | Price on date | 2025-09-03 | 5.75 |
| **45841.0** | number | Price on date | 2025-07-03 | 5.06 |
| **45750.0** | number | Price on date | 2025-04-03 | 4.82 |
| **45568.0** | number | Price on date | 2024-10-03 | 3.73 |

**Note**: Excel serial dates (45933 = Days since 1900-01-01)

---

## 🔧 Required Fields

### Critical (Must not be null)
- Ticker
- Corp
- Exchange
- WI26 (Industry)

### Important (Nullable but should validate)
- (USD mn) - Market Cap
- Price
- ROE/OPM/PER/PBR (Fwd)

### Optional
- 결산 (Fiscal year end)
- 설립 (Founding year)
- Performance metrics (W, 1M, 3M, etc.)
- Historical data

---

## 🚨 Data Quality Issues

### Issue 1: String Numbers
**Fields**: Price, ROE/OPM/PER/PBR (Fwd)
**Problem**: Stored as strings instead of numbers
**Impact**: Cannot perform numeric operations directly
**Solution**: Auto-convert to numbers in processData()

```javascript
processData(rawData) {
  return rawData.map(company => ({
    ...company,
    price: parseFloat(company.Price),
    roe: parseFloat(company['ROE (Fwd)']),
    opm: parseFloat(company['OPM (Fwd)']),
    per: parseFloat(company['PER (Fwd)']),
    pbr: parseFloat(company['PBR (Fwd)']),
  }));
}
```

---

### Issue 2: Percentage Format Confusion
**Fields**: ROE, OPM
**Problem**: Stored as decimals (0.7943) but might be percentages
**Current**: 0.7943 = 79.43%
**Solution**: Keep as decimal internally, display as percentage

---

### Issue 3: Korean Field Names
**Fields**: WI26, 결산, 설립
**Problem**: Non-ASCII field names
**Impact**: None (JavaScript handles UTF-8)
**Decision**: Keep original names, add English aliases

```javascript
{
  ...company,
  industry: company.WI26,
  fiscalYearEnd: company['결산'],
  foundingYear: company['설립'],
}
```

---

## 📊 Field Usage Statistics

**Total fields**: 33
**String fields**: 10 (30%)
**Numeric fields**: 23 (70%)

**Critical fields (Identity)**: 3
**Company info**: 3
**Valuation**: 2
**Financial ratios**: 4
**Performance metrics**: 15 (3 groups × 5 periods)
**Historical data**: 6

---

## ✅ Validation Rules Summary

### Identity
- Ticker: /^[A-Z0-9]{1,10}$/ (uppercase, 1-10 chars)
- Corp: Non-empty string
- Exchange: Whitelist validation

### Financial
- Market Cap: > 0 (millions USD)
- Price: > 0 (USD)
- ROE: -100% to 300% (decimal: -1.0 to 3.0)
- OPM: -100% to 100% (decimal: -1.0 to 1.0)
- PER: 0 to 1000
- PBR: 0 to 100

### Performance
- All returns: -100% to 300% (decimal: -1.0 to 3.0)

---

## 🎯 Next Steps

### Immediate (Task 1.2)
1. ✅ Schema analysis complete
2. ⏳ Design CompanyMasterProvider class
3. ⏳ Define indexes (ticker, industry, exchange)
4. ⏳ Define methods (get, filter, search)

### Future (Task 1.3-1.4)
1. Implement data normalization
2. Auto-convert string numbers to numbers
3. Add English field aliases
4. Implement validation

---

**작성자**: Claude Code (Sonnet 4.5)
**Task 상태**: Module 1 Task 1.1 완료 ✅
**다음 Task**: Task 1.2 - Provider Class Design
