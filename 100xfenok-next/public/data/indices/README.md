# Indices Data

> **Source**: Various
> **Update**: Manual + automated SOX GIW daily
> **Files**: 3

---

## File Catalog

| File | Description |
|------|-------------|
| `sp500.json` | S&P 500 index information |
| `nasdaq.json` | Nasdaq index information |
| `nasdaq-giw-sox-constituents.json` | Nasdaq GIW public SOX constituents for RIM input automation |

## Note

Legacy index data. For current broad US index holdings, see `slickcharts/` folder which provides daily updated data.

SOX uses `nasdaq-giw-sox-constituents.json` from Nasdaq Global Index Watch. The public free GIW view exposes official constituents but not official weight columns, so RIM weights are derived from stock_action market caps with the published SOX methodology cap schedule.

---

*Last Updated: 2026-01-10*
