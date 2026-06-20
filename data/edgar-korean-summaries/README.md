# EDGAR Korean Summaries

This folder mirrors the public Korean SEC filing summary data contract.

## Contract

- `by-ticker/{ticker}.json`: ticker-level manifest consumed by `/stock/[ticker]?tab=filings`.
- `index.json`: ticker availability index. Consumers should read it before `by-ticker/*` to avoid noisy 404s.
- `pilot/*.json`: generated summary artifacts for individual filings.
- Every manifest row must preserve `sourceUrl` so the UI can always link to the SEC original.
- `summaryPath` is optional. Rows without it remain visible as original-only filings with a pending summary state.
- `translationPath` is optional. Full Korean translations are separate from short summaries.
- Summary artifacts must keep short evidence digests and source anchors. Do not embed long SEC source text.
- Run `npm run qa:edgar-summaries` from `100xfenok-next` after adding or editing manifests/artifacts. The check blocks missing evidence anchors and numeric claims that are not present in cited evidence digests.

## Current Coverage

- `NVDA`: 2026 Form 10-K pilot summary.
- `AAPL`: 2025 Form 10-K pilot summary.
