# Stock Analyzer data contracts

The data-provider, filter, chart and dashboard types remain shared by the native
Screener, stock detail, ticker search and command palette. Do not remove these
modules with the retired legacy assets.

The former `/tools/stock-analyzer` and `/tools/stock-analyzer/native` entry points
redirect to `/screener`, including administrator and design-version requests.
Native analysis exports and stock/sector/country comparisons live in
`src/app/screener/ScreenerAnalysisTools.tsx`. Their calculations and CSV formatting
live in `src/app/screener/screener-analysis.ts`.

The retired static tree is not a data source. Current financial inputs come from
the native data providers and retain their supplied source dates.
