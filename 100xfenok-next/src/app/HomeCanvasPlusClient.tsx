"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import TransitionLink from "@/components/TransitionLink";
import { Bar } from "@/components/ui/Bar";
import { EvidenceRail } from "@/components/ui/EvidenceRail";
import { Panel } from "@/components/ui/Panel";
import { PanelHeader } from "@/components/ui/PanelHeader";
import { Pill } from "@/components/ui/Pill";
import { Tile } from "@/components/ui/Tile";
import { useDashboardData } from "@/hooks/useDashboardData";
import { clamp, getRegimeLabel } from "@/lib/dashboard/formatters";
import { DATA_STATE_LABELS } from "@/lib/data-state";
import type { DashboardSnapshot, DashboardSourceId, SectorSnapshot } from "@/lib/dashboard/types";
import { projectMaterialChanges } from "@/lib/home/material-change";
import { readPersonalFlags, type Flag } from "@/lib/personal/personal-state";
import { EXPLORE_PRODUCT_TITLE } from "@/lib/product-nav";
import { ROUTES } from "@/lib/routes";
import type { TradesRankingData, TradesRankingRow } from "@/lib/superinvestors/types";

type IndexSymbol = "SPY" | "QQQ" | "DIA";

type RegimeSummary = {
  label: string;
  confidence: number;
  breadth: number;
};

type IndexCardDefinition = {
  symbol: IndexSymbol;
  label: string;
  detail: string;
};

type IndexCardViewModel = IndexCardDefinition & {
  price: number | null;
  changePercent: number | null;
  fetchedAt: string | null;
  marketState: string | null;
  chartData: ChartPoint[];
  isLive: boolean;
};

type ChartPoint = {
  time: string;
  value: number;
};

type InvestorHighlight = {
  key: string;
  label: string;
  ticker: string;
  meta: string;
  signal: string;
};

type RevisionMoversData = {
  generated_at?: string;
  up?: unknown;
  down?: unknown;
};

type FinanceHistoryPoint = {
  date?: string;
  Close?: number;
  close?: number;
};

type FinanceHistoryResponse = {
  data?: {
    history_1y?: FinanceHistoryPoint[];
  };
};

type KospiIndexRow = {
  date?: unknown;
  close?: unknown;
  change_pct?: unknown;
  index_class?: unknown;
  index_name?: unknown;
};

type KospiIndexFile = {
  as_of?: unknown;
  generated_at?: unknown;
  indices?: KospiIndexRow[];
};

type KospiTileModel = {
  price: number | null;
  changePercent: number | null;
  asOf: string | null;
  series: number[];
};

const INDEX_CARDS = [
  {
    symbol: "SPY",
    label: "SPY",
    detail: "S&P 500 ETF",
  },
  {
    symbol: "QQQ",
    label: "QQQ",
    detail: "NASDAQ 100 ETF",
  },
  {
    symbol: "DIA",
    label: "DIA",
    detail: "DOW 30 ETF",
  },
] satisfies readonly IndexCardDefinition[];

function formatDatePart(value: string | null | undefined): string {
  if (!value) return "대기";
  return value.slice(0, 10);
}

const REVISION_REFRESH_WEEKDAY_KST = 5; // Friday: weekly US-Thursday batch lands Friday 08:00 KST
const REVISION_REFRESH_HOUR_KST = 8;
function parseFileTimeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split("-").map(Number);
    return Date.UTC(y, m - 1, d, 12);
  }
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}
function lastRevisionRefreshMs(nowMs: number): number {
  // most recent Friday 08:00 KST at or before nowMs (KST = UTC+9)
  const kst = new Date(nowMs + 9 * 3600 * 1000);
  const day = kst.getUTCDay();
  let back = (day - REVISION_REFRESH_WEEKDAY_KST + 7) % 7;
  const dayStartKstAsUtc = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600 * 1000;
  let refresh = dayStartKstAsUtc - back * 86400 * 1000 + REVISION_REFRESH_HOUR_KST * 3600 * 1000;
  if (refresh > nowMs) refresh -= 7 * 86400 * 1000;
  return refresh;
}
function nextRevisionRefreshMs(nowMs: number): number {
  const last = lastRevisionRefreshMs(nowMs);
  return last > nowMs ? last : last + 7 * 86400 * 1000;
}
function formatNextRefreshLabel(nowMs: number): string {
  const kst = new Date(nextRevisionRefreshMs(nowMs) + 9 * 3600 * 1000);
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  return `${mm}-${dd} 08:00`;
}

function maxTimestamp(values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort()
    .at(-1) ?? null;
}

function formatPriceValue(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatIndexPoints(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSignedPercentUnit(value: number | null | undefined, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${Math.abs(value).toFixed(digits)}%`;
}

function formatMarketState(value: string | null): string {
  if (!value) return "대기";
  if (value.includes("REGULAR")) return "장중";
  if (value.includes("PRE")) return "프리";
  if (value.includes("POST")) return "마감 후";
  if (value.includes("CLOSED")) return "장 마감";
  return value;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asDateString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text.slice(0, 10) : null;
}

function historyToChartData(payload: FinanceHistoryResponse | null): ChartPoint[] {
  const rows = payload?.data?.history_1y;
  if (!Array.isArray(rows)) return [];

  const chartData: ChartPoint[] = [];
  rows
    .filter((row): row is FinanceHistoryPoint & { date: string } => typeof row.date === "string")
    .slice(-21)
    .forEach((row) => {
      const close = readFiniteNumber(row.Close) ?? readFiniteNumber(row.close);
      if (close !== null) chartData.push({ time: row.date, value: close });
    });
  return chartData;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  return (await response.json()) as T;
}

async function loadIndexCardHistory(symbol: IndexSymbol): Promise<ChartPoint[]> {
  const history = await fetchJson<FinanceHistoryResponse>(`/data/yf/finance/${symbol}.json`).catch(() => null);
  return historyToChartData(history);
}

function useIndexCardHistories(): Partial<Record<IndexSymbol, ChartPoint[]>> {
  const [histories, setHistories] = useState<Partial<Record<IndexSymbol, ChartPoint[]>>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      INDEX_CARDS.map(async (definition) => [definition.symbol, await loadIndexCardHistory(definition.symbol)] as const),
    ).then((entries) => {
      if (!cancelled) setHistories(Object.fromEntries(entries) as Partial<Record<IndexSymbol, ChartPoint[]>>);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return histories;
}

function useIndexCards(dashboard: DashboardSnapshot): IndexCardViewModel[] {
  const histories = useIndexCardHistories();

  return useMemo(() => INDEX_CARDS.map((definition) => {
    const snapshot = dashboard.quickIndices.find((item) => item.symbol === definition.symbol);
    const isLiveQuote = Boolean(snapshot?.isLive && snapshot.displayHorizon === "1D");
    return {
      ...definition,
      price: isLiveQuote ? snapshot?.price ?? null : null,
      changePercent: isLiveQuote ? (snapshot?.change ?? 0) * 100 : null,
      fetchedAt: snapshot?.fetchedAt ?? null,
      marketState: isLiveQuote ? snapshot?.marketState ?? null : null,
      chartData: histories[definition.symbol] ?? [],
      isLive: isLiveQuote,
    };
  }), [dashboard.quickIndices, histories]);
}

function useKospiTile(): { tile: KospiTileModel; loading: boolean } {
  const [tile, setTile] = useState<KospiTileModel>({ price: null, changePercent: null, asOf: null, series: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchJson<KospiIndexFile>("/data/computed/fenok-edge-korea-krx-index-daily.json")
      .then((payload) => {
        if (cancelled) return;
        const rows = Array.isArray(payload?.indices) ? payload.indices : [];
        const composite = rows
          .filter((row) => row.index_class === "KOSPI" && row.index_name === "코스피")
          .filter((row) => typeof row.date === "string" && readFiniteNumber(row.close) !== null)
          .sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const latest = composite.at(-1);
        setTile({
          price: readFiniteNumber(latest?.close),
          changePercent: readFiniteNumber(latest?.change_pct),
          asOf: asDateString(payload?.as_of) ?? asDateString(latest?.date),
          series: composite.slice(-21).map((row) => readFiniteNumber(row.close)).filter((v): v is number => v !== null),
        });
      })
      .catch(() => {
        if (!cancelled) setTile({ price: null, changePercent: null, asOf: null, series: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { tile, loading };
}

function buildInvestorHighlights(data: TradesRankingData | null): InvestorHighlight[] {
  if (!data) return [];
  const topBought: TradesRankingRow | undefined = data.bought[0];
  const topSold: TradesRankingRow | undefined = data.sold[0];
  const topNew = data.bought
    .filter((row) => (row.new_count ?? 0) > 0)
    .sort((a, b) => (b.new_count ?? 0) - (a.new_count ?? 0) || b.amount - a.amount)[0];
  const highlights: InvestorHighlight[] = [];

  if (topBought) {
    highlights.push({
      key: "bought",
      label: "최다 매수",
      ticker: topBought.ticker,
      meta: `최대 ${topBought.top_investor.name}`,
      signal: `${topBought.investors_count}명 매수`,
    });
  }
  if (topSold) {
    highlights.push({
      key: "sold",
      label: "최다 매도",
      ticker: topSold.ticker,
      meta: `최대 ${topSold.top_investor.name}`,
      signal: `${topSold.investors_count}명 매도`,
    });
  }
  if (topNew) {
    highlights.push({
      key: "new",
      label: "신규 편입",
      ticker: topNew.ticker,
      meta: topNew.sector,
      signal: `${topNew.new_count ?? 0}명 신규`,
    });
  }
  return highlights;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeTradesRankingRow(value: unknown): value is TradesRankingRow {
  if (!isRecord(value) || !isRecord(value.top_investor)) return false;
  return typeof value.ticker === "string"
    && value.ticker.trim().length > 0
    && typeof value.sector === "string"
    && isFiniteNumber(value.amount)
    && isFiniteNumber(value.investors_count)
    && (value.new_count === undefined || isFiniteNumber(value.new_count))
    && typeof value.top_investor.name === "string"
    && value.top_investor.name.trim().length > 0;
}

function isValidTradesRankingData(value: unknown): value is TradesRankingData {
  if (!isRecord(value) || !isRecord(value.metadata)) return false;
  const quarter = value.metadata.quarter;
  return typeof quarter === "string"
    && /^\d{4}-Q[1-4]$/.test(quarter.trim())
    && Array.isArray(value.bought)
    && value.bought.every(isSafeTradesRankingRow)
    && Array.isArray(value.sold)
    && value.sold.every(isSafeTradesRankingRow);
}

function useInvestorHighlights(reloadKey: number): {
  source: {
    metadata: { quarter: string; generated_at?: string };
    highlights: InvestorHighlight[];
  } | null;
  loading: boolean;
} {
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchJson<unknown>("/data/sec-13f/analytics/trades_ranking.json")
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const source = useMemo(() => {
    if (!isValidTradesRankingData(data)) return null;
    const highlights = buildInvestorHighlights(data);
    return {
      metadata: {
        quarter: data.metadata.quarter,
        ...(typeof data.metadata.generated_at === "string" && data.metadata.generated_at.trim().length > 0
          ? { generated_at: data.metadata.generated_at }
          : {}),
      },
      highlights,
    };
  }, [data]);

  return {
    source,
    loading,
  };
}

function useStockMovers(reloadKey: number): { data: RevisionMoversData | null; loading: boolean } {
  const [data, setData] = useState<RevisionMoversData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchJson<RevisionMoversData>("/data/global-scouter/core/revision_movers.json")
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return {
    data,
    loading,
  };
}

function materialFlagLabel(flag: Flag): string {
  if (flag === "WATCH") return "관심";
  if (flag === "THESIS") return "테시스";
  if (flag === "RISK") return "위험";
  return "확인";
}

function Sparkline({ values, positive, label }: { values: number[]; positive: boolean; label: string }) {
  if (values.length < 2) {
    return (
      <div className="flex h-[26px] items-center text-[11px] text-[#94a3b8] md:h-9" role="img" aria-label={`${label} 차트 데이터 대기`}>
        차트 데이터 대기
      </div>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * 276 + 2).toFixed(1)},${(32 - ((v - min) / span) * 28).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 280 36" preserveAspectRatio="none" className="h-[26px] w-full md:h-9" role="img" aria-label={`${label} 가격 흐름`}>
      <polyline fill="none" stroke={positive ? "#1aa86f" : "#e84a5a"} strokeWidth="1.5" points={points} />
    </svg>
  );
}

function edgeStrengthLabel(score: number): string {
  if (score >= 75) return "강한 상승";
  if (score >= 62) return "상승 우위";
  if (score >= 45) return "중립 구간";
  return "방어 구간";
}

export default function HomeCanvasPlusClient() {
  const { dashboard, dataReady, failedSources } = useDashboardData();
  const indexCards = useIndexCards(dashboard);
  const { tile: kospi, loading: kospiLoading } = useKospiTile();
  const [reloadKey, setReloadKey] = useState(0);
  const investor = useInvestorHighlights(reloadKey);
  const stockMovers = useStockMovers(reloadKey);
  const [personalFlags, setPersonalFlags] = useState<Record<string, Flag>>({});

  useEffect(() => {
    setPersonalFlags(readPersonalFlags());
  }, []);

  const projection = useMemo(
    () => projectMaterialChanges(stockMovers.data, investor.source, personalFlags),
    [investor.source, personalFlags, stockMovers.data],
  );

  const indexUpdatedAt = useMemo(() => formatDatePart(maxTimestamp(indexCards.map((card) => card.fetchedAt))), [indexCards]);
  const dashboardSettled = dataReady || failedSources.length > 0;
  const router = useRouter();
  const sectorTickerFailed = (etf: string): boolean =>
    failedSources.includes(`ticker:${etf}` as DashboardSourceId);
  const heatDelayed = dashboard.sectorRows.some((sector) => sectorTickerFailed(sector.etf));
  const edgeDelayed = failedSources.includes("sentiment")
    || failedSources.includes("dailyBanking")
    || heatDelayed;

  const regime = useMemo(() => {
    const breadthTotal = Math.max(dashboard.sectorRows.length, 1);
    const breadthRatio = dashboard.sectorUp / breadthTotal;
    const score = clamp(
      (dashboard.fearGreedScore / 100) * 0.45 +
        breadthRatio * 0.35 +
        (1 - dashboard.stressScore) * 0.2,
      0,
      1,
    );
    return {
      label: getRegimeLabel(score),
      confidence: Math.round(score * 100),
      breadth: Math.round(breadthRatio * 100),
    } satisfies RegimeSummary;
  }, [dashboard]);

  const forces = useMemo(() => {
    const breadthTotal = Math.max(dashboard.sectorRows.length, 1);
    const breadthRatio = dashboard.sectorUp / breadthTotal;
    const stressReliefScore = (1 - dashboard.stressScore) * 100;
    const rawStressScore = Math.round(dashboard.stressScore * 100);
    return {
      items: [
        {
          key: "sentiment",
          label: "투자 심리",
          value: Math.round(dashboard.fearGreedScore),
          score: dashboard.fearGreedScore,
          weight: 45,
          contribution: dashboard.fearGreedScore * 0.45,
          weightLabel: "가중 45%",
          contributionLabel: `기여 ${(dashboard.fearGreedScore * 0.45).toFixed(1)}`,
        },
        {
          key: "breadth",
          label: "섹터 확산",
          value: regime.breadth,
          score: breadthRatio * 100,
          weight: 35,
          contribution: breadthRatio * 35,
          weightLabel: "가중 35%",
          contributionLabel: `기여 ${(breadthRatio * 35).toFixed(1)}`,
        },
        {
          key: "stress",
          label: "스트레스 완화",
          value: Math.round(stressReliefScore),
          score: stressReliefScore,
          weight: 20,
          contribution: stressReliefScore * 0.2,
          weightLabel: "가중 20%",
          contributionLabel: `기여 ${(stressReliefScore * 0.2).toFixed(1)}`,
        },
      ],
      total: dashboard.fearGreedScore * 0.45 + breadthRatio * 35 + stressReliefScore * 0.2,
      rawStressScore,
      stressLabel: dashboard.stressLabel,
    };
  }, [dashboard, regime.breadth]);

  const heatSectors = useMemo(() => dashboard.sectorRows
    .slice()
    .sort((a, b) => Math.abs(b.displayChange) - Math.abs(a.displayChange))
    .slice(0, 11), [dashboard.sectorRows]);

  const revisionEvidence = projection.sources.revision.evidence;
  const superinvestorEvidence = projection.sources.superinvestor.evidence;
  const revisionClock = revisionEvidence.asOf ?? revisionEvidence.generatedAt?.slice(0, 10) ?? "기준일 미확인";
  const superinvestorClock = superinvestorEvidence.quarter ?? "분기 미확인";
  const bothSourcesLoading = stockMovers.loading && investor.loading;
  const oneSourceLoading = stockMovers.loading !== investor.loading;
  const anySourceLoading = stockMovers.loading || investor.loading;
  const sourceUnavailable = projection.sources.revision.status !== "available"
    || projection.sources.superinvestor.status !== "available";
  const revisionLegOk = projection.sources.revision.status === "available";
  const superLegOk = projection.sources.superinvestor.status === "available";
  const laneFresh = revisionLegOk && superLegOk;
  const lanePartial = !laneFresh && (revisionLegOk || superLegOk);
  const revisionFileMs = parseFileTimeMs(revisionEvidence.generatedAt ?? revisionEvidence.asOf);
  const revisionOverdue = !revisionLegOk && (revisionFileMs === null || revisionFileMs < lastRevisionRefreshMs(Date.now()));
  const laneDelayed = revisionOverdue;
  const laneAwaiting = !laneFresh && !lanePartial && !laneDelayed;
  const laneNext = laneAwaiting ? formatNextRefreshLabel(Date.now()) : undefined;
  const changedEmptyMessage = bothSourcesLoading
    ? DATA_STATE_LABELS.pending
    : oneSourceLoading
      ? "남은 데이터 소스를 불러오는 중입니다."
      : sourceUnavailable
        ? "일부 데이터 소스를 사용할 수 없어 확인이 필요합니다."
        : "표시할 변경 사항이 없습니다.";
  const attentionEmptyMessage = bothSourcesLoading
    ? DATA_STATE_LABELS.pending
    : oneSourceLoading
      ? "남은 데이터 소스를 불러오는 중입니다."
      : sourceUnavailable
        ? "일부 데이터 소스를 사용할 수 없어 확인이 필요합니다."
        : "플래그가 있는 변경 사항이 없습니다.";
  const attentionCountLabel = projection.attention.length > 0
    ? `${projection.attention.length}`
    : anySourceLoading
      ? DATA_STATE_LABELS.pending
      : sourceUnavailable
        ? "확인 필요"
        : "0";
  const headerAttentionLabel = projection.attention.length > 0
    ? `${projection.attention.length}건`
    : anySourceLoading
      ? DATA_STATE_LABELS.pending
      : "0건";
  const retrySources = () => setReloadKey((k) => k + 1);

  return (
    <div className="flex flex-col gap-3 md:gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="m-0 text-[18px] font-semibold text-[#0f172a] md:text-[20px]">오늘 시장의 기준점</h1>
            <span className="text-[13px] text-[#64748b]">
              시장 판독 <b className="font-semibold text-[#334155]">{regime.label}</b>
              {" · "}데이터 <b className="font-semibold text-[#334155]">{dataReady ? "준비됨" : "대기 중"}</b>
              {" · "}확인 필요 <b className="font-semibold text-[#b9791a]">{headerAttentionLabel}</b>
              {failedSources.length > 0 && !anySourceLoading
                ? " · 일부 소스 미수신"
                : null}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 max-md:hidden">
            <Pill>시세 수집 {indexUpdatedAt}</Pill>
            <TransitionLink
              href={ROUTES.screener}
              className="inline-flex h-8 items-center rounded-[6px] bg-[#1B73D3] px-3 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-[#155fae]"
            >
              종목 열기
            </TransitionLink>
          </div>
        </div>

        <section aria-label="주요 지수">
          <div className="grid grid-cols-2 gap-[10px] md:grid-cols-4 md:gap-3">
            {indexCards.map((card) => {
              const positive = (card.changePercent ?? 0) >= 0;
              return (
                <Panel key={card.symbol} loading={!dashboardSettled}>
                  <div className="flex flex-col gap-[6px] p-3 md:gap-[10px] md:p-[14px_16px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[12px] text-[#0f172a] md:text-[13px]">{card.label}</span>
                      <span className="truncate text-[10px] text-[#64748b] md:text-[11px]">{card.detail} · {card.isLive ? formatMarketState(card.marketState) : "추정치"}</span>
                    </div>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="tabular-nums text-[18px] font-semibold text-[#0f172a] md:text-[22px]">{formatPriceValue(card.price)}</span>
                      <span className={`tabular-nums text-[12px] font-semibold md:text-[13px] ${positive ? "text-[#1aa86f]" : "text-[#e84a5a]"}`}>
                        {formatSignedPercentUnit(card.changePercent)}
                      </span>
                    </div>
                    <Sparkline values={card.chartData.map((d) => d.value)} positive={positive} label={card.label} />
                  </div>
                </Panel>
              );
            })}
            <Panel loading={kospiLoading}>
              <div className="flex flex-col gap-[6px] p-3 md:gap-[10px] md:p-[14px_16px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[12px] text-[#0f172a] md:text-[13px]">KOSPI</span>
                  <span className="truncate text-[10px] text-[#64748b] md:text-[11px]">코스피 · {kospi.asOf ? "마감" : "대기"}</span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="tabular-nums text-[18px] font-semibold text-[#0f172a] md:text-[22px]">{formatIndexPoints(kospi.price)}</span>
                  <span className={`tabular-nums text-[12px] font-semibold md:text-[13px] ${(kospi.changePercent ?? 0) >= 0 ? "text-[#1aa86f]" : "text-[#e84a5a]"}`}>
                    {formatSignedPercentUnit(kospi.changePercent)}
                  </span>
                </div>
                <Sparkline values={kospi.series} positive={(kospi.changePercent ?? 0) >= 0} label="KOSPI" />
              </div>
            </Panel>
          </div>
        </section>

        <div className="grid gap-3 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-4">
          <Panel loading={!dashboardSettled} stale={edgeDelayed} asOf={formatDatePart(dashboard.tickerFetchedAt)}>
            <PanelHeader
              eyebrow="Fenok Edge"
              title="시장 체력 점수"
              right={<Pill tone={regime.confidence >= 62 ? "up" : regime.confidence >= 45 ? "neutral" : "down"}>{edgeStrengthLabel(regime.confidence)}</Pill>}
            />
            <div className="flex gap-4 p-[14px] md:gap-6 md:p-4">
              <div className="flex min-w-[72px] flex-col justify-center md:min-w-24">
                <span className="tabular-nums text-[36px] font-semibold leading-none text-[#0f172a] md:text-[44px]">{regime.confidence}</span>
                <span className="mt-1.5 text-[12px] text-[#64748b]">/ 100 · 기여 {forces.total.toFixed(1)}</span>
              </div>
              <div className="flex flex-1 flex-col gap-[10px] pt-1 md:gap-[14px]">
                {forces.items.map((force) => (
                  <div key={force.key} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between text-[12px]">
                      <span className="text-[#334155]">
                        {force.label} <span className="text-[#94a3b8] max-md:hidden">· {force.weightLabel}</span>
                      </span>
                      <span className="tabular-nums font-semibold text-[#0f172a]">
                        {force.value} <span className="font-medium text-[#94a3b8] max-md:hidden">{force.contributionLabel}</span>
                      </span>
                    </div>
                    <Bar value={force.score} aria-label={`${force.label} ${force.value}점`} />
                  </div>
                ))}
                <div className="pt-0.5 text-[12px] text-[#64748b]">
                  현재 스트레스 {forces.rawStressScore}점 · 낮을수록 유리
                </div>
              </div>
            </div>
            <EvidenceRail
              freshness={edgeDelayed ? "delayed" : "fresh"}
              source="Fenok Edge"
              asOf={formatDatePart(dashboard.tickerFetchedAt)}
              coverage={`섹터 ${dashboard.sectorRows.length}개 · 실시간 ${dashboard.sectorLiveCount}개`}
              onEvidence={() => router.push(ROUTES.regime)}
            />
          </Panel>

          <Panel loading={!dashboardSettled} stale={heatDelayed} asOf={formatDatePart(dashboard.tickerFetchedAt)}>
            <PanelHeader
              eyebrow="Sector Flow"
              title="섹터 히트맵"
              right={<span className="text-[12px] text-[#64748b]">1일 · {dashboard.sectorMode === "LIVE_1D" ? "실시간" : dashboard.sectorMode === "MIXED" ? "혼합" : "1개월 기준"}</span>}
            />
            <div className="grid grid-cols-3 gap-1.5 p-2.5 md:grid-cols-4 md:p-3">
              {heatSectors.map((sector: SectorSnapshot, i: number) => (
                <Tile
                  key={sector.key}
                  symbol={sector.etf}
                  name={sector.name}
                  value={formatSignedPercentUnit(sector.displayChange * 100, 1)}
                  change={sector.displayChange * 100}
                  className={`${i === 0 ? "col-span-1 md:col-span-2" : ""}${i >= 9 ? " max-md:hidden" : ""}`}
                />
              ))}
            </div>
            <EvidenceRail
              freshness={heatDelayed ? "delayed" : dashboard.sectorMode === "LIVE_1D" ? "fresh" : "fixed"}
              source="Sector Flow"
              asOf={dashboard.sectorMode === "LIVE_1D" ? formatDatePart(dashboard.tickerFetchedAt) : "1개월 기준"}
              coverage={`${heatSectors.length}/${dashboard.sectorRows.length} 섹터`}
              onEvidence={() => router.push(ROUTES.sectors)}
            />
          </Panel>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] md:gap-4">
          <Panel
            loading={bothSourcesLoading}
            empty={!anySourceLoading && projection.changed.length === 0}
            emptyReason={changedEmptyMessage}
            emptyNextRefresh="다음 데이터 수집 주기에 자동 갱신"
            emptyActionLabel="다시 불러오기"
            onEmptyAction={retrySources}
            stale={!anySourceLoading && laneDelayed && projection.changed.length > 0}
            asOf={revisionClock}
            onRetry={retrySources}
          >
            <PanelHeader
              eyebrow="What Changed"
              title="무엇이 바뀌었나"
              right={<span className="whitespace-nowrap text-[12px] text-[#64748b]">리비전 {revisionClock} · 13F {superinvestorClock}</span>}
            />
            <div className="hidden grid-cols-[140px_1fr_140px_110px] items-center gap-2 border-b border-[#e2e8f0] px-4 text-[11px] font-semibold text-[#64748b] md:grid md:h-8">
              <span>종목</span><span>변경</span><span className="text-right">FY+1 EPS 추정</span><span className="text-right">변화</span>
            </div>
            <div className="hidden md:block">
              {projection.changed.map((item) => {
                const isRevision = item.source === "revision";
                const revisionUp = isRevision && item.kind === "up";
                return (
                  <TransitionLink
                    key={item.id}
                    href={ROUTES.stock(item.ticker)}
                    className="grid grid-cols-[140px_1fr_140px_110px] items-center gap-2 border-t border-[#f1f5f9] px-4 text-[13px] transition-colors duration-150 first:border-t-0 hover:bg-[#f8fafc] hover:shadow-[inset_2px_0_0_#1B73D3] focus-visible:bg-[#f8fafc] focus-visible:outline-none h-9"
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 font-mono text-[#0f172a]">{item.ticker}</span>
                      {item.title !== item.ticker && <span className="truncate text-[#64748b]">{item.title}</span>}
                    </span>
                    <span className="truncate text-[#334155]">{item.label}</span>
                    <span className="text-right tabular-nums text-[#334155]">{isRevision ? (revisionUp ? "상향" : "하향") : "—"}</span>
                    <span className={`text-right tabular-nums font-semibold ${isRevision ? (revisionUp ? "text-[#1aa86f]" : "text-[#e84a5a]") : "font-medium text-[#334155]"}`}>
                      {isRevision && typeof item.value === "number" ? formatSignedPercentUnit(item.value * 100, 1) : item.detail}
                    </span>
                  </TransitionLink>
                );
              })}
            </div>
            <div className="md:hidden">
              {projection.changed.map((item) => {
                const isRevision = item.source === "revision";
                const revisionUp = isRevision && item.kind === "up";
                return (
                  <TransitionLink
                    key={item.id}
                    href={ROUTES.stock(item.ticker)}
                    className="flex min-h-11 items-center justify-between gap-3 border-t border-[#f1f5f9] px-[14px] transition-colors duration-150 first:border-t-0 hover:bg-[#f8fafc] focus-visible:bg-[#f8fafc] focus-visible:outline-none"
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 font-mono text-[#0f172a]">{item.ticker}</span>
                      {item.title !== item.ticker && <span className="truncate text-[12px] text-[#64748b]">{item.title}</span>}
                    </span>
                    <span className={`shrink-0 tabular-nums text-[13px] font-semibold ${isRevision ? (revisionUp ? "text-[#1aa86f]" : "text-[#e84a5a]") : "font-medium text-[#334155]"}`}>
                      {isRevision && typeof item.value === "number" ? formatSignedPercentUnit(item.value * 100, 1) : item.detail}
                    </span>
                  </TransitionLink>
                );
              })}
            </div>
            <EvidenceRail
              freshness={laneFresh ? "fresh" : laneDelayed ? "delayed" : lanePartial ? "partial" : "stale"}
              source="리비전 무버 · 13F"
              asOf={revisionClock}
              coverage={`후보 ${revisionEvidence.validCandidateCount + superinvestorEvidence.validCandidateCount}개`}
              next={laneNext}
              onEvidence={() => router.push(ROUTES.screener)}
            />
          </Panel>

          <Panel
            className="max-md:hidden"
            loading={bothSourcesLoading}
            empty={!anySourceLoading && projection.attention.length === 0}
            emptyReason={attentionEmptyMessage}
            stale={!anySourceLoading && laneDelayed && projection.attention.length > 0}
            asOf={revisionClock}
            onRetry={retrySources}
          >
            <PanelHeader
              eyebrow="My Attention"
              title="내가 확인할 항목"
              right={<Pill tone={projection.attention.length > 0 ? "warn" : "neutral"}>{attentionCountLabel}</Pill>}
            />
            <div>
              {projection.attention.map((item) => (
                <TransitionLink
                  key={item.id}
                  href={ROUTES.stock(item.ticker)}
                  className="flex min-h-10 items-center justify-between gap-3 border-t border-[#f1f5f9] px-4 transition-colors duration-150 first:border-t-0 hover:bg-[#f8fafc] hover:shadow-[inset_2px_0_0_#1B73D3] focus-visible:bg-[#f8fafc] focus-visible:outline-none max-md:min-h-11 max-md:px-[14px]"
                >
                  <span className="flex min-w-0 items-baseline gap-2 text-[13px]">
                    <span className="shrink-0 font-semibold text-[#b9791a]">{materialFlagLabel(item.flag)}</span>
                    <span className="shrink-0 font-mono text-[#0f172a]">{item.ticker}</span>
                    <span className="truncate text-[#334155]">{item.title}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-[#94a3b8]">확인</span>
                </TransitionLink>
              ))}
            </div>
            <EvidenceRail
              freshness={laneFresh ? "fresh" : laneDelayed ? "delayed" : lanePartial ? "partial" : "stale"}
              source="개인 플래그 · 리비전 · 13F"
              asOf={revisionClock}
              coverage={`확인 대상 ${projection.attention.length}건`}
              next={laneNext}
              onEvidence={() => router.push(ROUTES.portfolio)}
            />
          </Panel>
        </div>
    </div>
  );
}

export function HomeShell() {
  return (
    <div className="fnk-shell">
      <AppShell active="explore" title={EXPLORE_PRODUCT_TITLE}>
        <HomeCanvasPlusClient />
      </AppShell>
    </div>
  );
}
