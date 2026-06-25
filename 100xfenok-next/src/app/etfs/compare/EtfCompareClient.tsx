"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { formatSignedPercent } from "@/lib/format";
import { MAX_COMPARE_TICKERS, buildCompareCsv, isFiniteNumber, pairOverlaps, parseTickers } from "./etfCompareOverlap";
import type { EtfCompareRow, EtfPayload, PairOverlap } from "./etfCompareOverlap";

function rawText(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (isFiniteNumber(value)) return value.toLocaleString("ko-KR");
  return "—";
}

function fmtDateish(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "—";
  const text = value.trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
}

function parsePercentPoints(value: unknown): number | null {
  if (isFiniteNumber(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function fmtPercent(value: number | null | undefined): string {
  return isFiniteNumber(value) ? `${value.toFixed(Math.abs(value) >= 10 ? 1 : 2)}%` : "—";
}

function fmtSigned(value: number | null | undefined): string {
  return isFiniteNumber(value) ? formatSignedPercent(value, { digits: 2, fraction: false }) : "—";
}

async function loadEtf(ticker: string): Promise<EtfCompareRow> {
  try {
    const response = await fetch(`/api/data/stockanalysis/etfs/${encodeURIComponent(ticker)}/`, { cache: "no-store" });
    if (!response.ok) return { ticker, data: null, failed: true };
    const data = await response.json() as EtfPayload;
    return { ticker, data, failed: false };
  } catch {
    return { ticker, data: null, failed: true };
  }
}

function CompareSummaryCard({ row }: { row: EtfCompareRow }) {
  const overview = row.data?.normalized?.overview ?? {};
  const performance = row.data?.normalized?.performance ?? {};
  const holdings = Array.isArray(row.data?.normalized?.holdings) ? row.data.normalized.holdings : [];
  const holdingCount = row.data?.normalized?.holding_count ?? holdings.length;
  const holdingsDate = fmtDateish(row.data?.normalized?.holdings_updated ?? row.data?.fetched_at);
  const expenseRatio = parsePercentPoints(overview.expenseRatio);
  const dividendYield = parsePercentPoints(overview.dividendYield);
  const aum = rawText(overview.aum);
  const name = rawText(overview.name) !== "—" ? rawText(overview.name) : row.ticker;

  return (
    <div className="rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)]/80 px-3 py-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <TransitionLink href={`/etfs/${encodeURIComponent(row.ticker)}`} className="orbitron text-sm font-black text-[var(--c-ink)] hover:text-brand-interactive">
            {row.ticker}
          </TransitionLink>
          <p className="mt-1 min-w-0 break-words text-xs font-bold leading-snug text-[var(--c-ink)]">{name}</p>
          <p className="mt-1 text-[10px] font-bold text-[var(--c-ink-3)]">기준 {holdingsDate}</p>
        </div>
        <span className="orbitron tabular-nums shrink-0 rounded-full bg-[var(--c-surface-2)] px-2 py-1 text-[10px] font-black text-[var(--c-ink-3)]">
          {fmtSigned(performance.tr1y)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-bold text-[var(--c-ink-3)]">
        <span className="rounded-lg bg-[var(--c-surface-2)] px-2 py-2">AUM <b className="tabular-nums text-[var(--c-ink)]">{aum}</b></span>
        <span className="rounded-lg bg-[var(--c-surface-2)] px-2 py-2">보수 <b className="tabular-nums text-[var(--c-ink)]">{fmtPercent(expenseRatio)}</b></span>
        <span className="rounded-lg bg-[var(--c-surface-2)] px-2 py-2">배당 <b className="tabular-nums text-[var(--c-ink)]">{fmtPercent(dividendYield)}</b></span>
        <span className="rounded-lg bg-[var(--c-surface-2)] px-2 py-2">보유 <b className="tabular-nums text-[var(--c-ink)]">{holdingCount.toLocaleString("ko-KR")}</b></span>
      </div>
      {row.failed ? <p className="mt-2 text-[10px] font-bold text-red-700">상세 데이터를 불러오지 못했습니다.</p> : null}
    </div>
  );
}

function OverlapCard({ pair }: { pair: PairOverlap }) {
  const topCommon = pair.common.slice(0, 8);
  return (
    <div className="rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)]/80 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="orbitron text-sm font-black text-[var(--c-ink)]">{pair.left.ticker} / {pair.right.ticker}</p>
          <p className="mt-1 text-[10px] font-semibold text-[var(--c-ink-3)]">상위 25개 보유 항목 기준</p>
        </div>
        <div className="text-right">
          <p className="orbitron tabular-nums text-lg font-black text-[var(--c-ink)]">{fmtPercent(pair.overlapWeight)}</p>
          <p className="text-[10px] font-bold text-[var(--c-ink-3)]">최소 비중 합계</p>
        </div>
      </div>
      <div className="mt-3 overflow-x-auto" role="region" aria-label={`${pair.left.ticker} ${pair.right.ticker} 공통 보유 항목`} tabIndex={0}>
        {topCommon.length ? (
          <table className="w-full min-w-[440px] text-xs">
            <thead>
              <tr className="border-b border-[var(--c-line)] text-[10px] font-black uppercase tracking-[0.06em] text-[var(--c-ink-3)]">
                <th scope="col" className="px-2 py-2 text-left">공통 항목</th>
                <th scope="col" className="px-2 py-2 text-right">{pair.left.ticker}</th>
                <th scope="col" className="px-2 py-2 text-right">{pair.right.ticker}</th>
              </tr>
            </thead>
            <tbody>
              {topCommon.map((item) => (
                <tr key={item.key} className="border-b border-[var(--c-line)] last:border-b-0">
                  <th scope="row" className="px-2 py-2 text-left font-bold text-[var(--c-ink)]">
                    {item.symbol !== "—" ? `${item.symbol} · ` : ""}{item.name}
                  </th>
                  <td className="px-2 py-2 text-right orbitron font-black tabular-nums text-[var(--c-ink)]">{fmtPercent(item.leftWeight)}</td>
                  <td className="px-2 py-2 text-right orbitron font-black tabular-nums text-[var(--c-ink)]">{fmtPercent(item.rightWeight)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="rounded-lg bg-[var(--c-surface-2)] px-3 py-3 text-xs font-semibold text-[var(--c-ink-3)]">
            공통 보유 항목을 찾지 못했습니다.
          </p>
        )}
      </div>
    </div>
  );
}

function downloadCompareCsv(rows: EtfCompareRow[], overlaps: PairOverlap[]) {
  if (typeof window === "undefined" || rows.length === 0) return;
  const blob = new Blob([buildCompareCsv(rows, overlaps)], { type: "text/csv;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `100xfenok-etf-compare-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export default function EtfCompareClient({ initialTickers }: { initialTickers: string }) {
  const initial = parseTickers(initialTickers);
  const [tickers, setTickers] = useState(initial.length >= 2 ? initial : ["SPY", "VOO"]);
  const [input, setInput] = useState(tickers.join(", "));
  const tickersKey = tickers.join(",");
  const [loadState, setLoadState] = useState<{
    key: string;
    rows: EtfCompareRow[];
  }>({ key: "", rows: [] });

  useEffect(() => {
    let cancelled = false;
    Promise.all(tickers.map(loadEtf)).then((nextRows) => {
      if (!cancelled) {
        setLoadState({ key: tickersKey, rows: nextRows });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tickers, tickersKey]);

  const loading = loadState.key !== tickersKey;
  const rows = useMemo(() => (loading ? [] : loadState.rows), [loading, loadState.rows]);
  const overlaps = useMemo(() => pairOverlaps(rows), [rows]);
  const asOfDates = useMemo(() => {
    const dates = rows
      .map((row) => fmtDateish(row.data?.normalized?.holdings_updated ?? row.data?.fetched_at))
      .filter((date) => date !== "—");
    return [...new Set(dates)];
  }, [rows]);
  const asOfLabel = asOfDates.length === 0 ? "—" : asOfDates.length === 1 ? asOfDates[0] : "기준일 혼합";
  const hasMixedAsOf = asOfDates.length > 1;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = parseTickers(input);
    if (next.length < 2) return;
    setTickers(next);
    setInput(next.join(", "));
    window.history.replaceState(null, "", `/etfs/compare?tickers=${encodeURIComponent(next.join(","))}`);
  }

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>비교 세트</h2>
        <span className="desc">최대 {MAX_COMPARE_TICKERS}개 · 기준일 {asOfLabel}</span>
      </div>
      <div className="panel-b space-y-4">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="etf-compare-tickers">비교 ETF</label>
          <input
            id="etf-compare-tickers"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="min-h-10 min-w-0 flex-1 rounded-xl border border-[var(--c-line)] bg-white px-3 text-sm font-bold text-[var(--c-ink)] outline-none transition focus:border-brand-interactive"
            placeholder="SPY, VOO"
          />
          <button
            type="submit"
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[var(--c-brand)] bg-[var(--c-brand)] px-4 text-xs font-black uppercase tracking-[0.08em] text-white transition hover:bg-brand-interactive"
          >
            비교
          </button>
          <button
            type="button"
            onClick={() => downloadCompareCsv(rows, overlaps)}
            disabled={loading || rows.length === 0}
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[var(--c-line)] bg-white px-4 text-xs font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)] transition hover:border-brand-interactive hover:text-brand-interactive disabled:cursor-not-allowed disabled:bg-[var(--c-surface-2)] disabled:text-[var(--c-ink-4)]"
          >
            CSV 저장
          </button>
        </form>

        <div className="rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 py-2 text-xs font-semibold text-[var(--c-ink-3)]">
          보유 구성 겹침은 각 ETF 상세 화면에 연결된 상위 25개 표시 항목 기준입니다. 전체 원장 겹침으로 해석하지 않습니다.
        </div>

        {hasMixedAsOf ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
            비교 ETF의 보유 기준일이 서로 달라 각 카드의 기준일을 함께 확인하세요.
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm font-semibold text-[var(--c-ink-3)]">ETF 비교 데이터를 불러오는 중</p>
        ) : (
          <>
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
              {rows.map((row) => (
                <CompareSummaryCard key={row.ticker} row={row} />
              ))}
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              {overlaps.map((pair) => (
                <OverlapCard key={`${pair.left.ticker}-${pair.right.ticker}`} pair={pair} />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
