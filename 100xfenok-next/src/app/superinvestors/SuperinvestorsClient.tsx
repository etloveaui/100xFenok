"use client";

import { useMemo, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import TransitionLink from "@/components/TransitionLink";
import { use13FData, useInvestorDetail } from "@/hooks/use13FData";
import { resolveSector, sectorColor, sectorLabelKo } from "@/lib/design/sectorMap";
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

const ChartLoading = () => (
  <div className="grid h-[220px] place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-xs font-bold text-slate-400">
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

function fmtAum(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
  return `$${Math.round(value).toLocaleString()}`;
}

function fmtShares(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function fmtWeight(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function fmtScore(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}`;
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
    return <EmptyState title="보유 종목이 없습니다" desc="최신 분기에 유효한 티커 보유가 없어요." />;
  }

  return (
    <div className="-mx-1 overflow-x-auto px-1">
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
            <tr key={`${h.ticker}-${h.cusip}`} className="border-b border-slate-100 last:border-b-0">
              <td className="px-2 py-2">
                {h.ticker ? (
                  <TransitionLink
                    href={`/stock/${encodeURIComponent(h.ticker)}`}
                    className="font-black text-brand-interactive hover:underline"
                  >
                    {h.ticker}
                  </TransitionLink>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="px-2 py-2">
                <span className="block max-w-[200px] truncate font-semibold text-slate-700">{h.name}</span>
                {h.sector ? <span className="text-[10px] text-slate-400">{h.sector}</span> : null}
              </td>
              <td className="px-2 py-2 text-right">
                <span className="orbitron tabular-nums font-bold text-slate-900">{fmtWeight(h.weight)}</span>
              </td>
              <td className="px-2 py-2 text-right">
                <span className="orbitron tabular-nums text-slate-700">{fmtShares(h.shares)}</span>
              </td>
              <td className="px-2 py-2 text-right">
                <span className="orbitron tabular-nums text-slate-700">{fmtAum(h.market_value)}</span>
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
    <div className="mt-3 rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
      {/* Row 1 — KPI strip (panel lives inside a narrow card column — keep 2x2) */}
      <div className="grid grid-cols-2 gap-2">
        <KpiCard label="운용 자산" value={fmtAum(latest?.aum_total ?? summary.aum)} isLoading={loading} />
        <KpiCard
          label="보유 종목"
          value={latest ? latest.holdings_count.toLocaleString() : "—"}
          isLoading={loading}
        />
        <KpiCard
          label="TOP 10 비중"
          value={latest?.top_10_weight != null ? `${(latest.top_10_weight * 100).toFixed(1)}%` : "—"}
          isLoading={loading}
        />
        <KpiCard
          label="회전율"
          value={turnover === undefined ? "..." : turnover === null ? "—" : `${(turnover * 100).toFixed(1)}%`}
          isLoading={loading || turnover === undefined}
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
          {latest ? latest.quarter : summary.quarter || "—"}
        </p>
        {prev ? (
          <p className="text-[10px] font-semibold text-slate-500">
            이전 분기: {prev.quarter}
          </p>
        ) : null}
      </div>

      {/* Portfolio charts (from portfolio_views.json) */}
      {hasPortfolioView ? (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <p className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">보유 포트폴리오</p>
          <div className="mt-2 space-y-4">
            {treemapRows.length > 0 ? (
              <PortfolioTreemap
                rows={treemapRows}
                quarterLabel={investorView.quarter}
              />
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
}: {
  label: string;
  value: string;
  isLoading?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
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
  amountColor,
  expanded,
  onToggle,
  actionLabel,
}: {
  title: string;
  rows: TradesRankingRow[];
  amountColor: AmountColor;
  expanded: boolean;
  onToggle: () => void;
  actionLabel: (r: TradesRankingRow) => string | undefined;
}) {
  const visibleRows = expanded ? rows : rows.slice(0, 10);
  const amountTextClass = amountColor === "emerald" ? "text-emerald-700" : "text-rose-700";
  const topLabel = amountColor === "emerald" ? "TOP 매수자" : "TOP 매도자";

  if (rows.length === 0) {
    return (
      <div className="rounded-[1.5rem] border border-slate-200 bg-white p-3 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-4">
        <h3 className="text-sm font-black tracking-tight text-slate-900">{title}</h3>
        <EmptyState title="데이터가 없습니다" desc="해당 분기 매매 데이터가 존재하지 않습니다." />
      </div>
    );
  }

  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-3 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-4">
      <h3 className="text-sm font-black tracking-tight text-slate-900">{title}</h3>
      <div className="mt-3 -mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[440px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">
              <th className="px-2 py-2 text-left">순위</th>
              <th className="px-2 py-2 text-left">종목</th>
              <th className="px-2 py-2 text-left">섹터</th>
              <th className="px-2 py-2 text-right">금액</th>
              <th className="px-2 py-2 text-right">투자자</th>
              <th className="px-2 py-2 text-left">{topLabel}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => (
              <tr key={`${r.ticker}-${r.rank}`} className="border-b border-slate-100 last:border-b-0">
                <td className="px-2 py-2">
                  <span className="orbitron tabular-nums text-xs font-bold text-slate-400">{r.rank}</span>
                </td>
                <td className="px-2 py-2">
                  <span className="block max-w-[130px] truncate font-bold text-slate-900">{r.name}</span>
                  <TransitionLink
                    href={`/stock/${encodeURIComponent(r.ticker)}`}
                    className="text-[10px] font-black text-brand-interactive hover:underline"
                  >
                    {r.ticker}
                  </TransitionLink>
                </td>
                <td className="px-2 py-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: sectorColor(r.sector as Parameters<typeof sectorColor>[0]) }}
                    />
                    {sectorLabelKo(r.sector as Parameters<typeof sectorLabelKo>[0])}
                  </span>
                </td>
                <td className="px-2 py-2 text-right">
                  <span className={`orbitron tabular-nums font-bold ${amountTextClass}`}>
                    {fmtAum(r.amount)}
                  </span>
                </td>
                <td className="px-2 py-2 text-right">
                  <span className="orbitron tabular-nums font-bold text-slate-900">{r.investors_count}</span>
                  {actionLabel(r) ? (
                    <span className="block text-[10px] font-semibold text-slate-400">{actionLabel(r)}</span>
                  ) : null}
                </td>
                <td className="px-2 py-2 max-w-[110px]">
                  <span className="block truncate text-[10px] font-bold text-slate-700">{r.top_investor?.name ?? "—"}</span>
                </td>
              </tr>
            ))}
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
  const { consensus, enhancedConsensus, summary, byTicker, bySector, dataReady, failed, quarter, excludedStale } = use13FData();
  const [tab, setTab] = useState<SuperInvestorsTab>(initialTab ?? "consensus");
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
    if (!group) return rows;
    return rows.filter(([, inv]) => inv.group === group);
  }, [summary, group]);

  const groups = useMemo(() => {
    if (!summary) return [];
    return Array.from(new Set(Object.values(summary.investors).map((i) => i.group))).sort();
  }, [summary]);

  const byTickerEntry = useMemo(() => {
    if (!byTicker || !search.trim()) return null;
    const key = search.trim().toUpperCase();
    return byTicker[key] ?? null;
  }, [byTicker, search]);

  const byTickerEnhanced = useMemo(() => {
    if (!enhancedConsensus || !search.trim()) return null;
    const key = search.trim().toUpperCase();
    return enhancedConsensus.enhanced_consensus?.[key] ?? null;
  }, [enhancedConsensus, search]);

  const sectorRows = useMemo(() => {
    if (!bySector) return [];
    return Object.entries(bySector)
      .filter(([sector, entry]) => sector !== "_meta" && isSectorEntry(entry))
      .map(([sector, entry]) => ({ sector, ...(entry as SectorHoldingsEntry) }))
      .sort((a, b) => b.avg_weight - a.avg_weight)
      .slice(0, 8);
  }, [bySector]);

  const coverage = summary?.metadata?.enrichment_coverage ?? null;

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

  const quarterLabel = quarter ? `${quarter} 기준` : null;
  const delayLabel = "기관 공시는 분기 종료 후 최대 45일 지연됩니다";

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
          {quarterLabel ? (
            <span className="data-shell-pill ok">
              <span />
              {quarterLabel}
            </span>
          ) : null}
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

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-1">
        {[
          { id: "consensus" as const, label: "공통 보유" },
          { id: "gurus" as const, label: "투자자 목록" },
          { id: "by-ticker" as const, label: "종목별 보유" },
          { id: "trades" as const, label: "매매 순위" },
          { id: "insights" as const, label: "인사이트" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setSearch("");
              setExpandedGuru(null);
            }}
            className={cx(
              "relative inline-flex min-h-9 items-center px-3 text-[11px] font-black uppercase tracking-[0.12em] transition",
              tab === t.id ? "text-brand-interactive" : "text-slate-500 hover:text-slate-900",
            )}
            aria-pressed={tab === t.id}
            aria-current={tab === t.id ? "page" : undefined}
          >
            {t.label}
            {tab === t.id ? <span className="absolute bottom-[-5px] left-0 right-0 h-[2px] rounded-full bg-brand-interactive" /> : null}
          </button>
        ))}
      </div>

      {/* Consensus */}
      {tab === "consensus" && (
        <section className="space-y-3">
          {/* Total portfolio (collapsible) */}
          {pvData && !pvFailed ? (
            <div className="rounded-[1.5rem] border border-slate-200 bg-white p-3 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-4">
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
                    <span className="text-[10px] font-semibold text-slate-400">
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
                    <p className="text-[10px] font-semibold text-slate-400">{pvData.metadata.disclaimer}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {sectorRows.length > 0 ? (
            <div className="rounded-[1.5rem] border border-slate-200 bg-white p-3 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-black tracking-tight text-slate-900">섹터 정렬</h2>
                  <p className="mt-1 text-[10px] font-semibold text-slate-400">
                    최신 공시 보유를 섹터별로 묶어 어느 영역에 거장 자금이 모이는지 봅니다.
                  </p>
                </div>
                {coverage ? (
                  <span className="rounded-full border border-slate-200 px-2 py-1 text-[10px] font-black text-slate-500">
                    섹터 정보 {fmtPct(coverage.sector, 0)} · 공시 당시 가격 {fmtPct(coverage.price_at_filing, 0)}
                  </span>
                ) : null}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {sectorRows.map((row) => {
                  const canonicalSector = resolveSector(row.sector);
                  return (
                    <div key={row.sector} className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] font-black text-slate-800">
                          {sectorLabelKo(canonicalSector)}
                        </span>
                        <span className="orbitron tabular-nums text-[11px] font-black text-brand-interactive">
                          {fmtPct(row.avg_weight)}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] font-semibold text-slate-400">
                        {row.investors.filter(Boolean).length}명 보유 · 대표 {row.top_holdings.slice(0, 3).join(", ")}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex min-w-[220px] flex-col gap-1">
              <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">티커 검색</span>
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

          <div className={cx("rounded-[1.5rem] border border-slate-200 bg-white p-2 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-3", !dataReady && "opacity-60")}>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">
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
                        <EmptyState title="결과가 없습니다" desc="검색어를 바꾸거나 필터를 초기화해 보세요." />
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
                            <span className="orbitron tabular-nums text-xs font-bold text-slate-400">{rank}</span>
                          </td>
                          <td className="px-3 py-3">
                            <span className="text-sm font-black text-slate-950">{row.ticker}</span>
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
                                  <span className="text-[10px] font-bold text-slate-400">
                                    {fmtScore(enhanced.equity_score)}
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
        </section>
      )}

      {/* Gurus */}
      {tab === "gurus" && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="flex min-w-[200px] flex-col gap-1">
              <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">스타일</span>
              <select
                value={group}
                onChange={(e) => {
                  setGroup(e.target.value);
                  setExpandedGuru(null);
                }}
                className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
              >
                <option value="">전체 스타일</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-sm font-bold text-slate-500">
              <strong className="orbitron text-slate-900">{guruEntries.length}</strong>명
            </span>
          </div>

          {!dataReady ? (
            <SkeletonCards count={6} />
          ) : guruEntries.length === 0 ? (
            <EmptyState title="투자자가 없습니다" desc="스타일 필터를 변경해 보세요." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {guruEntries.map(([id, inv]) => {
                const isOpen = expandedGuru === id;
                return (
                  <div
                    key={id}
                    className={cx(
                      "rounded-[1.5rem] border bg-white p-4 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] transition",
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
                        <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-400">AUM</p>
                        <p className="orbitron mt-0.5 text-sm font-black text-slate-900">{fmtAum(inv.aum)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                        <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-400">보유</p>
                        <p className="orbitron mt-0.5 text-sm font-black text-slate-900">{inv.holdings_count}종목</p>
                      </div>
                    </div>

                    {inv.top5.length > 0 ? (
                      <div className="mt-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-400">Top 5</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {[...new Set(inv.top5)].slice(0, 5).map((ticker, i) => (
                            <span
                              key={`${ticker}-${i}`}
                              className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-700"
                            >
                              {ticker}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => setExpandedGuru(isOpen ? null : id)}
                      aria-pressed={isOpen}
                      className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive sm:min-h-8"
                    >
                      {isOpen ? "접기" : "포트폴리오 보기"}
                    </button>

                    {isOpen ? <GuruDetailPanel id={id} summary={inv} pvData={pvData} /> : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* By ticker */}
      {tab === "by-ticker" && (
        <section className="space-y-3">
          <label className="flex max-w-md flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">티커 검색</span>
            <div className="flex gap-2">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="예: AAPL"
                className="min-h-10 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
              />
              <button
                type="button"
                onClick={() => setSearch("")}
                className="inline-flex min-h-10 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-600 transition hover:border-rose-300 hover:text-rose-600"
              >
                초기화
              </button>
            </div>
          </label>

          <div className={cx("rounded-[1.5rem] border border-slate-200 bg-white p-3 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-4", !dataReady && "opacity-60")}>
            {!dataReady ? (
              <div className="space-y-3">
                <div className="h-5 w-1/3 rounded bg-slate-200" />
                <div className="h-4 w-1/2 rounded bg-slate-200" />
                <div className="h-4 w-2/3 rounded bg-slate-200" />
              </div>
            ) : !search.trim() ? (
              <EmptyState title="티커를 입력하세요" desc="보유 투자자를 확인할 종목 코드를 검색해 주세요." />
            ) : !byTickerEntry ? (
              <EmptyState
                title={`${search.trim().toUpperCase()} 데이터 없음`}
                desc="해당 종목의 공시 보유 데이터가 아직 없습니다."
              />
            ) : byTickerEntry.holder_details.length === 0 ? (
              <EmptyState
                title={`${search.trim().toUpperCase()}에 보유자가 없습니다`}
                desc="현재 추적 중인 투자자 중 이 종목 보유자가 없습니다."
              />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-black tracking-tight text-slate-950">
                      {search.trim().toUpperCase()}
                    </h2>
                    {byTickerEnhanced ? (
                      <p className="mt-1 text-[10px] font-bold text-slate-400">
                        주식 기준 {byTickerEnhanced.equity_holders}/{byTickerEnhanced.total_holders}명 · 확신 점수 {fmtScore(byTickerEnhanced.equity_score)}
                      </p>
                    ) : null}
                  </div>
                  <span className="text-sm font-bold text-slate-500">
                    보유자{" "}
                    <strong className="orbitron text-slate-900">{byTickerEntry.holder_details.length}</strong>명
                  </span>
                </div>
                <div className="-mx-1 overflow-x-auto px-1">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">
                        <th className="px-3 py-2 text-left">보유자</th>
                        <th className="px-3 py-2 text-right">비중</th>
                        <th className="px-3 py-2 text-right">평가액</th>
                        <th className="px-3 py-2 text-right">주식수</th>
                        <th className="px-3 py-2 text-right">전체 비중</th>
                        <th className="px-3 py-2 text-left">보유 구분</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...byTickerEntry.holder_details]
                        .sort((a, b) => (b.weight || 0) - (a.weight || 0))
                        .map((h) => (
                          <tr key={h.investor} className="border-b border-slate-100 last:border-b-0">
                            <td className="px-3 py-3">
                              <span className="font-black text-slate-900">{h.investor}</span>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <span className="orbitron tabular-nums font-bold text-slate-900">{fmtWeight(h.weight)}</span>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <span className="orbitron tabular-nums text-slate-700">{fmtAum(h.market_value)}</span>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <span className="orbitron tabular-nums text-slate-700">{fmtShares(h.shares)}</span>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <span className="orbitron tabular-nums text-slate-500">
                                {((h.shares / (byTickerEntry.total_shares || 1)) * 100).toFixed(1)}%
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
                    href={`/stock/${encodeURIComponent(search.trim().toUpperCase())}`}
                    className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive sm:min-h-8"
                  >
                    종목 상세 보기 →
                  </TransitionLink>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Trades ranking */}
      {tab === "trades" && (
        <section className="space-y-4">
          {/* Header strip */}
          {tradesData ? (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {tradesData.metadata.quarter} 기준
                </span>
                <span className="text-[10px] font-bold text-slate-400">{delayLabel}</span>
              </div>
              {tradesData.metadata.disclaimer ? (
                <p className="text-[10px] font-semibold text-slate-400">{tradesData.metadata.disclaimer}</p>
              ) : null}
            </div>
          ) : null}

          {/* Loading skeleton */}
          {tradesLoading ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {[0, 1].map((p) => (
                <div key={p} className="rounded-[1.5rem] border border-slate-200 bg-white p-3 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-4">
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
                  amountColor="emerald"
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
                  amountColor="rose"
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
        </section>
      )}

      {/* Insights */}
      {tab === "insights" && <InsightsTab />}

    </div>
  );
}
