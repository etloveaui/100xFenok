# Damodaran Data Files

Aswath Damodaran's public financial data converted to JSON format.

---

## File Catalog

| File | Size | Description | Update |
|------|------|-------------|--------|
| `industries.json` | 72 KB | 96 industries with 6 datasets merged (beta, margins, EVA, debt, growth, multiples) | Yearly |
| `erp.json` | 44 KB | 178 countries with ERP, CRP, ratings, tax rates (2026 structure) | Yearly |
| `historical_erp.json` | 6.5 KB | 66 years of implied ERP (1960-2025) | Yearly |
| `credit_ratings.json` | 6.2 KB | 3 interest coverage lookup tables (large, small, financial) | Yearly |

**Total**: 4 files, ~129 KB

---

## Source

- https://pages.stern.nyu.edu/~adamodar/
- robots.txt policy verified: scraping allowed (2025-12-18)

---

## Usage

- **100xFenok Market Radar**: Benchmark data hosting
- **FenokValue Chrome Extension**: DCF valuation, WACC calculation, sector comparisons

---

## Data Schema

### industries.json (v2.0.0)

Unified industry data merged from 6 Damodaran datasets.

```json
{
  "metadata": {
    "source": "Damodaran Online",
    "schema_version": "2.0.0",
    "generated_at": "2026-01-11T...",
    "industry_count": 96,
    "datasets_merged": ["betas", "margin", "eva", "debtdetails", "fundgr", "ev_sales"]
  },
  "industries": {
    "Software (System & Application)": {
      "num_firms": 312,
      "beta": {
        "levered": 1.23,
        "unlevered": 1.15,
        "unlevered_cash_adj": 1.18,
        "d_e_ratio": 0.15
      },
      "margins": {
        "net": 0.1823,
        "operating": 0.2145,
        "ebitda": 0.2856,
        "gross": 0.6234
      },
      "eva": {
        "roe": 0.2134,
        "roc": 0.1845,
        "wacc": 0.0923,
        "eva_millions": 1234.5
      },
      "debt": {
        "total_debt": 45678.9,
        "lease_debt": 12345.6
      },
      "growth": {
        "fundamental_growth": 0.0823,
        "retention_ratio": 0.45,
        "roe_for_growth": 0.1823
      },
      "multiples": {
        "ev_sales": 10.45,
        "price_sales": 8.12
      }
    }
  }
}
```

**Replaces**: `ev_sales.json` (legacy) - now included in `industries.multiples`

### erp.json (v2.0.0)

Country-level Equity Risk Premiums with 2026 structure updates.

```json
{
  "metadata": {
    "source": "Damodaran Online",
    "url": "https://www.stern.nyu.edu/~adamodar/pc/datasets/ctryprem.xlsx",
    "schema_version": "2.0.0",
    "generated_at": "2026-01-11T...",
    "country_count": 178,
    "note": "2026 structure: ERPs by country sheet + Tax Rate merged"
  },
  "countries": {
    "United States": {
      "equity_risk_premium": 0.0446,
      "country_risk_premium": 0.0023,
      "default_spread": 0.0023,
      "region": "North America",
      "rating": "Aa1",
      "corporate_tax_rate": 0.25
    },
    "Korea": {
      "equity_risk_premium": 0.0487,
      "country_risk_premium": 0.0064,
      "default_spread": 0.0042,
      "region": "Asia",
      "rating": "Aa2",
      "corporate_tax_rate": 0.264
    }
  },
  "us_erp": 0.0446
}
```

**2026 Updates**:
- Sheet change: `PRS Worksheet` → `ERPs by country`
- New fields: `region`, `rating` (Moody's)
- Tax Rate merged from separate sheet (158/178 countries)
- US ERP: 4.46% (up from 4.33% in 2025)

### historical_erp.json (v2.0.0)

66 years of historical implied ERP data.

```json
{
  "metadata": {
    "source": "Damodaran Online - histimpl.xls",
    "schema_version": "2.0.0",
    "generated_at": "2026-01-11T...",
    "year_range": "1960-2025",
    "year_count": 66
  },
  "years": {
    "2025": {
      "tbond_rate": 0.0431,
      "implied_erp_ddm": 0.0446,
      "implied_erp_fcfe": 0.0478
    },
    "2024": {
      "tbond_rate": 0.0388,
      "implied_erp_ddm": 0.0433,
      "implied_erp_fcfe": 0.0451
    }
  }
}
```

**Usage**: Rate stress testing, historical ERP analysis

### credit_ratings.json (v2.0.0)

Interest coverage ratio to credit rating lookup tables.

```json
{
  "metadata": {
    "source": "Damodaran Online - ratings.xls",
    "schema_version": "2.0.0",
    "generated_at": "2026-01-11T...",
    "table_count": 3,
    "parsing_method": "fallback",
    "fallback_used": true
  },
  "lookup_tables": {
    "large_manufacturing": [
      {"min_coverage": 12.5, "max_coverage": null, "rating": "AAA", "spread": 0.0063},
      {"min_coverage": 9.5, "max_coverage": 12.5, "rating": "AA", "spread": 0.0078}
    ],
    "small_risky": [...],
    "financial": [...]
  }
}
```

**Note**: Using fallback data (2024 values). Dynamic parsing available but complex Excel structure requires manual verification.

---

## Update Process

1. Check Damodaran site for updates (typically January each year)
2. Run unified converter:
   ```bash
   cd extensions/converters/damodaran
   python3 run.py --dataset all
   ```
3. Copy 4 JSON files from `output/` to this folder
4. Commit + push
5. Verify fetch from `https://100xfenok.pages.dev/data/damodaran/`

**Converter location**: `extensions/converters/damodaran/` (v2.1.0)

---

## Change History

| Version | Date | Changes |
|---------|------|---------|
| v2.0.0 | 2026-01-11 | **Major update**: 4 files, industries.json replaces ev_sales.json, 2026 ERP structure |
| v1.0.0 | 2025-12-18 | Initial: erp.json + ev_sales.json |

---

*Last updated: 2026-01-11*
