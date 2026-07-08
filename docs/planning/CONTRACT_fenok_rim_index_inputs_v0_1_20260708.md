# Fenok RIM Index Inputs Contract v0.1

Date: 2026-07-08

## Scope

- Canonical generator: `scripts/build-rim-index.mjs`
- Canonical output: `data/computed/rim-index/inputs.json`
- Public mirror: `100xfenok-next/public/data/computed/rim-index/inputs.json`
- Package hooks:
  - `npm --prefix 100xfenok-next run build:rim-index`
  - `npm --prefix 100xfenok-next run qa:rim-index`
  - `npm --prefix 100xfenok-next run sync-static`

## Public Policy

- The payload is a source-tiered workbench for index RIM analysis.
- SPX/NDX may include `derived.forecast_grid_v1`, a near-term financial path
  generated from 100x variables and formulas.
- Public JSON must not contain `fair_value` or `target_price`.
- Every observed, derived, blocked, or assumed field must expose `source_tier`.
- SPX and NDX are the first public-ready input/forecast-grid slices.
- CCMP, KOSPI, and SOX stay secondary/backlog until source coverage and public-product blockers are closed.
- KOSPI must use Korea 10Y (`IRLTLT01KRM156N`) when available and must never fall back to US DGS10.
- Screenshots/workbook cells are discovery evidence only; builder code must not
  hardcode their numeric values.
- `peg_ratio` formula/sources must use `derived.explicit_eps_growth_3y` as the
  default denominator; any row-level growth denominator must be explicitly
  documented as a divergence.
- FY2/FY3 roll-forward rows must carry `derivation_depth` and
  `source_confidence` markers when they depend on prior derived rows.

## Proxy Diagnostics

- `coverage_diagnostics.proxy_constituent_candidates` records local ETF proxy
  candidates for CCMP, KOSPI, and SOX without promoting them to exact index
  weights.
- Current candidates:
  - CCMP: `ONEQ` via `stockanalysis/etfs/ONEQ.json`; below the 0.75 public-card
    coverage threshold.
  - KOSPI: `EWY` via `stockanalysis/etfs/EWY.json`; KRX symbols are normalized
    for diagnostics and currently clear the 0.75 financial-coverage threshold,
    but this is still an MSCI Korea ETF proxy, not official KOSPI weights.
  - SOX: `SOXX` via `stockanalysis/etfs/SOXX.json`; clears the coverage
    threshold but remains a semiconductor ETF proxy, not literal PHLX SOX.
- Proxy coverage may guide backlog work, but UI/public labels must preserve the
  proxy caveat until the exact index source is wired or the owner approves a
  proxy-labeled product.

## Automation

- `sync-static` rebuilds the RIM inputs before copying the data tree into Next public data.
- `qa:fenok-edge-readiness` and `qa:fenok-edge-public-bundle` include `qa:rim-index`.
- `update-manifest.yml` rebuilds and stages the canonical output plus the public mirror.
- `fenok-edge-daily.yml` stages the RIM output when daily derived artifacts are committed.
- `fetch-fred-banking.yml` requests `IRLTLT01KRM156N`, then rebuilds and checks
  RIM inputs in the same run so refreshed FRED rates flow into the canonical
  and public mirror payload without waiting for a later manifest job.

## Verification

```bash
node scripts/test-build-rim-index.mjs
node scripts/build-rim-index.mjs --check
npm --prefix 100xfenok-next run qa:rim-index
cmp data/computed/rim-index/inputs.json 100xfenok-next/public/data/computed/rim-index/inputs.json
grep -n "0.0948\\|0.0998\\|0.059603\\|0.070707" scripts/build-*.mjs && exit 1 || true
```
