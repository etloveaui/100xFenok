import type { ScreenerStock } from "@/lib/screener/types";

export type ComparisonMode = "stocks" | "sectors" | "countries";
export type AnalysisDates = { sourceDate: string | null; marketFactsDate?: string | null };
type NumericKey = { [K in keyof ScreenerStock]-?: NonNullable<ScreenerStock[K]> extends number ? K : never }[keyof ScreenerStock];

export const COMPARISON_METRICS: ReadonlyArray<{
  key: NumericKey; label: string; percent?: boolean; min: number; max: number; reverse?: boolean; weight: number;
}> = [
  { key: "roe", label: "ROE", percent: true, min: -0.2, max: 0.5, weight: 0.25 },
  { key: "growthRate", label: "성장률", percent: true, min: -0.5, max: 0.4, weight: 0.2 },
  { key: "momentum12m", label: "12개월 모멘텀", percent: true, min: -0.6, max: 1, weight: 0.2 },
  { key: "per", label: "선행 PER", min: 0, max: 80, reverse: true, weight: 0.2 },
  { key: "dividendYield", label: "배당수익률", percent: true, min: 0, max: 0.1, weight: 0.15 },
];

export type ComparisonEntity = {
  id: string; name: string; count: number;
  values: Partial<Record<NumericKey, number | null>>;
  coverage: Partial<Record<NumericKey, number>>;
};

export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function comparisonEntities(stocks: readonly ScreenerStock[], mode: ComparisonMode): ComparisonEntity[] {
  const groups = new Map<string, { name: string; count: number; sums: Partial<Record<NumericKey, number>>; coverage: Partial<Record<NumericKey, number>> }>();
  const keys: NumericKey[] = [...COMPARISON_METRICS.map((metric) => metric.key), "eps", "rank", "marketCap", "momentum1m", "momentum3m", "momentum6m"];
  for (const stock of stocks) {
    const id = mode === "stocks" ? stock.ticker : (mode === "sectors" ? stock.sector : stock.country) || "미분류";
    let group = groups.get(id);
    if (!group) {
      group = { name: mode === "stocks" ? `${stock.ticker} · ${stock.name}` : id, count: 0, sums: {}, coverage: {} };
      groups.set(id, group);
    }
    group.count += 1;
    for (const key of keys) {
      // EPS in different listing currencies cannot be averaged across funds.
      if (key === "eps" && mode !== "stocks") continue;
      const value = stock[key];
      if (!finite(value)) continue;
      if (key === "per" && value <= 0) continue;
      group.sums[key] = (group.sums[key] ?? 0) + value;
      group.coverage[key] = (group.coverage[key] ?? 0) + 1;
    }
  }
  return [...groups].map(([id, group]) => ({
    id, name: group.name, count: group.count, coverage: group.coverage,
    values: Object.fromEntries(keys.map((key) => [key, group.coverage[key] ? group.sums[key]! / group.coverage[key]! : null])),
  }));
}

export function normalizedComparison(entity: ComparisonEntity): Array<number | null> {
  return COMPARISON_METRICS.map((metric) => {
    const value = entity.values[metric.key];
    if (!finite(value)) return null;
    const ratio = Math.max(0, Math.min(1, (value - metric.min) / (metric.max - metric.min)));
    return (metric.reverse ? 1 - ratio : ratio) * 100;
  });
}

export function comparisonScore(entity: ComparisonEntity): number | null {
  const values = normalizedComparison(entity);
  if (values.some((value) => value === null)) return null;
  return values.reduce<number>((sum, value, index) => sum + value! * COMPARISON_METRICS[index].weight, 0) / 20;
}

export function analysisCell(value: unknown): string {
  if (value === null || value === undefined || (typeof value === "number" && !finite(value))) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const EXPORT_COLUMNS: ReadonlyArray<{ key: NumericKey; label: string; percent?: boolean }> = [
  { key: "price", label: "price_source_currency" }, { key: "marketCap", label: "market_cap_USD_mn" },
  { key: "per", label: "forward_PE" }, { key: "pbr", label: "PB" }, { key: "peg", label: "PEG" },
  { key: "dividendYield", label: "dividend_yield_pct", percent: true },
  { key: "roe", label: "ROE_pct", percent: true }, { key: "opm", label: "operating_margin_pct", percent: true },
  { key: "growthRate", label: "growth_pct", percent: true }, { key: "eps", label: "EPS_source_currency" },
  { key: "rank", label: "rank" }, { key: "momentum1m", label: "momentum_1m_pct", percent: true },
  { key: "momentum3m", label: "momentum_3m_pct", percent: true }, { key: "momentum6m", label: "momentum_6m_pct", percent: true },
  { key: "momentum12m", label: "momentum_12m_pct", percent: true },
  { key: "return12m", label: "return_12m_pct", percent: true },
  { key: "ret3y", label: "return_3y_pct", percent: true }, { key: "ret5y", label: "return_5y_pct", percent: true },
  { key: "perBandMin", label: "PE_band_min" }, { key: "perBandAvg", label: "PE_band_avg" }, { key: "perBandMax", label: "PE_band_max" },
  ...([1, 2, 3] as const).flatMap((year) => [
    { key: `forwardPeFy${year}` as NumericKey, label: `forward_PE_FY${year}` },
    { key: `forwardEpsFy${year}` as NumericKey, label: `forward_EPS_FY${year}_source_currency` },
    { key: `revenueGrowthFy${year}` as NumericKey, label: `revenue_growth_FY${year}_pct`, percent: true },
    { key: `epsGrowthFy${year}` as NumericKey, label: `EPS_growth_FY${year}_pct`, percent: true },
  ]),
];

export function screenerAnalysisCsv(stocks: readonly ScreenerStock[], dates: AnalysisDates): string {
  const header = ["ticker", "name", "sector", "country", "exchange", "profile_as_of", "market_facts_as_of", ...EXPORT_COLUMNS.map((column) => column.label)];
  const rows = stocks.map((stock) => [stock.ticker, stock.name, stock.sector, stock.country, stock.exchange,
    dates.sourceDate, dates.marketFactsDate, ...EXPORT_COLUMNS.map((column) => {
      const value = stock[column.key];
      return finite(value) ? value * (column.percent ? 100 : 1) : null;
    })]);
  return "\ufeff" + [header, ...rows].map((row) => row.map(analysisCell).join(",")).join("\r\n");
}

export function comparisonCsv(entities: readonly ComparisonEntity[], sourceDate: string | null): string {
  const header = ["name", "members", "source_as_of", "comparison_score_0_to_5", ...COMPARISON_METRICS.flatMap((metric) => [
    `${metric.key}${metric.percent ? "_pct" : ""}`, `${metric.key}_available_members`,
  ]), "EPS_source_currency", "rank", "market_cap_USD_mn"];
  const rows = entities.map((entity) => [entity.name, entity.count, sourceDate, comparisonScore(entity),
    ...COMPARISON_METRICS.flatMap((metric) => {
      const value = entity.values[metric.key];
      return [finite(value) ? value * (metric.percent ? 100 : 1) : null, entity.coverage[metric.key] ?? 0];
    }), entity.values.eps, entity.values.rank, entity.values.marketCap]);
  return "\ufeff" + [header, ...rows].map((row) => row.map(analysisCell).join(",")).join("\r\n");
}
