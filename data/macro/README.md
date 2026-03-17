# Macro Data

> **Version**: 1.0.0
> **Status**: Active
> **Purpose**: Manifest-registered home for banking macro series promoted from root compatibility JSON

---

## Files

| File | Source | Frequency | Description |
|------|--------|-----------|-------------|
| `fred-banking-daily.json` | FRED | Daily | 10Y Treasury yield, HY spread |
| `fred-banking-weekly.json` | FRED | Weekly | Total loans, deposits |
| `fred-banking-quarterly.json` | FRED | Quarterly | Delinquency, charge-off, Fed Tier1 |
| `fdic-tier1.json` | FDIC | Quarterly | Average Tier 1 capital ratio |

---

## Contract

1. Canonical location for these files is `data/macro/`
2. All consumers should read `data/macro/*`

---

## Notes

- `macro` is a single manifest category so Data Lab and `fenok-data-mcp` can query the dataset without special root handling
- File payloads intentionally keep the old JSON shape to avoid consumer breakage during migration
