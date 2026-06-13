// Coverage registry helpers (FORGE Slice A0, Claude/cc-29).
//
// Turns the owner mandate "zero dormant data" into a measurable invariant:
// for every source on a Market surface, reachable_count must equal available_count.
// Adapters (A1) populate entries; auditZeroDormant() proves the invariant in tests/gates.

import type {
  CoverageEntry,
  CoverageRegistry,
  DownsamplePolicy,
  Surface,
} from "./types";

export interface BuildCoverageArgs {
  source: string;
  rawSource?: string;
  availableCount: number;
  reachableCount: number;
  defaultVisibleCount: number;
  previewVisibleCount?: number;
  downsamplePolicy: DownsamplePolicy;
  surface: Surface;
  /** Pass an ISO timestamp so callers control time (testability + non-DOM runtimes). */
  nowIso?: string;
}

/** Build a normalized coverage entry from measured counts. */
export function buildCoverage(args: BuildCoverageArgs): CoverageEntry {
  return {
    source: args.source,
    raw_source: args.rawSource,
    available_count: args.availableCount,
    reachable_count: args.reachableCount,
    default_visible_count: args.defaultVisibleCount,
    preview_visible_count: args.previewVisibleCount,
    downsample_policy: args.downsamplePolicy,
    surface: args.surface,
    last_verified: args.nowIso ?? new Date().toISOString(),
  };
}

/** Dormant points = available - reachable. Owner mandate: 0 on Market surfaces. */
export function dormantCount(entry: CoverageEntry): number {
  return Math.max(0, entry.available_count - entry.reachable_count);
}

const MARKET_SURFACES: ReadonlySet<Surface> = new Set<Surface>([
  "ledger-default",
  "route",
  "drawer",
]);

/**
 * Audit the registry against the zero-dormant invariant.
 * Returns the sources that still hide depth on a Market surface (empty = PASS).
 */
export function auditZeroDormant(registry: CoverageRegistry): string[] {
  return Object.values(registry)
    .filter((e) => MARKET_SURFACES.has(e.surface) && dormantCount(e) > 0)
    .map((e) => e.source);
}

/** Merge/replace a coverage entry into a registry (keyed by source). */
export function registerCoverage(
  registry: CoverageRegistry,
  entry: CoverageEntry,
): CoverageRegistry {
  return { ...registry, [entry.source]: entry };
}
