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
      <div className="grid h-72 min-w-0 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-xs font-bold text-slate-400">
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
