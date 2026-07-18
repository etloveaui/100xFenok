# CONTRACT — YF to Screener Enrichment (#323 residue b)

## Decision

Keep `stocks_analyzer.json` as the screener's single aggregate payload. Enrich
only its existing forward-metric fields at build time; never fetch one Yahoo
file per screener row in the browser.

## Measured baseline (2026-07-19)

- Screener rows: 1,065.
- Matching `yf-finance/v2` equity payloads: 1,065.
- Existing `peForward`: 404; finite Yahoo `forwardPE`: 1,017.
- Existing `epsForward`: 406; finite Yahoo `forwardEps`: 728.
- USD-safe Yahoo EPS fallbacks: 175. The other 147 potential EPS fallbacks
  are non-USD and remain null because the current screener renders EPS as USD.

## Slice contract

1. Read `data/yf/finance/{TICKER}.json` only during
   `scripts/build-stocks-analyzer.mjs`.
2. Accept only `yf-finance/v2` payloads whose ticker identity matches the
   requested symbol.
3. Precedence is `SlickCharts value -> Yahoo fallback -> null`.
4. `forwardPE` is unitless and may be used for any matched equity.
5. `forwardEps` may be used only when Yahoo declares `currency: "USD"`.
6. Emit source labels and aggregate fallback/source-date coverage. Accept a
   valid provider ISO date or timestamp and normalize it to the declared
   calendar date. A missing provider date remains an honest null with a reason;
   it is never replaced by `fetched_at` or build time.
7. The workflow runs the deterministic enrichment contract test before the
   builder. Root/public generated artifacts remain byte-identical.

## Explicit exclusions

- No new screener columns, filters, URL state, or client-side fetches.
- No overwrite of finite SlickCharts values.
- No Yahoo dividend-yield fallback: current provider values use a different
  unit contract from the screener fraction.
- No market-cap fallback: Yahoo stores native-currency absolute values while
  the screener field is USD millions.
- No price/EPS fallback for non-USD rows until native currency is carried end
  to end.
- No beta, target-price, ownership, liquidity, debt, or statement columns in
  this slice. Those require a separately approved product contract.

## Acceptance

- Unit test pins ticker/schema rejection, Slick precedence, fallback behavior,
  invalid/null preservation, and the non-USD EPS guard.
- A local aggregate build reports 1,065 matched rows, 613 Yahoo PE fallbacks,
  175 USD-safe Yahoo EPS fallbacks, 613/613 fallback rows with provider dates,
  and zero non-USD EPS violations.
- Expected aggregate coverage after the measured build: `peForward=1,017`,
  `epsForward=581`.
- No generated data artifact is committed as part of the code slice.
