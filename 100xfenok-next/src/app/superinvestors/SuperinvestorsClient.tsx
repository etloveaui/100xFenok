"use client";

import { useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { use13FData, useInvestorDetail } from "@/hooks/use13FData";
import type {
  SuperInvestorsTab,
  ConsensusTicker,
  SummaryInvestor,
  InvestorHolding,
  InvestorFiling,
} from "@/lib/superinvestors/types";

const PAGE_SIZE = 50;

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
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
    return [...holdings]
      .filter((h) => h.ticker !== null && h.ticker !== "")
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
                    href={`/screener?ticker=${encodeURIComponent(h.ticker)}`}
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

function GuruDetailPanel({ id, summary }: { id: string; summary: SummaryInvestor }) {
  const { data, loading } = useInvestorDetail(id);

  const latest: InvestorFiling | null = data?.investor?.filings?.[data.investor.filings.length - 1] ?? null;
  const prev: InvestorFiling | null =
    data?.investor?.filings?.[data.investor.filings.length - 2] ?? null;

  return (
    <div className="mt-3 rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">최신 분기</p>
          <p className="text-sm font-bold text-slate-900">
            {latest ? latest.quarter : "—"} · 보유 {latest ? latest.holdings_count.toLocaleString() : "—"}종목
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">AUM</p>
          <p className="text-sm font-bold text-slate-900">{fmtAum(latest?.aum_total ?? summary.aum)}</p>
        </div>
      </div>

      {latest?.changes_summary ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-emerald-700">신규</p>
            <p className="orbitron mt-1 text-sm font-black text-emerald-800">{latest.changes_summary.new_positions ?? 0}</p>
          </div>
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-sky-700">증가</p>
            <p className="orbitron mt-1 text-sm font-black text-sky-800">{latest.changes_summary.added_to ?? 0}</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-amber-700">감소</p>
            <p className="orbitron mt-1 text-sm font-black text-amber-800">{latest.changes_summary.reduced ?? 0}</p>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-rose-700">매도</p>
            <p className="orbitron mt-1 text-sm font-black text-rose-800">{latest.changes_summary.sold_out ?? 0}</p>
          </div>
        </div>
      ) : null}

      {prev && latest ? (
        <p className="mt-3 text-[10px] font-semibold text-slate-500">
          이전 분기 대비: {prev.quarter} → {latest.quarter}
        </p>
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

export default function SuperinvestorsClient() {
  const { consensus, summary, byTicker, dataReady, failed, quarter, excludedStale } = use13FData();
  const [tab, setTab] = useState<SuperInvestorsTab>("consensus");
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [expandedGuru, setExpandedGuru] = useState<string | null>(null);
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

  const quarterLabel = quarter ? `${quarter} 기준` : null;
  const delayLabel = "13F 공시는 분기 종료 후 최대 45일 지연됩니다";

  return (
    <main className="container mx-auto max-w-6xl space-y-4 overflow-x-hidden px-3 py-4 sm:px-4 sm:py-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-interactive">13F Superinvestors</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">구루 보유 현황</h1>
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
                      isOpen ? "border-brand-interactive" : "border-slate-200",
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
                          {inv.top5.slice(0, 5).map((ticker, i) => (
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

                    {isOpen ? <GuruDetailPanel id={id} summary={inv} /> : null}
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
                    href={`/screener?ticker=${encodeURIComponent(search.trim().toUpperCase())}`}
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
    </main>
  );
}
