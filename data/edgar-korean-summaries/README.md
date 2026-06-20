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
- Section keys are canonicalized for the app. For `10-K`, request `item_1`, `item_1a`, and `item_7`. For `10-Q`, request only `item_1a` and `item_7`; `item_7` represents Part I Item 2 MD&A, and `item_1a` represents Part II Item 1A Risk Factors.
- A manifest row with `translationStatus: "ready"` must include `translationPath`; rows with `translationPath` must keep source/public mirrors in sync.
- Translation artifacts use `/data/edgar-korean-summaries/translations/{ticker}-{formSlug}-{accession}.json`; `formSlug` is lower-case and path-safe, for example `10-k`, `10-q`, or `10-k-a`.
- Translation artifacts must use `artifactType: "edgar_korean_translation"` and include `company`, `filing`, optional `sourceSummaryPath`, `translationKo.title`, `translationKo.scopeNote`, and `translationKo.sections[]`.
- `translationKo.scopeNote` must say the Korean rendering is AI-generated and not an official/verbatim legal translation.
- Each `translationKo.sections[]` row must include `id`, `sourceSection`, `titleKo`, `bodyKo`, and non-empty `sourceAnchors`. `sourceAnchors` must reference summary artifact evidence IDs, and every numeric token in `bodyKo` must appear in the cited evidence digests. Korean translation text may be long; do not embed long English SEC source text.
- Each translation artifact must include `generation.generatedAtUtc`, `generation.promptVersion`, `generation.model`, `generation.paidQuotaUsed`, and `generation.costUsedUsd` for auditability.
- Run `npm run qa:edgar-summaries` from `100xfenok-next` after adding or editing manifests/artifacts. The check blocks missing evidence anchors and numeric claims that are not present in cited evidence digests.
- Run `npm run qa:edgar-translations` from `100xfenok-next` after adding or editing `translationPath` artifacts. The check validates the translation artifact schema and source/public mirrors.

## Current Coverage

- `NVDA`: 2026 Form 10-K pilot summary.
- `AAPL`: 2025 Form 10-K pilot summary.
