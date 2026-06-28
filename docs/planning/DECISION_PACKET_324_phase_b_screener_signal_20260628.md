# DECISION PACKET: #324 Phase B Screener Signal Column

Date: 2026-06-28
Status: owner-gated prep only
Scope: proposal only; no screener wiring in this packet

## Decision Needed

Approve or reject a Phase B screener exposure for the Fenok native signal layer.

Recommended first screener column:

- `upside_downside`

User-facing label:

- `Fenok Edge`

Do not ship this without owner approval. Phase A approval remains limited to the
`/stock/[ticker]` Fenok signal lens card and the public slim summary payload.

## Why This Signal First

The native signal layer currently exposes five public summary signals:

- `profitability`
- `growth`
- `technical_flow`
- `upside_downside`
- `market_similarity`

Recommended Phase B starts with `upside_downside` because it is the most suitable
single screener sort/filter column:

- It has full current coverage: 1,066 / 1,066 rows.
- It is explicitly a neutral-centered derived score, not true order flow.
- It answers a screener-native question: "where is the Fenok-calculated
  upside/downside setup strongest?"
- It avoids duplicating existing profitability, growth, and momentum columns.
- It avoids `market_similarity`, whose current score distribution is too
  compressed for a primary rank column.

Current summary payload coverage observed from `data/computed/fenok_signals_summary.json`:

- `profitabilityScore`: 1,042 rows
- `growthScore`: 1,043 rows
- `technicalFlowScore`: 1,042 rows
- `upsideDownsideScore`: 1,066 rows
- `marketSimilarityScore`: 1,048 rows

Current score distribution check:

- `upsideDownsideScore`: 60 rows >=70, 452 rows 50-69, 554 rows <50
- `marketSimilarityScore`: 1,027 rows >=70, 21 rows 50-69, 0 rows <50

Interpretation:

- `upside_downside` has enough range for sorting and threshold filters.
- `market_similarity` is better as an explanation/detail helper, not a rank
  column.
- `technical_flow` can be revisited after source-contract wording is mature;
  current v0 technical flow is price/momentum proxy only, not order flow.

## Proposed Product Treatment

Column:

- Key: `fenokEdgeScore`
- Source field: `upsideDownsideScore`
- Secondary source fields: `upsideDownsideDirection`, `confidence`,
  `coverageRatio`, `asOf`
- Label: `Fenok Edge`
- Render: compact score pill, e.g. `74` plus a tiny direction dot or arrow.
- Tooltip/title: `Fenok derived upside/downside proxy; confidence={label};
  coverage={pct}; as_of={date}`.

Sorting:

- Descending by default.
- Null or missing rows sort last.
- Keep existing `toggleSort()` mechanics; this is a numeric `ScreenerSortKey`.

Filtering:

- Add one advanced filter only after approval:
  - `Fenok Edge >= 70`
  - `Fenok Edge >= 60`
  - `Fenok Edge >= 50`
- Do not add direction, confidence, or per-signal multi-select filters in the
  first slice. They increase control density and state-key churn without clear
  first-release value.

Column presets:

- Add the column to the `action` preset after `actionScore`.
- Do not add it to the `basic` preset in the first release, so the default first
  viewport remains stable.
- Mobile: add it to `MOBILE_PRESET_KEYS.action` only.
- Optional later: a dedicated `fenok` preset can be considered after usage data.

Copy boundary:

- Allowed: `Fenok derived upside/downside proxy`
- Avoid: `smart money`, `Prospero`, `dark pool`, `options flow`, `order flow`,
  or `real-time` wording.

## Implementation Shape If Approved

No code is approved by this packet. If owner approves, keep the implementation
slice narrow:

1. Extend `ScreenerStock` and `ScreenerSortKey` with:
   - `fenokEdgeScore?: number | null`
   - `fenokEdgeDirection?: string | null`
   - `fenokSignalConfidence?: string | null`
   - `fenokSignalCoverageRatio?: number | null`
   - `fenokSignalAsOf?: string | null`
2. Load `fenok_signals_summary.json` once in `useScreenerData()` alongside the
   existing stock records and connection indexes.
3. Join by uppercase ticker into the mapped `ScreenerStock` rows.
4. Add one `COLUMNS` entry and preset placement.
5. Render the cell with a small score pill.
6. Add one threshold filter only if owner wants filtering in the first release.

Existing relevant surfaces:

- `100xfenok-next/src/lib/screener/types.ts`
- `100xfenok-next/src/hooks/useScreenerData.ts`
- `100xfenok-next/src/app/screener/ScreenerClient.tsx`
- `100xfenok-next/src/features/stock-analyzer/data/fenok-signals-summary-provider.ts`

## Performance And Virtualization Impact

Current screener facts:

- `PAGE_SIZE = 50`
- `DESKTOP_ROW_HEIGHT = 52`
- Desktop table virtualizes only the current page rows.
- `pageRows` is derived from `sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)`.
- Desktop renders `desktopVirtualRows`, not every page row at once.

Expected incremental cost:

- One extra public JSON fetch: current slim payload is about 194 KB.
- One `Map` join across about 1,066 rows.
- One additional numeric sort key in the existing sort path.
- No new row expansion, chart, or per-cell network call.

Risk guardrails:

- Do not load the private full `fenok_signals.json` in public UI.
- Do not call `loadFenokSignalsSummaryMap()` once per row.
- Keep join at data-load time, not render time.
- Keep the first release to one visible column in one preset.
- If build or render cost regresses, remove the column/preset entry and leave the
  Phase A stock-card summary provider untouched.

## Rollback

Rollback should be a UI-only revert:

1. Remove the `Fenok Edge` column from `COLUMNS` and presets.
2. Remove the new `ScreenerStock` fields and data join.
3. Keep `fenok_signals_summary.json` generation and `/stock/[ticker]` card
   unchanged.
4. No data rebuild is required unless the owner also rejects the Phase A summary
   artifact.

## First Collector: FINRA Short-Pressure Go/No-Go

Collector status:

- Prep only. No production collector is approved.
- Free sources only.
- Raw FINRA rows must remain admin/private only.
- Public surfaces may expose only Fenok-derived scores with freshness and
  confidence fields.

Recommended first collector:

- FINRA Daily Short Sale Volume / Reg SHO daily short-volume data.

Why first:

- It is daily, ticker-level, and directly supports a short-pressure proxy.
- It does not require buyer/seller inference.
- It can produce simple derived fields:
  - `short_volume_ratio`
  - `short_exempt_ratio`
  - `short_volume_pressure`
  - `as_of`
  - `source_lag`
  - `confidence`

Per-source terms-review status:

| Source | Technical status | Terms status | Owner decision |
|---|---:|---:|---|
| FINRA Daily Short Sale Volume Files | sample row verified 2026-06-28 | needs owner review | approve derived-only collector or hold |
| FINRA Reg SHO Daily API | JSON `limit=1` sample verified 2026-06-28; `HEAD` returns 405 | needs owner review | approve as API fallback or hold |
| FINRA Consolidated Short Interest API | official page verified; route remains gated/candidate | needs owner review | hold for later slice |
| StockTwits/social | disabled | terms not cleared | no-go |

Recommended owner answer:

- Go for a bounded FINRA short-pressure collector only after terms review accepts
  `derived_only_raw_admin_only`.
- No-go for social sentiment and any raw public redistribution.
- Hold consolidated short interest until API access and terms are confirmed.

## Acceptance Criteria For A Future Approved Slice

- No screener code ships before owner approval.
- Public payload contains derived Fenok scores only.
- Raw source files are outside `100xfenok-next/public/`.
- UI copy avoids real-time flow, dark-pool, buyer/seller, or smart-money claims.
- `npm run lint -- src/app/screener/ScreenerClient.tsx src/hooks/useScreenerData.ts src/lib/screener/types.ts`
  passes.
- `npm exec tsc -- --noEmit` passes.
- `git diff --check` passes.

## References

- `docs/planning/CONTRACT_fenok_native_signals_v0_1_20260628.md`
- `docs/planning/CONTRACT_fenok_short_pressure_sources_20260628.md`
- `docs/planning/CONTRACT_fenok_flow_sources_20260628.md`
- `100xfenok-next/src/app/screener/ScreenerClient.tsx`
- `100xfenok-next/src/hooks/useScreenerData.ts`
- `100xfenok-next/src/lib/screener/types.ts`
- `100xfenok-next/src/features/stock-analyzer/data/fenok-signals-summary-provider.ts`
