# Damodaran Data Files

Aswath Damodaran's public financial data converted to JSON format.

---

## File Catalog

| File | Size | Description | Update |
|------|------|-------------|--------|
| `industries.json` | 75 KB | 96 US industries with 6 datasets merged (beta, margins, EVA, debt, growth, multiples) | Yearly |
| `industry_metrics.json` | 307 KB | 96 US industries with 11 extended valuation metric datasets | Yearly |
| `industry_metrics_regions.json` | 4.2 MB | 7 non-US regions with 96 industries each and 17 regional metric datasets | Yearly |
| `erp.json` | 45 KB | 178 countries with ERP, CRP, ratings, tax rates (April 2026 update) | Quarterly/Yearly |
| `historical_erp.json` | 6.5 KB | 66 years of implied ERP (1960-2025) | Yearly |
| `credit_ratings.json` | 6.4 KB | 3 interest coverage lookup tables parsed from the official current ratings workbook | Yearly |

**Total**: 6 files, ~4.2 MB

---

## Source

- https://pages.stern.nyu.edu/~adamodar/
- Current data page: https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datacurrent.html
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

### industry_metrics.json (v1.0.0)

Additive US industry valuation metrics from 11 Damodaran current-year tables.

```json
{
  "metadata": {
    "schema_version": "1.0.0",
    "source_date": "January 2026",
    "scope": "US current-year industry tables",
    "industry_count": 96,
    "dataset_count": 11,
    "datasets_merged": ["wacc", "taxrate", "pedata", "pbvdata", "psdata", "vebitda", "capex", "roe", "wcdata", "leaseeffect", "fundgrEB"]
  },
  "industries": {
    "Software (System & Application)": {
      "cost_of_capital": {"cost_of_capital": 0.0923},
      "pe_multiples": {"current_pe": 35.2, "forward_pe": 28.4},
      "ev_multiples": {"all_ev_to_ebitda": 18.1},
      "reinvestment": {"net_capex_to_sales": 0.024},
      "working_capital": {"non_cash_working_capital_to_sales": 0.08}
    }
  }
}
```

**Scope**: US current-year industry tables only. Regional variants are not included in v1.0.0.

### industry_metrics_regions.json (v1.0.0)

Additive non-US regional industry valuation metrics from 17 Damodaran current-year tables.

```json
{
  "metadata": {
    "schema_version": "1.0.0",
    "source_date": "January 2026",
    "scope": "Non-US current-year regional industry tables",
    "region_count": 7,
    "dataset_count": 17,
    "regions": ["europe", "japan", "rest", "emerging", "china", "india", "global"],
    "datasets_merged": ["betas", "totalbeta", "wacc", "taxrate", "eva", "debtdetails", "leaseeffect", "capex", "margin", "wcdata", "roe", "fundgr", "fundgrEB", "pedata", "pbvdata", "psdata", "vebitda"],
    "errors": []
  },
  "regions": {
    "europe": {
      "label": "Europe",
      "industries": {
        "Software (System & Application)": {
          "num_firms": 72,
          "beta": {"levered": 1.12},
          "cost_of_capital": {"cost_of_capital": 0.083},
          "ev_multiples": {"all_ev_to_ebitda": 13.4},
          "pe_multiples": {"current_pe": 24.8},
          "book_value_returns": {"pbv": 3.1},
          "sales_multiples": {"price_sales": 4.6}
        }
      }
    }
  }
}
```

**Scope**: Non-US regional variants only. US remains in `industry_metrics.json`.
**Regional PE/PB/PS**: regional workbooks use short names (`pe`, `pbv`, `ps`) while JSON dataset keys remain `pedata`, `pbvdata`, and `psdata`.

### erp.json (v2.0.0)

Country-level Equity Risk Premiums with 2026 structure updates.

```json
{
  "metadata": {
    "source": "Damodaran Online",
    "url": "https://pages.stern.nyu.edu/~adamodar/pc/datasets/ctrypremApr26.xlsx",
    "schema_version": "2.0.0",
    "generated_at": "2026-06-05T...",
    "source_date": "April 1, 2026",
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
  "us_erp": 0.0503
}
```

**2026 Updates**:
- Sheet change: `PRS Worksheet` → `ERPs by country`
- New fields: `region`, `rating` (Moody's)
- Tax Rate merged from separate sheet (158/178 countries)
- US ERP: 5.03% in the April 1, 2026 source file

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
    "generated_at": "2026-06-05T...",
    "table_count": 3,
    "parsing_method": "xls_dynamic",
    "fallback_used": false
  },
  "lookup_tables": {
    "large_manufacturing": [
      {"min_coverage": 12.5, "max_coverage": null, "rating": "Aaa/AAA", "spread": 0.004},
      {"min_coverage": 9.5, "max_coverage": 12.5, "rating": "Aa2/AA", "spread": 0.0055}
    ],
    "small_risky": [...],
    "financial": [...]
  }
}
```

**Note**: All three tables are parsed from the official current `pc/ratings.xls` workbook.

---

## Update Process

1. Check Damodaran site for updates (typically January each year)
2. Run unified converter:
   ```bash
   cd docs/products/converters/damodaran
   $HOME/.pyenv/versions/3.12.8/bin/python3 run.py --dataset all
   ```
3. Copy 6 JSON files from `output/` to this folder and the Next public mirror
4. Commit + push
5. Verify fetch from `https://100xfenok.pages.dev/data/damodaran/`

**Converter location**: `docs/products/converters/damodaran/` (v2.3.0)

---

## Change History

| Version | Date | Changes |
|---------|------|---------|
| v2.3.0 | 2026-06-05 | Regional expansion: added `industry_metrics_regions.json` with 7 non-US regions x 17 datasets, including regional PE/PB/PS, and switched credit ratings to official XLS dynamic parsing |
| v2.2.0 | 2026-06-05 | Current data refresh: ERP April 2026, HTML-based industry/rating parsing, new `industry_metrics.json` with 11 extended valuation datasets |
| v2.0.0 | 2026-01-11 | **Major update**: 4 files, industries.json replaces ev_sales.json, 2026 ERP structure |
| v1.0.0 | 2025-12-18 | Initial: erp.json + ev_sales.json |

---

*Last updated: 2026-06-05*
