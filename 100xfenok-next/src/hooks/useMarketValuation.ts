"use client";

import { useEffect, useRef, useState } from "react";
import type {
  IndexMomentum,
  MarketIndexValuation,
  MarketValuationResult,
  MomentumSet,
  ValuationDataSource,
  ValuationDriver,
  ValuationBand,
} from "@/lib/market-valuation/types";

const FETCH_TIMEOUT_MS = 4000;

// Order = market-cap / breadth significance for display.
const INDEX_ORDER = ["sp500", "nasdaq100", "nasdaq_composite", "russell2000"] as const;

interface RawPoint {
  date?: string;
  px_last?: number;
  best_eps?: number;
  best_pe_ratio?: number;
  px_to_book_ratio?: number;
  roe?: number;
}
interface RawSection {
  name?: string;
  name_en?: string;
  data?: RawPoint[];
}
interface RawUs {
  metadata?: { version?: string };
  sections?: Record<string, RawSection | undefined>;
}
interface RawSummaryMetric {
  "1w"?: number | null;
  "1m"?: number | null;
  "3m"?: number | null;
  "6m"?: number | null;
  ytd?: number | null;
}
interface RawSummarySection {
  momentum?: {
    px_last?: RawSummaryMetric;
    best_eps?: RawSummaryMetric;
    best_pe_ratio?: RawSummaryMetric;
    px_to_book_ratio?: RawSummaryMetric;
    roe?: RawSummaryMetric;
  };
}
interface RawSummaries {
  metadata?: {
    version?: string;
    generated?: string;
    source_summary_sections?: number;
    source_summary_non_null_values?: number;
  };
  source_summaries?: Record<string, RawSummarySection | undefined>;
}
interface RawManifestFolder {
  version?: string;
  updated?: string;
  update_frequency?: string;
  source?: string;
  description?: string;
  file_count?: number;
}
interface RawManifest {
  folders?: Record<string, RawManifestFolder | undefined>;
}
interface RawDamodaranErp {
  us_erp?: number;
  metadata?: {
    source?: string;
    source_date?: string;
    generated_at?: string;
  };
}

async function fetchJson<T>(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Build a min/avg/max/percentile band for `current` over a numeric series. */
function buildBand(series: number[], current: number | null): ValuationBand {
  if (series.length === 0) {
    return { current, min: null, avg: null, max: null, percentile: null };
  }
  let min = series[0];
  let max = series[0];
  let sum = 0;
  for (const v of series) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const avg = sum / series.length;
  let percentile: number | null = null;
  if (current !== null) {
    const below = series.reduce((acc, v) => acc + (v <= current ? 1 : 0), 0);
    percentile = Math.round((below / series.length) * 100);
  }
  return { current, min, avg, max, percentile };
}

const EMPTY: MarketValuationResult = {
  indices: [],
  dataSources: [],
  benchmarkSections: null,
  damodaranUsErp: null,
  dataReady: false,
  failed: false,
  sourceDate: null,
};

function normalizeMomentum(metric: RawSummaryMetric | undefined): MomentumSet {
  return {
    "1w": finite(metric?.["1w"]) ? metric!["1w"]! : null,
    "1m": finite(metric?.["1m"]) ? metric!["1m"]! : null,
    "3m": finite(metric?.["3m"]) ? metric!["3m"]! : null,
    "6m": finite(metric?.["6m"]) ? metric!["6m"]! : null,
    ytd: finite(metric?.ytd) ? metric!.ytd! : null,
  };
}

function buildMomentum(section: RawSummarySection | undefined): IndexMomentum | null {
  const m = section?.momentum;
  if (!m) return null;
  return {
    price: normalizeMomentum(m.px_last),
    eps: normalizeMomentum(m.best_eps),
    pe: normalizeMomentum(m.best_pe_ratio),
    pb: normalizeMomentum(m.px_to_book_ratio),
    roe: normalizeMomentum(m.roe),
  };
}

function driverFromMomentum(momentum: IndexMomentum | null): ValuationDriver | null {
  if (!momentum) return null;
  const price = momentum.price.ytd;
  const eps = momentum.eps.ytd;
  const pe = momentum.pe.ytd;
  if (price === null || eps === null || pe === null) return null;

  if (price > 0.03 && eps > 0.03 && pe <= 0) {
    return {
      label: "이익 주도 상승",
      detail: "가격은 올랐지만 P/E는 눌려 밸류 부담이 완화된 흐름",
      tone: "emerald",
    };
  }
  if (price > 0.03 && pe > eps) {
    return {
      label: "멀티플 주도 상승",
      detail: "이익보다 P/E 확장이 더 커서 밸류 부담이 커지는 흐름",
      tone: "amber",
    };
  }
  if (price < -0.03 && eps > 0 && pe < 0) {
    return {
      label: "멀티플 디레이팅",
      detail: "이익은 버티지만 시장이 지불하는 배수가 낮아진 흐름",
      tone: "slate",
    };
  }
  if (price < -0.03 && eps < 0) {
    return {
      label: "이익 훼손",
      detail: "가격과 이익 기대가 같이 내려가는 방어적 신호",
      tone: "rose",
    };
  }
  return {
    label: "혼합 구간",
    detail: "가격·이익·멀티플 방향이 뚜렷하게 한쪽으로 정렬되지 않음",
    tone: "slate",
  };
}

function sourceFromManifest(id: string, label: string, usage: string, manifest: RawManifest | null): ValuationDataSource | null {
  const folder = manifest?.folders?.[id];
  if (!folder) return null;
  return {
    id,
    label,
    source: folder.source ?? "—",
    updated: folder.updated ?? null,
    cadence: folder.update_frequency ?? null,
    coverage: folder.description ?? `${folder.file_count ?? "?"} files`,
    usage,
  };
}

export function useMarketValuation(): MarketValuationResult {
  const [result, setResult] = useState<MarketValuationResult>(EMPTY);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    void (async () => {
      const [raw, summaries, manifest, damodaran] = await Promise.all([
        fetchJson<RawUs>("/data/benchmarks/us.json"),
        fetchJson<RawSummaries>("/data/benchmarks/summaries.json"),
        fetchJson<RawManifest>("/data/manifest.json"),
        fetchJson<RawDamodaranErp>("/data/damodaran/erp.json"),
      ]);
      if (!isMountedRef.current) return;

      if (!raw?.sections) {
        setResult({ ...EMPTY, failed: true });
        return;
      }

      const indices: MarketIndexValuation[] = [];
      for (const id of INDEX_ORDER) {
        const section = raw.sections[id];
        const data = Array.isArray(section?.data) ? section!.data : [];
        if (data.length === 0) continue;

        const latest = data[data.length - 1];
        const peSeries = data.map((p) => p.best_pe_ratio).filter(finite);
        const pbSeries = data.map((p) => p.px_to_book_ratio).filter(finite);
        const momentum = buildMomentum(summaries?.source_summaries?.[id]);

        indices.push({
          id,
          name: section?.name ?? id,
          nameEn: section?.name_en ?? id,
          price: finite(latest?.px_last) ? latest!.px_last! : null,
          date: typeof latest?.date === "string" ? latest!.date! : null,
          pe: buildBand(peSeries, finite(latest?.best_pe_ratio) ? latest!.best_pe_ratio! : null),
          pb: buildBand(pbSeries, finite(latest?.px_to_book_ratio) ? latest!.px_to_book_ratio! : null),
          eps: finite(latest?.best_eps) ? latest!.best_eps! : null,
          roe: finite(latest?.roe) ? latest!.roe! : null,
          momentum,
          driver: driverFromMomentum(momentum),
          points: data.length,
        });
      }

      const dataSources = [
        sourceFromManifest("benchmarks", "Bloomberg Benchmarks", "지수 P/E·P/B·ROE·EPS 역사 밴드와 변화 분해", manifest),
        sourceFromManifest("yardney", "Yardeni Bond PER", "회사채 금리 기반 S&P 500 적정가와 프리미엄", manifest),
        sourceFromManifest("damodaran", "Damodaran ERP", "주식위험프리미엄과 금리 대비 요구수익률 앵커", manifest),
        sourceFromManifest("macro", "Macro/FRED", "금리·유동성·성장 배경을 해석하는 보조 축", manifest),
      ].filter((source): source is ValuationDataSource => source !== null);

      setResult({
        indices,
        dataSources,
        benchmarkSections: summaries?.metadata?.source_summary_sections ?? null,
        damodaranUsErp: finite(damodaran?.us_erp) ? damodaran!.us_erp! : null,
        dataReady: indices.length > 0,
        failed: indices.length === 0,
        sourceDate: raw.metadata?.version ?? null,
      });
    })();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return result;
}
