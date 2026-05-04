# Yardney Data

> **Last Updated**: 2026-05-04
> **Source**: Yardeni model workbook (`야데니모델.xlsx`)
> **Frequency**: Weekly

---

## Files

| File | Records | Date Range | Description |
|------|---------|------------|-------------|
| `yardney_model.json` | 1,867 | 1990-02-02 ~ 2026-05-01 | Moody's AAA/BAA spread, Bond PER, S&P 500 fair value, premium/discount |

## Latest Record

| Date | SPX | Fair Value | Premium |
|------|-----|------------|---------|
| 2026-05-01 | 7,230.12 | 6,015.64 | +20.19% |

## Update Policy

- Append missing weekly dates by default.
- Existing dates are preserved as historical records.
- Workbook revisions to existing dates are reported by the converter and require an explicit rebuild decision to overwrite.

## Consumer

- AA daily digest reads `yardney_model.json` for S&P 500 fair value.
