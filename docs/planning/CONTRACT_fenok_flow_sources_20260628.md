# CONTRACT: Options and ATS Flow Free Sources v0

Date: 2026-06-28
Status: source-contract verification only
Scope: options regime, ticker option volume proxy, delayed OTC/ATS proxy for #324

## Owner Direction

- Free sources only.
- Raw rows stay admin-only.
- Public outputs are derived Fenok proxy scores only.
- No production collector is approved by this document.
- Do not label these proxies as true buyer/seller order flow or real-time
  dark-pool intent.

## Source Contracts

### Cboe Put/Call CSV Files

- `source_id`: `cboe_put_call_csv`
- `provider`: Cboe
- `endpoint`: `https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/{totalpc,equitypc,indexpc}.csv`
- `alternate_archive_endpoint`: `https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/{pcratioarchive,equitypc,indexpcarchive}.csv`
- `access_type`: `free_public`
- `terms_status`: `needs_owner_review`
- `redistribution_policy`: `derived_only_raw_admin_only`
- `cadence`: daily historical CSV
- `lag`: daily market-statistics cadence; exact publication time not verified
- `rate_limit`: not found
- `raw_public`: false
- `public_derived_path`: future market options-regime overlay
- `fallback`: existing Fenok market sentiment put/call inputs
- `verification_status`: CSV header/sample verified on 2026-06-28
- `evidence`: https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/totalpc.csv
- `terms_evidence`: https://www.cboe.com/terms and https://www.cboe.com/use-of-content

Observed sample fields:

- `DATE`
- `CALLS`
- `PUTS`
- `TOTAL`
- `P/C Ratio`

Boundary:

- Use for market-regime put/call ratios only.
- Do not claim ticker-level order direction.
- CSV text states Cboe terms apply. Separate Cboe terms research indicates
  content reuse/service use requires permission or license outside personal
  non-commercial browsing, so owner review is required before any automated
  collector or redistribution decision.

### Cboe U.S. Options Daily Market Statistics Page

- `source_id`: `cboe_options_daily_market_statistics`
- `provider`: Cboe
- `endpoint`: `https://www.cboe.com/markets/us/options/market-statistics/daily/`
- `access_type`: `free_public_page`
- `terms_status`: `needs_owner_review`
- `redistribution_policy`: `derived_only_raw_admin_only`
- `cadence`: daily page
- `lag`: not fully verified
- `rate_limit`: needs_review
- `raw_public`: false
- `public_derived_path`: future market options-regime overlay
- `fallback`: Cboe put/call CSV files
- `verification_status`: page title and table content observed on 2026-06-28
- `evidence`: https://www.cboe.com/markets/us/options/market-statistics/daily/

Boundary:

- Use as validation/reference for daily options market statistics.
- Prefer CSV files for durable automated parsing if terms pass.

### OCC Volume Query

- `source_id`: `occ_volume_query`
- `provider`: OCC
- `endpoint`: `https://marketdata.theocc.com/volume-query?reportDate=YYYYMMDD&format=csv&volumeQueryType=O&symbolType=U&symbol={TICKER}&reportType=D&productKind=OSTK&porc={C|P}`
- `access_type`: `free_public_endpoint_observed`
- `terms_status`: `needs_owner_review`
- `redistribution_policy`: `derived_only_raw_admin_only`
- `cadence`: daily query by report date
- `lag`: date availability window not fully verified
- `availability_status`: [not verified] exact daily volume-query release time is not confirmed from the public batch-processing page
- `initial_scheduler_guidance`: KST morning after FINRA's known worst-case window, with source-specific polling/retries; do not default to 23:45 ET / 12:45 KST unless empirical polling proves it is needed
- `poll_window_kst`: 08:00-10:30 initial unverified window pending empirical polling
- `rate_limit`: not found
- `raw_public`: false
- `public_derived_path`: `computed/fenok_occ_options_volume.json` feeds the approved public summary score
- `fallback`: none for the public score; yfinance option-chain snapshots are admin-only PoC if kept
- `verification_status`: NVDA/MU 20260626 call/put CSV sample verified; producer formula `fenok-occ-options-volume-v0.2-volume-skew-calibration` maps the measured latest-per-ticker p5/p95 log-ratio band (`-0.90..+3.45`) piecewise to `0..100`, preserving equal call/put volume as neutral `50`
- `evidence`: https://marketdata.theocc.com/volume-query
- `docs_evidence`: https://www.theocc.com/market-data/market-data-reports/other-market-data-info/batch-processing/volume-query-batch-processing
- `terms_evidence`: https://www.theocc.com/specialpages/legal/terms-and-conditions

Observed sample fields:

- `quantity`
- `underlying`
- `symbol`
- `actype`
- `porc`
- `exchange`
- `actdate`

Boundary:

- Use as listed-options call/put volume skew proxy only.
- Do not infer buyer/seller initiation, OPRA flow, greeks, sweeps, blocks, or premium flow.
- All-eligible expansion must stay batched and request-budgeted. The default
  `--all-eligible` mode is a 50-ticker batch with a 100-request max budget,
  one report date by default, and a fail threshold. Use `--plan-only` first.
- Do not automate beyond a bounded owner-approved collector; OCC terms research
  flags automated systems and commercial exploitation constraints.

### FINRA OTC/ATS Weekly Summary

- `source_id`: `finra_otc_ats_weekly_summary`
- `provider`: FINRA
- `endpoint`: `https://api.finra.org/data/group/otcMarket/name/weeklySummary`
- `metadata_endpoint`: `https://api.finra.org/metadata/group/otcMarket/name/weeklySummary`
- `historic_endpoint`: `https://api.finra.org/data/group/otcMarket/name/weeklySummaryHistoric`
- `access_type`: `free_public_credential_or_public_endpoint_observed`
- `terms_status`: `owner_approved_for_admin_only_api_integration_2026_07_24`
- `redistribution_policy`: `derived_only_raw_admin_only`
- `cadence`: weekly
- `lag`: FINRA specification states Tier 1 NMS has a two-week delay and Tier 2/OTC has a four-week delay
- `rate_limit`: synchronous Query API hard-capped locally at 100 requests per run; FINRA platform limits remain an outer bound
- `raw_public`: false
- `public_derived_path`: future delayed ATS/OTC proxy
- `fallback`: existing 13F/YF institutional proxy only
- `verification_status`: metadata, unauthenticated bounded POST batch filter, tier delays, and current OAuth contract re-measured on 2026-07-24; live secret OAuth remains dispatch-gated
- `evidence`: https://www.finra.org/filing-reporting/otc-transparency
- `api_spec_evidence`: https://www.finra.org/sites/default/files/OTC-Transparency-Data-File-Download-API-v04.pdf
- `rate_limit_evidence`: https://developer.finra.org/docs

Observed sample fields:

- `issueSymbolIdentifier`
- `issueName`
- `MPID`
- `marketParticipantName`
- `tierIdentifier`
- `summaryStartDate`
- `totalWeeklyShareQuantity`
- `totalWeeklyTradeCount`
- `totalNotionalSum`
- `summaryTypeCode`

Boundary:

- Use as delayed ATS/OTC activity proxy only.
- Do not label as real-time dark-pool prints.
- Raw venue/MPID rows stay admin-only unless terms are explicitly cleared.
- API integration is owner-cleared for this admin-only lane by work order
  `fh-20260724-081-cc-d01b63ea`; credential failures fail closed and never
  downgrade automatically to public access.

### FINRA ATS Block Data

- `source_id`: `finra_ats_block_data`
- `provider`: FINRA
- `endpoint`: FINRA OTC Transparency ATS Block family; exact API dataset name still requires API catalog confirmation
- `access_type`: `free_public_credential_or_public_endpoint_candidate`
- `terms_status`: `approved_for_public_reference_needs_owner_review_for_api_integration`
- `redistribution_policy`: `derived_only_raw_admin_only`
- `cadence`: monthly in FINRA specification
- `lag`: delayed publication; exact dataset route pending
- `rate_limit`: published platform limits exist; exact local account policy remains owner-review gated
- `raw_public`: false
- `public_derived_path`: future delayed ATS block proxy
- `fallback`: weeklySummary without block component
- `verification_status`: FINRA specification confirms ATS Block Data concept and fields; exact endpoint not yet verified
- `evidence`: https://www.finra.org/sites/default/files/OTC-transparency-data-user-guide-v4.pdf
- `api_spec_evidence`: https://www.finra.org/sites/default/files/OTC-Transparency-Data-File-Download-API-v04.pdf

Boundary:

- Use only after exact dataset route and terms are verified.
- If unavailable, omit block features and cap dark-pool/ATS confidence.

## Implementation Gate

Before any collector is added:

1. Owner accepts or updates `terms_status=needs_owner_review`. Completed for
   weeklySummary only by `fh-20260724-081-cc-d01b63ea` on 2026-07-24.
2. Raw storage path is admin-only.
3. Public artifact contains only derived proxy scores.
4. Rate-limit and retry policy are encoded in the collector contract.
5. Freshness and confidence are separate fields.
6. UI labels must say options-volume proxy or delayed ATS proxy, never true net
   flow or real-time dark-pool intent.
