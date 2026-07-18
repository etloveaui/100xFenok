"use client";

import { useEffect, useState } from "react";
import TickerChip from "@/components/TickerChip";
import TransitionLink from "@/components/TransitionLink";
import DataStateNotice from "@/components/DataStateNotice";
import { StaticStockAnalyzerDataProvider } from "@/features/stock-analyzer/data/static-data-provider";
import { makeDataState } from "@/lib/data-state";
import { useWatchlist } from "@/lib/watchlist";
import { ROUTES } from "@/lib/routes";
import { formatSignedPercent, formatInteger } from "@/lib/format";

interface AnalyzerLite {
  symbol: string;
  companyName: string | null;
  return12m: number | null;
}

let rowsCache: Map<string, AnalyzerLite> | null = null;
let rowsPending: Promise<Map<string, AnalyzerLite> | null> | null = null;
const analyzerProvider = new StaticStockAnalyzerDataProvider();

function loadRows(): Promise<Map<string, AnalyzerLite> | null> {
  if (rowsCache) return Promise.resolve(rowsCache);
  if (rowsPending) return rowsPending;
  rowsPending = analyzerProvider.load()
    .then((records) => {
      const map = new Map<string, AnalyzerLite>();
      for (const row of records) {
        if (!row.symbol) continue;
        map.set(String(row.symbol).toUpperCase(), {
          symbol: row.symbol,
          companyName: row.companyName ?? null,
          return12m: typeof row.return12m === "number" ? row.return12m : null,
        });
      }
      rowsCache = map;
      return map;
    })
    .catch(() => { rowsPending = null; return null; });
  return rowsPending;
}

export default function MyWatchlistStrip() {
  const tickers = useWatchlist();
  const [rows, setRows] = useState<Map<string, AnalyzerLite> | null>(null);
  const [rowsLoaded, setRowsLoaded] = useState(false);

  useEffect(() => {
    if (tickers.length === 0) return;
    let cancelled = false;
    loadRows().then((m) => {
      if (!cancelled) {
        setRows(m);
        setRowsLoaded(true);
      }
    });
    return () => { cancelled = true; };
  }, [tickers.length]);

  if (tickers.length === 0) {
    return (
      <section className="panel wl">
        <div className="panel-h">
          <h2>내 종목</h2>
          <span className="desc num">(0)</span>
          <TransitionLink href={ROUTES.portfolio} className="act">포트폴리오 →</TransitionLink>
        </div>
        <div className="panel-b text-sm font-semibold text-[var(--c-ink-3)]">관심 종목을 추가하면 여기에서 바로 확인할 수 있습니다.</div>
      </section>
    );
  }

  const missingCount = rows ? tickers.filter((ticker) => !rows.has(ticker)).length : 0;
  const watchlistState = makeDataState({
    status: !rowsLoaded ? "pending" : rows ? (missingCount > 0 ? "partial" : "ready") : "error",
    label: !rowsLoaded ? "내 종목 확인 중" : rows ? (missingCount > 0 ? "일부 종목 정보 없음" : "내 종목 준비됨") : "내 종목 오류",
    detail: !rowsLoaded
      ? "관심 종목의 이름과 수익률을 읽고 있습니다."
      : rows
        ? missingCount > 0
          ? `${formatInteger(missingCount)}개 관심 종목은 기본 정보만 표시됩니다.`
          : "관심 종목의 이름과 수익률을 표시할 수 있습니다."
        : "관심 종목 정보를 불러오지 못했습니다.",
  });

  return (
    <section className="panel wl">
      <div className="panel-h">
        <h2>내 종목</h2>
        <span className="desc num">({tickers.length})</span>
        <TransitionLink href={ROUTES.portfolio} className="act">포트폴리오 →</TransitionLink>
      </div>
      {watchlistState.status !== "ready" ? (
        <div className="panel-b">
          <DataStateNotice state={watchlistState} />
        </div>
      ) : null}
      <div className="rows">
        {tickers.map((t) => {
          const row = rows?.get(t) ?? null;
          const ret = row?.return12m ?? null;
          return (
            <div key={t} className="row">
              <span className="av">{t.slice(0, 2)}</span>
              <span>
                <div className="nm"><TickerChip ticker={t} variant="inline" /></div>
                {row?.companyName ? <div className="sub">{row.companyName}</div> : null}
              </span>
              {ret !== null ? (
                <span className={`pc num ${ret >= 0 ? "up" : "down"}`}>
                  {formatSignedPercent(ret, { fraction: true, digits: 1 })}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
