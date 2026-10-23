import { fetchJsonOrNull } from "@/lib/client/data-fetch";

/* eslint-disable @typescript-eslint/no-explicit-any */

type YfData = Record<string, any>;

/** Read only equivalent fields captured in this same Yahoo document. */
export function yfFinanceForDisplay(value: unknown): YfData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as YfData;
  const info = { ...(data.info ?? {}) };
  const targets = { ...(data.analyst_price_targets ?? {}) };
  const holders = { ...(data.major_holders ?? {}) };
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (!finite(info.currentPrice) && finite(info.regularMarketPrice)) info.currentPrice = info.regularMarketPrice;
  for (const [target, source] of [["low", "targetLowPrice"], ["high", "targetHighPrice"], ["mean", "targetMeanPrice"], ["median", "targetMedianPrice"]]) {
    if (!finite(targets[target]) && finite(info[source])) targets[target] = info[source];
  }
  for (const [target, source] of [["insidersPercentHeld", "heldPercentInsiders"], ["institutionsPercentHeld", "heldPercentInstitutions"]]) {
    if (!finite(holders[target]) && finite(info[source])) holders[target] = info[source];
  }
  return { ...data, info, analyst_price_targets: targets, major_holders: holders };
}

/** Yahoo periods are 0m, -1m, ...; array order is not the observation clock. */
export function latestYfRecommendation(value: unknown): YfData | null {
  if (!Array.isArray(value)) return null;
  let latest: YfData | null = null;
  let latestMonth = -Infinity;
  for (const row of value) {
    const match = typeof row?.period === "string" ? /^(0|-\d+)m$/.exec(row.period) : null;
    if (match && Number(match[1]) > latestMonth) {
      latest = row;
      latestMonth = Number(match[1]);
    }
  }
  // An empty current row remains empty; never fill it with a past recommendation.
  return latest;
}

export interface IndustryBench {
  name: string;
  source_date?: string | null;
  num_firms: number | null;
  trailing_pe: number | null;
  forward_pe: number | null;
  roe: number | null;
  cost_of_capital: number | null;
  operating_margin: number | null;
  net_margin: number | null;
}

type BenchDoc = {
  source_date?: string | null;
  yf_industry_map?: Record<string, string>;
  industries?: Record<string, Omit<IndustryBench, "name">>;
};

export function loadIndustryBenchmarks(): Promise<BenchDoc | null> {
  // Through the shared layer: successes are cached by the layer; a failure is
  // never cached, so it retries instead of sticking (the old pending promise
  // used to hold a resolved http-error null for the whole visit).
  return fetchJsonOrNull<BenchDoc>("/data/damodaran/industry_benchmarks.json");
}

export function resolveIndustryBench(doc: BenchDoc | null, yfIndustry: string | undefined | null): IndustryBench | null {
  if (!doc || !yfIndustry) return null;
  const key = doc.yf_industry_map?.[yfIndustry];
  const row = key ? doc.industries?.[key] : undefined;
  return key && row ? { name: key, ...row, source_date: doc.source_date?.trim() || null } : null;
}

