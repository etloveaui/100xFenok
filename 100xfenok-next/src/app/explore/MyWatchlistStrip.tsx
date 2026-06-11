"use client";

import { useEffect, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { useWatchlist } from "@/lib/watchlist";

/** "내 종목" strip — watchlist chips with 12m return context (Wave C P-1). */

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

  if (tickers.length === 0) return null;

  return (
    <div className="rounded-[1.2rem] border border-amber-200/70 bg-amber-50/40 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-black uppercase tracking-[0.1em] text-amber-600">
          <i className="fas fa-star mr-1" aria-hidden="true" />내 종목 ({tickers.length})
        </p>
        <TransitionLink href="/portfolio" className="text-[10px] font-black text-slate-400 hover:text-brand-interactive">
          포트폴리오 →
        </TransitionLink>
      </div>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {tickers.map((t) => {
          const row = rows?.get(t) ?? null;
          const ret = row?.return12m ?? null;
          return (
            <TransitionLink
              key={t}
              href={`/stock/${encodeURIComponent(t)}`}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 transition hover:border-brand-interactive"
            >
              <span className="text-[11px] font-black text-slate-800">{t}</span>
              {ret !== null ? (
                // return12m is a fraction (0.53 = +53%)
                <span className={`orbitron tabular-nums text-[10px] font-bold ${ret >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                  {ret >= 0 ? "+" : ""}{(ret * 100).toFixed(1)}%
                </span>
              ) : null}
            </TransitionLink>
          );
        })}
      </div>
    </div>
  );
}
