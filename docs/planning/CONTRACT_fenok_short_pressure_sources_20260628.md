# CONTRACT: Short-Pressure Free Sources v0

Date: 2026-06-28
Status: source-contract verification only
Scope: FINRA short-pressure sources for #324

## Owner Direction

- Free sources only.
- Raw rows stay admin-only.
- Public outputs are derived Fenok proxy scores only.
- StockTwits and other social sources remain disabled until terms review.
- No production collector is approved by this document.

## Source Contracts

### FINRA Daily Short Sale Volume Files

- `source_id`: `finra_daily_short_sale_volume_files`
- `provider`: FINRA
- `endpoint`: `https://cdn.finra.org/equity/regsho/daily/CNMSshvolYYYYMMDD.txt`
- `access_type`: `free_public`
- `terms_status`: `needs_owner_review`
- `redistribution_policy`: `derived_only_raw_admin_only`
- `cadence`: daily
- `lag`: FINRA states daily files are posted by 6:00 p.m. ET on the trade date; rare subsequent updates are possible.
- `availability_window_kst`: next-day 07:00 during EDT, next-day 08:00 during EST
- `initial_scheduler_guidance`: KST morning after the known FINRA window; do not default to 23:45 ET / 12:45 KST without empirical need.
- `poll_window_kst`: 07:05-09:30 initial window, with retries encoded in the collector manifest
- `rate_limit`: not found in the public static-file page
- `raw_public`: false
- `public_derived_path`: future `data/computed/short_pressure.json`
- `fallback`: FINRA Reg SHO Daily API
- `verification_status`: sample row verified on 2026-06-28
- `evidence`: https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data/daily-short-sale-volume-files
- `terms_review`: `docs/planning/TERMS_REVIEW_finra_short_pressure_20260628.md`

Derived-only candidates:

- `short_volume_ratio`
- `short_exempt_ratio`
- `short_volume_pressure`

Implemented producer calibration:

- `fenok-flow-proxies-v0.3-short-pressure-calibration`
- static `short_volume_ratio` band `0.28..0.77`, anchored on the measured
  2026-07-18 p5/p95 distribution (`687` scored US rows)
- exact `0/100` endpoint mass falls from `24.60%` under the retired
  `[0.35, 0.70]` band to `10.19%`

Boundary:

- `ShortVolume / TotalVolume` must be labeled as FINRA reported short-sale
  volume share, not off-exchange percent.
- It does not prove buyer/seller direction and does not identify true ATS-only
  dark-pool prints.

### FINRA Reg SHO Daily API

- `source_id`: `finra_regsho_daily_api`
- `provider`: FINRA
- `endpoint`: `https://api.finra.org/data/group/otcMarket/name/regShoDaily`
- `access_type`: `free_public_credential_or_public_endpoint_observed`
- `terms_status`: `needs_owner_review`
- `redistribution_policy`: `derived_only_raw_admin_only`
- `cadence`: daily trade-report-date rows
- `lag`: rolling 12-month dataset according to FINRA API docs research
- `rate_limit`: FINRA API docs research indicates published platform limits; exact local account policy still owner-review gated
- `raw_public`: false
- `public_derived_path`: future `data/computed/short_pressure.json`
- `fallback`: static daily TXT files
- `verification_status`: `limit=1` sample returned JSON fields on 2026-06-28; `HEAD` returned 405, so use GET/POST checks
- `evidence`: https://developer.finra.org/docs

Observed sample fields:

- `tradeReportDate`
- `securitiesInformationProcessorSymbolIdentifier`
- `shortParQuantity`
- `shortExemptParQuantity`
- `totalParQuantity`
- `marketCode`
- `reportingFacilityCode`

### FINRA Consolidated Short Interest API

- `source_id`: `finra_consolidated_short_interest_api`
- `provider`: FINRA
- `endpoint`: `https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest`
- `access_type`: `free_public_credential_gated_candidate`
- `terms_status`: `needs_owner_review`
- `redistribution_policy`: `derived_only_raw_admin_only`
- `cadence`: twice monthly
- `lag`: FINRA states publication on the 7th business day after the reporting settlement date; API docs research indicates availability by 4:40 p.m. ET on publication date
- `rate_limit`: FINRA API docs research indicates published platform limits; exact local account policy still owner-review gated
- `raw_public`: false
- `public_derived_path`: future `data/computed/short_pressure.json`
- `fallback`: omit short-interest features and cap confidence
- `verification_status`: official data page verified; route remains owner-review gated before implementation
- `evidence`: https://www.finra.org/finra-data/browse-catalog/equity-short-interest

Derived-only candidates:

- `short_interest_float`
- `days_to_cover`
- `short_interest_change`
- `short_squeeze_setup`

## Implementation Gate

Before any collector is added:

1. Owner accepts `terms_status=needs_owner_review` or upgrades it after review.
2. Raw storage path is admin-only.
3. Public artifact contains only derived proxy scores.
4. Rate-limit and retry policy are encoded in the collector contract.
5. Source freshness and model confidence are separate fields.
