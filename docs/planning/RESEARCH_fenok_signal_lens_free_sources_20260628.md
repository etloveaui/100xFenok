# RESEARCH: Fenok Signal Lens Free Source Map

Date: 2026-06-28
Status: source map for owner review and next collectors
Scope: free/public data sources for Fenok-native long-term and short-term
signal axes

## Principle

- Use free/public sources only.
- Keep third-party raw rows under `_private/admin/` unless the source is already
  part of the existing public 100x data contract.
- Public product surfaces expose only owner-approved derived scores.
- Do not present proxies as true proprietary flow. Label limitations directly.

## Implemented Now

| Axis | Source | Collector | Current status |
| --- | --- | --- | --- |
| Short pressure proxy | FINRA Daily Short Sale Volume Files | `scripts/build-fenok-flow-proxies.mjs` | implemented, 579/587 FINRA-matched rows |
| Off-exchange activity proxy | FINRA daily total volume vs local YF consolidated volume | `scripts/build-fenok-flow-proxies.mjs` | implemented, 579 scored rows |
| Net options proxy | Private yfinance option-chain snapshots | `scripts/fetch-fenok-private-options.py` | implemented for 8 reference tickers |
| News tone proxy | GDELT DOC headline sample | `scripts/fetch-fenok-news-tone-proxy.mjs` | implemented, rate-limited partial sample |
| SPY tracking similarity | Local YF 1Y daily returns vs SPY | `scripts/build-fenok-signal-lens-proxies.mjs` | implemented, 637 rows |
| Technical indicator proxy | Local 1Y OHLCV, MA/RSI/momentum/volume | `scripts/build-fenok-signal-lens-proxies.mjs` | implemented, 637 rows |

## Official Source Candidates

### FINRA Daily Short Sale Volume

- URL: `https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data/daily-short-sale-volume-files`
- What it gives: daily aggregated short-sale volume by security for trades
  reported to TRF/ADF/ORF; same-day posting no later than 6:00pm ET.
- Fenok use: implemented as `shortPressureProxyScore` and
  `offExchangeActivityProxyScore`.
- Caveat: this is not short interest, borrow fee, utilization, buyer/seller
  intent, or true ATS-only dark-pool prints.

### FINRA OTC / ATS Transparency

- URL: `https://www.finra.org/filing-reporting/otc-transparency`
- What it gives: delayed OTC trading information for ATS and non-ATS member
  firms; derived from FINRA equity trade reporting facilities.
- Fenok use: next collector candidate for weekly ATS baseline and
  off-exchange quality adjustment.
- Caveat: delayed publication. Use as baseline/context, not as real-time flow.

### Cboe Historical Options Data

- URL: `https://www.cboe.com/us/options/market_statistics/historical_data/`
- What it gives: historical options volume across Cboe exchanges by symbol,
  product type, or all symbols for month/year, plus Cboe put/call ratio files.
- Fenok use: candidate supplement for market-wide and symbol-level options
  volume context.
- Caveat: Cboe terms apply; this is exchange-side volume context, not
  buyer/seller initiated options flow.

### OCC Volume / Open Interest Reports

- URL: `https://www.theocc.com/market-data/market-data-reports/volume-and-open-interest/volume-query`
- URL: `https://www.theocc.com/market-data/market-data-reports/volume-and-open-interest/monthly-weekly-volume-statistics`
- What it gives: OCC market data reports including daily volume, open interest,
  stock loan volume, volume by account type, and volume query record layouts.
- Fenok use: candidate supplement for options volume/OI and possible stock-loan
  proxy research.
- Caveat: not a free real-time borrow fee/utilization feed.

### GDELT DOC

- URL: `https://api.gdeltproject.org/api/v2/doc/doc`
- What it gives: public article search API.
- Fenok use: implemented as a headline lexical tone proxy.
- Caveat: rate limits and noisy entity matching. Use sharded retry/backoff and
  cache raw under `_private/admin/`.

## Explicit Non-Goals For Now

- No paid feeds.
- No login-gated scraping.
- No social platform ingestion until terms are reviewed.
- No public raw option-chain mirror.
- No claim that off-exchange proxy equals true dark-pool prints.
- No claim that options volume/open-interest proxy equals buyer/seller flow.

## Next Collector Order

1. Add a daily shard ledger for GDELT so rate-limited retries steadily fill the
   universe without burst traffic.
2. Add FINRA OTC/ATS delayed baseline collector after owner review.
3. Add Cboe/OCC options context collectors after terms/format review.
4. Derive a public-safe summary only after owner approves score labels.
