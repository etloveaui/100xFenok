"use client";

import { useMemo, useState, useEffect } from "react";
import TransitionLink from "@/components/TransitionLink";
import { use13FData, useInvestorDetail } from "@/hooks/use13FData";
import { sectorColor, sectorLabelKo } from "@/lib/design/sectorMap";
import { PortfolioTreemap, SectorMixPanel, loadPortfolioViews } from "./PortfolioCharts";
import InsightsTab from "./InsightsTab";
import type {
  SuperInvestorsTab,
  ConsensusTicker,
  SummaryInvestor,
  InvestorHolding,
  InvestorFiling,
  TradesRankingData,
  TradesRankingRow,
  TurnoverData,
  PortfolioViewsData,
} from "@/lib/superinvestors/types";

const PAGE_SIZE = 50;

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

function EmptyState({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-[1.2rem] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
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
          <td className="px-3 py-3"><div className="h-4 w-40 rounded bg-slate-200" /></td>
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
      {pvData?.investors?.[id] ? (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <p className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">보유 포트폴리오</p>
          <div className="mt-2 space-y-4">
            <PortfolioTreemap
              rows={pvData.investors[id].treemap}
              quarterLabel={pvData.investors[id].quarter}
            />
            <SectorMixPanel
              currentSectors={Object.fromEntries(
                Object.entries(pvData.investors[id].sector_history).map(([s, h]) => [
                  s,
                  h[h.length - 1] ?? 0,
                ]),
              )}
              history={pvData.investors[id].sector_history}
              quarters={pvData.investors[id].quarters}
            />
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
          <LatestHoldingsTable holdings={latest.holdings} />
        </div>
      ) : (
        <div className="mt-4">
          <EmptyState title="상세 데이터를 불러오지 못했습니다" desc="investors/{name}.json 을 확인해 주세요." />
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
              <th className="px-2 py-2 text-right">구루</th>
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
                  <span className="block truncate text-[10px] font-bold text-slate-700">{r.top_investor.name}</span>
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
          className="mt-3 inline-flex min-h-8 w-full items-center justify-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
        >
          {expanded ? "접기" : "전체 50개 보기"}
        </button>
      ) : null}
    </div>
  );
}

export default function SuperinvestorsClient() {
  const { consensus, summary, byTicker, dataReady, failed, quarter, excludedStale } = use13FData();
  const [tab, setTab] = useState<SuperInvestorsTab>("consensus");
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [expandedGuru, setExpandedGuru] = useState<string | null>(null);
  const [tradesData, setTradesData] = useState<TradesRankingData | null>(null);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [tradesFailed, setTradesFailed] = useState(false);
  const [tradesBoughtExpanded, setTradesBoughtExpanded] = useState(false);
  const [tradesSoldExpanded, setTradesSoldExpanded] = useState(false);
  const [pvData, setPvData] = useState<PortfolioViewsData | null>(null);
  const [pvFailed, setPvFailed] = useState(false);
  const [totalPortfolioOpen, setTotalPortfolioOpen] = useState(false);

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
        const json: TradesRankingData = await res.json();
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
  const delayLabel = "13F 공시는 분기 종료 후 최대 45일 지연됩니다";

  return (
    <main className="container mx-auto max-w-6xl space-y-4 overflow-x-hidden px-3 py-4 sm:px-4 sm:py-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-interactive">13F Superinvestors</p>
          <h1 className="mt-1 text-xl font-black tracking-tight text-slate-950 sm:text-2xl">구루 보유 현황</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
            워런 버핏, 세스 클라먼 등 30개 슈퍼인베스터의 13F 보유 데이터를 탐색합니다.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {quarterLabel ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {quarterLabel}
            </span>
          ) : null}
          <span className="text-[10px] font-bold text-slate-400">{delayLabel}</span>
          {excludedStale.length > 0 ? (
            <span className="text-[10px] font-bold text-amber-600">
              제외된 stale: {excludedStale.join(", ")}
            </span>
          ) : null}
        </div>
      </header>

      {failed ? (
        <div className="rounded-[1.2rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          13F 데이터를 불러오지 못했습니다. /data/sec-13f 경로를 확인해 주세요.
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-1">
        {[
          { id: "consensus" as const, label: "컨센서스" },
          { id: "gurus" as const, label: "구루 리스트" },
          { id: "by-ticker" as const, label: "종목별 보유" },
          { id: "trades" as const, label: "매매랭킹" },
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
                  <PortfolioTreemap rows={pvData.total.treemap} quarterLabel={pvData.metadata.quarter} />
                  {pvData.metadata.disclaimer ? (
                    <p className="text-[10px] font-semibold text-slate-400">{pvData.metadata.disclaimer}</p>
                  ) : null}
                </div>
              ) : null}
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
              보유 구루 수 {consensusSortDir === "desc" ? "내림차순" : "오름차순"}
            </button>
          </div>

          <div className={cx("rounded-[1.5rem] border border-slate-200 bg-white p-2 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-3", !dataReady && "opacity-60")}>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">티커</th>
                    <th className="px-3 py-2 text-right">보유 구루</th>
                    <th className="px-3 py-2 text-left">구루 목록</th>
                    <th className="px-3 py-2 text-right">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {!dataReady ? (
                    <SkeletonRows count={6} />
                  ) : pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center">
                        <EmptyState title="결과가 없습니다" desc="검색어를 바꾸거나 필터를 초기화해 보세요." />
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((row, idx) => {
                      const rank = safePage * PAGE_SIZE + idx + 1;
                      const holders = uniqueHolders(row.holders_list);
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
                              className="inline-flex min-h-7 items-center rounded-full border border-slate-200 bg-white px-2.5 text-[10px] font-black uppercase tracking-[0.1em] text-slate-600 transition hover:border-brand-interactive hover:text-brand-interactive"
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
                  className="inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive disabled:opacity-40"
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
                  className="inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive disabled:opacity-40"
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
            <EmptyState title="구루가 없습니다" desc="스타일 필터를 변경해 보세요." />
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
                      className="mt-4 inline-flex min-h-8 w-full items-center justify-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
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
              <EmptyState title="티커를 입력하세요" desc="보유 구루를 확인할 종목 코드를 검색해 주세요." />
            ) : !byTickerEntry ? (
              <EmptyState
                title={`${search.trim().toUpperCase()} 데이터 없음`}
                desc="by_ticker.json에 해당 종목이 없거나, 13F 보유 구루가 없습니다."
              />
            ) : byTickerEntry.holder_details.length === 0 ? (
              <EmptyState
                title={`${search.trim().toUpperCase()}에 보유 구루가 없습니다`}
                desc="현재 코호트에서 이 종목을 보유한 구루가 없습니다."
              />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-black tracking-tight text-slate-950">
                    {search.trim().toUpperCase()}
                  </h2>
                  <span className="text-sm font-bold text-slate-500">
                    보유 구루{" "}
                    <strong className="orbitron text-slate-900">{byTickerEntry.holder_details.length}</strong>명
                  </span>
                </div>
                <div className="-mx-1 overflow-x-auto px-1">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">
                        <th className="px-3 py-2 text-left">구루</th>
                        <th className="px-3 py-2 text-right">비중</th>
                        <th className="px-3 py-2 text-right">주식수</th>
                        <th className="px-3 py-2 text-right">전체 비중</th>
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
                              <span className="orbitron tabular-nums text-slate-700">{fmtShares(h.shares)}</span>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <span className="orbitron tabular-nums text-slate-500">
                                {((h.shares / (byTickerEntry.total_shares || 1)) * 100).toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end">
                  <TransitionLink
                    href={`/stock/${encodeURIComponent(search.trim().toUpperCase())}`}
                    className="inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
                  >
                    스크리너에서 보기 →
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
              매매랭킹 데이터를 불러오지 못했습니다. /data/sec-13f/analytics/trades_ranking.json 을 확인해 주세요.
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

    </main>
  );
}
