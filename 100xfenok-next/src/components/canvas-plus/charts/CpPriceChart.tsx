"use client";

import dynamic from "next/dynamic";

import type { CpPriceChartProps } from "@/components/canvas-plus/charts/types";

function CpPriceChartLoading() {
  return (
    <div className="cp-chart-shell" data-cp-price-chart-loading>
      <div className="cp-chart-skeleton" aria-hidden="true" />
      <p className="cp-chart-summary">차트 불러오는 중...</p>
    </div>
  );
}

const CpPriceChart = dynamic<CpPriceChartProps>(
  () => import("@/components/canvas-plus/charts/CpPriceChartImpl.client").then((mod) => mod.CpPriceChartImpl),
  {
    ssr: false,
    loading: CpPriceChartLoading,
  },
);

export type { CpChartDatum, CpChartKind, CpChartRange, CpPriceChartProps } from "@/components/canvas-plus/charts/types";

export default CpPriceChart;
