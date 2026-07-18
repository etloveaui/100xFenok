# CONTRACT: Fenok Signal Lens Proxy Spine v0.1

Date: 2026-06-28
Status: private/admin derived prototype implemented
Scope: Fenok-native reconstruction of screenshot-observed long-term and
short-term signal methodology
Source map: `docs/planning/RESEARCH_fenok_signal_lens_free_sources_20260628.md`

## Implemented Artifacts

- `scripts/build-fenok-flow-proxies.mjs`
  - FINRA daily short-sale volume TXT
  - local YF consolidated volume denominator
  - outputs `data/computed/fenok_flow_proxies.json`
  - appends `data/computed/fenok_flow_proxies_history.json`
- `scripts/build-fenok-signal-lens-proxies.mjs`
  - consolidates long-term native axes, SPY tracking similarity, technical
    indicator proxy, options proxy, off-exchange proxy, short-pressure proxy,
    and news-tone proxy status
  - outputs `data/computed/fenok_signal_lens_proxies.json`
  - outputs private/admin summary
    `data/computed/fenok_signal_lens_proxies_summary.json`
  - appends `data/computed/fenok_signal_lens_proxies_history.json`
- `scripts/fetch-fenok-news-tone-proxy.mjs`
  - bounded GDELT headline sample collector
  - raw articles stay under `_private/admin/fenok-flow/gdelt_news/{TICKER}.json`
  - outputs derived-only `data/computed/fenok_news_tone_proxy.json`
  - appends `data/computed/fenok_news_tone_proxy_history.json`
- `scripts/fetch-fenok-private-options.py`
  - targeted yfinance option-chain snapshots
  - writes only `_private/admin/fenok-flow/yf_options/{TICKER}.json`
  - does not write `data/yf/finance/` or any public mirror
- `scripts/update-fenok-signal-lens-proxies.mjs`
  - one-command local updater for FINRA flow, private option snapshots, GDELT
    headline samples, and all-axis consolidation
  - supports `--dry-run`, `--tickers`, and skip flags for safe sharding

## Raw Boundary

- FINRA raw TXT cache:
  `_private/admin/fenok-flow/finra/regsho_daily/`
- Targeted option-chain raw snapshots:
  `_private/admin/fenok-flow/yf_options/`
- GDELT raw article samples:
  `_private/admin/fenok-flow/gdelt_news/`
- No `100xfenok-next/public/data/computed/fenok_*proxy*.json` mirror is written.
- `100xfenok-next/sync-static-overrides.mjs` removes these private-only computed
  mirrors after `sync-static` copies `../data` into `public/`.
- The same sync override strips public `yf/finance/*.json` option chains; raw
  option snapshots belong only under `_private/admin/fenok-flow/yf_options/`.
- Public/product surfaces must expose only owner-approved derived scores.

## Current Coverage

Current full US universe run:

- rows: 637
- profitability: 636
- durability profitability: 636
- growth: 636
- upside potential: 637
- downside pressure: 637
- peer similarity: 637
- SPY tracking similarity: 637
- technical flow: 636
- technical indicator proxy: 637
- net options proxy: 8 targeted reference tickers
- off-exchange activity proxy: 579
- short-pressure proxy: 579
- direct news tone proxy: 3 targeted reference tickers after bounded GDELT
  collection

## Semantics

- Signal-lens formula `fenok-signal-lens-proxies-v0.2-ma-distance` replaces the
  binary `80/30` MA20/50/200 components with declared close-to-MA distance
  bands: below `-10/-5/-2%` scores `10/25/40`, `-2%..+2%` scores `50`, and
  above `+2/+5/+10%` scores `60/75/90`.
- Invalid or non-positive latest/MA values remain `null`; the output records
  each MA distance percentage and band beside the component score.
- A formula-version change starts a fresh signal-lens history series so rows
  computed under an older formula are never relabeled as current-formula data.
- `offExchangeActivityProxyScore` is FINRA-reported off-exchange activity
  relative to local consolidated volume. It is not true ATS-only dark-pool flow.
- `shortPressureProxyScore` is FINRA-reported short-sale volume share. It is not
  short interest, borrow fee, utilization, or buy/sell direction.
- `netOptionsProxyScore` is a private option-chain volume/OI proxy. It is not
  OPRA buyer/seller initiated flow.
- `directNewsToneProxyScore` is a headline lexical proxy. It is not social
  sentiment and not a live news firehose.
- `sp500TrackingSimilarityScore` is daily return correlation vs SPY, separate
  from the existing peer-vector similarity.

## Commands

```sh
node scripts/update-fenok-signal-lens-proxies.mjs --dry-run
node scripts/update-fenok-signal-lens-proxies.mjs

# Equivalent manual sequence:
node scripts/build-fenok-flow-proxies.mjs
python3 scripts/fetch-fenok-private-options.py --reference-only --max-age-hours 12
node scripts/fetch-fenok-news-tone-proxy.mjs --reference-only --max-records 10 --sleep-ms 5500 --retries 2
node scripts/build-fenok-signal-lens-proxies.mjs
```

Validation:

```sh
node --check scripts/build-fenok-flow-proxies.mjs
node scripts/test-build-fenok-flow-proxies.mjs
node --check scripts/build-fenok-signal-lens-proxies.mjs
node scripts/test-build-fenok-signal-lens-proxies.mjs
npm --prefix 100xfenok-next run qa:fenok-signal-lens-proxies:artifacts
node --check scripts/fetch-fenok-news-tone-proxy.mjs
node scripts/test-fetch-fenok-news-tone-proxy.mjs
python3 -m py_compile scripts/fetch-fenok-private-options.py
node --check scripts/update-fenok-signal-lens-proxies.mjs
node scripts/test-update-fenok-signal-lens-proxies.mjs
git diff --check
```

## Remaining Work

- Add scheduled shard policy for GDELT; retry/backoff is implemented, and the
  observed service limit is one request per five seconds.
- Decide which derived scores, if any, may join the public summary.
- Wire admin-only inspection UI after owner review.
