# Macro Chart V2 Implementation Plan

> Owner-approved artboard: `docs/design-handoff/100x-light-system/MacroChartV2.dc.html` in the platform control repo.

**Goal:** Turn the existing Macro Chart into a reading-first FRED-style workbench while preserving the slice-6 data correctness contracts.

**Architecture:** Keep the projected 30-series catalog and loader as the data SSOT. Extend per-series view state for transform, frequency/aggregation, axis, and color; keep range filtering before aggregation/transform; render one hero chart with unit-aware dual axes and an external legend/editor. Reuse URL state and local storage rather than introducing a new persistence service.

**Verification:** Local checks are limited to source inspection and syntax-safe diffs under DEC-403. Each slice is pushed from a clean revision and receives exactly one queue-serialized hosted build-first Cloudflare gate.

---

## Slice A — Reading first

- Add a static contract for the V2 top bar, hero chart, legend/editor, mobile sheet, honest event state, gap preservation, and required colors.
- Extend macro series view state with `% change`, output frequency, aggregation, explicit color, and URL round-trip.
- Aggregate only after range cutoff and before transforms; preserve missing-date gaps.
- Recompose the chart panel: catalog type-ahead, five lens chips, global toggles, range controls, share/export split, persistent legend overlay, 720px desktop chart, 360px mobile chart.
- Add per-series transient edit popover/sheet with transform, frequency, aggregation, axis, color, and remove actions.
- Pass units into the all-series crosshair tooltip and keep UI-font axis/tooltip labels.
- Show recession/event controls as unavailable with the honest `이벤트 피드 없음` state until a compatible feed exists.

## Slice B — Derived series

- Expand formulas to `a - b`, `a / b`, and `a × k` with explicit derived unit/axis metadata.
- Add guarded 10Y−2Y and HY−IG presets only when both required catalog series exist.
- Name derived CSV columns with the displayed formula.
- Add focused formula assertions to the Macro Chart contract.

## Slice C — Reuse

- Move saved lens configurations into `같이 보기` tiles with sparklines and one EvidenceRail per tile.
- Complete collection save/list/rename/delete with local-storage failure fallback.
- Preserve shareable URL state and add the post-transform `표 보기` drawer.
- Add five-state and mobile contracts for tiles, collection controls, and table output.

## Slice completion loop

1. Inspect only the changed source and contract paths.
2. Confirm no raw-color/token/ink4 violations in the candidate diff.
3. Commit and push the slice tip.
4. Wait for the hosted verification queue to become empty.
5. Dispatch one build-first Cloudflare gate and report the pushed tip and run identifier to the lead.
