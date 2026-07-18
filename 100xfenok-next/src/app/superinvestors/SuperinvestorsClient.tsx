"use client";

import { useMemo, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import TickerChip from "@/components/TickerChip";
import TransitionLink from "@/components/TransitionLink";
import Tabs, { TabPanel, type TabItem, useTabsBaseId } from "@/components/ui/Tabs";
import { use13FData, useInvestorDetail } from "@/hooks/use13FData";
import { ROUTES } from "@/lib/routes";
import { normalizeForEntityKey } from "@/lib/ticker";
import { CANONICAL_SECTORS, resolveSector, sectorColor, sectorLabelKo } from "@/lib/design/sectorMap";
import type { CanonicalSector } from "@/lib/design/sectorMap";
import {
  CpVerdictHero,
  CpDivergingBar,
  CpSectionCard,
  CpMeterRow,
  CpMetricTile,
  CpMetricTileGrid,
  CpInsightCard,
  CpAccordion,
  CpEmptyState,
} from "@/components/canvas-plus/kit";
import {
  formatCurrencyCompact,
  formatCompactNumber,
  formatInteger,
  formatPercent,
} from "@/lib/format";
import GuruTrendBlock from "./GuruTrendBlock";
import InsightsTab from "./InsightsTab";
import type {
  SuperInvestorsTab,
  ConsensusTicker,
  EnhancedConsensusTicker,
  SummaryInvestor,
  InvestorHolding,
  InvestorFiling,
  SectorHoldingsEntry,
  TradesRankingData,
  TradesRankingRow,
  TurnoverData,
  PortfolioViewsData,
} from "@/lib/superinvestors/types";

const PAGE_SIZE = 50;
const SUPERINVESTOR_TABS_ID = "superinvestors-main-tabs";
const SUPERINVESTOR_TAB_ITEMS = {
  consensus: { id: "consensus", label: "공통 보유" },
  gurus: { id: "gurus", label: "투자자 목록" },
  "by-ticker": { id: "by-ticker", label: "종목별 보유" },
  trades: { id: "trades", label: "매매 동향" },
  insights: { id: "insights", label: "인사이트" },
} satisfies Record<SuperInvestorsTab, TabItem<SuperInvestorsTab>>;
// Reordered by decision value (brief-superinvestors.md D/H): 매매 동향 leads, methodology-flavored
// tiles no longer gate the page. Default active tab stays "consensus" (unchanged in function).
const SUPERINVESTOR_TABS: Array<TabItem<SuperInvestorsTab>> = [
  SUPERINVESTOR_TAB_ITEMS.trades,
  SUPERINVESTOR_TAB_ITEMS.consensus,
  SUPERINVESTOR_TAB_ITEMS["by-ticker"],
  SUPERINVESTOR_TAB_ITEMS.gurus,
  SUPERINVESTOR_TAB_ITEMS.insights,
];

const ChartLoading = () => (
  <div className="grid h-[220px] place-items-center rounded-xl border border-dashed border-[var(--c-line)] bg-[var(--c-surface-2)] text-xs font-bold text-[var(--c-ink-4)]">
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

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const CANONICAL_SECTOR_SET = new Set<string>(CANONICAL_SECTORS);

function normalizeSuperSector(gicsRaw?: string | null, scouterRaw?: string | null): CanonicalSector {
  const gics = gicsRaw?.trim();
  if (gics && CANONICAL_SECTOR_SET.has(gics)) return gics as CanonicalSector;
  const scouter = scouterRaw?.trim();
  if (scouter && CANONICAL_SECTOR_SET.has(scouter)) return scouter as CanonicalSector;
  return resolveSector(gicsRaw, scouterRaw);
}

// Module-level turnover cache — fetched lazily once per page
let turnoverCache: TurnoverData["by_investor"] | null = null;
let turnoverPromise: Promise<TurnoverData["by_investor"] | null> | null = null;

function loadTurnover(): Promise<TurnoverData["by_investor"] | null> {
  if (turnoverCache) return Promise.resolve(turnoverCache);
  if (turnoverPromise) return turnoverPromise;
  turnoverPromise = fetch("/data/sec-13f/analytics/turnover.json")
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<TurnoverData>;
    })
    .then((data) => {
      turnoverCache = data.by_investor ?? {};
      return turnoverCache;
    })
    .catch(() => {
      turnoverPromise = null;
      return null;
    });
  return turnoverPromise;
}

let pvCache: PortfolioViewsData | null = null;
let pvPromise: Promise<PortfolioViewsData | null> | null = null;

function normalizePortfolioViews(data: unknown): PortfolioViewsData | null {
  const raw = data as Partial<PortfolioViewsData> | null;
  if (!raw?.metadata) return null;
  const investors: PortfolioViewsData["investors"] = {};
  for (const [id, view] of Object.entries(raw.investors ?? {})) {
    investors[id] = {
      name: view.name ?? id,
      quarter: view.quarter ?? raw.metadata.quarter ?? "—",
      quarters: Array.isArray(view.quarters) ? view.quarters : [],
      sector_history: view.sector_history ?? {},
      treemap: Array.isArray(view.treemap) ? view.treemap : [],
      performance: view.performance ?? null,
    };
  }
  return {
    metadata: {
      ...raw.metadata,
      quarter: raw.metadata.quarter ?? "—",
      cohort_count: raw.metadata.cohort_count ?? Object.keys(investors).length,
    },
    total: {
      treemap: Array.isArray(raw.total?.treemap) ? raw.total.treemap : [],
      sectors: raw.total?.sectors ?? {},
      sector_history:
        raw.total?.sector_history &&
        Array.isArray(raw.total.sector_history.quarters) &&
        raw.total.sector_history.series &&
        typeof raw.total.sector_history.series === "object" &&
        !Array.isArray(raw.total.sector_history.series)
          ? raw.total.sector_history
          : undefined,
    },
    investors,
  };
}

function loadPortfolioViews(): Promise<PortfolioViewsData | null> {
  if (pvCache) return Promise.resolve(pvCache);
  if (pvPromise) return pvPromise;
  pvPromise = fetch("/data/sec-13f/analytics/portfolio_views.json")
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      pvCache = normalizePortfolioViews(data);
      return pvCache;
    })
    .catch(() => {
      pvPromise = null;
      return null;
    });
  return pvPromise;
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

function uniqueHolders(holdersList: string[]): string[] {
  const seen = new Set<string>();
  return holdersList.filter((h) => {
    if (seen.has(h)) return false;
    seen.add(h);
    return true;
  });
}

function groupBadgeClass(group: string): string {
  if (group === "value") return "bg-emerald-100 text-emerald-700";
  if (group === "hedge") return "bg-violet-100 text-violet-700";
  if (group === "activist") return "bg-amber-100 text-amber-700";
  if (group === "growth") return "bg-sky-100 text-sky-700";
  return "bg-slate-100 text-slate-600";
}

function sortConsensus(rows: ConsensusTicker[], dir: "asc" | "desc") {
  const d = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (a.holders_count !== b.holders_count) return (a.holders_count - b.holders_count) * d;
    return a.ticker.localeCompare(b.ticker) * d;
  });
}

function isSectorEntry(value: unknown): value is SectorHoldingsEntry {
  return !!value && typeof value === "object" && Array.isArray((value as SectorHoldingsEntry).top_holdings);
}

function classSummary(entry: EnhancedConsensusTicker | undefined): string {
  if (!entry) return "—";
  const extra = Math.max(0, entry.total_holders - entry.equity_holders);
  if (extra > 0) return `${entry.equity_holders}/${entry.total_holders}`;
  return `${entry.equity_holders}`;
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

function EmptyState({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-[1.2rem] border border-dashed border-[var(--c-line)] bg-[var(--c-surface-2)] px-6 py-10 text-center">
      <p className="text-sm font-black text-slate-700">{title}</p>
      <p className="mt-1 text-xs font-semibold text-slate-500">{desc}</p>
    </div>
  );
}

function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className="border-b border-slate-100 last:border-b-0">
          <td className="px-3 py-3"><div className="h-4 w-8 rounded bg-slate-200" /></td>
          <td className="px-3 py-3"><div className="h-4 w-20 rounded bg-slate-200" /></td>
          <td className="px-3 py-3"><div className="h-4 w-12 rounded bg-slate-200" /></td>
          <td className="px-3 py-3"><div className="h-4 w-16 rounded bg-slate-200" /></td>
          <td className="px-3 py-3"><div className="h-4 w-40 rounded bg-slate-200" /></td>
          <td className="px-3 py-3"><div className="h-4 w-16 rounded bg-slate-200" /></td>
        </tr>
      ))}
    </>
  );
}

function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-[1.2rem] border border-slate-200 bg-white p-4">
          <div className="h-5 w-1/2 rounded bg-slate-200" />
          <div className="mt-2 h-3 w-1/3 rounded bg-slate-200" />
          <div className="mt-4 h-3 w-2/3 rounded bg-slate-200" />
        </div>
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
    return <EmptyState title="보유 종목이 없습니다" desc="최신 분기에 유효한 티커 보유가 없습니다." />;
  }

  return (
    <div
      data-superinvestor-guru-top-holdings
      className="scroll-hint-x -mx-1 px-1"
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
              data-superinvestor-guru-holding-row
              data-superinvestor-guru-holding-ticker={h.ticker ?? ""}
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
                <span className="orbitron tabular-nums font-bold text-slate-900">{formatPercent(h.weight, { digits: 2 })}</span>
              </td>
              <td className="px-2 py-2 text-right">
                <span className="orbitron tabular-nums text-slate-700">{formatCompactNumber(h.shares)}</span>
              </td>
              <td className="px-2 py-2 text-right">
                <span className="orbitron tabular-nums text-slate-700">{formatCurrencyCompact(h.market_value, "USD")}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GuruDetailPanel({
  id,
  summary,
  pvData,
}: {
  id: string;
  summary: SummaryInvestor;
  pvData: PortfolioViewsData | null;
}) {
  const { data, loading } = useInvestorDetail(id);
  const [turnover, setTurnover] = useState<number | null | undefined>(undefined);

  const latest: InvestorFiling | null = data?.investor?.filings?.[data.investor.filings.length - 1] ?? null;
  const prev: InvestorFiling | null =
    data?.investor?.filings?.[data.investor.filings.length - 2] ?? null;
  const investorView = pvData?.investors?.[id] ?? null;
  const treemapRows = Array.isArray(investorView?.treemap) ? investorView.treemap : [];
  const sectorHistory = investorView?.sector_history ?? {};
  const sectorQuarters = Array.isArray(investorView?.quarters) ? investorView.quarters : [];
  const hasSectorHistory = sectorQuarters.length > 0 && Object.keys(sectorHistory).length > 0;
  const hasPortfolioView = !!investorView && (treemapRows.length > 0 || hasSectorHistory || !!investorView.performance);
  const latestQuarter = latest?.quarter ?? summary.quarter ?? "—";
  const reportDate = latest?.report_date ?? "—";
  const filingDate = latest?.filing_date ?? "—";

  useEffect(() => {
    let cancelled = false;
    loadTurnover().then((map) => {
      if (cancelled) return;
      const entry = map?.[id];
      setTurnover(entry?.turnover ?? null);
    });
    return () => { cancelled = true; };
  }, [id]);

  return (
    <div
      id={`superinvestor-guru-profile-${id}`}
      data-superinvestor-guru-profile
      data-superinvestor-guru-id={id}
      data-superinvestor-guru-quarter={latestQuarter}
      data-superinvestor-guru-report-date={reportDate}
      data-superinvestor-guru-filing-date={filingDate}
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
            SEC 13F 데이터 변환
          </p>
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

      {/* Row 2 — 분기 매매 내역 */}
      {latest?.changes_summary ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-emerald-700">신규매수 ↑</p>
            <p className="orbitron mt-1 text-sm font-black text-emerald-800">
              {latest.changes_summary.new?.length ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-rose-700">청산매도 ↓</p>
            <p className="orbitron mt-1 text-sm font-black text-rose-800">
              {latest.changes_summary.sold?.length ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-sky-700">비중확대 ↑</p>
            <p className="orbitron mt-1 text-sm font-black text-sky-800">
              {latest.changes_summary.increased?.length ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-amber-700">비중축소 ↓</p>
            <p className="orbitron mt-1 text-sm font-black text-amber-800">
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

      {/* Portfolio charts (from portfolio_views.json) */}
      {hasPortfolioView ? (
        <div
          data-superinvestor-guru-portfolio
          data-superinvestor-guru-portfolio-quarter={investorView?.quarter ?? ""}
          className="mt-4 border-t border-slate-200 pt-4"
        >
          <p className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">보유 포트폴리오</p>
          <div className="mt-2 space-y-4">
            {treemapRows.length > 0 ? (
              <div data-superinvestor-guru-treemap data-superinvestor-guru-treemap-count={treemapRows.length}>
                <PortfolioTreemap
                  rows={treemapRows}
                  quarterLabel={investorView.quarter}
                />
              </div>
            ) : null}
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
            {investorView.performance ? (
              <PerformanceChart
                performance={investorView.performance}
                investorName={investorView.name}
              />
            ) : null}
            <GuruTrendBlock investorId={id} />
          </div>
        </div>
      ) : null}

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
      ) : (
        <div className="mt-4">
          <EmptyState title="상세 데이터를 불러오지 못했습니다" desc="잠시 후 다시 시도하거나 다른 투자자를 선택해 주세요." />
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
        <p className="mt-1 truncate text-lg font-black tracking-tight text-slate-950 orbitron tabular-nums sm:text-xl">
          {value}
        </p>
      )}
    </div>
  );
}

type AmountColor = "emerald" | "rose";

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
        <EmptyState title="데이터가 없습니다" desc="해당 분기 매매 데이터가 존재하지 않습니다." />
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
        data-superinvestor-trades-region
        data-superinvestor-trades-side={side}
        className="cpw5-super-trades-region scroll-hint-x mt-3 -mx-1 px-1"
        role="region"
        tabIndex={0}
        aria-label={`${title} 표`}
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
                  data-superinvestor-trades-row
                  data-superinvestor-trades-side={side}
                  data-superinvestor-trades-ticker={r.ticker}
                  className="border-b border-slate-100 last:border-b-0"
                >
                  <td className="min-w-0 px-1 py-2 sm:px-2">
                    <span className="orbitron tabular-nums text-xs font-bold text-[var(--c-ink-3)]">{r.rank}</span>
                  </td>
                  <td className="min-w-0 px-1 py-2 sm:px-2">
                    <TransitionLink
                      href={ROUTES.stock(r.ticker)}
                      data-superinvestor-trades-action
                      data-superinvestor-trades-stock-link
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
                    <span className={`orbitron tabular-nums font-bold ${amountTextClass}`}>
                      {formatTradeShare(r.amount, totalAmount)}
                    </span>
                  </td>
                  <td className="min-w-0 px-1 py-2 text-right sm:px-2">
                    <span className="orbitron tabular-nums font-bold text-slate-900">{r.investors_count}</span>
                    {actionLabel(r) ? (
                      <span className="block truncate text-[10px] font-semibold text-[var(--c-ink-3)]">{actionLabel(r)}</span>
                    ) : null}
                  </td>
                  <td className="min-w-0 px-1 py-2 sm:px-2">
                    {r.top_investor?.id ? (
                      <TransitionLink
                        href={ROUTES.superinvestorsGuru(r.top_investor.id)}
                        data-superinvestor-trades-action
                        data-superinvestor-trades-investor-link
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

export default function SuperinvestorsClient({
  initialTab,
  initialSearch = "",
  initialGuru = null,
}: {
  initialTab?: SuperInvestorsTab;
  initialSearch?: string;
  initialGuru?: string | null;
}) {
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
  } = use13FData();
  const [tab, setTab] = useState<SuperInvestorsTab>(initialTab ?? "consensus");
  const tabsId = useTabsBaseId(SUPERINVESTOR_TABS_ID);
  const [search, setSearch] = useState(initialSearch);
  const [group, setGroup] = useState("");
  const [expandedGuru, setExpandedGuru] = useState<string | null>(initialGuru);
  const [tradesData, setTradesData] = useState<TradesRankingData | null>(null);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [tradesFailed, setTradesFailed] = useState(false);
  const [tradesBoughtExpanded, setTradesBoughtExpanded] = useState(false);
  const [tradesSoldExpanded, setTradesSoldExpanded] = useState(false);
  const [pvData, setPvData] = useState<PortfolioViewsData | null>(null);
  const [pvFailed, setPvFailed] = useState(false);
  const [totalPortfolioOpen, setTotalPortfolioOpen] = useState(false);

  useEffect(() => {
    setTab(initialTab ?? "consensus");
    setSearch(initialSearch);
    setExpandedGuru(initialGuru);
  }, [initialTab, initialSearch, initialGuru]);

  // Open the total-portfolio treemap by default on desktop only (mobile stays collapsed).
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      setTotalPortfolioOpen(true);
    }
  }, []);
  const [consensusSortDir, setConsensusSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  const consensusRows = useMemo<ConsensusTicker[]>(() => {
    if (!consensus) return [];
    const query = search.trim().toLowerCase();
    const rows = Object.values(consensus.consensus).filter((row) => {
      if (!query) return true;
      return row.ticker.toLowerCase().includes(query);
    });
    return sortConsensus(rows, consensusSortDir);
  }, [consensus, search, consensusSortDir]);

  const guruEntries = useMemo<[string, SummaryInvestor][]>(() => {
    if (!summary) return [];
    const rows = Object.entries(summary.investors);
    const filtered = group ? rows.filter(([, inv]) => inv.group === group) : rows;
    if (!expandedGuru) return filtered;
    return [...filtered].sort(([a], [b]) => {
      if (a === expandedGuru) return -1;
      if (b === expandedGuru) return 1;
      return 0;
    });
  }, [summary, group, expandedGuru]);
  const selectedGuruEntry =
    expandedGuru && summary?.investors[expandedGuru]
      ? ([expandedGuru, summary.investors[expandedGuru]] as const)
      : null;

  const groups = useMemo(() => {
    if (!summary) return [];
    return Array.from(new Set(Object.values(summary.investors).map((i) => i.group))).sort();
  }, [summary]);

  const byTickerEntry = useMemo(() => {
    if (!byTicker || !search.trim()) return null;
    const key = normalizeForEntityKey(search);
    return byTicker[key] ?? null;
  }, [byTicker, search]);

  const byTickerEnhanced = useMemo(() => {
    if (!enhancedConsensus || !search.trim()) return null;
    const key = normalizeForEntityKey(search);
    return enhancedConsensus.enhanced_consensus?.[key] ?? null;
  }, [enhancedConsensus, search]);

  const selectedTicker = normalizeForEntityKey(search);
  const byTickerHolderRows = useMemo(() => {
    if (!byTickerEntry) return [];
    return [...byTickerEntry.holder_details].sort((a, b) => (b.weight || 0) - (a.weight || 0));
  }, [byTickerEntry]);

  const sectorRows = useMemo(() => {
    if (!bySector) return [];
    return Object.entries(bySector)
      .filter(([sector, entry]) => sector !== "_meta" && isSectorEntry(entry))
      .map(([sector, entry]) => ({ sector, ...(entry as SectorHoldingsEntry) }))
      .sort((a, b) => b.avg_weight - a.avg_weight)
      .slice(0, 8);
  }, [bySector]);

  const sectorBreakdownCount = useMemo(() => {
    if (!bySector) return 0;
    return Object.entries(bySector).filter(([sector, entry]) => sector !== "_meta" && isSectorEntry(entry)).length;
  }, [bySector]);

  const pageCount = Math.max(1, Math.ceil(consensusRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = consensusRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const stateKey = `${tab}|${search}|${group}|${consensusSortDir}`;
  const [prevStateKey, setPrevStateKey] = useState(stateKey);
  if (prevStateKey !== stateKey) {
    setPrevStateKey(stateKey);
    if (page !== 0) setPage(0);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setTradesLoading(true);
      setTradesFailed(false);
      try {
        const res = await fetch("/data/sec-13f/analytics/trades_ranking.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = normalizeTradesRanking(await res.json());
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

  useEffect(() => {
    let cancelled = false;
    loadPortfolioViews().then((data) => {
      if (cancelled) return;
      if (data) setPvData(data);
      else setPvFailed(true);
    });
    return () => { cancelled = true; };
  }, []);

  const delayLabel = "기관 공시는 분기 종료 후 최대 45일 지연됩니다";
  const generatedAtLabel = fmtDateTimeKo(summary?.metadata?.generated_at);
  const investorCount =
    consensus?.metadata?.current_cohort_investors ??
    summary?.metadata?.investor_count ??
    summary?.metadata?.total_investors ??
    null;
  const tickerCount =
    consensus?.metadata?.tickers_count ??
    summary?.metadata?.total_tickers ??
    (byTicker ? Object.keys(byTicker).length : null);
  const topSector = sectorRows[0] ?? null;
  const topSectorLabel = topSector ? sectorLabelKo(normalizeSuperSector(topSector.sector, topSector.sector)) : "—";
  const topSectorHoldings = topSector?.top_holdings?.slice(0, 3).join(", ") || "—";
  const convictionNewCount = convictionEntries?.metadata?.high_conviction_new_count ?? null;
  const convictionHoldCount = convictionEntries?.metadata?.top_conviction_hold_count ?? null;
  const topBoughtTrade = tradesData?.bought[0] ?? null;
  const topSoldTrade = tradesData?.sold[0] ?? null;
  const tradesBoughtAmount = tradesData?.bought.reduce((sum, row) => sum + (row.amount || 0), 0) ?? 0;
  const tradesSoldAmount = tradesData?.sold.reduce((sum, row) => sum + (row.amount || 0), 0) ?? 0;
  const tradesGeneratedAtLabel = fmtDateTimeKo(tradesData?.metadata.generated_at);
  const tradeTotalAmount = tradesBoughtAmount + tradesSoldAmount;
  const boughtSegmentPct = tradeTotalAmount > 0 ? (tradesBoughtAmount / tradeTotalAmount) * 100 : 50;
  const soldSegmentPct = tradeTotalAmount > 0 ? (tradesSoldAmount / tradeTotalAmount) * 100 : 50;
  const netFlowPct = tradeTotalAmount > 0 ? ((tradesBoughtAmount - tradesSoldAmount) / tradeTotalAmount) * 100 : 0;
  const topBoughtShare = formatTradeShare(topBoughtTrade?.amount, tradesBoughtAmount);
  const topSoldShare = formatTradeShare(topSoldTrade?.amount, tradesSoldAmount);

  // ---- CANVAS+ hero + Tier 2 (brief-superinvestors.md D/G/H) --------------
  const heroReady = dataReady && !tradesFailed && !!tradesData && !!topBoughtTrade && !!topSoldTrade;
  const heroInvestorCount = investorCount ?? tradesData?.metadata.investors_included.length ?? null;
  const heroVerdict = heroReady ? (
    <>
      이번 분기 거장 {formatInteger(heroInvestorCount)}명 중 <b className="up">{topBoughtTrade!.investors_count}명</b>이{" "}
      <b>{topBoughtTrade!.ticker}</b>을 순매수(<b className="up">매수 상위권 {topBoughtShare}</b>), 최대 매도는{" "}
      <b className="down">{topSoldTrade!.ticker}</b>(<b className="down">매도 상위권 {topSoldShare}</b>) —
      자금은 <b>{topSectorLabel}</b> 섹터로 쏠렸다.
    </>
  ) : failed || tradesFailed ? (
    "13F 매매 데이터를 불러오지 못했습니다."
  ) : (
    "13F 매매 데이터를 불러오는 중입니다…"
  );

  const sectorRotationRows = useMemo(() => {
    const hist = pvData?.total?.sector_history;
    return buildSectorRotationRows(hist);
  }, [pvData]);

  const highConvictionNewRows = convictionEntries?.high_conviction_new?.slice(0, 3) ?? [];
  const topConvictionHoldRows = convictionEntries?.top_conviction_hold?.slice(0, 3) ?? [];

  return (
    <div className="data-shell-page">
      <section className="panel data-shell-header">
        <div className="data-shell-head-main">
          <p className="data-shell-kicker">기관 공시 분석</p>
          <h1 className="data-shell-title">거장 보유 현황</h1>
          <p className="data-shell-desc">
            분기 공시로 공개되는 주요 투자자의 보유·매매·집중도를 함께 탐색합니다.
          </p>
        </div>
        <div className="data-shell-head-actions">
          <span className="data-shell-note">{delayLabel}</span>
          {excludedStale.length > 0 ? (
            <span className="data-shell-note warn">
              최신 분기에서 제외: {excludedStale.join(", ")}
            </span>
          ) : null}
        </div>
      </section>

      {failed ? (
        <div className="rounded-[1.2rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          기관 공시 데이터를 불러오지 못했습니다.
        </div>
      ) : null}

      {/* Hero — verdict-first (cp-design-system-spec.md §A.1). Buy/sell balance is the
          route's single dominant visual; methodology detail moves to the bottom accordion. */}
      <CpVerdictHero
        eyebrow="13F · 이번 분기 자금 흐름"
        verdict={heroVerdict}
        sub={delayLabel}
        trustChips={[
          { id: "quarter", label: "기준 분기", value: quarter ?? "—", freshness: true, tone: "positive" },
          { id: "generated", label: "데이터 변환", value: generatedAtLabel ?? "확인 중" },
        ]}
      />

      {tradeTotalAmount > 0 ? (
        <CpDivergingBar
          data-superinvestor-hero-meter
          segments={[
            { id: "bought", label: `매수 ${formatPercent(boughtSegmentPct, { digits: 1, fraction: false })}`, percent: boughtSegmentPct, tone: "positive" },
            { id: "sold", label: `매도 ${formatPercent(soldSegmentPct, { digits: 1, fraction: false })}`, percent: soldSegmentPct, tone: "negative" },
          ]}
          net={{
            label: "매수/매도 균형",
            value: `${netFlowPct >= 0 ? "매수" : "매도"} 우위 ${formatPercent(Math.abs(netFlowPct), { digits: 1, fraction: false })}`,
            direction: netFlowPct >= 0 ? "up" : "down",
            sub: tradesData ? `${tradesData.metadata.quarter} · 상위 ${tradesData.metadata.top_n}개 랭킹 내부 상대 비중` : undefined,
          }}
        />
      ) : null}

      {/* Tier 2 — sector rotation band + compressed metric tiles + promoted insight cards. */}
      <section className="cpw5-super-tier2">
        <div className="cpw5-super-tier2__tiles">
          <CpMetricTileGrid>
            <CpMetricTile label="코호트" value={formatInteger(investorCount)} unit="명" sub="추적 중인 거장 투자자" />
            <CpMetricTile label="추적 종목" value={formatInteger(tickerCount)} unit="개" sub="13F 보유 유니버스" />
            <CpMetricTile label="신규 고비중" value={formatInteger(convictionNewCount)} unit="건" sub="이번 분기 신규 진입" />
          </CpMetricTileGrid>
        </div>

        <div className="cpw5-super-tier2__band">
          <CpSectionCard
            title="섹터 로테이션"
            meta={pvData ? `${pvData.metadata.quarter} · 전분기 대비` : undefined}
            footnote="가중치는 거장 코호트 합산 보유 시가총액 기준, 델타는 직전 분기 대비 %p입니다."
          >
            {sectorRotationRows.length > 0 ? (
              sectorRotationRows.map((row) => {
                const canonicalSector = row.sector;
                const tone = row.deltaPp > 0.05 ? "positive" : row.deltaPp < -0.05 ? "negative" : "neutral";
                return (
                  <CpMeterRow
                    key={row.sector}
                    variant="axis"
                    label={sectorLabelKo(canonicalSector)}
                    value={formatPercent(row.current, { digits: 1 })}
                    percent={row.current * 100}
                    tone={tone}
                    toneWord={`${row.deltaPp >= 0 ? "▲" : "▼"}${Math.abs(row.deltaPp).toFixed(1)}%p`}
                  />
                );
              })
            ) : (
              <CpEmptyState message={pvFailed ? "섹터 로테이션 데이터를 불러오지 못했습니다." : "섹터 로테이션 데이터를 불러오는 중입니다…"} />
            )}
          </CpSectionCard>
        </div>

        <div className="cpw5-super-tier2__insights">
          <div>
            <CpInsightCard
              badgeLabel="신규 고비중"
              badgeTone="positive"
              dateLabel={quarter ?? "—"}
              headline={`이번 분기 고비중 신규 진입 ${formatInteger(convictionNewCount)}건`}
              bullets={highConvictionNewRows.map((r) => ({
                id: `${r.investor}-${r.ticker}`,
                tone: "fact",
                tagLabel: r.ticker,
                text: `${r.investor} · 비중 ${formatPercent(r.weight, { digits: 2 })}`,
              }))}
            />
            <button
              type="button"
              onClick={() => setTab("insights")}
              className="mt-2 inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-600 transition hover:border-brand-interactive hover:text-brand-interactive sm:min-h-8"
            >
              인사이트 탭에서 더 보기
            </button>
          </div>
          <div>
            <CpInsightCard
              badgeLabel="상위 확신 유지"
              badgeTone="neutral"
              dateLabel={quarter ?? "—"}
              headline={`상위 확신 보유 유지 ${formatInteger(convictionHoldCount)}건`}
              bullets={topConvictionHoldRows.map((r) => ({
                id: `${r.investor}-${r.ticker}`,
                tone: "note",
                tagLabel: r.ticker,
                text: `${r.investor} · 비중 ${formatPercent(r.weight, { digits: 2 })}`,
              }))}
            />
            <button
              type="button"
              onClick={() => setTab("insights")}
              className="mt-2 inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-600 transition hover:border-brand-interactive hover:text-brand-interactive sm:min-h-8"
            >
              인사이트 탭에서 더 보기
            </button>
          </div>
        </div>
      </section>

      {dataReady && selectedGuruEntry ? (
        <section
          data-superinvestor-guru-landing
          data-superinvestor-guru-id={selectedGuruEntry[0]}
          className="rounded-[1.5rem] border border-brand-interactive/30 bg-gradient-to-br from-white via-slate-50 to-emerald-50 p-4 shadow-[var(--sh-sm)]"
          aria-label={`${selectedGuruEntry[1].name} 투자자 프로필 바로가기`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-brand-interactive">선택 투자자</p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">
                {selectedGuruEntry[1].name}
              </h2>
              <p className="mt-1 text-xs font-semibold text-[var(--c-ink-3)]">
                {selectedGuruEntry[1].group} · {formatCurrencyCompact(selectedGuruEntry[1].aum, "USD")} · {selectedGuruEntry[1].holdings_count}종목
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-superinvestor-guru-landing-asof
                className="inline-flex min-h-11 items-center rounded-full border border-amber-200 bg-amber-50 px-3 text-[10px] font-black text-amber-700"
              >
                {selectedGuruEntry[1].latest_quarter || quarter || "—"}
              </span>
              <span
                data-superinvestor-guru-landing-lag
                className="inline-flex min-h-11 items-center rounded-full border border-sky-200 bg-sky-50 px-3 text-[10px] font-black text-sky-700"
              >
                13F 최대 45일 지연
              </span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a
              href={`#superinvestor-guru-profile-${selectedGuruEntry[0]}`}
              data-superinvestor-guru-action
              className="inline-flex min-h-11 items-center rounded-full bg-slate-950 px-4 text-[11px] font-black uppercase tracking-[0.1em] text-white transition hover:bg-brand-interactive"
            >
              프로필 보기
            </a>
            <TransitionLink
              href={`${ROUTES.screener}?preset=guru`}
              data-superinvestor-guru-action
              data-superinvestor-guru-screener-link
              className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-wide text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
            >
              스크리너 guru 보기
            </TransitionLink>
            {[...new Set(selectedGuruEntry[1].top5)].slice(0, 5).map((ticker, i) => (
              <TransitionLink
                key={`${ticker}-${i}`}
                href={ROUTES.stock(ticker)}
                data-superinvestor-guru-action
                data-superinvestor-guru-landing-stock-link
                className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-wide text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
              >
                {ticker}
              </TransitionLink>
            ))}
          </div>
        </section>
      ) : null}

      {dataReady && tab === "by-ticker" && selectedTicker && byTickerEntry && byTickerHolderRows.length > 0 ? (
        <section
          data-superinvestor-ticker-landing
          data-superinvestor-ticker-symbol={selectedTicker}
          data-superinvestor-ticker-quarter={quarter ?? ""}
          className="rounded-[1.5rem] border border-brand-interactive/30 bg-gradient-to-br from-white via-slate-50 to-sky-50 p-4 shadow-[var(--sh-sm)]"
          aria-label={`${selectedTicker} 13F 보유 투자자 요약`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-brand-interactive">선택 종목</p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">
                {selectedTicker}
              </h2>
              <p className="mt-1 text-xs font-semibold text-[var(--c-ink-3)]">
                {byTickerEntry.holder_details.length}명 보유 · 총 {formatCompactNumber(byTickerEntry.total_shares)}주
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-superinvestor-ticker-landing-asof
                className="inline-flex min-h-11 items-center rounded-full border border-amber-200 bg-amber-50 px-3 text-[10px] font-black text-amber-700"
              >
                {quarter ?? "—"}
              </span>
              <span
                data-superinvestor-ticker-landing-lag
                className="inline-flex min-h-11 items-center rounded-full border border-sky-200 bg-sky-50 px-3 text-[10px] font-black text-sky-700"
              >
                13F 최대 45일 지연
              </span>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div data-superinvestor-ticker-kpi="holders" className="rounded-xl border border-slate-100 bg-white px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">보유 투자자</p>
              <p className="mt-1 orbitron text-sm font-black text-slate-950">{byTickerEntry.holder_details.length}명</p>
            </div>
            <div data-superinvestor-ticker-kpi="equity" className="rounded-xl border border-slate-100 bg-white px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">주식 기준</p>
              <p className="mt-1 orbitron text-sm font-black text-slate-950">
                {byTickerEnhanced ? `${byTickerEnhanced.equity_holders}/${byTickerEnhanced.total_holders}명` : "—"}
              </p>
            </div>
            <div data-superinvestor-ticker-kpi="score" className="rounded-xl border border-slate-100 bg-white px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">확신 점수</p>
              <p className="mt-1 orbitron text-sm font-black text-slate-950">
                {byTickerEnhanced ? formatPercent(byTickerEnhanced.equity_score, { digits: 0 }) : "—"}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <TransitionLink
              href={ROUTES.stock(selectedTicker)}
              data-superinvestor-ticker-action
              data-superinvestor-ticker-stock-link
              className="inline-flex min-h-11 items-center rounded-full bg-slate-950 px-4 text-[11px] font-black uppercase tracking-[0.1em] text-white transition hover:bg-brand-interactive"
            >
              종목 상세
            </TransitionLink>
            <TransitionLink
              href={ROUTES.screenerTicker(selectedTicker)}
              data-superinvestor-ticker-action
              data-superinvestor-ticker-screener-link
              className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-wide text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
            >
              스크리너
            </TransitionLink>
            {byTickerHolderRows.slice(0, 5).map((holder) => (
              <TransitionLink
                key={holder.investor}
                href={ROUTES.superinvestorsGuru(holder.investor)}
                data-superinvestor-ticker-action
                data-superinvestor-ticker-investor-link
                className="inline-flex min-h-11 max-w-full items-center rounded-full border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-wide text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
              >
                <span className="max-w-[150px] truncate">{holder.investor}</span>
              </TransitionLink>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "trades" && tradesData && (topBoughtTrade || topSoldTrade) ? (
        <section
          data-superinvestor-trades-landing
          data-superinvestor-trades-quarter={tradesData.metadata.quarter}
          className="rounded-[1.5rem] border border-brand-interactive/30 bg-gradient-to-br from-white via-slate-50 to-emerald-50 p-4 shadow-[var(--sh-sm)]"
          aria-label={`${tradesData.metadata.quarter} 13F 매매 순위 요약`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-brand-interactive">13F 매매 순위</p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">
                {tradesData.metadata.quarter}
              </h2>
              <p className="mt-1 text-xs font-semibold text-[var(--c-ink-3)]">
                {tradesData.metadata.investors_included.length}명 코호트 · 상위 {tradesData.metadata.top_n}개 매수/매도
                {tradesGeneratedAtLabel ? ` · 변환 ${tradesGeneratedAtLabel}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-superinvestor-trades-asof
                className="inline-flex min-h-11 items-center rounded-full border border-amber-200 bg-amber-50 px-3 text-[10px] font-black text-amber-700"
              >
                {tradesData.metadata.quarter}
              </span>
              <span
                data-superinvestor-trades-lag
                className="inline-flex min-h-11 items-center rounded-full border border-sky-200 bg-sky-50 px-3 text-[10px] font-black text-sky-700"
              >
                13F 최대 45일 지연
              </span>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div data-superinvestor-trades-kpi="bought" className="rounded-xl border border-emerald-100 bg-white px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-[0.08em] text-emerald-700">상위 매수 비중</p>
              <p className="mt-1 orbitron text-sm font-black text-slate-950">{formatPercent(boughtSegmentPct, { digits: 1, fraction: false })}</p>
            </div>
            <div data-superinvestor-trades-kpi="sold" className="rounded-xl border border-rose-100 bg-white px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-[0.08em] text-rose-700">상위 매도 비중</p>
              <p className="mt-1 orbitron text-sm font-black text-slate-950">{formatPercent(soldSegmentPct, { digits: 1, fraction: false })}</p>
            </div>
            <div data-superinvestor-trades-kpi="cohort" className="rounded-xl border border-slate-100 bg-white px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">분석 투자자</p>
              <p className="mt-1 orbitron text-sm font-black text-slate-950">{tradesData.metadata.investors_included.length}명</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {topBoughtTrade ? (
              <TransitionLink
                href={ROUTES.stock(topBoughtTrade.ticker)}
                data-superinvestor-trades-action
                data-superinvestor-trades-stock-link
                className="inline-flex min-h-11 items-center rounded-full bg-emerald-700 px-4 text-[11px] font-black uppercase tracking-[0.1em] text-white transition hover:bg-brand-interactive"
              >
                매수 1위 {topBoughtTrade.ticker}
              </TransitionLink>
            ) : null}
            {topSoldTrade ? (
              <TransitionLink
                href={ROUTES.stock(topSoldTrade.ticker)}
                data-superinvestor-trades-action
                data-superinvestor-trades-stock-link
                className="inline-flex min-h-11 items-center rounded-full bg-rose-700 px-4 text-[11px] font-black uppercase tracking-[0.1em] text-white transition hover:bg-brand-interactive"
              >
                매도 1위 {topSoldTrade.ticker}
              </TransitionLink>
            ) : null}
            {[topBoughtTrade, topSoldTrade].filter(Boolean).map((row) => (
              <TransitionLink
                key={`${row?.ticker}-${row?.top_investor?.id}`}
                href={ROUTES.superinvestorsGuru(row?.top_investor.id ?? "")}
                data-superinvestor-trades-action
                data-superinvestor-trades-investor-link
                className="inline-flex min-h-11 max-w-full items-center rounded-full border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-wide text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
              >
                <span className="max-w-[150px] truncate">{row?.top_investor.name}</span>
              </TransitionLink>
            ))}
          </div>
        </section>
      ) : null}

      {/* Tabs */}
      <Tabs
        idBase={tabsId}
        items={SUPERINVESTOR_TABS}
        value={tab}
        onValueChange={(next) => {
          setTab(next);
          setSearch("");
          setExpandedGuru(null);
        }}
        ariaLabel="거장 보유 현황 분류"
        className="flex flex-wrap items-center gap-2 border-b border-[var(--c-line)] pb-1"
        getTabClassName={(_, selected) => cx(
          "relative inline-flex min-h-9 items-center px-3 text-[11px] font-black uppercase tracking-[0.12em] transition",
          selected ? "text-[var(--c-brand)]" : "text-[var(--c-ink-3)] hover:text-[var(--c-ink)]",
        )}
        renderLabel={(item, selected) => (
          <>
            {item.label}
            {selected ? <span className="absolute bottom-[-5px] left-0 right-0 h-[2px] rounded-full bg-[var(--c-brand)]" /> : null}
          </>
        )}
      />

      {/* Consensus */}
      <TabPanel idBase={tabsId} item={SUPERINVESTOR_TAB_ITEMS.consensus} active={tab === "consensus"} className="space-y-3">
          {/* Total portfolio (collapsible) */}
          {pvData && !pvFailed ? (
            <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-3 shadow-[var(--sh-sm)] sm:p-4">
              <button
                type="button"
                onClick={() => setTotalPortfolioOpen((v) => !v)}
                aria-pressed={totalPortfolioOpen}
                className="flex w-full items-center justify-between text-left"
              >
                <div>
                  <h2 className="text-sm font-black tracking-tight text-slate-900">
                    거장 토탈 포트폴리오
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-emerald-700">
                      {pvData.metadata.quarter}
                    </span>
                    <span className="text-[10px] font-semibold text-[var(--c-ink-3)]">
                      {pvData.total.treemap.length}종목 · 30인 합산
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
                  {totalPortfolioOpen ? "접기" : "펼치기"}
                </span>
              </button>
              {totalPortfolioOpen ? (
                <div className="mt-3 space-y-4 border-t border-slate-100 pt-3">
                  {pvData.total.treemap.length > 0 ? (
                    <PortfolioTreemap rows={pvData.total.treemap} quarterLabel={pvData.metadata.quarter} />
                  ) : (
                    <EmptyState title="포트폴리오 차트 데이터가 없습니다" desc="차트 데이터가 아직 준비되지 않았습니다." />
                  )}
                  {pvData.metadata.disclaimer ? (
                    <p className="text-[10px] font-semibold text-[var(--c-ink-3)]">{pvData.metadata.disclaimer}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex min-w-[220px] flex-col gap-1">
              <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-700">티커 검색</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="예: AAPL"
                className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
              />
            </label>
            <button
              type="button"
              onClick={() => setConsensusSortDir((d) => (d === "desc" ? "asc" : "desc"))}
              className="inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
            >
              보유 투자자 수 {consensusSortDir === "desc" ? "내림차순" : "오름차순"}
            </button>
          </div>

          <div className={cx("rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-2 shadow-[var(--sh-sm)] sm:p-3", !dataReady && "opacity-60")}>
            <div className="scroll-hint-x -mx-1 px-1" role="region" tabIndex={0} aria-label="공통 보유 종목 표 가로 스크롤">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink)]">
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">티커</th>
                    <th className="px-3 py-2 text-right">보유자</th>
                    <th className="px-3 py-2 text-right">주식 기준</th>
                    <th className="px-3 py-2 text-left">보유자 목록</th>
                    <th className="px-3 py-2 text-right">보기</th>
                  </tr>
                </thead>
                <tbody>
                  {!dataReady ? (
                    <SkeletonRows count={6} />
                  ) : pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center">
                        <EmptyState title="결과가 없습니다" desc="검색어를 바꾸거나 필터를 초기화해 주세요." />
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((row, idx) => {
                      const rank = safePage * PAGE_SIZE + idx + 1;
                      const holders = uniqueHolders(row.holders_list);
                      const enhanced = enhancedConsensus?.enhanced_consensus?.[row.ticker];
                      return (
                        <tr key={row.ticker} className="border-b border-slate-100 last:border-b-0">
                          <td className="px-3 py-3">
                            <span className="orbitron tabular-nums text-xs font-bold text-[var(--c-ink-3)]">{rank}</span>
                          </td>
                          <td className="px-3 py-3">
                            <TickerChip ticker={row.ticker} variant="inline" />
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className="orbitron tabular-nums text-base font-black text-brand-interactive">
                              {holders.length}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">
                            {enhanced ? (
                              <div className="ml-auto max-w-[120px]">
                                <div className="flex items-center justify-end gap-2">
                                  <span className="orbitron tabular-nums text-xs font-black text-slate-900">
                                    {classSummary(enhanced)}
                                  </span>
                                  <span className="text-[10px] font-bold text-[var(--c-ink-3)]">
                                    {formatPercent(enhanced.equity_score, { digits: 0 })}
                                  </span>
                                </div>
                                <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                                  <div
                                    className="h-1.5 rounded-full bg-brand-interactive"
                                    style={{ width: `${Math.max(0, Math.min(1, enhanced.equity_score)) * 100}%` }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs font-bold text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-1">
                              {holders.slice(0, 8).map((h) => (
                                <span
                                  key={h}
                                  className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-700"
                                >
                                  {h}
                                </span>
                              ))}
                              {holders.length > 8 ? (
                                <span className="inline-flex items-center rounded-md bg-slate-50 px-1.5 py-0.5 text-[10px] font-black text-slate-500">
                                  +{holders.length - 8}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                setSearch(row.ticker);
                                setTab("by-ticker");
                              }}
                              className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-2.5 text-[10px] font-black uppercase tracking-[0.1em] text-slate-600 transition hover:border-brand-interactive hover:text-brand-interactive sm:min-h-7"
                            >
                              보유 보기
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {dataReady && pageCount > 1 ? (
              <div className="mt-3 flex items-center justify-between px-2">
                <button
                  type="button"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive disabled:opacity-40 sm:min-h-8"
                >
                  이전
                </button>
                <span className="text-xs font-bold text-slate-500">
                  <span className="orbitron tabular-nums text-slate-900">{safePage + 1}</span> / {pageCount}
                </span>
                <button
                  type="button"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive disabled:opacity-40 sm:min-h-8"
                >
                  다음
                </button>
              </div>
            ) : null}
          </div>
      </TabPanel>

      {/* Gurus */}
      <TabPanel idBase={tabsId} item={SUPERINVESTOR_TAB_ITEMS.gurus} active={tab === "gurus"} className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="flex min-w-[200px] flex-col gap-1">
              <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-700">스타일</span>
              <select
                value={group}
                onChange={(e) => {
                  setGroup(e.target.value);
                  setExpandedGuru(null);
                }}
                className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
              >
                <option value="">전체 스타일</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-sm font-bold text-slate-700">
              <strong className="orbitron text-slate-900">{guruEntries.length}</strong>명
            </span>
          </div>

          {!dataReady ? (
            <SkeletonCards count={6} />
          ) : guruEntries.length === 0 ? (
            <EmptyState title="투자자가 없습니다" desc="스타일 필터를 변경해 주세요." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {guruEntries.map(([id, inv]) => {
                const isOpen = expandedGuru === id;
                return (
                  <div
                    key={id}
                    data-superinvestor-guru-card
                    data-superinvestor-guru-id={id}
                    data-superinvestor-guru-expanded={isOpen ? "true" : "false"}
                    className={cx(
                      "rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)] transition",
                      // expanded detail (KPI + treemap + sector mix) needs the full row width
                      isOpen ? "border-brand-interactive sm:col-span-2 lg:col-span-3" : "border-slate-200",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span
                          className={cx(
                            "inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide",
                            groupBadgeClass(inv.group),
                          )}
                        >
                          {inv.group}
                        </span>
                        <h3 className="mt-1 text-lg font-black tracking-tight text-slate-950">{inv.name}</h3>
                        <p className="text-xs font-semibold text-slate-500">{id}</p>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                        <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">AUM</p>
                        <p className="orbitron tabular-nums mt-0.5 text-sm font-black text-slate-900">{formatCurrencyCompact(inv.aum, "USD")}</p>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                        <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">보유</p>
                        <p className="orbitron mt-0.5 text-sm font-black text-slate-900">{inv.holdings_count}종목</p>
                      </div>
                    </div>

                    {inv.top5.length > 0 ? (
                      <div className="mt-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">Top 5</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {[...new Set(inv.top5)].slice(0, 5).map((ticker, i) => (
                            <TransitionLink
                              key={`${ticker}-${i}`}
                              href={ROUTES.stock(ticker)}
                              data-superinvestor-guru-top5-link
                              className="inline-flex min-h-11 items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-700 transition hover:bg-slate-200 hover:text-brand-interactive"
                            >
                              {ticker}
                            </TransitionLink>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setExpandedGuru(isOpen ? null : id)}
                        aria-pressed={isOpen}
                        className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive sm:min-h-8"
                      >
                        {isOpen ? "접기" : "포트폴리오 보기"}
                      </button>
                      <TransitionLink
                        href={`${ROUTES.screener}?preset=guru`}
                        data-superinvestor-guru-screener-link
                        className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive sm:min-h-8"
                      >
                        스크리너 guru 보기
                      </TransitionLink>
                    </div>

                    {isOpen ? <GuruDetailPanel id={id} summary={inv} pvData={pvData} /> : null}
                  </div>
                );
              })}
            </div>
          )}
      </TabPanel>

      {/* By ticker */}
      <TabPanel idBase={tabsId} item={SUPERINVESTOR_TAB_ITEMS["by-ticker"]} active={tab === "by-ticker"} className="space-y-3">
        <label className="flex max-w-md flex-col gap-1">
          <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-700">티커 검색</span>
          <div className="flex gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="예: AAPL"
              className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
            />
            <button
              type="button"
              onClick={() => setSearch("")}
              className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-600 transition hover:border-rose-300 hover:text-rose-600"
            >
              초기화
            </button>
          </div>
        </label>

        <div
          data-superinvestor-ticker-panel
          data-superinvestor-ticker-symbol={selectedTicker}
          className={cx("rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-3 shadow-[var(--sh-sm)] sm:p-4", !dataReady && "opacity-60")}
        >
          {!dataReady ? (
            <div className="space-y-3">
              <div className="h-5 w-1/3 rounded bg-slate-200" />
              <div className="h-4 w-1/2 rounded bg-slate-200" />
              <div className="h-4 w-2/3 rounded bg-slate-200" />
            </div>
          ) : !search.trim() ? (
            <EmptyState title="티커를 입력해 주세요" desc="보유 투자자를 확인할 종목 코드를 검색해 주세요." />
          ) : !byTickerEntry ? (
            <EmptyState
              title={`${normalizeForEntityKey(search)} 데이터 없음`}
              desc="해당 종목의 공시 보유 데이터가 아직 없습니다."
            />
          ) : byTickerEntry.holder_details.length === 0 ? (
            <EmptyState
              title={`${normalizeForEntityKey(search)}에 보유자가 없습니다`}
              desc="현재 추적 중인 투자자 중 이 종목 보유자가 없습니다."
            />
          ) : (
            <div className="space-y-3">
              <div data-superinvestor-ticker-result className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black tracking-tight text-slate-950">
                    {selectedTicker}
                  </h2>
                  {byTickerEnhanced ? (
                    <p data-superinvestor-ticker-equity-score className="mt-1 text-[10px] font-bold text-[var(--c-ink-3)]">
                      주식 기준 {byTickerEnhanced.equity_holders}/{byTickerEnhanced.total_holders}명 · 확신 점수 {formatPercent(byTickerEnhanced.equity_score, { digits: 0 })}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    data-superinvestor-ticker-asof
                    className="inline-flex min-h-11 items-center rounded-full border border-amber-200 bg-amber-50 px-3 text-[10px] font-black text-amber-700"
                  >
                    {quarter ?? "—"}
                  </span>
                  <span
                    data-superinvestor-ticker-lag
                    className="inline-flex min-h-11 items-center rounded-full border border-sky-200 bg-sky-50 px-3 text-[10px] font-black text-sky-700"
                  >
                    13F 최대 45일 지연
                  </span>
                  <span className="text-sm font-bold text-slate-500">
                    보유자{" "}
                    <strong className="orbitron text-slate-900">{byTickerEntry.holder_details.length}</strong>명
                  </span>
                  <TransitionLink
                    href={ROUTES.screenerTicker(selectedTicker)}
                    data-superinvestor-ticker-action
                    data-superinvestor-ticker-screener-link
                    className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
                  >
                    스크리너에서 보기
                  </TransitionLink>
                </div>
              </div>
              <div
                data-superinvestor-ticker-holders
                className="scroll-hint-x -mx-1 px-1"
                role="region"
                tabIndex={0}
                aria-label="종목별 보유자 표 가로 스크롤"
              >
                <table className="w-full min-w-[820px] table-fixed text-sm">
                  <colgroup>
                    <col className="w-[190px]" />
                    <col className="w-[104px]" />
                    <col className="w-[132px]" />
                    <col className="w-[128px]" />
                    <col className="w-[104px]" />
                    <col className="w-[162px]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink)]">
                      <th className="px-3 py-2 text-left">보유자</th>
                      <th className="px-3 py-2 text-right">비중</th>
                      <th className="px-3 py-2 text-right">평가액</th>
                      <th className="px-3 py-2 text-right">주식수</th>
                      <th className="px-3 py-2 text-right">전체 비중</th>
                      <th className="px-3 py-2 text-left">보유 구분</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byTickerHolderRows.map((h) => (
                      <tr
                        key={h.investor}
                        data-superinvestor-ticker-holder-row
                        data-superinvestor-ticker-holder-investor={h.investor}
                        className="border-b border-slate-100 last:border-b-0"
                      >
                        <td className="px-3 py-3">
                          <TransitionLink
                            href={ROUTES.superinvestorsGuru(h.investor)}
                            data-superinvestor-ticker-holder-link
                            className="inline-flex min-h-11 max-w-full items-center rounded-full border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-wide text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
                            title={h.investor}
                          >
                            <span className="max-w-[150px] truncate">{h.investor}</span>
                          </TransitionLink>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right">
                          <span className="orbitron tabular-nums font-bold text-slate-900">{formatPercent(h.weight, { digits: 2 })}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right">
                          <span className="orbitron tabular-nums text-slate-700">{formatCurrencyCompact(h.market_value, "USD")}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right">
                          <span className="orbitron tabular-nums text-slate-700">{formatCompactNumber(h.shares)}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right">
                          <span className="orbitron tabular-nums text-slate-500">
                            {formatPercent(h.shares / (byTickerEntry.total_shares || 1), { digits: 1 })}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex max-w-[180px] flex-wrap gap-1">
                            {(h.classes_held ?? []).slice(0, 2).map((item) => (
                              <span key={item} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-600">
                                {item}
                              </span>
                            ))}
                            {(h.position_types ?? []).map((item) => (
                              <span key={item} className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-700">
                                {item}
                              </span>
                            ))}
                            {!(h.classes_held?.length || h.position_types?.length) ? (
                              <span className="text-[10px] font-bold text-slate-300">—</span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <TransitionLink
                  href={ROUTES.stock(selectedTicker)}
                  data-superinvestor-ticker-action
                  data-superinvestor-ticker-stock-link
                  className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
                >
                  종목 상세 보기 →
                </TransitionLink>
              </div>
            </div>
          )}
        </div>
      </TabPanel>

      {/* Trades ranking */}
      <TabPanel idBase={tabsId} item={SUPERINVESTOR_TAB_ITEMS.trades} active={tab === "trades"} className="space-y-4">
          {/* Header strip */}
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
            </div>
          ) : null}

          {/* Loading skeleton */}
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
            <>
              {/* Panels */}
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
            </>
          ) : null}
      </TabPanel>

      {/* Insights */}
      <TabPanel idBase={tabsId} item={SUPERINVESTOR_TAB_ITEMS.insights} active={tab === "insights"}>
        <InsightsTab />
      </TabPanel>

      {/* Methodology — demoted per brief-superinvestors.md D (content preserved verbatim,
          just relocated from a top-of-page card into a collapsed bottom accordion). */}
      {dataReady ? (
      <CpAccordion
        title="자료 기준 · SEC 13F 공시 변환 데이터"
        meta={`${quarter ?? "—"} · 45일 지연`}
      >
        <p className="text-xs font-semibold leading-5 text-[var(--c-ink-3)]">
          SEC 13F 공시 원문을 가공한 분석 자료만 사용합니다. 실시간 보유가 아니라 분기 보고 기준이며,
          분기 종료 후 최대 45일 지연됩니다.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">기준 분기</p>
            <p className="mt-1 orbitron text-sm font-black text-slate-950">{quarter ?? "—"}</p>
            <p className="mt-1 text-[10px] font-semibold text-[var(--c-ink-3)]">
              {generatedAtLabel ? `생성 ${generatedAtLabel}` : "생성 시각 정보 없음"}
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">분석 범위</p>
            <p className="mt-1 orbitron text-sm font-black text-slate-950">
              {formatInteger(investorCount)}명 · {formatInteger(tickerCount)}종목
            </p>
            <p className="mt-1 text-[10px] font-semibold text-[var(--c-ink-3)]">
              오래된 공시는 최신 분기 계산에서 제외
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">섹터 분해</p>
            <p className="mt-1 text-sm font-black text-slate-950">{topSectorLabel}</p>
            <p className="mt-1 text-[10px] font-semibold text-[var(--c-ink-3)]">
              {sectorBreakdownCount}개 섹터 · 대표 {topSectorHoldings}
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">종목별 보유</p>
            <p className="mt-1 orbitron text-sm font-black text-slate-950">{formatInteger(tickerCount)}</p>
            <p className="mt-1 text-[10px] font-semibold text-[var(--c-ink-3)]">
              보유 투자자·비중은 종목별 보유 탭에서 확인
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">확신 신호</p>
            <p className="mt-1 orbitron text-sm font-black text-slate-950">
              {formatInteger(convictionNewCount)} / {formatInteger(convictionHoldCount)}
            </p>
            <p className="mt-1 text-[10px] font-semibold text-[var(--c-ink-3)]">
              신규 고비중 / 상위 보유 유지
            </p>
          </div>
        </div>
        <p className="mt-3 text-[10px] font-semibold leading-4 text-[var(--c-ink-3)]">
          섹터·종목·확신 신호는 같은 기준 분기의 변환 데이터에서 계산합니다. 공시 지연 때문에 오늘의 실제 보유와 다를 수 있습니다.
        </p>
      </CpAccordion>
      ) : null}

    </div>
  );
}
