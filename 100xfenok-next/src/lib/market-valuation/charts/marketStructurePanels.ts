// Market Structure panel adapters (FORGE Slice C, Claude/cc-29).
//
// Explicit, per-panel conversions from the marketStructureModel into chart series
// the MarketChartFrame can render. Deliberately NOT generic — each panel keeps its
// own field meaning (cx-9's B0 warning) and domain order. Default series come from
// the summary; the panel component swaps to rawChartSeries(loadFull()) on MAX so the
// UI actually reaches full depth (gate note N1).

import type {
  MarketStructureModel,
} from "../models/marketStructureModel";
import type { SeriesPoint } from "../models/types";
import type { MarketChartPoint, MarketChartSeries } from "./types";

function pointsFrom(series: readonly SeriesPoint[]): MarketChartPoint[] {
  return series.map((point) => ({ label: point.date, value: point.value }));
}

/** TGA + stablecoins liquidity trends (one series each). */
export function liquidityChartSeries(model: MarketStructureModel): MarketChartSeries[] {
  return model.liquidity.map((item) => ({
    id: item.id,
    label: item.label,
    points: pointsFrom(item.series),
  }));
}

/** CNN fear/greed components (one series per component). */
export function sentimentChartSeries(model: MarketStructureModel): MarketChartSeries[] {
  return model.sentiment.map((item) => ({
    id: item.id,
    label: item.label,
    points: pointsFrom(item.series),
  }));
}

/** AAII bull-bear spread (single series). */
export function aaiiChartSeries(model: MarketStructureModel): MarketChartSeries[] {
  if (!model.aaii) return [];
  return [
    {
      id: "aaii_spread",
      label: "AAII Bull-Bear",
      points: pointsFrom(model.aaii.series),
    },
  ];
}

/**
 * Wrap a raw full-depth series (from a model's loadFull) into a chart series.
 * Used by the panel component when the user selects MAX, so reachable depth is
 * actually rendered rather than only asserted in the coverage registry.
 */
export function rawChartSeries(
  id: string,
  label: string,
  raw: readonly SeriesPoint[],
): MarketChartSeries {
  return { id, label, points: pointsFrom(raw) };
}
