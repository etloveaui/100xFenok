# Macro Multichart Vision

> Status: accepted as the P9-D native macro-chart direction. This note preserves
> the service boundary referenced by `docs/planning/PLAN_data_spine_service_layer_20260624.md`.

## Intent

Replace the legacy `/multichart` iframe/prototype with a first-party
Data Spine-native `/macro-chart` route that can become a durable public service
surface.

## Boundary

- Use static public Data Spine JSON only. No browser-side external provider calls.
- Keep `/multichart` as a redirect to `/macro-chart`.
- Do not add paid providers, credentials, or runtime installs for the first slice.
- Keep Chart.js category/ISO labels until the TimeScale adapter decision is made.

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

## Deferred

- P1b: decide whether Chart.js `TimeScale` + adapter is worth the dependency.
- P3: brush/zoom, crosshair sync, formula series, and PNG export.
