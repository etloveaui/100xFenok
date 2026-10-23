"use client";

import { useEffect, useState } from "react";
import { Button, EmptyState, EvidenceRail, Panel, PanelHeader } from "@/components/ui";
import { fetchJsonOrNull } from "@/lib/client/data-fetch";
import { normalizeForEntityKey } from "@/lib/ticker";

type Dividend = { amount: number; exDate: string; payDate?: string };
type DividendFile = { updated?: string; stocks: { symbol: string; dividends: Dividend[] }[] };
type Period = "recent" | "historical";
const tickerKey = (ticker: string) => normalizeForEntityKey(ticker).replaceAll(".", "-");
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
const tickerRows = (data: DividendFile | null | undefined, ticker: string) => {
  const rawRows = data?.stocks.find((stock) => tickerKey(stock.symbol) === tickerKey(ticker))?.dividends;
  return (Array.isArray(rawRows) ? rawRows : []).filter((row) => validDate(row?.exDate) && typeof row.amount === "number" && Number.isFinite(row.amount) && row.amount >= 0)
    .sort((a, b) => b.exDate.localeCompare(a.exDate));
};

export default function StockDividendsCard({ ticker }: { ticker: string }) {
  const [period, setPeriod] = useState<Period>("recent");
  const [state, setState] = useState<{ ticker: string; files: Record<Period, DividendFile | null> } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState(null);
    Promise.all((["recent", "historical"] as const).map(async (key) => {
      const data = await fetchJsonOrNull<DividendFile>(`/data/slickcharts/stocks-dividends-${key}.json`).catch(() => null);
      return Array.isArray(data?.stocks) ? data : null;
    })).then(([recent, historical]) => {
      if (cancelled) return;
      setState({ ticker, files: { recent, historical } });
      setPeriod(tickerRows(recent, ticker).length || !tickerRows(historical, ticker).length ? "recent" : "historical");
    });
    return () => { cancelled = true; };
  }, [ticker, attempt]);
  const current = state?.ticker === ticker ? state : null;
  const data = current?.files[period];
  const rows = tickerRows(data, ticker);
  if (!current || (current.files.recent && current.files.historical
    && !tickerRows(current.files.recent, ticker).length && !tickerRows(current.files.historical, ticker).length)) return null;
  return <Panel>
    <div data-stock-dividends>
      <PanelHeader eyebrow="SlickCharts · 배당 사건별" title={`${ticker} 배당 지급 이력`} />
      <div className="flex flex-wrap gap-2 px-4 pb-3">
        <Button variant={period === "recent" ? "primary" : "secondary"} aria-pressed={period === "recent"} onClick={() => setPeriod("recent")}>최근 5년</Button>
        <Button variant={period === "historical" ? "primary" : "secondary"} aria-pressed={period === "historical"} onClick={() => setPeriod("historical")}>이전 이력</Button>
      </div>
      {!data ? <EmptyState reason="배당 자료를 불러오지 못했습니다." actionLabel="다시 불러오기" onAction={() => setAttempt((value) => value + 1)} />
        : <>
          {rows.length ? <div className="max-h-80 overflow-auto px-4">
            <table className="w-full text-sm text-left">
              <caption className="pb-2 text-left">배당락일 기준 · 주당 배당금 (USD) · 미래 지급일은 예정일</caption>
              <thead><tr><th className="py-2">배당락일</th><th>지급일</th><th className="text-right">주당 배당금</th></tr></thead>
              <tbody>{rows.map((row, index) => <tr key={`${row.exDate}-${index}`} className="border-t border-slate-100">
                <td className="py-2">{row.exDate}</td><td>{validDate(row.payDate) ? row.payDate : "—"}</td><td className="text-right">${row.amount.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}</td>
              </tr>)}</tbody>
            </table>
          </div> : <p className="p-4 text-sm">선택한 기간의 배당 기록이 없습니다. 무배당 종목이라는 뜻은 아닙니다.</p>}
          <EvidenceRail freshness="fixed" stateLabel="배당 사건별" source="SlickCharts" asOf={data.updated?.slice(0, 10) ?? "—"} asOfKind="published"
            coverage={`${period === "recent" ? "최근 5년" : "이전 이력"} · ${rows.length}건${rows[0] ? ` · 최근 배당락 ${rows[0].exDate}` : ""}`} />
        </>}
    </div>
  </Panel>;
}
