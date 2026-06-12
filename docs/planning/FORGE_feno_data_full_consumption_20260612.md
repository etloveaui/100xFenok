# FORGE: feno-data Full Consumption Atlas

Date: 2026-06-12
Scope: `100xfenok-next` public data inventory, admin consumption path, and UI organization map.

## Mandate

The target is not just "use the most useful data." The app must first expose a
consumption path for every feno-data JSON asset, including historical files and
per-ticker/per-investor payloads. After that baseline is visible, product UI can
organize the data into market, stock, screener, explore, and guru surfaces.

## Measured Inventory

Source of truth: `100xfenok-next/public/data`.

| Slice | Count | Consumption lane |
| --- | ---: | --- |
| Root/admin/metadata | 55 | Admin |
| Benchmarks | 9 | Market |
| Calendar/computed | 4 | Explore |
| Damodaran | 8 | Market + Stock |
| Global Scouter core/raw/detail | 1,085 | Screener + Stock |
| Indices | 3 | Market |
| Macro | 10 | Market |
| SEC 13F analytics/investors | 47 | Guru |
| Sentiment | 14 | Market |
| SlickCharts top-level/stocks | 568 | Market + Explore + Stock |
| Yardeni | 1 | Market |
| YF finance | 1,068 | Stock |
| Total JSON files | 2,872 | All lanes |

## Implementation Contract

- `scripts/generate-static-route-manifest.mjs` recursively indexes every
  `public/data/**/*.json` file, not a hardcoded allowlist.
- `src/generated/static-route-manifest.ts` carries the generated file index for
  server-side fallback and Cloudflare asset environments.
- `/api/data/atlas` returns a full file atlas: path, category, directory, size,
  updated time, historical flag, content class, and canonical consumer lane.
- `/admin/data-lab` renders the atlas above the old health cards so every data
  file has at least one visible app consumption path.

## Organization Map

| Lane | Data families | Rule |
| --- | --- | --- |
| Market | benchmarks, indices, macro, sentiment, yardney, index-level SlickCharts | Valuation, macro pulse, risk tone, breadth, concentration, returns |
| Stock | YF finance, global-scouter detail, SlickCharts stocks/dividends/returns, Damodaran industry inputs | Per-ticker fundamentals, revisions, valuation bands, dividends |
| Screener | global-scouter core/raw/indicators | Universe scan, raw source audit, economic overlays |
| Explore | calendar, computed signals, SlickCharts movers/membership | Fast routing, near-term events, movers, alerts |
| Guru | SEC 13F analytics and investors | Investor holdings, quarter history, conviction |
| Admin | root manifest, schemas, metadata, admin folder | Inventory, freshness, coverage, source health |

## Verification Plan

- Regenerate static route manifest and confirm `2,872` data JSON entries.
- Type-check changed Next.js/TS files with `npx tsc --noEmit --pretty false`.
- Run targeted lint on changed TypeScript files.
- Run `git diff --check`.
- Browser/dev-server validation remains `[not verified]` unless explicitly
  approved, due the current low-resource constraint.

## Verification Report

| Check | Result |
| --- | --- |
| Static route manifest regeneration | PASS: `2,872` data JSON files, `24` directories |
| Atlas API computation smoke | PASS: `2,872` files, `15` categories, `2,213` historical files |
| TypeScript | PASS: `npx tsc --noEmit --pretty false` |
| Targeted ESLint | PASS: `src/lib/server/data-loader.ts`, `src/app/api/data/atlas/route.ts` |
| JS syntax check | PASS: Data Lab dashboard/renderer and manifest generator |
| Whitespace | PASS: `git diff --check` |
| Browser/dev-server | [not verified]: intentionally skipped for low-resource constraint |
