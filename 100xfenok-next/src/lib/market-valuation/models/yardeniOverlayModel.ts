// Yardeni Bond PER overlay adapter (FORGE Slice B, Codex/cx-9).
//
// The legacy YardeniCard drew a hand-rolled SVG over the latest-loaded JSON.
// This model makes the full weekly series explicit and coverage-auditable so the
// shared MarketChartFrame can provide hover/range/series controls.

import {
  MARKET_SOURCES,
  buildCoverageEntry,
  latestSeriesPoint,
  loadRawSeries,
  loadSummarySeries,
  type MarketSourceConfig,
} from "./loaders";
import type { MarketModel, SeriesPoint } from "./types";

const SOURCE_ID = "yardeniModel" as const;

export interface YardeniOverlayLatest {
  date: string;
  spx: number | null;
  fairValue: number | null;
  premiumPct: number | null;
  eps: number | null;
  bondPer: number | null;
  moodysAaa: number | null;
  moodysBaa: number | null;
  spreadAvg: number | null;
  premiumPercentile: number | null;
}

export interface YardeniOverlayModel extends MarketModel<YardeniOverlayLatest> {
  latest: YardeniOverlayLatest;
}

function numberField(point: SeriesPoint | null, key: string): number | null {
  const value = point?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentile(points: readonly SeriesPoint[], value: number | null): number | null {
  if (value === null) return null;
  const values = points
    .map((point) => numberField(point, "premium_pct"))
    .filter((next): next is number => next !== null)
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  const below = values.reduce((count, next) => count + (next <= value ? 1 : 0), 0);
  return Math.round((below / values.length) * 100);
}

export async function yardeniOverlayModel(
  nowIso?: string,
): Promise<YardeniOverlayModel | null> {
  const series = await loadSummarySeries(SOURCE_ID);
  if (series.length === 0) return null;

  const meta = await buildCoverageEntry(SOURCE_ID, nowIso);
  if (!meta) return null;

  const last = latestSeriesPoint(series);
  const premiumPct = numberField(last, "premium_pct");
  const latest: YardeniOverlayLatest = {
    date: last?.date ?? "",
    spx: numberField(last, "spx") ?? last?.value ?? null,
    fairValue: numberField(last, "fair_value"),
    premiumPct,
    eps: numberField(last, "eps"),
    bondPer: numberField(last, "bond_per"),
    moodysAaa: numberField(last, "moodys_aaa"),
    moodysBaa: numberField(last, "moodys_baa"),
    spreadAvg: numberField(last, "spread_avg"),
    premiumPercentile: percentile(series, premiumPct),
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
