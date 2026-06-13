// S&P 500 annual-returns adapter (FORGE Slice A1, Claude/cc-29).
//
// Builds a typed MarketModel on top of the A0 loaders. The source array is stored
// newest-first (2026 -> 1926), so we rely on the loaders' date sort rather than
// rows[len-1] — fixing the order-assumption trap (gate note N2: explicit fields, no
// averaging fallback; `return` is an explicit key, so the loader selects it directly).

import {
  MARKET_SOURCES,
  buildCoverageEntry,
  latestSeriesPoint,
  loadRawSeries,
  loadSummarySeries,
  type MarketSourceConfig,
} from "./loaders";
import type { MarketModel, SeriesPoint } from "./types";

const SOURCE_ID = "sp500AnnualReturns" as const;

export interface AnnualReturnLatest {
  year: number;
  /** Annual total return in percent (e.g. 11.27). */
  return: number;
}

function yearOf(point: SeriesPoint | null): number {
  if (!point) return 0;
  if (typeof point.year === "number") return point.year;
  const parsed = Number.parseInt(point.date.slice(0, 4), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Returns the full annual-returns series (date-ascending) plus the latest year,
 * with coverage proving zero dormant (all 101 years reachable). null when the
 * source is unavailable — callers render an explicit empty/error state, never a
 * silent blank.
 */
export async function annualReturnsModel(
  nowIso?: string,
): Promise<MarketModel<AnnualReturnLatest> | null> {
  const series = await loadSummarySeries(SOURCE_ID); // loaders sort ascending by date
  if (series.length === 0) return null;

  const meta = await buildCoverageEntry(SOURCE_ID, nowIso);
  if (!meta) return null;

  const last = latestSeriesPoint(series);
  const latest: AnnualReturnLatest = {
    year: yearOf(last),
    return: typeof last?.value === "number" ? last.value : 0,
  };

  const config: MarketSourceConfig = MARKET_SOURCES[SOURCE_ID];
  return {
    source: config.source,
    rawSource: config.rawSource,
    latest,
    series,
    meta,
    loadFull: () => loadRawSeries(SOURCE_ID),
  };
}
