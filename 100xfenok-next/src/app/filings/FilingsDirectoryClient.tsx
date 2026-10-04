"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { CpDataTable, type CpDataTableColumn } from "@/components/canvas-plus/kit";
import { EmptyState, Panel, useDelayedLoading } from "@/components/ui";
import { loadEdgarKoreanSummaryTickers } from "@/lib/edgarKoreanSummaries";
import { ROUTES } from "@/lib/routes";

type TickerRow = { ticker: string };
const columns: readonly CpDataTableColumn<TickerRow>[] = [
  { key: "ticker", header: "종목", render: (row) => <strong>{row.ticker}</strong> },
  { key: "summary", header: "공시", render: (row) => (
    <TransitionLink className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4" href={ROUTES.stockFilings(row.ticker)}>
      {row.ticker} 공시 요약 보기
    </TransitionLink>
  ) },
];

export default function FilingsDirectoryClient() {
  const [directory, setDirectory] = useState<{ tickers: string[]; updated: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const showLoading = useDelayedLoading(loading);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    loadEdgarKoreanSummaryTickers().then((result) => {
      if (cancelled) return;
      setDirectory(result);
      setFailed(result === null);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) { setFailed(true); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [attempt]);
  const rows = useMemo(() => {
    const needle = query.trim().toUpperCase();
    return (directory?.tickers ?? []).filter((ticker) => ticker.includes(needle)).map((ticker) => ({ ticker }));
  }, [directory, query]);

  return <div className="space-y-4" data-filings-directory>
    <header>
      <h1 className="text-xl font-bold">공시 한글 요약</h1>
      <p className="mt-2 text-sm text-slate-600">종목을 고르면 공시 목록, 한글 요약과 SEC 원문을 확인할 수 있습니다.</p>
      {directory ? <p className="mt-2 text-sm text-slate-500">{directory.tickers.length}개 종목 · 목록 갱신 {directory.updated}</p> : null}
    </header>
    <label className="block text-sm font-semibold" htmlFor="filings-ticker-search">종목 검색
      <input id="filings-ticker-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)}
        className="mt-2 block min-h-11 w-full max-w-sm rounded-lg border border-slate-300 px-3 font-normal" placeholder="예: AAPL, NVDA, TSM" />
    </label>
    {failed ? <EmptyState reason="공시 목록을 불러오지 못했습니다." actionLabel="다시 불러오기" onAction={() => setAttempt((value) => value + 1)} />
      : <Panel loading={showLoading}>
        {loading ? <p className="p-4 text-sm text-slate-500">공시 목록을 불러오는 중입니다.</p>
          : rows.length ? <CpDataTable columns={columns} rows={rows} getRowKey={(row) => row.ticker} caption={`공시 한글 요약 ${rows.length}개 종목`} />
            : <EmptyState reason={query.trim() ? "검색한 종목에 연결된 공시 요약이 없습니다." : "등록된 공시 요약이 없습니다."} />}
      </Panel>}
  </div>;
}
