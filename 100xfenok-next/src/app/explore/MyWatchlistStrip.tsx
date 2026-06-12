"use client";

import { useEffect, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { useWatchlist } from "@/lib/watchlist";

interface AnalyzerLite {
  symbol: string;
  companyName: string | null;
  return12m: number | null;
}

let rowsCache: Map<string, AnalyzerLite> | null = null;
let rowsPending: Promise<Map<string, AnalyzerLite> | null> | null = null;
function loadRows(): Promise<Map<string, AnalyzerLite> | null> {
  if (rowsCache) return Promise.resolve(rowsCache);
  if (rowsPending) return rowsPending;
  rowsPending = fetch("/data/global-scouter/core/stocks_analyzer.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((doc) => {
      if (!doc?.data) return null;
      const map = new Map<string, AnalyzerLite>();
      for (const row of doc.data) {
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

  useEffect(() => {
    if (tickers.length === 0) return;
    let cancelled = false;
    loadRows().then((m) => { if (!cancelled) setRows(m); });
    return () => { cancelled = true; };
  }, [tickers.length]);

  if (tickers.length === 0) {
    return (
      <section className="panel wl">
        <div className="panel-h">
          <h2>내 종목</h2>
          <span className="desc num">(0)</span>
          <TransitionLink href="/portfolio" className="act">포트폴리오 →</TransitionLink>
        </div>
        <div className="panel-b text-sm font-semibold text-slate-500">관심 종목을 추가하면 여기에서 바로 확인할 수 있습니다.</div>
      </section>
    );
  }

  return (
    <section className="panel wl">
      <div className="panel-h">
        <h2>내 종목</h2>
        <span className="desc num">({tickers.length})</span>
        <TransitionLink href="/portfolio" className="act">포트폴리오 →</TransitionLink>
      </div>
      <div className="rows">
        {tickers.map((t) => {
          const row = rows?.get(t) ?? null;
          const ret = row?.return12m ?? null;
          return (
            <TransitionLink key={t} href={`/stock/${encodeURIComponent(t)}`} className="row">
              <span className="av">{t.slice(0, 2)}</span>
              <span>
                <div className="nm">{t}</div>
                {row?.companyName ? <div className="sub">{row.companyName}</div> : null}
              </span>
              {ret !== null ? (
                <span className={`pc num ${ret >= 0 ? "up" : "down"}`}>
                  {ret >= 0 ? "+" : ""}{(ret * 100).toFixed(1)}%
                </span>
              ) : null}
            </TransitionLink>
          );
        })}
      </div>
    </section>
  );
}
