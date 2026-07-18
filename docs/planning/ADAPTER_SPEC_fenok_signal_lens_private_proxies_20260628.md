# ADAPTER SPEC: Fenok Signal Lens Private Proxy Adapters

Date: 2026-06-28 KST
Status: derived-score adapters implemented; raw inputs remain private/admin
Public surface: approved derived stock scores only

## Scope

- Goal: absorb the screenshot-derived long/short signal methodology into Fenok-native adapters.
- Product UI target remains two Fenok hexagons: long-term and short-term.
- This spec does not approve public JSON, public raw rows, public screenshots, or copied third-party scores.
- Current implementation must keep raw/source rows under private/admin paths only.

## Mandatory Labels

- `net_options_proxy`: options positioning proxy, not true buyer/seller options flow.
- `off_exchange_activity_proxy`: off-exchange activity, not dark pool.
- `short_pressure_proxy`: noisy pressure proxy, not buy/sell direction.
- `sp500_tracking_similarity`: market tracking similarity, not a directional bullish/bearish signal.
- `direct_corpus_tone_proxy`: private direct-corpus tone only; social collection remains disabled until terms review.

## Formula Ports

### Net Options Proxy

Source basis: OCC listed-options call/put volume by underlying and source date.

Input:

- OCC aggregate call volume.
- OCC aggregate put volume.

Formula:

- `log_ratio = ln((call_volume + 1) / (put_volume + 1))`
- declared endpoints: `floor=-0.90`, `neutral=0`, `ceil=+3.45`
- `floor..neutral` maps linearly to `0..50`; `neutral..ceil` maps to `50..100`
- values outside the endpoints clamp to `0/100`
- endpoints are rounded measured p5/p95 values from the 2026-07-18
  latest-per-ticker OCC projection (`686` rows); equal call/put remains `50`

Private metadata:

- `put_call_volume_ratio`, `call_share`, call/put/total volume, source date.
- Legacy yfinance option-chain OI/GEX/max-pain diagnostics remain private PoC
  fields and do not feed the public OCC score.

Honesty:

- OCC aggregate volume is not OPRA-grade flow.
- Score is a listed-options volume-skew proxy, not trade initiator direction.

### FINRA Off-Exchange Activity Proxy

Input:

- FINRA CNMS daily short-volume file: `Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market`.
- Consolidated total volume denominator from local YF/market facts when available.

Formula:

- `off_exchange_share = FINRA_TotalVolume / consolidated_total_volume`
- `score_0_100 = ((off_exchange_share - 0.25) / (0.65 - 0.25)) * 100`, clamped to `0..100`.
- `0.25/0.65` are the declared rounded p5/p95 calibration endpoints from
  the measured 2026-07-18 distribution (`687` rows).

Public label if approved later:

- `Off-exchange activity`, not `Dark Pool`.

Honesty:

- FINRA CNMS TotalVolume is off-exchange bucket coverage, not ATS-only.
- It can include dark pools, OTC/internalization, and reporting bucket effects.

### FINRA Short Pressure Proxy

Input:

- Same FINRA CNMS file.

Formula:

- `short_ratio = ShortVolume / TotalVolume`
- `score_0_100 = ((short_ratio - 0.28) / (0.77 - 0.28)) * 100`, clamped to `0..100`.
- `0.28/0.77` are the declared rounded p5/p95 calibration endpoints from
  the measured 2026-07-18 distribution (`687` rows).

Honesty:

- Short volume can be market-maker facilitation.
- It is not buy/sell lean and not standalone bearish evidence.

### SPY Tracking Similarity

Input:

- Local 1Y-ish OHLCV history for ticker and SPY.
- Use up to the latest 61 closes from both series.

Formula:

- `r_t = ln(close_t / close_{t-1})`
- `spy_r_t = ln(spy_close_t / spy_close_{t-1})`
- `abs_dev_t = abs((r_t - spy_r_t) * 100)`
- `mean_abs_dev = mean(abs_dev_t)`
- `tracking_error_absdev = stdev(abs_dev_t)`
- Ranking score candidate: percentile rank of `-mean_abs_dev` inside comparable universe.

Honesty:

- This is magnitude-deviation tracking, not beta/correlation.
- High score means "moves like SPY", not "better".

### Direct Corpus Tone Proxy

Input:

- Private feno-rag direct ticker evidence only.
- No related/generic fallback.
- No StockTwits/social feed until terms review.

Formula:

- Evaluate first 5 direct items.
- Count positive/negative lexical cues in title + summary.
- `raw = clamp((positive_hits - negative_hits) / 2, -2, 2)`.
- `score_0_100 = 50 + 12.5 * raw`, clamped to `0..100`.

Honesty:

- This is a lexical cue proxy, not social sentiment.
- Raw titles/summaries remain private.

## Private Loader Scaffold

Script:

- `scripts/fetch-fenok-finra-daily-private.mjs`

Cache path:

- `_private/admin/fenok-flow/finra/regsho_daily/CNMSshvolYYYYMMDD.json`

Git/public guard:

- `_private/admin/fenok-flow/` is gitignored.
- Loader writes no `data/computed/**` and no `100xfenok-next/public/**`.

Dry parse verification:

```bash
node scripts/test-fetch-fenok-finra-daily-private.mjs
```

Optional single-file fetch after owner approves source use for a date:

```bash
node scripts/fetch-fenok-finra-daily-private.mjs --date 20260626
```

## UI Gate

- `/stock/[ticker]` may prepare two-hexagon code paths, but public render must fall back to the existing 4-signal card until approved Lens fields are explicitly present.
- Final long/short axis assignment is still pending peer design closeout.

## Evidence Pointers

- Screenshot methodology intake: `/Volumes/M470/aw-smb/feno/03_work/20260628-181639_prospero_methodology_screenshots/analysis/prospero_methodology_intake_report_20260628.md`
- Four-pane brief and source acquisition plan: `/Volumes/M470/aw-smb/feno/03_work/2026-06-28_123220_prosperoai-image-intake/analysis/FOUR_PANE_BRIEF_prosperoai_image_intake_20260628.md`
- Formula source: `/Users/fenomenokim/agents-workspace/00_my_data/01_El_Fenomeno/00_Project/Asset_Allocator/docs/agent-work/forecast_arena/enriched_features.py`
