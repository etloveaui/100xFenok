# Benchmarks Data

> **Source**: Bloomberg Terminal (weekly update)
> **Period**: 2010-07-23 ~ 2026-06-05 (15+ years, 829 S&P 500 data points)
> **Version**: 3.8.0
> **Last Update**: 2026-06-08

---

## Files

| File | Description | Sections |
|------|-------------|----------|
| `us.json` | US Major Indices | `sp500`, `nasdaq100`, `nasdaq_composite`, `russell2000` |
| `us_sectors.json` | GICS 11 Sectors + Housing | `energy`, `materials`, `industrials`, `consumer_discretionary`, `consumer_staples`, `health_care`, `financials`, `information_technology`, `communication_services`, `utilities`, `real_estate`, `homebuilders` |
| `micro_sectors.json` | Micro Sectors | `philadelphia_semi`, `us_regional_banks`, `hang_seng_tech`, `us_biotech`, `kosdaq_150` |
| `developed.json` | Developed Markets | `euro_stoxx_50`, `topix`, `hong_kong`, `nikkei` |
| `emerging.json` | Emerging Markets | `shanghai`, `india_sensex`, `kospi`, `brazil`, `vietnam`, `hang_seng_h` |
| `msci.json` | MSCI Indices | `world`, `developed`, `emerging`, `china`, `india`, `korea` |
| `summaries.json` | Momentum, Yearly Returns, Source Summaries | 37 sections × price legacy views + 2,353 metric summary values |

---

## Data Fields

| Field | Description | Example |
|-------|-------------|---------|
| `date` | Date (ISO 8601) | `"2025-12-05"` |
| `px_last` | Last Price | `6090.27` |
| `best_eps` | Consensus EPS | `243.15` |
| `best_pe_ratio` | Forward P/E | `19.32` |
| `px_to_book_ratio` | P/B Ratio | `4.52` |
| `roe` | ROE (0~1 range) | `0.2344` |

---

## Schema

### Time Series (us, us_sectors, developed, emerging, msci, micro_sectors)

```json
{
  "metadata": {
    "version": "2026-01-30",
    "generated": "2026-02-03T11:24:00",
    "source": "Bloomberg Terminal",
    "update_frequency": "weekly"
  },
  "sections": {
    "sp500": {
      "name": "S&P 500 (SPX Index)",
      "name_en": "Sp500",
      "data": [
        {"date": "2010-01-22", "px_last": 1091.76, "best_eps": 80.462, ...}
      ]
    }
  }
}
```

### Summaries (summaries.json)

```json
{
  "metadata": {"type": "summary"},
  "momentum": {
    "sp500": {"1w": 0.0013, "1m": 0.0396, "3m": 0.0837, "6m": 0.1001, "ytd": 0.0691}
  },
  "yearly_returns": {
    "sp500": {"2025": 0.1541, "2024": 0.2518, "2023": 0.2423, ...}
  },
  "source_summaries": {
    "sp500": {
      "momentum": {
        "px_last": {"1w": 0.0013, "1m": 0.0396, "3m": 0.0837, "6m": 0.1001, "ytd": 0.0691},
        "best_eps": {"1w": 0.0057, "1m": 0.0363, "3m": 0.1101, "6m": 0.1733, "ytd": 0.1404},
        "best_pe_ratio": {"1w": -0.0043, "1m": 0.0032, "3m": -0.0238, "6m": -0.0624, "ytd": -0.0626},
        "px_to_book_ratio": {"1w": 0.0013, "1m": 0.0396, "3m": 0.0587, "6m": 0.0505, "ytd": 0.0444},
        "roe": {"1w": 0.0056, "1m": 0.0363, "3m": 0.0845, "6m": 0.1204, "ytd": 0.1142}
      },
      "yearly_returns": {
        "px_last": {"2025": 0.1606, "2024": 0.2518, "2023": 0.2423, ...},
        "best_eps": {"2025": 0.1423, "2024": 0.1229, "2023": 0.0608, ...}
      }
    }
  }
}
```

---

## Usage Example

```javascript
// Load data
const res = await fetch('data/benchmarks/us.json');
const data = await res.json();

// S&P 500 latest data
const sp500 = data.sections.sp500.data;
const latest = sp500[sp500.length - 1];
console.log(latest.px_last, latest.best_pe_ratio);

// Iterate all sections
Object.entries(data.sections).forEach(([key, section]) => {
  console.log(key, section.name, section.data.length);
});

// Summaries - momentum & yearly returns
const summaries = await fetch('data/benchmarks/summaries.json').then(r => r.json());
console.log(summaries.momentum.sp500);        // {1w, 1m, 3m, 6m, ytd}
console.log(summaries.yearly_returns.sp500);  // {2025, 2024, 2023, ...}
console.log(summaries.source_summaries.sp500.momentum.best_eps); // EPS revision-style momentum
console.log(summaries.source_summaries.sp500.momentum.best_pe_ratio.ytd); // valuation multiple change
```

---

## Update

| Item | Detail |
|------|--------|
| **Frequency** | Weekly (Sunday) |
| **Process** | Bloomberg Excel → Converter → JSON → Git push |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 3.8.0 | 2026-06-08 | Weekly data update (2026-06-05 source): 30,441 records (+1), 2010-07-23 ~ 2026-06-05, 37 sections, 829 S&P 500 data points |
| 3.8.0 | 2026-06-05 | Weekly data update (2026-05-29 source): 30,440 records (+1), 2010-07-16 ~ 2026-05-29, 37 sections, 829 S&P 500 data points |
| 3.8.0 | 2026-05-27 | Weekly data update (2026-05-22 source): 30,439 records (+1), 2010-07-09 ~ 2026-05-22, 37 sections, 829 data points per index |
| 3.8.0 | 2026-05-25 | Added backward-compatible `source_summaries` with 1W/1M/3M/6M/YTD and yearly changes for px_last, EPS, PER, PBR, and ROE; source coverage: 2,353 non-null values + 52 null placeholders |
| 3.7.0 | 2026-05-21 | Weekly data update (2026-05-15 source): 30,438 records (+1), 2010-07-02 ~ 2026-05-15, 37 sections, 829 data points per index |
| 3.7.0 | 2026-05-11 | Weekly data update (2026-05-08 source): 30,437 records (+1), 2010-06-25 ~ 2026-05-08, 37 sections, 829 data points per index |
| 3.7.0 | 2026-05-04 | Weekly data update (2026-05-01 source): 30,436 records (+1), 2010-06-18 ~ 2026-05-01, 37 sections, 829 data points per index |
| 3.7.0 | 2026-04-27 | Weekly data update (2026-04-24 source): 30,435 records, 2010-06-11 ~ 2026-04-24, 37 sections, 829 data points per index |
| 3.7.0 | 2026-04-13 | Weekly data update (2026-04-10 source): 30,433 records, 2010-05-28 ~ 2026-04-12, 37 sections, 829 data points per index |
| 3.7.0 | 2026-04-06 | Weekly data update (2026-04-03 source): 30,432 records, 2010-05-21 ~ 2026-04-03, 37 sections, ~822 data points per index |
| 3.7.0 | 2026-03-30 | Weekly data update (2026-03-27 source): 31,114 records, 2010-01-01 ~ 2026-03-29, 37 sections, 848 data points per index |
| 3.7.0 | 2026-03-23 | Weekly data update (2026-03-20): 30,430 records, 2010-05-07 ~ 2026-03-22, micro_sectors +1 |
| 3.7.0 | 2026-01-20 | Added summaries.json (momentum + yearly returns) |
| 3.6.0 | 2025-12-26 | Unified output path |
| 3.5.0 | 2025-12-20 | Added micro_sectors.json |
| 3.0.0 | 2025-12-15 | Modular architecture |

---

*Source: Bloomberg Terminal | Converter: fenok-benchmarks*
