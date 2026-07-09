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
- KOSPI may expose secondary input-only fields when KRX exact market-cap
  weights are available. Public card promotion still requires freshness and
  KRX raw-data terms review.
- CCMP and SOX stay secondary/backlog until source coverage and public-product
  blockers are closed.
- KOSPI must use Korea risk-free inputs (`IRLTLT01KRM156N` when available, or
  KRX KTS nominal 10Y when wired) and must never fall back to US DGS10.
- Screenshots/workbook cells are discovery evidence only; builder code must not
  hardcode their numeric values.
- `peg_ratio` formula/sources must use `derived.explicit_eps_growth_3y` as the
  default denominator; any row-level growth denominator must be explicitly
  documented as a divergence.
- `forecast_grid_v1.periods[fy1].eps_growth` is a source-reported analyst
  growth snapshot, not an earnings-path roll-forward input. It must carry
  `growth_basis=source_reported_eps_growth_snapshot` and
  `growth_usage=context_only_not_earnings_roll_forward`, and the FY1
  `earnings_proxy` must remain anchored to benchmark EPS.
- FY2/FY3 roll-forward rows must carry `derivation_depth` and
  `source_confidence` markers when they depend on prior derived rows. Their
  `eps_growth` values must carry `growth_basis=forward_eps_ratio` and
  `growth_usage=earnings_path_roll_forward`.
- Any public UI/API consumer that reads RIM forecast-grid `eps_growth` must
  gate display/usage on `growth_usage=earnings_path_roll_forward`. Context-only
  rows such as FY1 must not be rendered as RIM path growth.

## Proxy Diagnostics

- `coverage_diagnostics.proxy_constituent_candidates` records local ETF proxy
  candidates for CCMP, KOSPI, and SOX without promoting them to exact index
  weights.
- `derived.proxy_inputs_v1` may expose proxy-only input grids for in-scope
  backlog indices when coverage clears the threshold. These fields must remain
  nested under `proxy_inputs_v1`, keep `exact_index_substitute=false`, preserve
  top-level blockers, and must not make the index public-ready.
- Current candidates:
  - CCMP: `ONEQ` via `stockanalysis/etfs/ONEQ.json`; below the 0.75 public-card
    coverage threshold.
  - KOSPI: `EWY` via `stockanalysis/etfs/EWY.json`; KRX symbols are normalized
    for diagnostics only. EWY is an MSCI Korea ETF proxy and must not be used
    as KOSPI RIM weights when KRX KOSPI market-cap rows are available.
  - SOX: `SOXX` via `stockanalysis/etfs/SOXX.json`; clears the coverage
    threshold but remains a semiconductor ETF proxy, not literal PHLX SOX.
- Proxy coverage may guide backlog work, but UI/public labels must preserve the
  proxy caveat until the exact index source is wired or the owner approves a
  proxy-labeled product.

## KOSPI KRX Inputs

- KOSPI weights use KRX issuer-level `MKTCAP / sum(MKTCAP)` from the private
  stock-daily source referenced by `data/admin/fenok-edge-korea-krx-daily-index.json`.
- Current denominator is the KOSPI stock-daily issuer `MKTCAP` sum, matching the
  KOSPI including foreign shares aggregate in `kospi_dd_trd`.
- Raw KRX rows remain private/admin. Public payloads may expose derived scalar
  values, coverage, and private path references, but must not redistribute raw
  rows without terms review.
- KRX KTS nominal 10Y may provide Korea risk-free input when FRED/OECD KR10Y is
  absent. Inflation-linked 10Y rows must be filtered out.

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
node 100xfenok-next/scripts/check-rim-index-consumer-growth-guard.mjs
npm --prefix 100xfenok-next run qa:rim-index
cmp data/computed/rim-index/inputs.json 100xfenok-next/public/data/computed/rim-index/inputs.json
grep -n "0.0948\\|0.0998\\|0.059603\\|0.070707" scripts/build-*.mjs && exit 1 || true
```
