import type {
  StockAnalyzerChartModel,
  StockAnalyzerChartSeries,
  StockAnalyzerRecord,
} from "@/lib/stock-analyzer/types";

const CHART_COLORS = [
  "#1B73D3",
  "#22C55E",
  "#F59E0B",
  "#EF4444",
  "#6366F1",
  "#0EA5E9",
  "#14B8A6",
  "#A855F7",
];

function buildTopMarketCapSeries(
  records: readonly StockAnalyzerRecord[],
): StockAnalyzerChartSeries {
  const points = [...records]
    .filter((record) => typeof record.marketCap === "number")
    .slice(0, 10)
    .map((record) => ({ x: record.symbol, y: record.marketCap ?? 0 }));

  return {
    id: "market-cap-top10",
    label: "Market Cap (USD mn)",
    color: CHART_COLORS[0],
    points,
  };
}

function buildSectorMomentumSeries(
  records: readonly StockAnalyzerRecord[],
): StockAnalyzerChartSeries {
  const sectorGroups = new Map<string, { sum: number; count: number }>();

  for (const record of records) {
    if (record.growthRate === undefined) continue;

    const sector = (record.sector ?? "Unknown").trim() || "Unknown";
    const group = sectorGroups.get(sector) ?? { sum: 0, count: 0 };
    group.sum += record.growthRate;
    group.count += 1;
    sectorGroups.set(sector, group);
  }

  const points = [...sectorGroups.entries()]
    .map(([sector, metrics]) => ({
      x: sector,
      y: metrics.count > 0 ? metrics.sum / metrics.count : 0,
    }))
    .sort((a, b) => b.y - a.y)
    .slice(0, 8);

  return {
    id: "sector-momentum",
    label: "Average 3M Growth",
    color: CHART_COLORS[1],
    points,
  };
}

export class ChartManager {
  buildCharts(records: readonly StockAnalyzerRecord[]): StockAnalyzerChartModel[] {
    const marketCapSeries = buildTopMarketCapSeries(records);
    const sectorMomentumSeries = buildSectorMomentumSeries(records);

    return [
      {
        config: {
          chartId: "market-cap-top10",
          chartType: "bar",
          title: "Top 10 Market Cap",
          yAxisLabel: "USD mn",
          xAxisLabel: "Ticker",
        },
        series: [marketCapSeries],
      },
      {
        config: {
          chartId: "sector-momentum",
          chartType: "line",
          title: "Sector Momentum (3M Avg)",
          yAxisLabel: "Growth Rate",
          xAxisLabel: "Sector",
        },
        series: [sectorMomentumSeries],
      },
    ];
  }
}
