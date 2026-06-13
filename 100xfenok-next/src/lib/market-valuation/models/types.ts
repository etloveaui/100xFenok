// Shared contract for the /market-valuation model layer (FORGE Slice A0).
//
// Owner mandate: ZERO DORMANT DATA. Every source's full depth must be REACHABLE
// (default view may be curated; availability must not be). The coverage registry
// below makes "zero dormant" measurable, not asserted.
//
// Built by Claude (cc-29) as the contract; loaders.ts (Codex/cx-9) and the
// per-panel adapters (Slice A1) build to these types.
// Code truth: origin/main. Plan: docs/planning/FORGE_market_valuation_ledger_20260613.md

/** One point in a time series. `date` is ISO (YYYY-MM-DD); extra numeric fields per source. */
export interface SeriesPoint {
  date: string;
  value: number;
  [key: string]: number | string;
}

/** Which surface a coverage count is measured against. */
export type Surface = "ledger-default" | "drawer" | "route" | "preview";

/** How a summary artifact was derived from raw — honesty about lost depth. */
export type DownsamplePolicy =
  | "none" // summary === raw
  | "trend-sampled" // raw thinned to a trend series (e.g. tga 5196 -> 42)
  | "latest-only" // only the latest snapshot retained (e.g. PMI cards)
  | "aggregated"; // bucketed / rolled up

/**
 * Coverage of one source on one surface.
 *
 * Invariants (Market = full ledger):
 *   - Market surfaces (route, ledger-default after expand): reachable_count === available_count
 *   - Explore preview: preview_visible_count < reachable_count is allowed
 *
 * "Dormant" = available_count - reachable_count. Owner mandate: dormant === 0 on Market.
 */
export interface CoverageEntry {
  /** Data path actually read for the default view (often a summary). */
  source: string;
  /** Raw path lazy-loaded for full depth, when the summary differs from raw. */
  raw_source?: string;
  /** Total points/fields that exist in the raw source. */
  available_count: number;
  /** Points/fields the UI can reach via default + lazy expansion. */
  reachable_count: number;
  /** Points/fields rendered on first paint (curated; may be < reachable). */
  default_visible_count: number;
  /** Points/fields shown on the Explore preview surface, if any. */
  preview_visible_count?: number;
  downsample_policy: DownsamplePolicy;
  surface: Surface;
  /** ISO timestamp of the last coverage check. */
  last_verified: string;
}

/** A typed model for one panel/source. Adapters (A1) return this; UI consumes it. */
export interface MarketModel<TLatest = Record<string, number | string>> {
  source: string;
  rawSource?: string;
  /** Latest snapshot for cards/headline. */
  latest: TLatest;
  /** Default series (summary or full, per downsample policy). */
  series: SeriesPoint[];
  meta: CoverageEntry;
  /** Lazily resolve the full raw series — full depth reachable, not eager-loaded. */
  loadFull?: () => Promise<SeriesPoint[]>;
}

/** Loader contract implemented by loaders.ts (Codex). Summary is eager, raw is lazy. */
export interface ModelLoaders {
  loadSummary(source: string): Promise<unknown>;
  loadRaw(rawSource: string): Promise<unknown>;
}

/** Registry keyed by source path — the measurable proof of "zero dormant". */
export type CoverageRegistry = Record<string, CoverageEntry>;
