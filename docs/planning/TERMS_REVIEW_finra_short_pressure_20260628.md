# TERMS REVIEW: FINRA Short-Pressure Sources

Date: 2026-06-28
Status: owner-review only
Scope: Daily Short Sale Volume and Reg SHO API for future short-pressure proxy

## Decision Needed

Approve or reject a future bounded collector for FINRA short-pressure inputs.

Current recommendation:

- Approve terms review, not collector implementation.
- If approved later, keep raw FINRA rows admin/private only.
- Public output must be a Fenok-derived proxy score with source freshness,
  confidence, and explicit limitations.

No collector code is approved by this document.

## Source 1: Daily Short Sale Volume Files

Endpoint pattern:

- `https://cdn.finra.org/equity/regsho/daily/CNMSshvolYYYYMMDD.txt`

Observed access:

- Free public static text file.
- No login or API key observed.
- Sample `CNMSshvol20260626.txt` returned `HTTP/2 200` on 2026-06-28.
- Response content type observed as `text/plain`.

Observed file header:

- `Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market`

Sample row observed:

- `20260626|NVDA|17705180.795191|133288|49047927.127418|B,Q,N`

Official cadence note:

- FINRA states daily files are generally posted by 6:00 p.m. ET on the trade
  date, with rare later corrections possible.

Parsing note:

- Treat volume fields as decimal numeric. The public layout guidance may imply
  whole-number numeric fields, but current observed 2026 samples include
  decimals.

## Meaning Boundary

Do not label `ShortVolume / TotalVolume` as `off-exchange %`.

Safer label:

- `FINRA TRF/ADF reported short-sale volume share`

Korean UI/internal gloss:

- `FINRA TRF/ADF 보고 거래 중 공매도 거래량 비율`

Reason:

- `ShortVolume` is short-sale volume reported in the FINRA daily file.
- `ShortExemptVolume` is the short-exempt subset.
- `TotalVolume` is the total volume reported in the FINRA daily file.
- The file is not consolidated exchange plus off-exchange market volume.
- It cannot prove buyer/seller direction and cannot identify true ATS-only
  dark-pool prints.

Allowed derived fields:

- `finra_short_volume_share = ShortVolume / TotalVolume`
- `finra_short_exempt_share = ShortExemptVolume / TotalVolume`
- `finra_short_pressure_score`
- `as_of`
- `source_lag`
- `confidence`

Disallowed public labels:

- `dark pool %`
- `off-exchange %` for `ShortVolume / TotalVolume`
- `buyer/seller flow`
- `smart money flow`
- `real-time flow`

Optional future proxy:

- If a separate consolidated market-volume source is approved, `FINRA
  TotalVolume / consolidated total volume` may be considered as a non-exchange
  reporting proxy. That must be labeled separately and terms-reviewed for both
  sources.

## Source 2: FINRA Reg SHO Daily API

Endpoint:

- `https://api.finra.org/data/group/OTCMarket/name/regShoDaily`

Observed access:

- JSON `limit=1` sample returned data on 2026-06-28.
- `HEAD` returned `405`, so health checks should use bounded GET or POST if a
  collector is later approved.

Observed fields:

- `tradeReportDate`
- `securitiesInformationProcessorSymbolIdentifier`
- `shortParQuantity`
- `shortExemptParQuantity`
- `totalParQuantity`
- `marketCode`
- `reportingFacilityCode`

Use boundary:

- API fallback or structured source for the same derived short-pressure proxy.
- Same raw-admin-only and derived-public-only policy as the static files.
- Same label restriction: no dark-pool, buyer/seller, real-time, or smart-money
  claim.

## Supplemental Sources

### ChartExchange

Technical status:

- Public pages can expose exchange-volume tables without login.
- Pages label `Off Exchange` and also use dark-pool marketing/meta wording.

Policy status:

- Owner-review needed before any automated collection or redistribution.

Recommended use:

- Reference/benchmark only, not a Fenok collector source at this stage.
- Do not scrape for production until terms are explicitly cleared.

### Excluded For Free Collector

- Fintel: terms and access pattern are not suitable for automated free
  collection.
- MarketChameleon: access/automation barriers and terms concerns.
- Nasdaq/Barchart: license/subscription/redistribution constraints.
- Public GitHub wrappers: mostly thin wrappers around FINRA files; direct
  bounded fetch is cleaner if owner approves FINRA.

## Owner Go/No-Go

Go only if the owner accepts:

1. FINRA raw rows remain outside public artifacts.
2. Public output is derived score/proxy only.
3. UI copy uses the safer FINRA short-volume-share wording.
4. Rate limiting, retries, and source-lag metadata are encoded before launch.
5. No social, ChartExchange, Fintel, MarketChameleon, Nasdaq, or Barchart
   collector is added in the first slice.

No-go if:

- Raw redistribution is required.
- Product copy must claim true dark-pool prints or buyer/seller flow.
- Terms review cannot clear automated FINRA collection.

## Evidence

- FINRA Daily Short Sale Volume Files:
  `https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data/daily-short-sale-volume-files`
- FINRA Short Sale Volume overview:
  `https://www.finra.org/finra-data/browse-catalog/short-sale-volume`
- FINRA layout PDF:
  `https://www.finra.org/sites/default/files/2021-07/DailyShortSaleVolumeFileLayout.pdf`
- Sample static file:
  `https://cdn.finra.org/equity/regsho/daily/CNMSshvol20260626.txt`
- FINRA API docs:
  `https://developer.finra.org/docs`
