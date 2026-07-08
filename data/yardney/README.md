# Yardney Data

> **Last Updated**: 2026-07-08
> **Source**: Yardeni model workbook (`야데니모델.xlsx`)
> **Frequency**: Weekly
> **Public Schema**: Market inputs plus derived valuation fields; raw bond-yield components are excluded from public payloads.

---

## Files

| File | Records | Date Range | Description |
|------|---------|------------|-------------|
| `yardney_model.json` | 1,876 | 1990-02-02 ~ 2026-07-03 | Yardeni Bond PER, S&P 500 fair value, premium/discount |

## Latest Record

| Date | SPX | Fair Value | Premium |
|------|-----|------------|---------|
| 2026-07-03 | 7,483.24 | 6,381.29 | +17.27% |

## Update Policy

- Append missing weekly dates by default.
- Existing dates are preserved as historical records.
- Workbook revisions to existing dates are reported by the converter and require an explicit rebuild decision to overwrite.

## Consumer

- AA daily digest reads `yardney_model.json` for S&P 500 fair value.
- 100x market valuation reads the same public valuation payload for charting and premium/discount context.
- Full raw bond-yield components are kept only in the non-public internal store used by the converter.
