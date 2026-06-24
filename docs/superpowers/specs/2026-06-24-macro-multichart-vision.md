# Macro Multichart Vision

> Status: accepted as the P9-D native macro-chart direction. This note preserves
> the service boundary referenced by `docs/planning/PLAN_data_spine_service_layer_20260624.md`.

## Intent

Restore the chart stack as two separate surfaces: `/macro-chart` remains the
Data Spine-native macro workbench, while `/multichart` is the owner-approved
Stooq Worker-proxy stock/ETF/index comparison tool.

## Boundary

- Use static public Data Spine JSON only. No browser-side external provider calls.
- Keep `/macro-chart` as the "chart above charts"; keep `/multichart` as a
  separate compare route, not a redirect.
- DEC-20260624-P15-0: the owner-owned Stooq Worker proxy is an allowed
  `/multichart` data path. The browser calls the Worker, not Stooq directly; the
  Worker stores nothing, and the client keeps only a 24h per-symbol localStorage
  cache.
- Product entry should collapse chart/tool discovery under Explore. Header/shell
  navigation should not expose separate Multichart, ETF, Sector, Screener, or
  Investor entries.
- Do not add paid providers, credentials, or runtime installs for the first slice.
- Keep Chart.js category/ISO labels for the current service. The TimeScale adapter decision is closed as "defer unless an opt-in engine mode is designed and regression-covered."

## Landed Contract

- P0/P1: 30-series macro catalog, pure transform/alignment helpers, three presets,
  searchable picker, CSV export, URL-selected series/transforms, and legacy
  redirect.
- P1a.5: mobile-first chart/picker layout, share URL state for `range` and hidden
  series, explicit 8-series cap behavior, search debounce, retry/error copy, CSV
  smoke, and `qa:macro-chart` contract coverage.
- P2: browser-local saved analysis presets, keyed axis URL state, auto/left/right
  axis controls, localStorage write/corruption guards, dynamic right-axis title,
  Explore macro playbook entry points, and `qa:macro-chart` coverage for preset
  save/apply plus corrupted saved state.
- P3a: dependency-free depth controls: 3M/6M/3Y date windows, zoom in/out range
  stepping, browser PNG export, spread/ratio formula series from transformed
  chart values, formula URL/localStorage/CSV coverage, and shared Chart.js hover
  crosshair rendering.
- P14/P3a.5: service-grade workbench layer: curated analysis lenses, connected
  product-surface links, analysis summary cards, mobile formula/status chips,
  explicit full-CSV copy, macro catalog `analysis_lenses`/`connection_surfaces`,
  and expanded `qa:macro-chart` static/browser/mobile coverage.
- P15-0/P9-G: restore `/multichart` as the existing stock compare surface by
  removing the `/macro-chart` redirect and restoring Stooq daily CSV fetches via
  the owner-owned Worker proxy plus 24h browser localStorage cache. No repo data
  accumulation or new credential path is introduced.
- P15-A/B/C/D: add a shared macro context key across `/macro-chart`, Explore,
  `/screener`, `/etfs`, and `/stock/[ticker]`. The native macro workbench now
  persists `macro={context}` in shared URLs and saved presets, shows a macro
  insight card, and deep-links each lens into screener presets, ETF filters, and
  representative stock detail routes. `qa:macro-chart` now verifies those
  connected surfaces, not just the chart page.
- P15-Fusion pivot: next direction is not a separate cross-link layer, but one
  `/macro-chart` where Stooq Worker-proxied market symbols and Data Spine macro
  series share the same chart pipeline. Draft contract:
  `docs/planning/CONTRACT_macro_chart_stooq_fusion_20260624.md`.
- P15-Fusion S1 local foundation: `loadMacroSeries` now supports a no-UI
  `sourceKind: "stooq"` path through the owner Worker proxy, using delimiter-safe
  IDs such as `stq~NVDA.US`, Close-price CSV parsing, 24h browser cache, and the
  existing transform/alignment pipeline.

## Deferred

- TimeScale opt-in engine mode: only revisit with adapter choice, `x` value
  contract, mixed-frequency fill-forward checks, URL state, and existing
  market-valuation chart regression coverage.
- P3b: true brush/wheel/pinch zoom and multi-chart crosshair sync. The current
  public service keeps dependency-free range-window controls until the install,
  gesture, mobile, and URL-sync tradeoff is explicit.
