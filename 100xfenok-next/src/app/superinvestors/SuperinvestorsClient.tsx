"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import TickerChip from "@/components/TickerChip";
import TransitionLink from "@/components/TransitionLink";
import { fetch13FJson, use13FData, useInvestorDetail } from "@/hooks/use13FData";
import { Button, EmptyState, EvidenceRail, Panel, PanelHeader, Pill, Row } from "@/components/ui";
import { TabPanel, getPanelId, getTabId, useTabsBaseId } from "@/components/ui/Tabs";
import {
  formatCurrencyCompact,
  formatCompactNumber,
  formatInteger,
  formatPercent,
} from "@/lib/format";
import { ROUTES, withQuery } from "@/lib/routes";
import { CANONICAL_SECTORS, resolveSector, sectorColor, sectorLabelKo } from "@/lib/design/sectorMap";
import type { CanonicalSector } from "@/lib/design/sectorMap";
import type {
  ConsensusTicker,
  FactorExposuresSummaryData,
  InvestorFiling,
  InvestorHolding,
  PortfolioViewsData,
  SectorHoldingsData,
  SectorHoldingsEntry,
  SummaryInvestor,
  TradesRankingData,
  TradesRankingRow,
  TurnoverData,
} from "@/lib/superinvestors/types";
import { loadFactorExposuresSummary, loadPortfolioViews } from "./portfolioViewsLoader";
import { buildGraphNetwork } from "./graphNetwork";
import GraphNetworkPanel, { GraphNetworkTeaser } from "./GraphNetworkPanel";
import GuruTrendBlock from "./GuruTrendBlock";
import InsightsTab from "./InsightsTab";
import SignalPanel from "./SignalPanel";
import WhoHoldsPanel from "./WhoHoldsPanel";

const ChartLoading = () => (
  <div className="grid h-[220px] place-items-center rounded-xl border border-dashed border-[var(--c-line)] bg-[var(--c-surface-2)] text-xs font-bold text-[var(--c-ink-3)]">
    차트 로딩 중
  </div>
);

const PortfolioTreemap = dynamic(() => import("./PortfolioCharts").then((mod) => mod.PortfolioTreemap), {
  ssr: false,
  loading: ChartLoading,
});
const PerformanceChart = dynamic(() => import("./PortfolioCharts").then((mod) => mod.PerformanceChart), {
  ssr: false,
  loading: ChartLoading,
});
const SectorMixPanel = dynamic(() => import("./PortfolioCharts").then((mod) => mod.SectorMixPanel), {
  ssr: false,
  loading: ChartLoading,
});
const RiskReturnScatter = dynamic(() => import("./PortfolioCharts").then((mod) => mod.RiskReturnScatter), {
  ssr: false,
  loading: ChartLoading,
});
const CumulativeReturnOverlay = dynamic(() => import("./PortfolioCharts").then((mod) => mod.CumulativeReturnOverlay), {
  ssr: false,
  loading: ChartLoading,
});
const FactorExposureRadar = dynamic(() => import("./PortfolioCharts").then((mod) => mod.FactorExposureRadar), {
  ssr: false,
  loading: ChartLoading,
});

const CANONICAL_SECTOR_SET = new Set<string>(CANONICAL_SECTORS);

function normalizeSuperSector(gicsRaw?: string | null, scouterRaw?: string | null): CanonicalSector {
  const gics = gicsRaw?.trim();
  if (gics && CANONICAL_SECTOR_SET.has(gics)) return gics as CanonicalSector;
  const scouter = scouterRaw?.trim();
  if (scouter && CANONICAL_SECTOR_SET.has(scouter)) return scouter as CanonicalSector;
  return resolveSector(gicsRaw, scouterRaw);
}

function isSectorEntry(value: unknown): value is SectorHoldingsEntry {
  return !!value && typeof value === "object" && Array.isArray((value as SectorHoldingsEntry).top_holdings);
}

function buildSectorRotationRows(
  hist: PortfolioViewsData["total"]["sector_history"],
): Array<{ sector: CanonicalSector; current: number; deltaPp: number }> {
  if (!hist || hist.quarters.length < 2) return [];
  const lastIdx = hist.quarters.length - 1;
  const prevIdx = lastIdx - 1;
  const bySector = new Map<CanonicalSector, { current: number; prev: number }>();

  Object.entries(hist.series).forEach(([rawSector, values]) => {
    const current = values[lastIdx] ?? 0;
    const prev = values[prevIdx] ?? 0;
    const canonicalSector = normalizeSuperSector(rawSector, rawSector);
    const existing = bySector.get(canonicalSector) ?? { current: 0, prev: 0 };
    bySector.set(canonicalSector, {
      current: existing.current + current,
      prev: existing.prev + prev,
    });
  });

  return [...bySector.entries()]
    .map(([sector, value]) => ({
      sector,
      current: value.current,
      deltaPp: (value.current - value.prev) * 100,
    }))
    .sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp))
    .slice(0, 8);
}

function normalizeTradesRanking(data: unknown): TradesRankingData | null {
  const raw = data as Partial<TradesRankingData> | null;
  if (!raw?.metadata) return null;
  return {
    metadata: raw.metadata,
    bought: Array.isArray(raw.bought) ? raw.bought : [],
    sold: Array.isArray(raw.sold) ? raw.sold : [],
  };
}

function tradeShare(amount: number | null | undefined, totalAmount: number): number | null {
  if (amount === null || amount === undefined || Number.isNaN(amount) || totalAmount <= 0) return null;
  return (amount / totalAmount) * 100;
}

function formatTradeShare(amount: number | null | undefined, totalAmount: number): string {
  return formatPercent(tradeShare(amount, totalAmount), { digits: 1, fraction: false });
}

function fmtDateTimeKo(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}

type HolderSort = "aum" | "holdings" | "change";

type SupTab = "signal" | "investors" | "stocks" | "trades" | "insights" | "graph";

const SUP_TABS: Array<{ id: SupTab; label: string }> = [
  { id: "signal", label: "시그널" },
  { id: "investors", label: "투자자" },
  { id: "stocks", label: "종목" },
  { id: "trades", label: "매매 동향" },
  { id: "insights", label: "인사이트" },
  { id: "graph", label: "그래프" },
];

function resolveInitialTab(value: string | null, guru: string | null): SupTab {
  if (guru) return "investors";
  if (value === "investors" || value === "stocks" || value === "graph" || value === "signal" || value === "trades" || value === "insights") return value;
  return "signal";
}

const HOLDER_SORTS: Array<{ key: HolderSort; label: string }> = [
  { key: "aum", label: "AUM 순" },
  { key: "holdings", label: "보유종목 순" },
  { key: "change", label: "변화율 순" },
];

// Turnover is shaped in the client (never in use13FData — window-2 owns that
// hook). One bulk fetch covers the Holders "분기 변화" column for all rows.
let turnoverCache: TurnoverData["by_investor"] | null | undefined;
let turnoverPromise: Promise<TurnoverData["by_investor"] | null> | null = null;

function loadTurnoverLocal(): Promise<TurnoverData["by_investor"] | null> {
  if (turnoverCache !== undefined) return Promise.resolve(turnoverCache);
  if (turnoverPromise) return turnoverPromise;
  turnoverPromise = fetch13FJson<TurnoverData>("/data/sec-13f/analytics/turnover.json").then((data) => {
    turnoverCache = data?.by_investor ?? null;
    return turnoverCache;
  }, (error) => {
    // A rejected fetch must not pin the module slot: clear it so a manual
    // retry can issue a fresh request instead of replaying the rejection.
    turnoverPromise = null;
    throw error;
  });
  return turnoverPromise;
}

function reload() {
  window.location.reload();
}

function openEvidence(path: string) {
  window.open(path, "_blank", "noopener");
}

function syncTabParam(tab: SupTab) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.set("tab", tab);
  const queryString = params.toString();
  const nextUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) window.history.replaceState(window.history.state, "", nextUrl);
}

function syncGuruParam(guru: string | null) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (guru) params.set("guru", guru);
  else params.delete("guru");
  const queryString = params.toString();
  const nextUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) window.history.replaceState(window.history.state, "", nextUrl);
}

function sortConsensusByHolders(rows: ConsensusTicker[]): ConsensusTicker[] {
  return [...rows].sort((a, b) => {
    if (a.holders_count !== b.holders_count) return b.holders_count - a.holders_count;
    return a.ticker.localeCompare(b.ticker);
  });
}

function LatestHoldingsMobileCards({ rows }: { rows: InvestorHolding[] }) {
  return (
    <div
      className="cpw5-super-mobile-cards"
      role="list"
      aria-label="최신 보유 종목 모바일 요약"
    >
      {rows.map((h) => (
        <article
          key={`${h.ticker}-${h.cusip}-mobile`}
          data-superinvestor-guru-holding-card
          data-superinvestor-guru-holding-card-ticker={h.ticker ?? ""}
          data-superinvestor-guru-holding-row
          data-superinvestor-guru-holding-ticker={h.ticker ?? ""}
          role="listitem"
          className="cpw5-super-mobile-card"
        >
          <div className="flex min-w-0 items-start justify-between gap-2">
            {h.ticker ? <TickerChip ticker={h.ticker} variant="pill" className="min-h-11 shrink-0" /> : null}
            <div className="min-w-0 text-right">
              <p className="truncate text-sm font-black text-slate-900">{h.name}</p>
              {h.sector ? <p className="truncate text-[10px] font-semibold text-[var(--c-ink-3)]">{h.sector}</p> : null}
            </div>
          </div>
          <dl className="cpw5-super-mobile-card__metrics mt-3">
            <div className="cpw5-super-mobile-card__field">
              <dt>비중</dt>
              <dd className="tabular-nums">{formatPercent(h.weight, { digits: 2 })}</dd>
            </div>
            <div className="cpw5-super-mobile-card__field">
              <dt>주식수</dt>
              <dd className="tabular-nums">{formatCompactNumber(h.shares)}</dd>
            </div>
            <div className="cpw5-super-mobile-card__field cpw5-super-mobile-card__field--wide">
              <dt>시가총액</dt>
              <dd className="tabular-nums">{formatCurrencyCompact(h.market_value, "USD")}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

function LatestHoldingsTable({ holdings }: { holdings: InvestorHolding[] }) {
  const rows = useMemo(() => {
    // Filings carry one row per share class / CUSIP — aggregate by ticker.
    const byTicker = new Map<string, InvestorHolding>();
    for (const h of holdings) {
      if (!h.ticker) continue;
      const cur = byTicker.get(h.ticker);
      if (cur) {
        cur.weight = (cur.weight || 0) + (h.weight || 0);
        cur.shares = (cur.shares || 0) + (h.shares || 0);
        cur.market_value = (cur.market_value || 0) + (h.market_value || 0);
      } else {
        byTicker.set(h.ticker, { ...h });
      }
    }
    return [...byTicker.values()]
      .sort((a, b) => (b.weight || 0) - (a.weight || 0))
      .slice(0, 50);
  }, [holdings]);

  if (rows.length === 0) {
    return (
      <Panel empty emptyReason="보유 종목이 없습니다" emptyNextRefresh="다음 분기 공시 반영 후 갱신"><span>보유 종목이 없습니다</span></Panel>
    );
  }

  return (
    <div data-superinvestor-guru-top-holdings className="space-y-2">
      <LatestHoldingsMobileCards rows={rows} />
      <div
        className="cpw5-super-desktop-table scroll-hint-x -mx-1 px-1"
        role="region"
        tabIndex={0}
        aria-label="최신 보유 종목 표 가로 스크롤"
      >
        <table className="w-full min-w-[480px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">
              <th className="px-2 py-2 text-left">티커</th>
              <th className="px-2 py-2 text-left">종목</th>
              <th className="px-2 py-2 text-right">비중</th>
              <th className="px-2 py-2 text-right">주식수</th>
              <th className="px-2 py-2 text-right">시가총액</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr
                key={`${h.ticker}-${h.cusip}`}
                data-superinvestor-guru-desktop-holding-row
                data-superinvestor-guru-desktop-holding-ticker={h.ticker ?? ""}
                className="border-b border-slate-100 last:border-b-0"
              >
                <td className="px-2 py-2">
                  {h.ticker ? (
                    <TickerChip ticker={h.ticker} variant="pill" className="min-h-11" />
                  ) : (
                    <span className="text-[var(--c-ink-3)]">—</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <span className="block max-w-[200px] truncate font-semibold text-slate-700">{h.name}</span>
                  {h.sector ? <span className="text-[10px] text-[var(--c-ink-3)]">{h.sector}</span> : null}
                </td>
                <td className="px-2 py-2 text-right">
                  <span className="tabular-nums font-bold text-slate-900">{formatPercent(h.weight, { digits: 2 })}</span>
                </td>
                <td className="px-2 py-2 text-right">
                  <span className="tabular-nums text-slate-700">{formatCompactNumber(h.shares)}</span>
                </td>
                <td className="px-2 py-2 text-right">
                  <span className="tabular-nums text-slate-700">{formatCurrencyCompact(h.market_value, "USD")}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GuruDetailPanel({
  id,
  summary,
  pvData,
  pvLoading,
  pvFailed,
  onRetryPv,
  factorData,
  factorLoading,
  factorFailed,
  onRetryFactor,
  asOf,
}: {
  id: string;
  summary: SummaryInvestor;
  pvData: PortfolioViewsData | null;
  pvLoading: boolean;
  pvFailed: boolean;
  onRetryPv?: () => void;
  factorData: FactorExposuresSummaryData | null;
  factorLoading: boolean;
  factorFailed: boolean;
  onRetryFactor?: () => void;
  asOf: string;
}) {
  const { data, loading, status } = useInvestorDetail(id);
  const [turnover, setTurnover] = useState<number | null | undefined>(undefined);

  const latest: InvestorFiling | null = data?.investor?.filings?.[data.investor.filings.length - 1] ?? null;
  const prev: InvestorFiling | null =
    data?.investor?.filings?.[data.investor.filings.length - 2] ?? null;
  const investorView = pvData?.investors?.[id] ?? null;
  const treemapRows = Array.isArray(investorView?.treemap) ? investorView.treemap : [];
  const sectorHistory = investorView?.sector_history ?? {};
  const sectorQuarters = Array.isArray(investorView?.quarters) ? investorView.quarters : [];
  const hasSectorHistory = sectorQuarters.length > 0 && Object.keys(sectorHistory).length > 0;
  const latestQuarter = latest?.quarter ?? summary.quarter ?? "—";
  const reportDate = latest?.report_date ?? "—";
  const filingDate = latest?.filing_date ?? "—";
  const cik = data?.investor?.cik ?? data?.metadata?.cik ?? "";
  const secBrowseUrl = cik
    ? `https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(cik)}&owner=exclude&action=getcompany`
    : null;

  useEffect(() => {
    let cancelled = false;
    loadTurnoverLocal().then(
      (map) => {
        if (cancelled) return;
        const entry = map?.[id];
        setTurnover(entry?.turnover ?? null);
      },
      () => {
        if (cancelled) return;
        setTurnover(null);
      },
    );
    return () => { cancelled = true; };
  }, [id]);

  const cohortCount = pvData?.metadata?.cohort_count ?? null;
  const plottableCount = useMemo(() => {
    if (!pvData) return 0;
    let count = 0;
    for (const view of Object.values(pvData.investors ?? {})) {
      const dates = view?.performance?.dates;
      if (Array.isArray(dates) && dates.length > 1) count += 1;
    }
    return count;
  }, [pvData]);
  const investorMissing = !!pvData && !investorView;
  const scatterFailed = !pvLoading && (pvFailed || !pvData);
  const scatterEmpty = !pvLoading && !!pvData && plottableCount === 0;
  const scatterFreshness: "pending" | "error" | "partial" | "stale" =
    pvLoading ? "pending" : scatterFailed ? "error" : scatterEmpty || investorMissing ? "partial" : "stale";
  const scatterCoverage = !pvData
    ? "—"
    : plottableCount === 0
      ? "표시할 수익 시리즈 없음"
      : `코호트 ${formatInteger(cohortCount)}명 중 ${formatInteger(plottableCount)}명 표시${investorMissing ? " · 이 투자자 시리즈 없음" : ""}`;

  const factorRows = factorData?.rows ?? [];
  const hasFactorRecord = factorRows.some((row) => row?.investorId === id);
  const radarFailed = !factorLoading && (factorFailed || !factorData);
  const radarEmpty = !factorLoading && !!factorData && !hasFactorRecord;
  const radarFreshness: "pending" | "error" | "partial" | "stale" =
    factorLoading ? "pending" : radarFailed ? "error" : radarEmpty || !hasFactorRecord ? "partial" : "stale";
  const radarCoverage = !factorData
    ? "—"
    : factorRows.length === 0
      ? "표시할 팩터 행 없음"
      : `투자자 ${formatInteger(factorRows.length)}행${hasFactorRecord ? "" : " · 이 투자자 기록 없음"}`;

  const kpiError = !loading && status === "error";
  const kpiEmpty = !loading && status !== "error" && status !== "private" && !latest;
  const kpiPartial = !loading && !kpiError && !kpiEmpty && (status === "private" || turnover == null);
  const kpiFreshness: "pending" | "error" | "partial" | "stale" =
    loading ? "pending" : kpiError ? "error" : kpiEmpty || kpiPartial ? "partial" : "stale";
  const kpiCoverage =
    status === "private"
      ? `요약 기준 ${latestQuarter} · 상세 비공개`
      : latest
        ? `13F ${latestQuarter} 기준${turnover == null ? " · 회전율 없음" : ""}`
        : "—";

  return (
    <div
      id={`superinvestor-guru-profile-${id}`}
      data-superinvestor-guru-profile
      data-superinvestor-guru-id={id}
      data-superinvestor-guru-quarter={latestQuarter}
      data-superinvestor-guru-report-date={reportDate}
      data-superinvestor-guru-filing-date={filingDate}
      tabIndex={-1}
      aria-label={`${summary.name} 포트폴리오 상세`}
      className="mt-3 rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4"
    >
      <div data-superinvestor-guru-profile-hero className="mb-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-amber-700">13F 기준</p>
          <p data-superinvestor-guru-asof className="mt-1 text-sm font-black text-amber-950">
            {latestQuarter}
          </p>
          <p className="mt-1 text-[10px] font-semibold text-amber-700">
            보고 기준일 {reportDate}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">공시일</p>
          <p data-superinvestor-guru-filing className="mt-1 text-sm font-black text-slate-950">
            {filingDate}
          </p>
          <p className="mt-1 text-[10px] font-semibold text-[var(--c-ink-3)]">
            {latest?.form ?? "SEC 13F 데이터 변환"}
          </p>
          {secBrowseUrl ? (
            <a
              href={secBrowseUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex text-[10px] font-black text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-950"
            >
              SEC 원문 탐색 ↗
            </a>
          ) : null}
          {latest?.accession_number ? (
            <p className="mt-1 break-all text-[9px] font-semibold text-[var(--c-ink-3)]">
              접수번호 {latest.accession_number}
            </p>
          ) : null}
        </div>
        <div
          data-superinvestor-guru-lag-disclosure
          className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2"
        >
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-sky-700">공시 지연</p>
          <p className="mt-1 text-sm font-black text-sky-950">최대 45일</p>
          <p className="mt-1 text-[10px] font-semibold text-sky-700">
            오늘 보유가 아니라 분기 보고치
          </p>
        </div>
      </div>

      {/* Row 1 — KPI strip (panel lives inside a narrow card column — keep 2x2) */}
      <Panel
        loading={loading}
        empty={kpiEmpty}
        emptyReason="이 투자자의 자료 없음"
        emptyNextRefresh="다음 분기 공시 반영 후 갱신"
        error={kpiError}
        errorDetail="KPI 데이터를 불러오지 못했습니다."
        asOf={latestQuarter}
      >
      <div className="grid grid-cols-2 gap-2">
        <KpiCard label="운용 자산" value={formatCurrencyCompact(latest?.aum_total ?? summary.aum, "USD")} isLoading={loading} dataKey="aum" />
        <KpiCard
          label="보유 종목"
          value={latest ? formatInteger(latest.holdings_count) : "—"}
          isLoading={loading}
          dataKey="holdings"
        />
        <KpiCard
          label="TOP 10 비중"
          value={latest?.top_10_weight != null ? formatPercent(latest.top_10_weight, { digits: 1 }) : "—"}
          isLoading={loading}
          dataKey="top10"
        />
        <KpiCard
          label="회전율"
          value={turnover === undefined ? "..." : turnover === null ? "—" : formatPercent(turnover, { digits: 1 })}
          isLoading={loading || turnover === undefined}
          dataKey="turnover"
        />
      </div>
        <EvidenceRail
          freshness={kpiFreshness}
          source="SEC EDGAR 13F"
          asOf={latestQuarter}
          coverage={kpiCoverage}
          next="분기 종료 후 최대 45일"
        />
      </Panel>

      {/* Row 2 — 분기 매매 내역 */}
      {latest?.changes_summary ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-emerald-700">신규매수 ↑</p>
            <p className="mt-1 text-sm font-black text-emerald-800">
              {latest.changes_summary.new?.length ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-rose-700">청산매도 ↓</p>
            <p className="mt-1 text-sm font-black text-rose-800">
              {latest.changes_summary.sold?.length ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-sky-700">비중확대 ↑</p>
            <p className="mt-1 text-sm font-black text-sky-800">
              {latest.changes_summary.increased?.length ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-amber-700">비중축소 ↓</p>
            <p className="mt-1 text-sm font-black text-amber-800">
              {latest.changes_summary.decreased?.length ?? 0}
            </p>
          </div>
        </div>
      ) : null}

      {/* Quarter label */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">
          {latestQuarter}
        </p>
        {prev ? (
          <p className="text-[10px] font-semibold text-slate-500">
            이전 분기: {prev.quarter}
          </p>
        ) : null}
      </div>

      {/* Portfolio charts (from portfolio_views.json) — the panels always mount;
          each Panel owns its loading / error / empty / partial / ready state. */}
        <div
          data-superinvestor-guru-portfolio
          data-superinvestor-guru-portfolio-quarter={investorView?.quarter ?? ""}
          data-superinvestor-guru-portfolio-state={pvLoading ? "loading" : pvFailed ? "error" : investorView ? "ready" : "empty"}
          className="mt-4 border-t border-slate-200 pt-4"
        >
          <p className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">보유 포트폴리오</p>
          <div className="mt-2 space-y-4">
            <Panel
              loading={pvLoading}
              empty={!pvLoading && !pvFailed && (!investorView || treemapRows.length === 0)}
              emptyReason={investorView ? "표시할 보유 비중 데이터가 없습니다" : "이 투자자의 자료 없음"}
              emptyNextRefresh="다음 분기 공시 반영 후 갱신"
              error={pvFailed}
              errorDetail="보유 포트폴리오 데이터를 불러오지 못했습니다."
              asOf={investorView?.quarter ?? asOf}
              onRetry={pvFailed ? onRetryPv : undefined}
              retryLabel="다시 시도"
            >
              {treemapRows.length > 0 ? (
                <div data-superinvestor-guru-treemap data-superinvestor-guru-treemap-count={treemapRows.length}>
                  <PortfolioTreemap
                    rows={treemapRows}
                    quarterLabel={investorView?.quarter ?? asOf}
                  />
                </div>
              ) : null}
              <EvidenceRail
                freshness={pvLoading ? "pending" : pvFailed ? "error" : treemapRows.length > 0 ? "stale" : "partial"}
                source="SEC EDGAR 13F"
                asOf={investorView?.quarter ?? asOf}
                coverage={treemapRows.length > 0 ? `상위 ${formatInteger(treemapRows.length)}종목 · ${investorView?.quarter ?? asOf}` : "이 투자자 트리맵 행 없음"}
                next="분기 종료 후 최대 45일"
                onRetry={pvFailed ? onRetryPv : undefined}
                onEvidence={() => openEvidence("/data/sec-13f/analytics/portfolio_views.json")}
              />
            </Panel>
            <Panel
              loading={pvLoading}
              empty={!pvLoading && !pvFailed && (!investorView || !hasSectorHistory)}
              emptyReason={investorView ? "표시할 섹터 구성 데이터가 없습니다" : "이 투자자의 자료 없음"}
              emptyNextRefresh="다음 분기 공시 반영 후 갱신"
              error={pvFailed}
              errorDetail="보유 포트폴리오 데이터를 불러오지 못했습니다."
              asOf={investorView?.quarter ?? asOf}
              onRetry={pvFailed ? onRetryPv : undefined}
              retryLabel="다시 시도"
            >
              {hasSectorHistory ? (
                <SectorMixPanel
                  currentSectors={Object.fromEntries(
                    Object.entries(sectorHistory).map(([s, h]) => [
                      s,
                      Array.isArray(h) ? h[h.length - 1] ?? 0 : 0,
                    ]),
                  )}
                  history={sectorHistory}
                  quarters={sectorQuarters}
                />
              ) : null}
              <EvidenceRail
                freshness={pvLoading ? "pending" : pvFailed ? "error" : hasSectorHistory ? "stale" : "partial"}
                source="SEC EDGAR 13F"
                asOf={investorView?.quarter ?? asOf}
                coverage={hasSectorHistory ? `${formatInteger(sectorQuarters.length)}분기 추적 · ${investorView?.quarter ?? asOf}` : "이 투자자 섹터 기록 없음"}
                next="분기 종료 후 최대 45일"
                onRetry={pvFailed ? onRetryPv : undefined}
                onEvidence={() => openEvidence("/data/sec-13f/analytics/portfolio_views.json")}
              />
            </Panel>
            <Panel
              loading={pvLoading}
              empty={!pvLoading && !pvFailed && !investorView?.performance}
              emptyReason={investorView ? "표시할 성과 데이터가 없습니다" : "이 투자자의 자료 없음"}
              emptyNextRefresh="다음 분기 공시 반영 후 갱신"
              error={pvFailed}
              errorDetail="보유 포트폴리오 데이터를 불러오지 못했습니다."
              asOf={investorView?.quarter ?? asOf}
              onRetry={pvFailed ? onRetryPv : undefined}
              retryLabel="다시 시도"
            >
              {investorView?.performance ? (
                <PerformanceChart
                  performance={investorView.performance}
                  investorName={investorView?.name ?? id}
                />
              ) : null}
              <EvidenceRail
                freshness={pvLoading ? "pending" : pvFailed ? "error" : investorView?.performance ? "stale" : "partial"}
                source="SEC EDGAR 13F"
                asOf={investorView?.quarter ?? asOf}
                coverage={investorView?.performance ? `${investorView.name} · ${investorView.quarter}` : "이 투자자 성과 시리즈 없음"}
                next="분기 종료 후 최대 45일"
                onRetry={pvFailed ? onRetryPv : undefined}
                onEvidence={() => openEvidence("/data/sec-13f/analytics/portfolio_views.json")}
              />
            </Panel>
          </div>
        </div>
      <GuruTrendBlock investorId={id} />

      {/* Cohort cross-investor charts — full PortfolioViewsData required */}
      <div className="mt-4 space-y-3">
        <Panel
          loading={pvLoading}
          empty={scatterEmpty}
          emptyReason="표시할 위험·수익 데이터가 없습니다"
          emptyNextRefresh="다음 분기 공시 반영 후 갱신"
          error={scatterFailed}
          errorDetail="포트폴리오 수익 데이터를 불러오지 못했습니다."
          asOf={asOf}
          onRetry={scatterFailed ? onRetryPv : undefined}
          retryLabel="다시 시도"
        >
          {pvData && plottableCount > 0 ? (
            <div data-superinvestor-guru-risk-return>
              <PanelHeader
                eyebrow="Risk · Return"
                title="위험 대비 수익"
                right={<span className="sup-head-note">동일 기간 기준</span>}
              />
              <RiskReturnScatter data={pvData} />
            </div>
          ) : null}
          <EvidenceRail
            freshness={scatterFreshness}
            source="SEC EDGAR 13F"
            asOf={asOf}
            coverage={scatterCoverage}
            next="분기 종료 후 최대 45일"
            onRetry={scatterFailed ? onRetryPv : undefined}
            onEvidence={pvData ? () => openEvidence("/data/sec-13f/analytics/portfolio_views.json") : undefined}
          />
        </Panel>

        <Panel
          loading={pvLoading}
          empty={scatterEmpty}
          emptyReason="표시할 누적 수익 데이터가 없습니다"
          emptyNextRefresh="다음 분기 공시 반영 후 갱신"
          error={scatterFailed}
          errorDetail="포트폴리오 수익 데이터를 불러오지 못했습니다."
          asOf={asOf}
          onRetry={scatterFailed ? onRetryPv : undefined}
          retryLabel="다시 시도"
        >
          {pvData && plottableCount > 0 ? (
            <div data-superinvestor-guru-cumulative>
              <PanelHeader
                eyebrow="Cumulative"
                title="누적 수익률 겹보기"
                right={<span className="sup-head-note">동일 기간 기준</span>}
              />
              <CumulativeReturnOverlay data={pvData} />
            </div>
          ) : null}
          <EvidenceRail
            freshness={scatterFreshness}
            source="SEC EDGAR 13F"
            asOf={asOf}
            coverage={scatterCoverage}
            next="분기 종료 후 최대 45일"
            onRetry={scatterFailed ? onRetryPv : undefined}
            onEvidence={pvData ? () => openEvidence("/data/sec-13f/analytics/portfolio_views.json") : undefined}
          />
        </Panel>

        <Panel
          loading={factorLoading}
          empty={radarEmpty}
          emptyReason={hasFactorRecord ? "표시할 팩터 노출 데이터가 없습니다" : "이 투자자의 자료 없음"}
          emptyNextRefresh="다음 분기 공시 반영 후 갱신"
          error={radarFailed}
          errorDetail="팩터 노출 데이터를 불러오지 못했습니다."
          asOf={asOf}
          onRetry={radarFailed ? onRetryFactor : undefined}
          retryLabel="다시 시도"
        >
          {factorData && hasFactorRecord ? (
            <div data-superinvestor-guru-factor>
              <PanelHeader
                eyebrow="Factor"
                title="팩터 노출"
                right={<span className="sup-head-note">FF 파생 틸트</span>}
              />
              <FactorExposureRadar data={factorData} investorId={id} />
            </div>
          ) : null}
          <EvidenceRail
            freshness={radarFreshness}
            source="SEC EDGAR 13F"
            asOf={asOf}
            coverage={radarCoverage}
            next="분기 종료 후 최대 45일"
            onRetry={radarFailed ? onRetryFactor : undefined}
            onEvidence={factorData ? () => openEvidence("/data/sec-13f/analytics/factor_exposures_summary.json") : undefined}
          />
        </Panel>
      </div>

      {loading ? (
        <div className="mt-4 space-y-2">
          <div className="h-4 w-1/3 rounded bg-slate-200" />
          <div className="h-4 w-1/2 rounded bg-slate-200" />
          <div className="h-4 w-2/3 rounded bg-slate-200" />
        </div>
      ) : latest ? (
        <div className="mt-4">
          <p className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">Top 보유</p>
          <LatestHoldingsTable holdings={latest.holdings ?? []} />
        </div>
      ) : status === "private" ? (
        <div className="mt-4">
          <Panel empty emptyReason="상세 데이터는 비공개입니다" emptyNextRefresh="요약·포트폴리오 정보는 공개 범위에서 제공되며, 원문 보유내역은 공개하지 않습니다."><span>상세 데이터는 비공개입니다</span></Panel>
        </div>
      ) : (
        <div className="mt-4">
          <Panel empty emptyReason="상세 데이터를 불러오지 못했습니다" emptyNextRefresh="잠시 후 다시 시도하거나 다른 투자자를 선택해 주세요."><span>상세 데이터를 불러오지 못했습니다</span></Panel>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  isLoading,
  dataKey,
}: {
  label: string;
  value: string;
  isLoading?: boolean;
  dataKey?: string;
}) {
  return (
    <div data-superinvestor-guru-kpi={dataKey} className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
      <p className="truncate text-[11px] font-medium text-slate-500">{label}</p>
      {isLoading ? (
        <div className="mt-1 h-6 w-3/4 rounded bg-slate-200" />
      ) : (
        <p className="mt-1 truncate text-lg font-black tracking-tight text-slate-950 tabular-nums sm:text-xl">
          {value}
        </p>
      )}
    </div>
  );
}

type AmountColor = "emerald" | "rose";

function TradeRankingMobileCard({
  row,
  totalAmount,
  amountColor,
  side,
  actionLabel,
}: {
  row: TradesRankingRow;
  totalAmount: number;
  amountColor: AmountColor;
  side: "bought" | "sold";
  actionLabel: (r: TradesRankingRow) => string | undefined;
}) {
  const canonicalSector = normalizeSuperSector(row.sector_gics ?? row.sector, row.sector);
  const amountTextClass = amountColor === "emerald" ? "text-emerald-700" : "text-rose-700";
  const shareScopeLabel = side === "bought" ? "매수 상위권 내 비중" : "매도 상위권 내 비중";
  return (
    <article
      data-superinvestor-trades-card
      data-superinvestor-trades-card-side={side}
      data-superinvestor-trades-card-ticker={row.ticker}
      data-superinvestor-trades-row
      data-superinvestor-trades-side={side}
      data-superinvestor-trades-ticker={row.ticker}
      role="listitem"
      className="cpw5-super-mobile-card"
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="shrink-0 pt-2 text-xs font-bold text-[var(--c-ink-3)]">#{row.rank}</span>
        <TransitionLink
          href={ROUTES.stock(row.ticker)}
          data-superinvestor-trades-card-action
          data-superinvestor-trades-card-stock-link
          data-superinvestor-trades-action
          data-superinvestor-trades-stock-link
          className="inline-flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-xl border border-slate-200 bg-white px-3 py-1 transition hover:border-brand-interactive hover:text-brand-interactive"
        >
          <span className="truncate text-sm font-black text-slate-900">{row.name}</span>
          <span className="mt-0.5 text-[10px] font-black text-brand-interactive">{row.ticker}</span>
        </TransitionLink>
      </div>
      <dl className="cpw5-super-mobile-card__metrics mt-3">
        <div className="cpw5-super-mobile-card__field">
          <dt>섹터</dt>
          <dd className="flex min-w-0 items-center gap-1">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: sectorColor(canonicalSector) }}
            />
            <span className="truncate">{sectorLabelKo(canonicalSector)}</span>
          </dd>
        </div>
        <div className="cpw5-super-mobile-card__field">
          <dt>{shareScopeLabel}</dt>
          <dd className={` tabular-nums ${amountTextClass}`}>
            {formatTradeShare(row.amount, totalAmount)}
          </dd>
        </div>
        <div className="cpw5-super-mobile-card__field">
          <dt>투자자</dt>
          <dd className="tabular-nums text-slate-900">
            {row.investors_count}
            {actionLabel(row) ? <span className="ml-1 font-sans text-[10px] font-semibold text-[var(--c-ink-3)]">{actionLabel(row)}</span> : null}
          </dd>
        </div>
        <div className="cpw5-super-mobile-card__field">
          <dt>{amountColor === "emerald" ? "TOP 매수자" : "TOP 매도자"}</dt>
          <dd className="min-w-0">
            {row.top_investor?.id ? (
              <TransitionLink
                href={ROUTES.superinvestorsGuru(row.top_investor.id)}
                data-superinvestor-trades-card-action
                data-superinvestor-trades-card-investor-link
                data-superinvestor-trades-action
                data-superinvestor-trades-investor-link
                className="inline-flex min-h-11 max-w-full items-center rounded-xl border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
                title={row.top_investor.name}
              >
                <span className="truncate">{row.top_investor.name}</span>
              </TransitionLink>
            ) : (
              <span className="font-bold text-slate-700">—</span>
            )}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function TradeRankingPanel({
  title,
  rows,
  totalAmount,
  amountColor,
  side,
  expanded,
  onToggle,
  actionLabel,
}: {
  title: string;
  rows: TradesRankingRow[];
  totalAmount: number;
  amountColor: AmountColor;
  side: "bought" | "sold";
  expanded: boolean;
  onToggle: () => void;
  actionLabel: (r: TradesRankingRow) => string | undefined;
}) {
  const visibleRows = expanded ? rows : rows.slice(0, 10);
  const amountTextClass = amountColor === "emerald" ? "text-emerald-700" : "text-rose-700";
  const topLabel = amountColor === "emerald" ? "TOP 매수자" : "TOP 매도자";
  const shareScopeLabel = side === "bought" ? "매수 상위권 내 비중" : "매도 상위권 내 비중";

  if (rows.length === 0) {
    return (
      <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-3 shadow-[var(--sh-sm)] sm:p-4">
        <h3 className="text-sm font-black tracking-tight text-slate-900">{title}</h3>
        <Panel empty emptyReason="데이터가 없습니다" emptyNextRefresh="해당 분기 매매 데이터가 존재하지 않습니다."><span>데이터가 없습니다</span></Panel>
      </div>
    );
  }

  return (
    <div
      data-superinvestor-trades-panel
      data-superinvestor-trades-side={side}
      className="cpw5-super-trades-panel rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-3 shadow-[var(--sh-sm)] sm:p-4"
    >
      <h3 className="text-sm font-black tracking-tight text-slate-900">{title}</h3>
      <div
        className="cpw5-super-mobile-cards mt-3"
        role="list"
        aria-label={`${title} 모바일 요약`}
      >
        {visibleRows.map((row) => (
          <TradeRankingMobileCard
            key={`${row.ticker}-${row.rank}-mobile`}
            row={row}
            totalAmount={totalAmount}
            amountColor={amountColor}
            side={side}
            actionLabel={actionLabel}
          />
        ))}
      </div>
      <div
        data-superinvestor-trades-region
        data-superinvestor-trades-side={side}
        className="cpw5-super-desktop-table cpw5-super-trades-region scroll-hint-x mt-3 -mx-1 px-1"
        role="region"
        tabIndex={0}
        aria-label={`${title} 표 가로 스크롤`}
      >
        <table className="cpw5-super-trades-table w-full min-w-0 table-fixed text-xs">
          <colgroup>
            <col className="w-[9%]" />
            <col className="w-[23%]" />
            <col className="w-[17%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[23%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">
              <th className="px-2 py-2 text-left">순위</th>
              <th className="px-2 py-2 text-left">종목</th>
              <th className="px-2 py-2 text-left">섹터</th>
              <th className="px-2 py-2 text-right">비중</th>
              <th className="px-2 py-2 text-right">투자자</th>
              <th className="px-2 py-2 text-left">{topLabel}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => {
              const canonicalSector = normalizeSuperSector(r.sector_gics ?? r.sector, r.sector);
              return (
                <tr
                  key={`${r.ticker}-${r.rank}`}
                  data-superinvestor-trades-desktop-row
                  data-superinvestor-trades-desktop-side={side}
                  data-superinvestor-trades-desktop-ticker={r.ticker}
                  className="border-b border-slate-100 last:border-b-0"
                >
                  <td className="min-w-0 px-1 py-2 sm:px-2">
                    <span className="tabular-nums text-xs font-bold text-[var(--c-ink-3)]">{r.rank}</span>
                  </td>
                  <td className="min-w-0 px-1 py-2 sm:px-2">
                    <TransitionLink
                      href={ROUTES.stock(r.ticker)}
                      data-superinvestor-trades-desktop-action
                      data-superinvestor-trades-desktop-stock-link
                      className="inline-flex min-h-11 w-full min-w-0 max-w-full flex-col justify-center rounded-xl border border-slate-200 bg-white px-2 py-1 transition hover:border-brand-interactive hover:text-brand-interactive"
                    >
                      <span className="block max-w-full truncate font-bold text-slate-900">{r.name}</span>
                      <span className="mt-0.5 text-[10px] font-black text-brand-interactive">{r.ticker}</span>
                    </TransitionLink>
                  </td>
                  <td className="min-w-0 px-1 py-2 sm:px-2">
                    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold sm:px-2">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: sectorColor(canonicalSector) }}
                      />
                      <span className="truncate">{sectorLabelKo(canonicalSector)}</span>
                    </span>
                  </td>
                  <td className="min-w-0 px-1 py-2 text-right sm:px-2" title={shareScopeLabel}>
                    <span className={` tabular-nums font-bold ${amountTextClass}`}>
                      {formatTradeShare(r.amount, totalAmount)}
                    </span>
                  </td>
                  <td className="min-w-0 px-1 py-2 text-right sm:px-2">
                    <span className="tabular-nums font-bold text-slate-900">{r.investors_count}</span>
                    {actionLabel(r) ? (
                      <span className="block truncate text-[10px] font-semibold text-[var(--c-ink-3)]">{actionLabel(r)}</span>
                    ) : null}
                  </td>
                  <td className="min-w-0 px-1 py-2 sm:px-2">
                    {r.top_investor?.id ? (
                      <TransitionLink
                        href={ROUTES.superinvestorsGuru(r.top_investor.id)}
                        data-superinvestor-trades-desktop-action
                        data-superinvestor-trades-desktop-investor-link
                        className="inline-flex min-h-11 w-full min-w-0 max-w-full items-center rounded-xl border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
                        title={r.top_investor.name}
                      >
                        <span className="truncate">{r.top_investor.name}</span>
                      </TransitionLink>
                    ) : (
                      <span className="block truncate text-[10px] font-bold text-slate-700">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 10 ? (
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={expanded}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive sm:min-h-8"
        >
          {expanded ? "접기" : "전체 50개 보기"}
        </button>
      ) : null}
    </div>
  );
}
function CohortTreemapPanel({
  pvData,
  pvLoading,
  pvFailed,
  onRetryPv,
  onSelectTicker,
}: {
  pvData: PortfolioViewsData | null;
  pvLoading: boolean;
  pvFailed: boolean;
  onRetryPv?: () => void;
  onSelectTicker?: (ticker: string) => void;
}) {
  const treemap = pvData?.total?.treemap ?? [];
  const quarter = pvData?.metadata?.quarter ?? "—";
  const cohort = pvData?.metadata?.cohort_count ?? null;
  const failed = !pvLoading && (pvFailed || !pvData);
  const empty = !pvLoading && !pvFailed && !!pvData && treemap.length === 0;
  const partial = !pvLoading && !failed && !empty && cohort == null;
  const headNote =
    treemap.length > 0
      ? `${formatInteger(treemap.length)}종목 · ${cohort != null ? `${formatInteger(cohort)}인 합산` : "코호트 확인 중"}`
      : "—";
  return (
    <Panel
      loading={pvLoading}
      empty={empty}
      emptyReason="표시할 코호트 트리맵 데이터가 없습니다"
      emptyNextRefresh="다음 분기 공시 반영 후 갱신"
      error={failed}
      errorDetail="거장 토탈 포트폴리오 데이터를 불러오지 못했습니다."
      asOf={quarter}
      onRetry={failed ? onRetryPv : undefined}
      retryLabel="다시 시도"
    >
      {treemap.length > 0 ? (
        <div data-superinvestor-cohort-treemap data-superinvestor-cohort-treemap-count={treemap.length}>
          <PanelHeader
            eyebrow="Cohort"
            title="거장 토탈 포트폴리오"
            right={<span className="sup-head-note">{headNote}</span>}
          />
          <PortfolioTreemap rows={treemap} quarterLabel={quarter} onSelectTicker={onSelectTicker} />
          {pvData?.metadata?.disclaimer ? (
            <p className="mt-2 text-[10px] font-semibold text-[var(--c-ink-3)]">{pvData.metadata.disclaimer}</p>
          ) : null}
        </div>
      ) : null}
      <EvidenceRail
        freshness={pvLoading ? "pending" : failed ? "error" : empty || partial ? "partial" : "stale"}
        source="SEC EDGAR 13F"
        asOf={quarter}
        coverage={treemap.length > 0 ? headNote : "표시할 코호트 행 없음"}
        next="분기 종료 후 최대 45일"
        onRetry={failed ? onRetryPv : undefined}
        onEvidence={pvData ? () => openEvidence("/data/sec-13f/analytics/portfolio_views.json") : undefined}
      />
    </Panel>
  );
}

type RotationSort = "abs" | "desc" | "asc";

const ROTATION_SORTS: Array<{ key: RotationSort; label: string }> = [
  { key: "abs", label: "변동폭 순" },
  { key: "desc", label: "확대 순" },
  { key: "asc", label: "축소 순" },
];

function SectorRotationPanel({
  pvData,
  pvLoading,
  pvFailed,
  onRetryPv,
  tradesData,
  tradesLoading,
  tradesFailed,
  bySector,
}: {
  pvData: PortfolioViewsData | null;
  pvLoading: boolean;
  pvFailed: boolean;
  onRetryPv?: () => void;
  tradesData: TradesRankingData | null;
  tradesLoading: boolean;
  tradesFailed: boolean;
  bySector: SectorHoldingsData | null;
}) {
  const [sortMode, setSortMode] = useState<RotationSort>("abs");
  const rotation = useMemo(() => {
    const base = buildSectorRotationRows(pvData?.total?.sector_history);
    const rows = [...base];
    if (sortMode === "desc") rows.sort((a, b) => b.deltaPp - a.deltaPp);
    else if (sortMode === "asc") rows.sort((a, b) => a.deltaPp - b.deltaPp);
    return rows;
  }, [pvData, sortMode]);
  const participation = useMemo(() => {
    const bought = new Map<CanonicalSector, number>();
    const sold = new Map<CanonicalSector, number>();
    for (const row of tradesData?.bought ?? []) {
      const sector = normalizeSuperSector(row.sector_gics ?? row.sector, row.sector);
      bought.set(sector, (bought.get(sector) ?? 0) + 1);
    }
    for (const row of tradesData?.sold ?? []) {
      const sector = normalizeSuperSector(row.sector_gics ?? row.sector, row.sector);
      sold.set(sector, (sold.get(sector) ?? 0) + 1);
    }
    return { bought, sold };
  }, [tradesData]);
  const holdingsBySector = useMemo(() => {
    const map = new Map<CanonicalSector, SectorHoldingsEntry>();
    if (!bySector) return map;
    for (const [key, entry] of Object.entries(bySector)) {
      if (key === "_meta" || !isSectorEntry(entry)) continue;
      const canonical = normalizeSuperSector(key, key);
      if (!map.has(canonical)) map.set(canonical, entry);
    }
    return map;
  }, [bySector]);

  const quarter = pvData?.metadata?.quarter ?? "—";
  const quarterCount = pvData?.total?.sector_history?.quarters.length ?? 0;
  const failed = !pvLoading && (pvFailed || !pvData);
  const empty = !pvLoading && !pvFailed && !!pvData && rotation.length === 0;
  const tradesPartFailed = !tradesLoading && (tradesFailed || !tradesData);
  const chipsMissing = !bySector;
  const partial = !pvLoading && !failed && !empty && (tradesPartFailed || chipsMissing);
  const coverage =
    rotation.length > 0
      ? `${formatInteger(rotation.length)}섹터 · ${formatInteger(quarterCount)}분기${tradesPartFailed ? " · 매매 참여 미반영" : ""}${chipsMissing ? " · 보유 칩 미반영" : ""}`
      : "표시할 섹터 행 없음";
  return (
    <Panel
      loading={pvLoading || tradesLoading}
      empty={empty}
      emptyReason="표시할 섹터 로테이션 데이터가 없습니다"
      emptyNextRefresh="다음 분기 공시 반영 후 갱신"
      error={failed}
      errorDetail="섹터 로테이션 데이터를 불러오지 못했습니다."
      asOf={quarter}
      onRetry={failed ? onRetryPv : undefined}
      retryLabel="다시 시도"
    >
      {rotation.length > 0 ? (
        <div data-superinvestor-sector-rotation data-superinvestor-sector-rotation-count={rotation.length}>
          <PanelHeader
            eyebrow="Sector"
            title="섹터 로테이션"
            right={<span className="sup-head-note">{quarter} · 전분기 대비</span>}
          />
          <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="섹터 정렬 기준">
            {ROTATION_SORTS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setSortMode(option.key)}
                aria-pressed={sortMode === option.key}
                className={`inline-flex min-h-11 items-center rounded-full border px-3 text-[10px] font-black uppercase tracking-[0.1em] transition sm:min-h-8 ${
                  sortMode === option.key
                    ? "border-brand-interactive bg-brand-interactive/10 text-brand-interactive"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="mt-2 space-y-2">
            {rotation.map((row) => {
              const up = row.deltaPp > 0.05;
              const down = row.deltaPp < -0.05;
              const deltaClass = up ? "text-emerald-700" : down ? "text-rose-700" : "text-slate-500";
              const bought = participation.bought.get(row.sector);
              const sold = participation.sold.get(row.sector);
              const chips = holdingsBySector.get(row.sector)?.top_holdings?.slice(0, 3) ?? [];
              return (
                <div
                  key={row.sector}
                  data-superinvestor-sector-rotation-row
                  data-superinvestor-sector-rotation-sector={row.sector}
                  className="rounded-xl border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: sectorColor(row.sector) }}
                      />
                      <span className="truncate">{sectorLabelKo(row.sector)}</span>
                    </span>
                    <span className={`shrink-0 text-xs font-black tabular-nums ${deltaClass}`}>
                      {row.deltaPp >= 0 ? "▲" : "▼"}{Math.abs(row.deltaPp).toFixed(1)}%p
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-slate-700">
                    <span>보유 <b className="tabular-nums text-slate-900">{formatPercent(row.current, { digits: 1 })}</b></span>
                    <span>매수 <b className="tabular-nums text-slate-900">{tradesPartFailed ? "—" : `${formatInteger(bought ?? 0)}종목`}</b></span>
                    <span>매도 <b className="tabular-nums text-slate-900">{tradesPartFailed ? "—" : `${formatInteger(sold ?? 0)}종목`}</b></span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {chips.length > 0 ? (
                      chips.map((ticker) => <TickerChip key={ticker} ticker={ticker} variant="inline" />)
                    ) : (
                      <span className="text-[10px] font-bold text-slate-700">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] font-semibold text-[var(--c-ink-3)]">
            가중치는 거장 코호트 합산 보유 시가총액 기준, 델타는 직전 분기 대비 %p입니다. 매수·매도는 매매 상위권 기준 종목 수입니다.
          </p>
        </div>
      ) : null}
      <EvidenceRail
        freshness={pvLoading || tradesLoading ? "pending" : failed ? "error" : empty || partial ? "partial" : "stale"}
        source="SEC EDGAR 13F"
        asOf={quarter}
        coverage={coverage}
        next="분기 종료 후 최대 45일"
        onRetry={failed ? onRetryPv : undefined}
        onEvidence={pvData ? () => openEvidence("/data/sec-13f/analytics/portfolio_views.json") : undefined}
      />
    </Panel>
  );
}
export default function SuperinvestorsClient({ initialGuru = null, initialTab = null }: { initialGuru?: string | null; initialTab?: string | null }) {
  const {
    consensus,
    enhancedConsensus,
    summary,
    byTicker,
    bySector,
    convictionEntries,
    dataReady,
    failed,
    quarter,
    excludedStale,
    failedRequests,
    retry,
  } = use13FData();
  const [sort, setSort] = useState<HolderSort>("aum");
  const [expandedGuru, setExpandedGuru] = useState<string | null>(initialGuru);
  const [tab, setTab] = useState<SupTab>(() => resolveInitialTab(initialTab, initialGuru));
  const [prevInitial, setPrevInitial] = useState({ guru: initialGuru, tab: initialTab });
  if (prevInitial.guru !== initialGuru || prevInitial.tab !== initialTab) {
    setPrevInitial({ guru: initialGuru, tab: initialTab });
    setExpandedGuru(initialGuru);
    setTab(resolveInitialTab(initialTab, initialGuru));
  }
  const tabsBaseId = useTabsBaseId("sup");
  const router = useRouter();
  const [turnover, setTurnover] = useState<TurnoverData["by_investor"] | null | undefined>(undefined);
  const [turnoverError, setTurnoverError] = useState(false);
  const [tradesData, setTradesData] = useState<TradesRankingData | null>(null);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [tradesFailed, setTradesFailed] = useState(false);
  const [tradesBoughtExpanded, setTradesBoughtExpanded] = useState(false);
  const [tradesSoldExpanded, setTradesSoldExpanded] = useState(false);
  const [pvData, setPvData] = useState<PortfolioViewsData | null>(null);
  const [pvLoading, setPvLoading] = useState(true);
  const [pvFailed, setPvFailed] = useState(false);
  const [factorData, setFactorData] = useState<FactorExposuresSummaryData | null>(null);
  const [factorLoading, setFactorLoading] = useState(true);
  const [factorFailed, setFactorFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadTurnoverLocal().then(
      (map) => {
        if (!cancelled) {
          setTurnover(map);
          setTurnoverError(false);
        }
      },
      () => {
        // Turnover shapes only the "분기 변화" column: a fetch rejection is
        // an error state on the Holders rail, never a silent pending cell.
        if (!cancelled) {
          setTurnover(null);
          setTurnoverError(true);
        }
      },
    );
    return () => { cancelled = true; };
  }, []);

  function retryTurnover() {
    setTurnoverError(false);
    setTurnover(undefined);
    loadTurnoverLocal().then(
      (map) => {
        setTurnover(map);
      },
      () => {
        setTurnover(null);
        setTurnoverError(true);
      },
    );
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setTradesLoading(true);
      setTradesFailed(false);
      try {
        const json = normalizeTradesRanking(
          await fetch13FJson<unknown>("/data/sec-13f/analytics/trades_ranking.json"),
        );
        if (!json) throw new Error("Invalid trades_ranking shape");
        if (!cancelled) setTradesData(json);
      } catch {
        if (!cancelled) setTradesFailed(true);
      } finally {
        if (!cancelled) setTradesLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  function loadPv() {
    setPvLoading(true);
    setPvFailed(false);
    loadPortfolioViews().then((data) => {
      setPvData(data);
      setPvFailed(!data);
      setPvLoading(false);
    }).catch(() => {
      setPvData(null);
      setPvFailed(true);
      setPvLoading(false);
    });
  }

  function loadFactor() {
    setFactorLoading(true);
    setFactorFailed(false);
    loadFactorExposuresSummary().then((data) => {
      setFactorData(data);
      setFactorFailed(!data);
      setFactorLoading(false);
    }).catch(() => {
      setFactorData(null);
      setFactorFailed(true);
      setFactorLoading(false);
    });
  }

  useEffect(() => {
    let cancelled = false;
    loadPortfolioViews().then((data) => {
      if (cancelled) return;
      setPvData(data);
      setPvFailed(!data);
      setPvLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setPvData(null);
      setPvFailed(true);
      setPvLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadFactorExposuresSummary().then((data) => {
      if (cancelled) return;
      setFactorData(data);
      setFactorFailed(!data);
      setFactorLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setFactorData(null);
      setFactorFailed(true);
      setFactorLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  function retryPv() {
    loadPv();
  }

  function retryFactor() {
    loadFactor();
  }

  const investors = useMemo<[string, SummaryInvestor][]>(
    () => (summary ? Object.entries(summary.investors) : []),
    [summary],
  );

  // Per-investor top holding: max within-investor weight across by_ticker
  // holder_details. Falls back to summary top5[0] (ticker only, no weight).
  const topHoldings = useMemo(() => {
    const map = new Map<string, { ticker: string; weight: number }>();
    if (!byTicker) return map;
    for (const [ticker, entry] of Object.entries(byTicker)) {
      if (!entry || !Array.isArray(entry.holder_details)) continue;
      for (const h of entry.holder_details) {
        if (!h || typeof h.investor !== "string") continue;
        const w = typeof h.weight === "number" && Number.isFinite(h.weight) ? h.weight : null;
        if (w === null) continue;
        const cur = map.get(h.investor);
        if (!cur || w > cur.weight) map.set(h.investor, { ticker, weight: w });
      }
    }
    return map;
  }, [byTicker]);

  const sortedInvestors = useMemo(() => {
    const rows = [...investors];
    if (sort === "aum") rows.sort(([, a], [, b]) => (b.aum ?? -1) - (a.aum ?? -1));
    else if (sort === "holdings") rows.sort(([, a], [, b]) => (b.holdings_count ?? -1) - (a.holdings_count ?? -1));
    else {
      rows.sort(([a], [b]) => (turnover?.[b]?.turnover ?? -1) - (turnover?.[a]?.turnover ?? -1));
    }
    if (expandedGuru) {
      rows.sort(([a], [b]) => {
        if (a === expandedGuru) return -1;
        if (b === expandedGuru) return 1;
        return 0;
      });
    }
    return rows;
  }, [investors, sort, turnover, expandedGuru]);

  const overlapRows = useMemo(() => {
    if (!consensus) return [];
    return sortConsensusByHolders(Object.values(consensus.consensus)).slice(0, 4);
  }, [consensus]);

  // Mobile graph replacement: ranked list of the most-held tickers.
  const graphRankRows = useMemo(() => {
    if (!consensus) return [];
    return sortConsensusByHolders(Object.values(consensus.consensus)).slice(0, 10);
  }, [consensus]);

  const loading = !dataReady && !failed;
  const investorCount = summary
    ? (consensus?.metadata?.current_cohort_investors ??
      summary?.metadata?.investor_count ??
      summary?.metadata?.total_investors ??
      investors.length)
    : null;
  const totalTracked = summary
    ? (consensus?.metadata?.total_investors ??
      summary?.metadata?.investor_count ??
      summary?.metadata?.total_investors ??
      investors.length)
    : null;
  const coverage = dataReady ? `${formatInteger(investorCount)}/${formatInteger(totalTracked)} 투자자` : "—";
  const submittedTotal = summary?.metadata?.investor_count ?? null;
  // No average-filing-lag field exists in the loaded 13F payloads: the chip
  // binds submitted/total/stale to the payload and shows "—" for the lag.
  const freshnessChip = `${formatInteger(dataReady ? investorCount : null)}/${formatInteger(dataReady ? submittedTotal : null)} 제출 · 정체 ${formatInteger(dataReady && summary ? excludedStale.length : null)}명 제외 · 지연 평균 —`;
  const turnoverCovered = turnover ? Object.keys(turnover).length : 0;
  const holdersCoverage =
    turnoverError
      ? `${coverage} · 회전율 확인 불가`
      : turnover !== undefined && turnoverCovered > 0
        ? `${coverage} · 회전율 ${formatInteger(turnoverCovered)}명`
        : coverage;
  // 13F filings land up to 45 days after quarter end: the quarter label names
  // the cohort, never a fresh as-of. Rails carry the real build clock when the
  // summary stamps one, else the true quarter as-of — always stale, never
  // fresh from the quarter label alone.
  const generatedClock = summary?.metadata?.generated_at?.slice(0, 10) ?? null;
  const asOfLabel = generatedClock ?? quarter ?? "—";
  const partialFeeds = failedRequests.length > 0;

  const holdersFailed = !loading && summary === null && failedRequests.includes("summary");
  const overlapFailed = !loading && consensus === null && failedRequests.includes("consensus");
  const holdersEmpty = !loading && !holdersFailed && dataReady && sortedInvestors.length === 0;
  const overlapEmpty = !loading && !overlapFailed && dataReady && overlapRows.length === 0;
  const holdersFreshness: "pending" | "error" | "partial" | "stale" =
    loading ? "pending" : holdersFailed ? "error" : partialFeeds || excludedStale.length > 0 || turnoverError ? "partial" : "stale";
  const overlapFreshness: "pending" | "error" | "partial" | "stale" =
    loading ? "pending" : overlapFailed ? "error" : partialFeeds || excludedStale.length > 0 ? "partial" : "stale";

  const delayLabel = "기관 공시는 분기 종료 후 최대 45일 지연됩니다";
  const tradesBoughtAmount = tradesData?.bought.reduce((sum, row) => sum + (row.amount || 0), 0) ?? 0;
  const tradesSoldAmount = tradesData?.sold.reduce((sum, row) => sum + (row.amount || 0), 0) ?? 0;

  const [selectedGraphTicker, setSelectedGraphTicker] = useState<string | null>(null);
  const graphNetwork = useMemo(
    () => buildGraphNetwork({ summary, byTicker, excludedStale, failedRequests }),
    [summary, byTicker, excludedStale, failedRequests],
  );
  const graphFailed = !loading && byTicker === null && graphNetwork.edges.length === 0 && failedRequests.includes("by_ticker");
  const graphReady = !loading && !graphFailed && (byTicker !== null || graphNetwork.edges.length > 0);
  const graphFreshness: "pending" | "error" | "partial" | "stale" =
    loading ? "pending" : graphFailed ? "error" : partialFeeds || excludedStale.length > 0 ? "partial" : "stale";
  const graphCoverage = graphReady
    ? `투자자 ${formatInteger(graphNetwork.investorCount)}${graphNetwork.totalInvestors !== null ? `/${formatInteger(graphNetwork.totalInvestors)}` : ""}명 · 종목 ${formatInteger(graphNetwork.tickerCount)}/${formatInteger(graphNetwork.totalTickers)} 연결`
    : coverage;
  function openGraphEvidence() {
    openEvidence("/data/sec-13f/summary.json");
    openEvidence("/data/sec-13f/by_ticker.json");
  }

  function toggleGuru(id: string) {
    setExpandedGuru((cur) => {
      const next = cur === id ? null : id;
      syncGuruParam(next);
      return next;
    });
  }

  function selectTab(next: SupTab) {
    setTab(next);
    syncTabParam(next);
  }

  return (
    <div className="sup" data-superinvestors-surface>
      <div className="sup-head">
        <div className="sup-title-block">
          <div className="sup-eyebrow-row">
            <span className="sup-eyebrow" data-superinvestors-eyebrow>
              SUPERINVESTORS · 13F {quarter ?? "분기 확인 중"}
            </span>
            <Pill data-superinvestors-count>투자자 {formatInteger(dataReady ? investorCount : null)}명</Pill>
          </div>
          <h1 className="sup-title">
            {loading ? "투자자 데이터를 불러오는 중입니다." : failed ? "투자자 데이터를 불러오지 못했습니다. 다시 시도해 주세요." : (
              <>이번 분기 무엇을 새로 사고 팔았나 — 지금 봐야 할 시그널부터</>
            )}
          </h1>
          <div className="sup-meta-row">
            <Pill data-superinvestors-quarter>기준 {quarter ?? "—"} 제출분</Pill>
            <Pill tone="warn" data-superinvestors-freshness>{freshnessChip}</Pill>
            {excludedStale.length > 0 ? <Pill tone="warn">최신 분기 제외 {excludedStale.length}명</Pill> : null}
            {!failed && partialFeeds ? <Pill tone="warn">일부 피드 {failedRequests.length}개 미반영</Pill> : null}
            {!failed && !partialFeeds && turnoverError ? <Pill tone="warn">회전율 확인 불가</Pill> : null}
            {failed ? <Button variant="secondary" onClick={reload}>다시 시도</Button> : null}
          </div>
        </div>
      </div>

      <div className="sup-tabs scroll-hint-x" role="region" tabIndex={0} aria-label="투자자 화면 탭 가로 스크롤">
        <div role="tablist" aria-label="투자자 화면 전환" className="sup-tablist">
          {SUP_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={getTabId(tabsBaseId, item)}
              aria-selected={tab === item.id}
              aria-controls={getPanelId(tabsBaseId, item)}
              data-superinvestors-tab={item.id}
              className={`sup-tab${tab === item.id ? " on" : ""}`}
              onClick={() => selectTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <TabPanel item={{ id: "signal" as SupTab, label: "시그널" }} active={tab === "signal"} idBase={tabsBaseId}>
        <SignalPanel
          summary={summary}
          consensus={consensus}
          enhancedConsensus={enhancedConsensus}
          byTicker={byTicker}
          convictionEntries={convictionEntries}
          quarter={quarter}
          asOf={asOfLabel}
          dataReady={dataReady}
          failed={failed}
          partialFeeds={partialFeeds}
          investorCount={investorCount}
          onRetry={retry}
        />
        <div className="sup-signal-teaser">
          <GraphNetworkTeaser
            network={graphNetwork}
            href={withQuery(ROUTES.superinvestors, { tab: "graph" })}
            status={loading ? "pending" : graphFailed ? "error" : "ready"}
            freshness={graphFreshness}
            source="SEC EDGAR 13F"
            asOf={asOfLabel}
            coverage={graphCoverage}
            onRetry={graphFailed || (graphReady && partialFeeds) ? retry : undefined}
            onEvidence={dataReady && !failed ? openGraphEvidence : undefined}
          />
        </div>
      </TabPanel>

      <TabPanel item={{ id: "investors" as SupTab, label: "투자자" }} active={tab === "investors"} idBase={tabsBaseId}>
      <div className="sup-grid">
        <Panel
          loading={loading}
          empty={holdersEmpty}
          emptyReason="표시할 투자자가 없습니다"
          emptyNextRefresh="다음 분기 공시 반영 후 갱신"
          error={holdersFailed}
          errorDetail="투자자 목록을 불러오지 못했습니다."
          onRetry={holdersFailed ? retry : undefined}
          retryLabel="다시 시도"
        >
          {dataReady && sortedInvestors.length > 0 && (
            <div data-superinvestors-holders data-superinvestors-holders-count={sortedInvestors.length}>
              <PanelHeader
                eyebrow="Holders"
                title="투자자 목록"
                right={(
                  <div className="sup-sort-toggle" data-superinvestors-sort-toggle role="group" aria-label="투자자 정렬 기준">
                    {HOLDER_SORTS.map((item) => (
                      <Button
                        key={item.key}
                        type="button"
                        variant="tab"
                        active={sort === item.key}
                        aria-pressed={sort === item.key}
                        data-superinvestors-sort={item.key}
                        className="sup-sort-btn"
                        onClick={() => setSort(item.key)}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                )}
              />
              <div className="sup-hold-scroll scroll-hint-x" role="region" tabIndex={0} aria-label="투자자 목록 표 가로 스크롤">
                <table className="sup-hold-table">
                  <thead>
                    <tr>
                      <th scope="col" className="sup-th-name">투자자</th>
                      <th scope="col">AUM</th>
                      <th scope="col">보유종목</th>
                      <th scope="col">최대 비중</th>
                      <th scope="col">분기 변화</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedInvestors.map(([id, inv]) => {
                      const isOpen = expandedGuru === id;
                      const top = topHoldings.get(id);
                      const topTicker = top?.ticker ?? inv.top5?.[0] ?? null;
                      const change = turnover?.[id] ?? null;
                      const changeValue = change && typeof change.turnover === "number" && Number.isFinite(change.turnover)
                        ? formatPercent(change.turnover, { digits: 1 })
                        : change
                          ? `신규 ${formatInteger(change.new_count)} · 청산 ${formatInteger(change.sold_count)}`
                          : "—";
                      return (
                        <Fragment key={id}>
                          <tr
                            className="sup-hold-row"
                            data-superinvestors-holder-row
                            data-superinvestors-holder-id={id}
                            data-superinvestors-holder-expanded={isOpen ? "true" : "false"}
                          >
                            <th scope="row" className="sup-holder-name-cell">
                              <button
                                type="button"
                                className="sup-holder-name"
                                aria-expanded={isOpen}
                                onClick={() => toggleGuru(id)}
                              >
                                <span className="sup-holder-name-text">{inv.name}</span>
                                <span className="sup-holder-sub">
                                  {inv.group}
                                  {inv.is_stale ? <span className="sup-stale-badge">지연</span> : null}
                                </span>
                              </button>
                            </th>
                            <td className="tabular-nums">{formatCurrencyCompact(inv.aum, "USD")}</td>
                            <td className="tabular-nums">{formatInteger(inv.holdings_count)}개</td>
                            <td>
                              {topTicker ? (
                                <span className="sup-top">
                                  <span className="sup-mono">{topTicker}</span>
                                  <span className="tabular-nums">{top ? formatPercent(top.weight, { digits: 1 }) : "—"}</span>
                                </span>
                              ) : (
                                <span className="sup-mute">—</span>
                              )}
                            </td>
                            <td
                              className="tabular-nums"
                              title={change ? `신규 ${change.new_count} · 청산 ${change.sold_count} · ${change.total_positions}포지션` : undefined}
                            >
                              {changeValue}
                            </td>
                          </tr>
                          {isOpen ? (
                            <tr key={`${id}-detail`} className="sup-detail-row">
                              <td colSpan={5} data-superinvestors-holder-detail data-superinvestors-holder-detail-id={id}>
                                <GuruDetailPanel
                                  id={id}
                                  summary={inv}
                                  pvData={pvData}
                                  pvLoading={pvLoading}
                                  pvFailed={pvFailed}
                                  onRetryPv={retryPv}
                                  factorData={factorData}
                                  factorLoading={factorLoading}
                                  factorFailed={factorFailed}
                                  onRetryFactor={retryFactor}
                                  asOf={asOfLabel}
                                />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <EvidenceRail
            freshness={holdersFreshness}
            source="SEC EDGAR 13F"
            asOf={asOfLabel}
            coverage={holdersCoverage}
            next="분기 종료 후 최대 45일"
            onRetry={failed ? reload : partialFeeds ? retry : turnoverError ? retryTurnover : undefined}
            onEvidence={dataReady && !failed ? () => openEvidence("/data/sec-13f/summary.json") : undefined}
          />
        </Panel>

        <div className="sup-rail">
          <Panel
            loading={loading}
            empty={overlapEmpty}
            emptyReason="표시할 공통 보유 종목이 없습니다"
            emptyNextRefresh="다음 분기 공시 반영 후 갱신"
            error={overlapFailed}
            errorDetail="공통 보유 종목을 불러오지 못했습니다."
            onRetry={overlapFailed ? retry : undefined}
            retryLabel="다시 시도"
          >
            {dataReady && overlapRows.length > 0 && (
              <div data-superinvestors-overlap data-superinvestors-overlap-count={overlapRows.length}>
                <PanelHeader
                  eyebrow="Overlap"
                  title="공통 보유"
                  right={<span className="sup-head-note">가장 많이 겹치는 종목</span>}
                />
                {overlapRows.map((row) => {
                  const enhanced = enhancedConsensus?.enhanced_consensus?.[row.ticker];
                  return (
                    <Row
                      key={row.ticker}
                      data-superinvestors-overlap-row
                      data-superinvestors-overlap-ticker={row.ticker}
                      data-superinvestors-overlap-holders={row.holders_count}
                    >
                      <span className="sup-mono sup-ticker-strong">{row.ticker}</span>
                      <span className="sup-olap-holders">
                        <b className="tabular-nums">{formatInteger(row.holders_count)}명</b>
                        {enhanced ? (
                          <span className="sup-mute tabular-nums">주식 {enhanced.equity_holders}/{enhanced.total_holders}</span>
                        ) : null}
                      </span>
                      <span className="tabular-nums sup-olap-score">
                        {enhanced ? formatPercent(enhanced.equity_score, { digits: 0 }) : "—"}
                      </span>
                    </Row>
                  );
                })}
              </div>
            )}
            <EvidenceRail
              freshness={overlapFreshness}
              source="SEC EDGAR 13F"
              asOf={asOfLabel}
              coverage={coverage}
              next="분기 종료 후 최대 45일"
              onRetry={failed ? reload : partialFeeds ? retry : undefined}
              onEvidence={dataReady && !failed ? () => openEvidence("/data/sec-13f/analytics/consensus.json") : undefined}
            />
          </Panel>

          <GraphNetworkTeaser
            network={graphNetwork}
            href={withQuery(ROUTES.superinvestors, { tab: "graph" })}
            status={loading ? "pending" : graphFailed ? "error" : "ready"}
            freshness={graphFreshness}
            source="SEC EDGAR 13F"
            asOf={asOfLabel}
            coverage={graphCoverage}
            onRetry={graphFailed || (graphReady && partialFeeds) ? retry : undefined}
            onEvidence={dataReady && !failed ? openGraphEvidence : undefined}
          />
        </div>
      </div>
      </TabPanel>

      <TabPanel item={{ id: "stocks" as SupTab, label: "종목" }} active={tab === "stocks"} idBase={tabsBaseId}>
        <div className="space-y-4">
        <CohortTreemapPanel
          pvData={pvData}
          pvLoading={pvLoading}
          pvFailed={pvFailed}
          onRetryPv={retryPv}
          onSelectTicker={(ticker) => router.push(ROUTES.stock(ticker))}
        />
        <WhoHoldsPanel
          summary={summary}
          consensus={consensus}
          enhancedConsensus={enhancedConsensus}
          byTicker={byTicker}
          quarter={quarter}
          asOf={asOfLabel}
          dataReady={dataReady}
          failed={failed}
          partialFeeds={partialFeeds}
          onRetry={retry}
        />
        </div>
      </TabPanel>

      <TabPanel item={{ id: "trades" as SupTab, label: "매매 동향" }} active={tab === "trades"} idBase={tabsBaseId}>
        <div className="space-y-4">
          <SectorRotationPanel
            pvData={pvData}
            pvLoading={pvLoading}
            pvFailed={pvFailed}
            onRetryPv={retryPv}
            tradesData={tradesData}
            tradesLoading={tradesLoading}
            tradesFailed={tradesFailed}
            bySector={bySector}
          />
          {tradesData ? (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {tradesData.metadata.quarter} 기준
                </span>
                <span className="text-[10px] font-bold text-[var(--c-ink-3)]">{delayLabel}</span>
              </div>
              {tradesData.metadata.disclaimer ? (
                <p className="text-[10px] font-semibold text-[var(--c-ink-3)]">{tradesData.metadata.disclaimer}</p>
              ) : null}
              {tradesData.metadata.generated_at && fmtDateTimeKo(tradesData.metadata.generated_at) ? (
                <p className="text-[10px] font-semibold text-[var(--c-ink-3)]">
                  생성 {fmtDateTimeKo(tradesData.metadata.generated_at)}
                </p>
              ) : null}
            </div>
          ) : null}

          {tradesLoading ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {[0, 1].map((p) => (
                <div key={p} className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-3 shadow-[var(--sh-sm)] sm:p-4">
                  <div className="h-5 w-1/3 rounded bg-slate-200" />
                  <div className="mt-3 space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="h-4 w-full rounded bg-slate-200" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : tradesFailed ? (
            <div className="rounded-[1.2rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
              매매랭킹 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
            </div>
          ) : tradesData ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <TradeRankingPanel
                title="많이 매수된 종목"
                rows={tradesData.bought}
                totalAmount={tradesBoughtAmount}
                amountColor="emerald"
                side="bought"
                expanded={tradesBoughtExpanded}
                onToggle={() => setTradesBoughtExpanded((v) => !v)}
                actionLabel={(r) =>
                  r.new_count != null && r.new_count > 0
                    ? `${r.new_count}개 신규`
                    : undefined
                }
              />
              <TradeRankingPanel
                title="많이 매도된 종목"
                rows={tradesData.sold}
                totalAmount={tradesSoldAmount}
                amountColor="rose"
                side="sold"
                expanded={tradesSoldExpanded}
                onToggle={() => setTradesSoldExpanded((v) => !v)}
                actionLabel={(r) =>
                  r.exit_count != null && r.exit_count > 0
                    ? `${r.exit_count}개 청산`
                    : undefined
                }
              />
            </div>
          ) : null}
        </div>
      </TabPanel>

      <TabPanel item={{ id: "insights" as SupTab, label: "인사이트" }} active={tab === "insights"} idBase={tabsBaseId}>
        <InsightsTab />
      </TabPanel>

      <TabPanel item={{ id: "graph" as SupTab, label: "그래프" }} active={tab === "graph"} idBase={tabsBaseId}>
      <section className="sup-graph-full" id="superinvestors-graph-full" aria-label="투자자 종목 연결 그래프">
        {graphFailed ? (
          <Panel
            error
            errorDetail="종목별 보유 피드를 불러오지 못했습니다."
            asOf={asOfLabel}
            onRetry={retry}
            retryLabel="다시 시도"
          >
            <div data-superinvestors-graph>
              <PanelHeader eyebrow="Graph Network" title="누가 무엇을 함께 들고 있나" />
              <EvidenceRail
                freshness="error"
                source="SEC EDGAR 13F"
                asOf={asOfLabel}
                coverage="—"
                onRetry={retry}
                onEvidence={dataReady && !failed ? openGraphEvidence : undefined}
              />
            </div>
          </Panel>
        ) : graphReady ? (
          <GraphNetworkPanel
            network={graphNetwork}
            selectedTicker={selectedGraphTicker}
            onSelectTicker={setSelectedGraphTicker}
            rail={{
              freshness: graphFreshness,
              source: "SEC EDGAR 13F",
              asOf: asOfLabel,
              coverage: graphCoverage,
              onRetry: failed ? reload : partialFeeds ? retry : undefined,
              onEvidence: dataReady && !failed ? openGraphEvidence : undefined,
            }}
          />
        ) : (
          <Panel>
            <div data-superinvestors-graph>
              <PanelHeader eyebrow="Graph Network" title="누가 무엇을 함께 들고 있나" />
              <EmptyState
                reason="그래프 데이터를 불러오는 중입니다"
                nextRefresh="잠시 후 다시 확인해 주세요"
              />
              <EvidenceRail
                freshness="pending"
                source="SEC EDGAR 13F"
                asOf={asOfLabel}
                coverage="—"
              />
            </div>
          </Panel>
        )}
      </section>
      {graphRankRows.length > 0 ? (
        <div className="sup-graph-ranklist" data-superinvestors-graph-ranklist>
          <PanelHeader eyebrow="Graph · Ranked" title="함께 가장 많이 들고 있는 종목" />
          {graphRankRows.map((row) => (
            <Row
              key={row.ticker}
              data-superinvestors-graph-rank-row
              data-superinvestors-graph-rank-ticker={row.ticker}
            >
              <span className="sup-mono sup-ticker-strong">{row.ticker}</span>
              <span className="tabular-nums"><b>{formatInteger(row.holders_count)}명</b></span>
            </Row>
          ))}
          <EvidenceRail
            freshness={graphFreshness}
            source="SEC EDGAR 13F"
            asOf={asOfLabel}
            coverage={graphCoverage}
            onEvidence={dataReady && !failed ? openGraphEvidence : undefined}
          />
        </div>
      ) : null}
      </TabPanel>

      <div className="sup-cta">
        <span className="sup-cta-note">13F 공시 기반 장기 보유 포지션만 집계합니다. 공시는 최대 45일 늦게 반영됩니다.</span>
        <span className="sup-cta-note sup-mute">투자 조언 아님 · 데이터 지연 가능</span>
      </div>
    </div>
  );
}
