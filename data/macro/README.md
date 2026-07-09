# Macro Data

> **Version**: 1.0.0
> **Status**: Active
> **Purpose**: Manifest-registered home for banking, liquidity, and monthly activity survey macro series

---

## Files

| File | Source | Frequency | Description |
|------|--------|-----------|-------------|
| `fred-banking-daily.json` | FRED | Daily | 10Y Treasury yield, HY spread, Korea 10Y government yield (`IRLTLT01KRM156N`) after the next collector run |
| `fred-banking-weekly.json` | FRED | Weekly | Total loans, deposits |
| `fred-banking-quarterly.json` | FRED | Quarterly | Delinquency, charge-off, Fed Tier1 |
| `fdic-tier1.json` | FDIC | Quarterly | Average Tier 1 capital ratio |
| `activity-surveys.json` | OECD / S&P Global / ISM | Monthly | OECD CLI, major-country manufacturing/services PMI, ISM components |

---

## Contract

1. Canonical location for these files is `data/macro/`
2. All consumers should read `data/macro/*`

---

## Notes

- `macro` is a single manifest category so Data Lab and `fenok-data-mcp` can query the dataset without special root handling
- File payloads intentionally keep the old JSON shape to avoid consumer breakage during migration
- The daily FRED collector feeds RIM inputs with US DGS10 now and Korea 10Y once `IRLTLT01KRM156N` lands in the same payload; KOSPI must not fall back to DGS10
- Latest FDIC Tier1 refresh: 2026-03-31, average Tier 1 capital ratio 13.3%, 4,352 banks
- `activity-surveys.json` keeps empty source columns in `empty_source_series` but exposes only series with numeric observations
- Latest activity survey refresh: 928 total records; manufacturing/services PMI and ISM components through 2026-06; OECD CLI preserved through 2026-04
