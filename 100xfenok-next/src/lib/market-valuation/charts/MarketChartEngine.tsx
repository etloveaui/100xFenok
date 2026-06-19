"use client";

import dynamic from "next/dynamic";

import type { MarketChartEngineProps } from "./types";

const DynamicMarketChartEngine = dynamic<MarketChartEngineProps>(
  () =>
    import("./MarketChartEngineClient").then(
      (module) => module.MarketChartEngineClient,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-72 min-w-0 place-items-center rounded-xl border border-dashed border-[var(--c-line)] bg-[var(--c-surface-2)] text-xs font-bold text-[var(--c-ink-2)]">
        차트 모듈 로드 중
      </div>
    ),
  },
);

export function MarketChartEngine(props: MarketChartEngineProps) {
  return <DynamicMarketChartEngine {...props} />;
}

export type {
  MarketChartEngineProps,
  MarketChartHoverPoint,
  MarketChartHoverSeriesPoint,
  MarketChartPoint,
  MarketChartSeries,
  MarketChartType,
  MarketChartValueFormatter,
} from "./types";
