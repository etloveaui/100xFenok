# Yardney Data

> **Last Updated**: 2026-07-08
> **Source**: Feno Yardeni model: official FRED WAAA/WBAA + 100x S&P 500 benchmark price/EPS; benchmark EPS/SPX is currently Bloomberg-sourced; 1990-2009 history preserved from verified seed
> **Frequency**: Weekly
> **Public Schema**: Market inputs plus derived valuation fields; raw bond-yield components are excluded from public payloads.

---

## Files

| File | Records | Date Range | Description |
|------|---------|------------|-------------|
| `yardney_model.json` | 1,888 | 1990-02-02 ~ 2026-07-03 | Feno Yardeni Bond PER, S&P 500 fair value, premium/discount |

## Latest Record

| Date | SPX | Fair Value | Premium |
|------|-----|------------|---------|
| 2026-07-03 | 7,483.24 | 6,421.44 | +16.54% |

## Update Policy

- Rebuild weekly from the official FRED observations API for WAAA/WBAA and `benchmarks/us.json` S&P 500 `px_last` / `best_eps`.
- Treat the EPS/SPX leg as the existing Bloomberg-sourced benchmark pipeline, not as a FRED-native feed.
- Preserve pre-benchmark seed history through 2009-12-25.
- Keep raw FRED bond-yield components only under the non-public `_private/admin/yardney/` store.
- The legacy Yardeni workbook converter is retained only for backfill or forensic comparison.

## Consumer

- AA daily digest reads `yardney_model.json` for S&P 500 fair value.
- 100x market valuation reads the same public valuation payload for charting and premium/discount context.
- feno-data reads the same stable public schema: `date`, `spx`, `eps`, `bond_per`, `fair_value`, `premium_pct`.
