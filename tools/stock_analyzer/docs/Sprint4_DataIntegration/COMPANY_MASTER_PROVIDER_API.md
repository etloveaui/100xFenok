# CompanyMasterProvider API Documentation

**Module**: `modules/CompanyMasterProvider.js`
**Version**: 1.0.0
**Last Updated**: 2025-10-18
**Data Source**: M_Company.json (6,176 companies)

---

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [API Reference](#api-reference)
4. [Data Structures](#data-structures)
5. [Performance Characteristics](#performance-characteristics)
6. [Usage Examples](#usage-examples)
7. [Error Handling](#error-handling)
8. [Best Practices](#best-practices)
9. [Integration Guide](#integration-guide)
10. [Troubleshooting](#troubleshooting)

---

## Overview

### Purpose

CompanyMasterProvider is a high-performance data provider for accessing and querying company master data. It provides O(1) lookup capabilities for ticker-based queries and efficient indexed access for industry and exchange-based filtering.

### Key Features

- **Fast Loading**: Loads 6,176 companies in < 5 seconds
- **O(1) Ticker Lookup**: Instant company retrieval by ticker symbol
- **Indexed Queries**: Pre-built indexes for industry and exchange filtering
- **Data Normalization**: Automatic type conversion and field aliasing
- **Flexible Filtering**: Market cap and PER range filtering
- **Search Capability**: Case-insensitive company name search
- **Statistics**: Built-in aggregation and statistical methods

### Data Source

- **File**: `data/M_Company.json`
- **Records**: 6,176 companies
- **Fields**: 33 fields per company
- **Coverage**: Global markets (NASDAQ, NYSE, KOSPI, KOSDAQ, etc.)

### Use Cases

- Stock screening and filtering
- Company information lookup
- Industry and sector analysis
- Market capitalization analysis
- Comparative company research
- Portfolio construction

---

## Quick Start

### Installation

```html
<!-- Include in your HTML -->
<script src="modules/CompanyMasterProvider.js"></script>
```

### Basic Usage

```javascript
// 1. Create instance
const provider = new CompanyMasterProvider();

// 2. Load data
await provider.loadFromJSON('data/M_Company.json');

// 3. Query data
const nvidia = provider.getCompanyByTicker('NVDA');
console.log(nvidia.corp);        // "NVIDIA"
console.log(nvidia.marketCap);   // 4559166.0 (millions USD)

const semiconductors = provider.getCompaniesByIndustry('반도체');
console.log(`Found ${semiconductors.length} semiconductor companies`);
```

### Browser Console Test

```javascript
// Test in browser console
window.companyMaster = new CompanyMasterProvider();
await window.companyMaster.loadFromJSON('data/M_Company.json');

// Quick tests
window.companyMaster.getCompanyByTicker('NVDA');
window.companyMaster.getCompaniesByIndustry('반도체');
window.companyMaster.getStatistics();
```

---

## API Reference

### Constructor

#### `new CompanyMasterProvider()`

Creates a new instance of the CompanyMasterProvider.

**Parameters**: None

**Returns**: `CompanyMasterProvider` instance

**Example**:
```javascript
const provider = new CompanyMasterProvider();
```

---

### Data Loading

#### `loadFromJSON(jsonPath)`

Loads and initializes company data from a JSON file.

**Parameters**:
- `jsonPath` (string, optional): Path to JSON file. Default: `'data/M_Company.json'`

**Returns**: `Promise<boolean>` - `true` if successful, `false` on error

**Complexity**: O(n) where n = number of companies

**Side Effects**:
- Populates `companies` array
- Sets `metadata` object
- Builds all indexes (ticker, industry, exchange)
- Sets `initialized` flag to `true`

**Example**:
```javascript
const success = await provider.loadFromJSON('data/M_Company.json');
if (success) {
    console.log('Data loaded successfully');
} else {
    console.error('Failed to load data');
}
```

**Edge Cases**:
- File not found: Returns `false`, logs error
- Invalid JSON structure: Returns `false`, logs error
- Network error: Returns `false`, logs error

---

#### `processData(rawData)`

Processes and normalizes raw JSON data.

**Parameters**:
- `rawData` (Array): Raw company data array from JSON

**Returns**: `Array` - Processed company objects with normalized fields

**Complexity**: O(n)

**Transformations**:
- Converts string numbers to actual numbers (`Price`, `ROE`, `OPM`, `PER`, `PBR`)
- Adds English field aliases (`industry`, `fiscalYearEnd`, `foundingYear`)
- Structures performance data into nested objects

**Example**:
```javascript
const rawData = [
    {
        Ticker: "NVDA",
        Price: "187.62",
        "ROE (Fwd)": "0.7943",
        WI26: "반도체"
    }
];

const processed = provider.processData(rawData);
// Result:
// {
//     ticker: "NVDA",
//     price: 187.62,              // number, not string
//     roe: 0.7943,                // number
//     industry: "반도체",          // alias for WI26
//     returns: { ... },           // structured object
//     ...
// }
```

**Edge Cases**:
- Invalid number strings: Converted to `null`
- Missing fields: Preserved as-is

---

#### `buildIndexes()`

Builds internal indexes for O(1) lookups.

**Parameters**: None

**Returns**: `void`

**Complexity**: O(n)

**Indexes Built**:
- `companyMap`: ticker → company object
- `industryIndex`: industry → array of companies
- `exchangeIndex`: exchange → array of companies

**Example**:
```javascript
provider.buildIndexes();
// Console output:
// ✅ [CompanyMasterProvider] Indexes built in 234ms
//    - Companies: 6176
//    - Industries: 26
//    - Exchanges: 15
```

**Edge Cases**:
- Duplicate tickers: Last entry wins (Map behavior)
- Null industry/exchange: Skipped in indexes

---

### Query Methods

#### `getCompanyByTicker(ticker)`

Retrieves a company by its ticker symbol.

**Parameters**:
- `ticker` (string): Stock ticker symbol (e.g., "NVDA", "005930.KS")

**Returns**: `Object|null` - Company object or `null` if not found

**Complexity**: O(1) - Map lookup

**Example**:
```javascript
const nvidia = provider.getCompanyByTicker('NVDA');
console.log(nvidia.corp);        // "NVIDIA"
console.log(nvidia.industry);    // "반도체"
console.log(nvidia.marketCap);   // 4559166.0

const samsung = provider.getCompanyByTicker('005930.KS');
console.log(samsung.corp);       // "삼성전자"
```

**Edge Cases**:
- Non-existent ticker: Returns `null`
- `null` input: Returns `null` with warning
- `undefined` input: Returns `null` with warning
- Empty string: Returns `null` with warning

---

#### `getCompaniesByIndustry(industry)`

Retrieves all companies in a specific industry.

**Parameters**:
- `industry` (string): Industry name (e.g., "반도체", "소프트웨어")

**Returns**: `Array` - Array of company objects (empty if no matches)

**Complexity**: O(1) lookup + O(k) result copy, where k = matching companies

**Example**:
```javascript
const semiconductors = provider.getCompaniesByIndustry('반도체');
console.log(`Found ${semiconductors.length} companies`);

semiconductors.forEach(company => {
    console.log(`${company.ticker}: ${company.corp}`);
});
// Output:
// NVDA: NVIDIA
// AMD: Advanced Micro Devices
// TSM: Taiwan Semiconductor
// ...
```

**Edge Cases**:
- Non-existent industry: Returns empty array `[]`
- `null` input: Returns empty array `[]`
- `undefined` input: Returns empty array `[]`

---

#### `getCompaniesByExchange(exchange)`

Retrieves all companies listed on a specific exchange.

**Parameters**:
- `exchange` (string): Exchange name (e.g., "NASDAQ", "KOSPI")

**Returns**: `Array` - Array of company objects (empty if no matches)

**Complexity**: O(1) lookup + O(k) result copy

**Example**:
```javascript
const nasdaq = provider.getCompaniesByExchange('NASDAQ');
console.log(`${nasdaq.length} companies on NASDAQ`);

const kospi = provider.getCompaniesByExchange('KOSPI');
console.log(`${kospi.length} companies on KOSPI`);
```

**Edge Cases**:
- Non-existent exchange: Returns empty array `[]`
- `null` input: Returns empty array `[]`
- `undefined` input: Returns empty array `[]`

---

### Filtering Methods

#### `filterByMarketCap(min, max)`

Filters companies by market capitalization range.

**Parameters**:
- `min` (number, optional): Minimum market cap in millions USD. Default: `0`
- `max` (number, optional): Maximum market cap in millions USD. Default: `Infinity`

**Returns**: `Array` - Filtered company array

**Complexity**: O(n) - Full array scan

**Example**:
```javascript
// Large cap (> $10B)
const largeCap = provider.filterByMarketCap(10000, Infinity);
console.log(`${largeCap.length} large cap companies`);

// Mid cap ($1B - $10B)
const midCap = provider.filterByMarketCap(1000, 10000);
console.log(`${midCap.length} mid cap companies`);

// Specific range ($5B - $20B)
const range = provider.filterByMarketCap(5000, 20000);
```

**Edge Cases**:
- `null` or `undefined` market cap values: Excluded from results
- `min > max`: Returns empty array
- Uninitialized provider: Returns empty array

---

#### `filterByPER(min, max)`

Filters companies by Price-to-Earnings ratio range.

**Parameters**:
- `min` (number, optional): Minimum PER. Default: `0`
- `max` (number, optional): Maximum PER. Default: `Infinity`

**Returns**: `Array` - Filtered company array

**Complexity**: O(n)

**Example**:
```javascript
// Value stocks (low PER)
const valuePicks = provider.filterByPER(0, 15);
console.log(`${valuePicks.length} value stocks (PER < 15)`);

// Medium PER
const balanced = provider.filterByPER(15, 30);

// Growth stocks (high PER)
const growthStocks = provider.filterByPER(30, Infinity);
```

**Edge Cases**:
- `null` or `undefined` PER values: Excluded from results
- Negative PER: Included if within range
- `min > max`: Returns empty array

---

#### `searchByName(query)`

Searches companies by name (partial match, case-insensitive).

**Parameters**:
- `query` (string): Search query (minimum 2 characters)

**Returns**: `Array` - Matching company array

**Complexity**: O(n)

**Example**:
```javascript
// Korean search
const samsung = provider.searchByName('삼성');
console.log(`Found ${samsung.length} Samsung companies`);

// English search (case-insensitive)
const apple = provider.searchByName('apple');
const APPLE = provider.searchByName('APPLE');
// Both return same results

// Partial match
const tech = provider.searchByName('tech');
// Matches: "Technology", "Biotech", etc.
```

**Edge Cases**:
- Query < 2 characters: Returns empty array with warning
- `null` input: Returns empty array with warning
- `undefined` input: Returns empty array with warning
- Empty string: Returns empty array with warning
- No matches: Returns empty array

---

### Metadata Methods

#### `getAllIndustries()`

Returns sorted list of all industries.

**Parameters**: None

**Returns**: `Array<string>` - Sorted industry names

**Complexity**: O(k log k) where k = number of industries (~26)

**Example**:
```javascript
const industries = provider.getAllIndustries();
console.log(industries);
// Output: [
//   "가전제품",
//   "건설",
//   "금융",
//   ...
//   "화학",
//   "환경"
// ]
```

**Edge Cases**:
- Uninitialized provider: Returns empty array

---

#### `getAllExchanges()`

Returns sorted list of all exchanges.

**Parameters**: None

**Returns**: `Array<string>` - Sorted exchange names

**Complexity**: O(k log k) where k = number of exchanges (~15)

**Example**:
```javascript
const exchanges = provider.getAllExchanges();
console.log(exchanges);
// Output: [
//   "AMEX",
//   "KOSDAQ",
//   "KOSPI",
//   "NASDAQ",
//   "NYSE",
//   ...
// ]
```

**Edge Cases**:
- Uninitialized provider: Returns empty array

---

#### `getStatistics()`

Returns comprehensive statistics about the dataset.

**Parameters**: None

**Returns**: `Object|null` - Statistics object or `null` if not initialized

**Complexity**: O(k) where k = number of industries/exchanges

**Example**:
```javascript
const stats = provider.getStatistics();
console.log(stats);
// Output:
// {
//   totalCompanies: 6176,
//   totalIndustries: 26,
//   totalExchanges: 15,
//   loadTime: 4523,  // ms
//   topIndustries: [
//     { industry: "소프트웨어", count: 842 },
//     { industry: "반도체", count: 523 },
//     ...
//   ],
//   topExchanges: [
//     { exchange: "NASDAQ", count: 2341 },
//     { exchange: "NYSE", count: 1823 },
//     ...
//   ]
// }
```

**Edge Cases**:
- Uninitialized provider: Returns `null`

---

## Data Structures

### Company Object Structure

Each company object contains 33+ fields:

```javascript
{
    // === Identity Fields ===
    ticker: "NVDA",              // Stock ticker symbol
    corp: "NVIDIA",              // Company name
    exchange: "NASDAQ",          // Stock exchange

    // === Company Information ===
    industry: "반도체",           // Industry (alias for WI26)
    WI26: "반도체",              // Original Korean industry name
    fiscalYearEnd: "Jan",        // Fiscal year end month (alias)
    foundingYear: 1998.0,        // Founding year (alias)
    "결산": "Jan",               // Original Korean field
    "설립": 1998.0,              // Original Korean field

    // === Valuation ===
    price: 187.62,               // Current stock price (USD)
    marketCap: 4559166.0,        // Market cap (millions USD)

    // === Financial Ratios ===
    roe: 0.7943,                 // Return on Equity (forward)
    opm: 0.6561,                 // Operating Profit Margin (forward)
    per: 31.69,                  // Price-to-Earnings Ratio (forward)
    pbr: 19.45,                  // Price-to-Book Ratio (forward)

    // === Performance - Absolute Returns ===
    returns: {
        week: 0.0529,            // 1-week return (5.29%)
        month1: 0.0996,          // 1-month return (9.96%)
        month3: 0.1775,          // 3-month return (17.75%)
        month6: 0.8430,          // 6-month return (84.30%)
        month12: 0.5272          // 12-month return (52.72%)
    },

    // === Performance - vs Benchmark ===
    returnsVsBenchmark: {
        week: -0.0224,           // vs benchmark
        month1: -0.0597,
        month3: 0.0172,
        month6: 0.5821,
        month12: 0.2663
    },

    // === Performance - vs Industry ===
    returnsVsIndustry: {
        week: 0.0296,            // vs industry average
        month1: 0.0296,
        month3: 0.0649,
        month6: 0.6319,
        month12: 0.5871
    },

    // === Historical Price Data (Excel serial dates) ===
    "45933": 5.92,               // Price on 2025-10-03
    "45926.0": 5.75,             // Price on 2025-09-26
    "45903.0": 5.75,             // Price on 2025-09-03
    "45841.0": 5.06,             // Price on 2025-07-03
    "45750.0": 4.82,             // Price on 2025-04-03
    "45568.0": 3.73              // Price on 2024-10-03
}
```

### Index Structures

```javascript
// Ticker Index (Map)
companyMap: Map {
    "NVDA" => { ticker: "NVDA", corp: "NVIDIA", ... },
    "MSFT" => { ticker: "MSFT", corp: "Microsoft", ... },
    "005930.KS" => { ticker: "005930.KS", corp: "삼성전자", ... },
    ...
}

// Industry Index (Map)
industryIndex: Map {
    "반도체" => [
        { ticker: "NVDA", corp: "NVIDIA", ... },
        { ticker: "AMD", corp: "Advanced Micro Devices", ... },
        ...
    ],
    "소프트웨어" => [
        { ticker: "MSFT", corp: "Microsoft", ... },
        { ticker: "GOOGL", corp: "Alphabet A", ... },
        ...
    ],
    ...
}

// Exchange Index (Map)
exchangeIndex: Map {
    "NASDAQ" => [
        { ticker: "NVDA", ... },
        { ticker: "MSFT", ... },
        ...
    ],
    "KOSPI" => [
        { ticker: "005930.KS", ... },
        ...
    ],
    ...
}
```

### Statistics Object

```javascript
{
    totalCompanies: 6176,
    totalIndustries: 26,
    totalExchanges: 15,
    loadTime: 4523,              // milliseconds
    topIndustries: [
        { industry: "소프트웨어", count: 842 },
        { industry: "반도체", count: 523 },
        { industry: "의료기기", count: 421 },
        { industry: "금융", count: 389 },
        { industry: "바이오텍", count: 312 }
    ],
    topExchanges: [
        { exchange: "NASDAQ", count: 2341 },
        { exchange: "NYSE", count: 1823 },
        { exchange: "KOSPI", count: 856 },
        { exchange: "KOSDAQ", count: 645 },
        { exchange: "AMEX", count: 234 }
    ]
}
```

---

## Performance Characteristics

### Loading Performance

| Metric | Target | Typical |
|--------|--------|---------|
| JSON Load Time | < 5s | ~3-4s |
| Index Build Time | < 1s | ~0.2-0.5s |
| Total Init Time | < 5s | ~3.5-4.5s |
| Memory Usage | < 50MB | ~30-40MB |

### Query Performance

| Operation | Complexity | Time (avg) |
|-----------|-----------|------------|
| `getCompanyByTicker()` | O(1) | < 1ms |
| `getCompaniesByIndustry()` | O(1) | < 5ms |
| `getCompaniesByExchange()` | O(1) | < 5ms |
| `filterByMarketCap()` | O(n) | ~20-50ms |
| `filterByPER()` | O(n) | ~20-50ms |
| `searchByName()` | O(n) | ~30-80ms |

### Scalability

| Dataset Size | Load Time | Memory | Query Time |
|--------------|-----------|--------|------------|
| 6,176 (current) | ~4s | ~35MB | < 50ms |
| 10,000 (target) | ~6s | ~55MB | < 80ms |
| 50,000 (future) | ~30s | ~250MB | < 400ms |

**Note**: O(1) operations (ticker lookup, industry/exchange queries) scale negligibly with dataset size.

---

## Usage Examples

### Example 1: Ticker Lookup

```javascript
// Quick company information lookup
const provider = new CompanyMasterProvider();
await provider.loadFromJSON('data/M_Company.json');

const nvidia = provider.getCompanyByTicker('NVDA');
if (nvidia) {
    console.log(`Company: ${nvidia.corp}`);
    console.log(`Industry: ${nvidia.industry}`);
    console.log(`Market Cap: $${(nvidia.marketCap / 1000).toFixed(1)}B`);
    console.log(`Price: $${nvidia.price.toFixed(2)}`);
    console.log(`PER: ${nvidia.per.toFixed(2)}`);
    console.log(`12M Return: ${(nvidia.returns.month12 * 100).toFixed(2)}%`);
}

// Output:
// Company: NVIDIA
// Industry: 반도체
// Market Cap: $4559.2B
// Price: $187.62
// PER: 31.69
// 12M Return: 52.72%
```

### Example 2: Industry Filtering

```javascript
// Find all semiconductor companies
const semiconductors = provider.getCompaniesByIndustry('반도체');

console.log(`Found ${semiconductors.length} semiconductor companies`);

// Sort by market cap
semiconductors.sort((a, b) => b.marketCap - a.marketCap);

// Top 10 by market cap
const top10 = semiconductors.slice(0, 10);
top10.forEach((company, i) => {
    console.log(
        `${i + 1}. ${company.ticker} (${company.corp}): ` +
        `$${(company.marketCap / 1000).toFixed(1)}B`
    );
});

// Output:
// Found 523 semiconductor companies
// 1. NVDA (NVIDIA): $4559.2B
// 2. TSM (Taiwan Semiconductor): $512.3B
// 3. ASML (ASML Holding): $324.1B
// ...
```

### Example 3: Market Cap Range Search

```javascript
// Find mid-cap tech companies
const techCompanies = provider.getCompaniesByIndustry('소프트웨어');
const midCapTech = techCompanies.filter(c =>
    c.marketCap >= 1000 && c.marketCap <= 10000
);

console.log(`Found ${midCapTech.length} mid-cap software companies`);

// Analyze average PER
const avgPER = midCapTech.reduce((sum, c) => sum + (c.per || 0), 0) / midCapTech.length;
console.log(`Average PER: ${avgPER.toFixed(2)}`);
```

### Example 4: Company Name Search

```javascript
// Search for Samsung companies
const samsungCompanies = provider.searchByName('삼성');

console.log(`Found ${samsungCompanies.length} Samsung companies:`);
samsungCompanies.forEach(company => {
    console.log(
        `${company.ticker}: ${company.corp} ` +
        `(${company.exchange}, ${company.industry})`
    );
});

// Output:
// Found 23 Samsung companies:
// 005930.KS: 삼성전자 (KOSPI, 반도체)
// 028260.KS: 삼성물산 (KOSPI, 건설)
// 207940.KS: 삼성바이오로직스 (KOSPI, 바이오텍)
// ...
```

### Example 5: Statistics Dashboard

```javascript
// Display comprehensive statistics
const stats = provider.getStatistics();

console.log('=== Company Master Data Statistics ===');
console.log(`Total Companies: ${stats.totalCompanies.toLocaleString()}`);
console.log(`Industries: ${stats.totalIndustries}`);
console.log(`Exchanges: ${stats.totalExchanges}`);
console.log(`Load Time: ${stats.loadTime}ms`);

console.log('\nTop 5 Industries:');
stats.topIndustries.forEach((item, i) => {
    console.log(`${i + 1}. ${item.industry}: ${item.count} companies`);
});

console.log('\nTop 5 Exchanges:');
stats.topExchanges.forEach((item, i) => {
    console.log(`${i + 1}. ${item.exchange}: ${item.count} companies`);
});
```

### Example 6: Combined Filters (Industry + Market Cap)

```javascript
// Find large-cap semiconductor companies
const largeSemiconductors = provider.getCompaniesByIndustry('반도체')
    .filter(c => c.marketCap >= 10000);  // > $10B

console.log(`Large-cap semiconductors: ${largeSemiconductors.length}`);

// Calculate total market cap
const totalMarketCap = largeSemiconductors.reduce(
    (sum, c) => sum + c.marketCap, 0
);
console.log(`Total market cap: $${(totalMarketCap / 1000).toFixed(1)}B`);

// Sort by 12-month performance
largeSemiconductors.sort((a, b) => b.returns.month12 - a.returns.month12);

console.log('\nBest performers (12M):');
largeSemiconductors.slice(0, 5).forEach((c, i) => {
    console.log(
        `${i + 1}. ${c.ticker}: ${(c.returns.month12 * 100).toFixed(2)}%`
    );
});
```

### Example 7: Exchange-Based Analysis

```javascript
// Compare NASDAQ vs NYSE
const nasdaq = provider.getCompaniesByExchange('NASDAQ');
const nyse = provider.getCompaniesByExchange('NYSE');

console.log('=== Exchange Comparison ===');
console.log(`NASDAQ: ${nasdaq.length} companies`);
console.log(`NYSE: ${nyse.length} companies`);

// Calculate average market cap
const nasdaqAvg = nasdaq.reduce((sum, c) => sum + c.marketCap, 0) / nasdaq.length;
const nyseAvg = nyse.reduce((sum, c) => sum + c.marketCap, 0) / nyse.length;

console.log(`\nAverage Market Cap:`);
console.log(`NASDAQ: $${(nasdaqAvg / 1000).toFixed(2)}B`);
console.log(`NYSE: $${(nyseAvg / 1000).toFixed(2)}B`);

// Calculate average PER
const nasdaqPER = nasdaq
    .filter(c => c.per)
    .reduce((sum, c) => sum + c.per, 0) / nasdaq.filter(c => c.per).length;
const nysePER = nyse
    .filter(c => c.per)
    .reduce((sum, c) => sum + c.per, 0) / nyse.filter(c => c.per).length;

console.log(`\nAverage PER:`);
console.log(`NASDAQ: ${nasdaqPER.toFixed(2)}`);
console.log(`NYSE: ${nysePER.toFixed(2)}`);
```

---

## Error Handling

### Input Validation

```javascript
// Null/undefined ticker
const result = provider.getCompanyByTicker(null);
// Returns: null
// Console: [CompanyMasterProvider] Invalid ticker

// Empty industry
const companies = provider.getCompaniesByIndustry('');
// Returns: []

// Short search query (< 2 chars)
const results = provider.searchByName('a');
// Returns: []
// Console: [CompanyMasterProvider] Query too short (min 2 chars)
```

### Non-Existent Data

```javascript
// Non-existent ticker
const company = provider.getCompanyByTicker('INVALID999');
// Returns: null (no warning)

// Non-existent industry
const companies = provider.getCompaniesByIndustry('NonExistent');
// Returns: []

// No search results
const results = provider.searchByName('xyz123impossiblequery999');
// Returns: []
```

### Data Type Mismatches

```javascript
// Number input (invalid)
const company = provider.getCompanyByTicker(12345);
// Returns: null

// Object input (invalid)
const companies = provider.getCompaniesByIndustry({ invalid: 'object' });
// Returns: []

// Array input (invalid)
const results = provider.searchByName(['array', 'input']);
// Returns: []
```

### Uninitialized Provider

```javascript
const provider = new CompanyMasterProvider();

// Before loading data
const stats = provider.getStatistics();
// Returns: null

const filtered = provider.filterByMarketCap(1000, 10000);
// Returns: []

// Always check initialization
if (provider.initialized) {
    // Safe to use
} else {
    console.error('Provider not initialized. Call loadFromJSON() first.');
}
```

### Load Failures

```javascript
// File not found
const success = await provider.loadFromJSON('data/nonexistent.json');
// Returns: false
// Console: [CompanyMasterProvider] Load failed: HTTP 404: Not Found

// Invalid JSON structure
const success = await provider.loadFromJSON('data/invalid.json');
// Returns: false
// Console: [CompanyMasterProvider] Load failed: Invalid JSON structure

// Network error
const success = await provider.loadFromJSON('http://invalid-url/data.json');
// Returns: false
// Console: [CompanyMasterProvider] Load failed: [network error]
```

---

## Best Practices

### 1. Initialize Once, Query Many

```javascript
// ✅ GOOD: Initialize once
const provider = new CompanyMasterProvider();
await provider.loadFromJSON('data/M_Company.json');

// Perform multiple queries
const nvidia = provider.getCompanyByTicker('NVDA');
const semiconductors = provider.getCompaniesByIndustry('반도체');
const nasdaq = provider.getCompaniesByExchange('NASDAQ');

// ❌ BAD: Re-initialize for each query
for (const ticker of tickers) {
    const provider = new CompanyMasterProvider();  // WASTEFUL!
    await provider.loadFromJSON('data/M_Company.json');
    const company = provider.getCompanyByTicker(ticker);
}
```

### 2. Use Global Instance

```javascript
// ✅ GOOD: Single global instance
window.companyMaster = new CompanyMasterProvider();
await window.companyMaster.loadFromJSON('data/M_Company.json');

// Access from anywhere
function showCompanyInfo(ticker) {
    const company = window.companyMaster.getCompanyByTicker(ticker);
    // ...
}
```

### 3. Check Initialization Status

```javascript
// ✅ GOOD: Check before use
if (!provider.initialized) {
    await provider.loadFromJSON('data/M_Company.json');
}

const company = provider.getCompanyByTicker('NVDA');

// ❌ BAD: Assume initialized
const company = provider.getCompanyByTicker('NVDA');  // Might fail!
```

### 4. Handle Null Results

```javascript
// ✅ GOOD: Check for null
const company = provider.getCompanyByTicker(userInput);
if (company) {
    console.log(company.corp);
} else {
    console.log('Company not found');
}

// ❌ BAD: Assume company exists
const company = provider.getCompanyByTicker(userInput);
console.log(company.corp);  // TypeError if null!
```

### 5. Use Indexes for Filtering

```javascript
// ✅ GOOD: Use industry index first
const techCompanies = provider.getCompaniesByIndustry('소프트웨어')
    .filter(c => c.marketCap >= 10000);  // O(k) where k = tech companies

// ❌ BAD: Filter all companies
const techCompanies = provider.companies
    .filter(c => c.industry === '소프트웨어' && c.marketCap >= 10000);  // O(n)
```

### 6. Cache Expensive Operations

```javascript
// ✅ GOOD: Cache results
const allIndustries = provider.getAllIndustries();  // Cache this
const industries = allIndustries.filter(i => i.startsWith('반'));

// ❌ BAD: Repeated calls
if (provider.getAllIndustries().includes('반도체')) {  // Call 1
    const count = provider.getCompaniesByIndustry('반도체').length;
}
```

### 7. Validate User Input

```javascript
// ✅ GOOD: Validate before query
function searchCompanies(query) {
    if (typeof query !== 'string' || query.length < 2) {
        return { error: 'Query must be at least 2 characters' };
    }
    return provider.searchByName(query);
}

// ❌ BAD: Pass raw input
function searchCompanies(query) {
    return provider.searchByName(query);  // May return empty array silently
}
```

### 8. Performance Tips

```javascript
// ✅ GOOD: Use appropriate method
// For single ticker lookup (O(1))
const company = provider.getCompanyByTicker('NVDA');

// ❌ BAD: Search through all companies (O(n))
const company = provider.companies.find(c => c.ticker === 'NVDA');

// ✅ GOOD: Filter by industry first (O(k))
const largeSoftware = provider.getCompaniesByIndustry('소프트웨어')
    .filter(c => c.marketCap >= 10000);

// ❌ BAD: Filter all companies (O(n))
const largeSoftware = provider.companies
    .filter(c => c.industry === '소프트웨어' && c.marketCap >= 10000);
```

---

## Integration Guide

### HTML Integration

```html
<!DOCTYPE html>
<html>
<head>
    <title>Stock Analyzer</title>
</head>
<body>
    <!-- Include CompanyMasterProvider -->
    <script src="modules/CompanyMasterProvider.js"></script>

    <!-- Your application script -->
    <script src="js/app.js"></script>
</body>
</html>
```

### Application Initialization

```javascript
// js/app.js

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    // Create global instance
    window.companyMaster = new CompanyMasterProvider();

    // Show loading indicator
    document.getElementById('loading').style.display = 'block';

    // Load data
    const success = await window.companyMaster.loadFromJSON('data/M_Company.json');

    // Hide loading indicator
    document.getElementById('loading').style.display = 'none';

    if (success) {
        console.log('Company data loaded successfully');
        initializeApp();
    } else {
        console.error('Failed to load company data');
        showError('Unable to load company data. Please refresh the page.');
    }
});

function initializeApp() {
    // App initialization code
    populateIndustryDropdown();
    populateExchangeDropdown();
    attachEventHandlers();
}
```

### Industry Dropdown Example

```javascript
function populateIndustryDropdown() {
    const select = document.getElementById('industrySelect');
    const industries = window.companyMaster.getAllIndustries();

    // Clear existing options
    select.innerHTML = '<option value="">All Industries</option>';

    // Add industry options
    industries.forEach(industry => {
        const option = document.createElement('option');
        option.value = industry;
        option.textContent = industry;
        select.appendChild(option);
    });
}

// Handle selection
document.getElementById('industrySelect').addEventListener('change', (e) => {
    const industry = e.target.value;
    if (industry) {
        const companies = window.companyMaster.getCompaniesByIndustry(industry);
        displayCompanies(companies);
    } else {
        displayAllCompanies();
    }
});
```

### Search Implementation

```javascript
// Search input handler
document.getElementById('searchInput').addEventListener('input', (e) => {
    const query = e.target.value.trim();

    if (query.length >= 2) {
        const results = window.companyMaster.searchByName(query);
        displaySearchResults(results);
    } else {
        clearSearchResults();
    }
});

function displaySearchResults(results) {
    const container = document.getElementById('searchResults');

    if (results.length === 0) {
        container.innerHTML = '<p>No companies found</p>';
        return;
    }

    container.innerHTML = results.map(company => `
        <div class="company-item" onclick="showCompanyDetail('${company.ticker}')">
            <strong>${company.ticker}</strong> - ${company.corp}
            <span class="exchange">${company.exchange}</span>
        </div>
    `).join('');
}
```

### Company Detail View

```javascript
function showCompanyDetail(ticker) {
    const company = window.companyMaster.getCompanyByTicker(ticker);

    if (!company) {
        console.error(`Company not found: ${ticker}`);
        return;
    }

    // Update detail view
    document.getElementById('detailTicker').textContent = company.ticker;
    document.getElementById('detailName').textContent = company.corp;
    document.getElementById('detailExchange').textContent = company.exchange;
    document.getElementById('detailIndustry').textContent = company.industry;
    document.getElementById('detailPrice').textContent = `$${company.price.toFixed(2)}`;
    document.getElementById('detailMarketCap').textContent =
        `$${(company.marketCap / 1000).toFixed(2)}B`;
    document.getElementById('detailPER').textContent = company.per?.toFixed(2) || 'N/A';
    document.getElementById('detailROE').textContent =
        `${(company.roe * 100).toFixed(2)}%` || 'N/A';

    // Show detail panel
    document.getElementById('companyDetail').style.display = 'block';
}
```

### Integration with Other Modules

```javascript
// Example: Integration with CorrelationEngine
class CorrelationEngine {
    constructor(companyProvider) {
        this.companyProvider = companyProvider;
    }

    findLowCorrelationPairs(ticker, maxCorrelation = 0.1) {
        // Get company info
        const company = this.companyProvider.getCompanyByTicker(ticker);
        if (!company) return [];

        // Get companies in same industry
        const sameIndustry = this.companyProvider.getCompaniesByIndustry(company.industry);

        // Calculate correlations...
        // (correlation logic here)
    }
}

// Initialize with shared CompanyMasterProvider
const correlationEngine = new CorrelationEngine(window.companyMaster);
```

---

## Troubleshooting

### Common Issues

#### 1. Data Not Loading

**Symptoms**:
- `loadFromJSON()` returns `false`
- Console shows "HTTP 404" error

**Solutions**:
```javascript
// Check file path
console.log('Loading from:', 'data/M_Company.json');
const success = await provider.loadFromJSON('data/M_Company.json');

// Verify file exists
// Open browser DevTools → Network tab → Check if file loads

// Check CORS if loading from different origin
// Use local server (e.g., python -m http.server 8080)
```

#### 2. Slow Loading Performance

**Symptoms**:
- Loading takes > 10 seconds
- Browser becomes unresponsive

**Solutions**:
```javascript
// Check file size
// M_Company.json should be ~2-3 MB

// Check network speed
// Use local server, not remote URL

// Monitor performance
const start = Date.now();
await provider.loadFromJSON('data/M_Company.json');
console.log(`Load time: ${Date.now() - start}ms`);  // Should be < 5000ms
```

#### 3. Query Returns Null/Empty

**Symptoms**:
- `getCompanyByTicker()` returns `null` for valid ticker
- `getCompaniesByIndustry()` returns empty array

**Solutions**:
```javascript
// Check initialization
console.log('Initialized:', provider.initialized);  // Should be true

// Check ticker format
const company = provider.getCompanyByTicker('NVDA');  // Correct
const company = provider.getCompanyByTicker('nvda');  // Wrong (case-sensitive)

// Check industry name (exact match required)
const companies = provider.getCompaniesByIndustry('반도체');  // Correct
const companies = provider.getCompaniesByIndustry('semiconductor');  // Wrong

// List all industries to find correct name
console.log(provider.getAllIndustries());
```

#### 4. Memory Issues

**Symptoms**:
- Browser tab crashes
- "Out of memory" error

**Solutions**:
```javascript
// Don't create multiple instances
// ❌ BAD
for (let i = 0; i < 100; i++) {
    const provider = new CompanyMasterProvider();  // Memory leak!
}

// ✅ GOOD
const provider = new CompanyMasterProvider();  // Single instance
```

#### 5. Performance Degradation

**Symptoms**:
- Queries getting slower over time
- Browser lag during filtering

**Solutions**:
```javascript
// Use indexed queries
// ✅ GOOD
const companies = provider.getCompaniesByIndustry('반도체');  // O(1)

// ❌ BAD
const companies = provider.companies.filter(c => c.industry === '반도체');  // O(n)

// Avoid unnecessary filtering
// ✅ GOOD
const largeCap = provider.filterByMarketCap(10000, Infinity);  // Single pass

// ❌ BAD
const allCompanies = provider.companies;  // Copy entire array
const largeCap = allCompanies.filter(c => c.marketCap >= 10000);  // Filter copy
```

### Console Error Messages

#### `[CompanyMasterProvider] Invalid ticker`

**Cause**: `getCompanyByTicker()` called with `null`, `undefined`, or empty string

**Solution**: Validate input before calling
```javascript
if (ticker && typeof ticker === 'string') {
    const company = provider.getCompanyByTicker(ticker);
}
```

#### `[CompanyMasterProvider] Query too short (min 2 chars)`

**Cause**: `searchByName()` called with < 2 character query

**Solution**: Enforce minimum length
```javascript
if (query.length >= 2) {
    const results = provider.searchByName(query);
}
```

#### `[CompanyMasterProvider] Load failed: HTTP 404`

**Cause**: JSON file not found at specified path

**Solution**: Check file path and server
```javascript
// Verify file exists
// Check server is running on correct port
// Ensure path is relative to HTML file
```

#### `[CompanyMasterProvider] Load failed: Invalid JSON structure`

**Cause**: JSON file missing `metadata` or `data` fields

**Solution**: Validate JSON structure
```javascript
// Expected structure:
// {
//   "metadata": { ... },
//   "data": [ ... ]
// }
```

### Debugging Tips

```javascript
// 1. Enable verbose logging
provider.loadFromJSON('data/M_Company.json').then(success => {
    console.log('Load success:', success);
    console.log('Companies loaded:', provider.companies?.length);
    console.log('Industries:', provider.industryIndex.size);
    console.log('Exchanges:', provider.exchangeIndex.size);
});

// 2. Inspect data structure
const nvidia = provider.getCompanyByTicker('NVDA');
console.log('Company object:', nvidia);
console.log('Available fields:', Object.keys(nvidia));

// 3. Check performance
console.time('ticker-lookup');
provider.getCompanyByTicker('NVDA');
console.timeEnd('ticker-lookup');  // Should be < 1ms

// 4. Validate indexes
console.log('Company map size:', provider.companyMap.size);  // Should be 6176
console.log('Industry index size:', provider.industryIndex.size);  // Should be ~26
console.log('Exchange index size:', provider.exchangeIndex.size);  // Should be ~15

// 5. Test filtering
const filtered = provider.filterByMarketCap(10000, Infinity);
console.log('Large cap count:', filtered.length);
console.log('All have valid marketCap:', filtered.every(c => c.marketCap >= 10000));
```

---

## Additional Resources

### Related Documentation

- **Schema Reference**: `docs/Sprint4_DataIntegration/M_COMPANY_SCHEMA.md`
- **Test Specifications**: `tests/modules/company-master-provider.spec.js`
- **Integration Guide**: `docs/INTEGRATION_GUIDE.md` (if available)
- **Performance Analysis**: `docs/PERFORMANCE_REPORT.md` (if available)

### Example Projects

- **Stock Analyzer**: `stock_analyzer.html` - Full implementation
- **Dashboard**: `js/DashboardManager.js` - Usage in dashboard context

### Source Code

- **Module**: `modules/CompanyMasterProvider.js`
- **Data**: `data/M_Company.json`

---

**Document Version**: 1.0.0
**Last Updated**: 2025-10-18
**Author**: Technical Documentation Team
**Status**: Complete ✅

---

## Quick Reference Card

```javascript
// INITIALIZATION
const provider = new CompanyMasterProvider();
await provider.loadFromJSON('data/M_Company.json');

// QUERIES (O(1))
provider.getCompanyByTicker('NVDA')
provider.getCompaniesByIndustry('반도체')
provider.getCompaniesByExchange('NASDAQ')

// FILTERING (O(n))
provider.filterByMarketCap(min, max)
provider.filterByPER(min, max)
provider.searchByName(query)

// METADATA
provider.getAllIndustries()
provider.getAllExchanges()
provider.getStatistics()

// STATE
provider.initialized         // boolean
provider.companies          // Array
provider.metadata           // Object
provider.companyMap         // Map
provider.industryIndex      // Map
provider.exchangeIndex      // Map
```
