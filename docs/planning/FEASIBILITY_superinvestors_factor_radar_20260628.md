# FEASIBILITY: Superinvestors Factor Radar Data

Date: 2026-06-28
Status: feasible with owner/legal review
Scope: deferred track-d-v2 factor-exposure radar for `/superinvestors`

Local context:

- `CONTRACT_superinvestors_charts_20260628.md` defers the v2 factor radar
  until a factor-data decision is made.
- Platform `ACTIVE_TASKS.md` currently marks `(d-v2) 팩터 레이더` as paused
  because Fama-French data is needed and proxy-only would mislead.
- Current `portfolio_views` types have holdings rows and performance series, but
  no factor-exposure field yet.

## Decision

Fama-French factor returns can be sourced free from the Ken French Data Library
for a future superinvestors factor-exposure radar.

Proxy-only is not unavoidable because the official library exposes monthly and
daily CSV ZIP files for the Fama/French 3 factors, Fama/French 5 factors, and
momentum factor without login or API key.

Recommended product boundary:

- raw factor files: admin/private only
- public surface: Fenok-derived factor exposure/tilt scores only
- UI copy: "factor exposure proxy" unless the model passes a separate
  regression-quality gate
- owner/legal review: required before automated collection or redistribution

## Source Fit

Primary source:

- Ken French Data Library
- Official page: `https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html`
- Candidate files:
  - `ftp/F-F_Research_Data_5_Factors_2x3_CSV.zip`
  - `ftp/F-F_Research_Data_5_Factors_2x3_daily_CSV.zip`
  - `ftp/F-F_Momentum_Factor_CSV.zip`
  - `ftp/F-F_Momentum_Factor_daily_CSV.zip`

Observed on 2026-06-28:

- 5-factor monthly ZIP: HTTP 200, `content-type: application/x-zip-compressed`,
  `last-modified: Sat, 30 May 2026 05:09:10 GMT`
- 5-factor monthly file header uses the 202604 CRSP database
- 5-factor daily file also uses the 202604 CRSP database
- momentum monthly ZIP opens and contains a `Mom` factor series

Cadence judgment:

- Acceptable for `/superinvestors` because the current 13F/performance surface
  is quarterly and already lag-aware.
- Monthly factor returns are the right default; daily files are available but
  not necessary for a 13F portfolio radar unless later daily portfolio returns
  exist.
- Treat freshness as source-lagged, not real-time.

Coverage fit:

- 5-factor monthly starts at 1963-07 with `Mkt-RF`, `SMB`, `HML`, `RMW`, `CMA`,
  `RF`.
- Momentum monthly starts earlier and can be joined separately as `Mom`.
- This covers the radar axes Fenok needs: market, size, value, quality/profit,
  investment/conservatism, and momentum.

## Licensing / Redistribution Boundary

Free access is verified, but broad redistribution is not cleared.

The official pages include copyright and permission language, so Fenok should
not publish the raw rows or mirror the full ZIPs in public artifacts until the
owner explicitly accepts the legal/terms boundary.

Allowed first slice if approved:

- bounded private/admin fetch
- store source URL, `as_of`, file `last_modified`, file hash, and row count
- publish only derived factor tilt/exposure values with source attribution
- cache raw files outside public web assets

Blocked until owner/legal review:

- public raw CSV/ZIP redistribution
- claiming Ken French endorsement
- exposing raw factor rows in public JSON
- automated scraping beyond a bounded official-file fetch

## Modeling Implication

Do not ship a "true factor exposure" claim from the current 22-quarter
superinvestor performance series alone.

Safer v2 shape:

1. aggregate monthly factor returns to the same quarterly dates as the
   portfolio performance series
2. run a constrained/regularized regression only for investors with enough
   observations
3. attach confidence based on sample length, residual fit, and data coverage
4. fall back to holdings-level proxy axes when regression quality is weak

Public labels:

- OK: `Fenok factor exposure proxy`
- OK: `Fama-French-informed tilt`
- Avoid: `true factor exposure`, `institutional factor model`, `real-time
  factor flow`

## Recommendation

Proceed with a gated Fama-French ingestion design, not proxy-only.

If owner/legal review passes, use Ken French monthly 5-factor plus monthly
momentum data as the private source and expose only derived, confidence-scored
radar values. If review does not pass, keep the existing proxy-only plan
(value = PER/PBR/PEG, quality = ROE/OPM, momentum = momentum3m, size =
marketCap) and label it explicitly as holdings metric proxy.

## Evidence

- Existing track-d contract:
  `docs/planning/CONTRACT_superinvestors_charts_20260628.md`
- Ken French Data Library:
  `https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html`
- Fama/French 5-factor details:
  `https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/f-f_5_factors_2x3.html`
- Momentum factor details:
  `https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/det_mom_factor.html`
