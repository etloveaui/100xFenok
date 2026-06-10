"use client";

import { useEffect, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { resolveSector, sectorColor, sectorLabelKo } from "@/lib/design/sectorMap";
import { bandPct, bandClass } from "@/lib/screener/bands";
import { useStockDetail, use13FData, StockDetailBody } from "@/app/screener/StockDetailPanel";

// ---------------------------------------------------------------------------
// stocks_analyzer.json module-level cache
// ---------------------------------------------------------------------------

interface AnalyzerRow {
  symbol: string;
  companyName: string;
  sector: string;
  price: number;
  marketCap: number;
  per: number;
  perBandCurrent: number;
  perBandMin: number;
  perBandAvg: number;
  perBandMax: number;
  return12m: number;
  growthRate: number;
}

let analyzerCache: Record<string, AnalyzerRow> | null = null;
let analyzerPromise: Promise<Record<string, AnalyzerRow> | null> | null = null;

function loadAnalyzer(): Promise<Record<string, AnalyzerRow> | null> {
  if (analyzerCache) return Promise.resolve(analyzerCache);
  if (analyzerPromise) return analyzerPromise;
  analyzerPromise = fetch("/data/global-scouter/core/stocks_analyzer.json")
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      const map: Record<string, AnalyzerRow> = {};
      for (const row of (data as { data: AnalyzerRow[] }).data ?? []) {
        map[row.symbol] = row;
      }
      analyzerCache = map;
      return map;
    })
    .catch(() => {
      analyzerPromise = null;
      return null;
    });
  return analyzerPromise;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPrice(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtMcap(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}T`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}B`;
  return `$${n.toFixed(0)}M`;
}

function fmtPct(n: number): string {
  const pct = n * 100;
  return pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
}

function perBandPositionText(current: number, min: number, max: number): string {
  const pct = bandPct(current, min, max);
  return `${(pct * 100).toFixed(0)}%`;
}

function perBandPositionColor(current: number, min: number, max: number): string {
  const cls = bandClass(bandPct(current, min, max));
  return cls === "emerald" ? "text-emerald-700 bg-emerald-50" : cls === "rose" ? "text-rose-700 bg-rose-50" : "text-slate-700 bg-slate-50";
}

// ---------------------------------------------------------------------------
// StockDetailClient
// ---------------------------------------------------------------------------

export default function StockDetailClient({ ticker }: { ticker: string }) {
  const { detail, loading: detailLoading } = useStockDetail(ticker);
  const f13Entries = use13FData(ticker);
  const [row, setRow] = useState<AnalyzerRow | null | undefined>(undefined);
  // stocks_analyzer sector is the Korean scouter taxonomy — pass as 2nd arg.
  const canonical = row ? resolveSector(null, row.sector) : null;

  useEffect(() => {
    let cancelled = false;
    loadAnalyzer().then((map) => {
      if (cancelled) return;
      setRow(map?.[ticker] ?? null);
    });
    return () => { cancelled = true; };
  }, [ticker]);

  const rowLoading = row === undefined;

  // Unknown ticker
  if (!rowLoading && !row) {
    return (
      <main className="container mx-auto max-w-4xl px-3 py-8 sm:px-4 sm:py-12">
        <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
          <p className="text-lg font-black text-slate-700">해당 티커를 찾을 수 없습니다</p>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            {ticker.toUpperCase()} — stocks_analyzer.json에 존재하지 않는 티커입니다.
          </p>
          <TransitionLink
            href="/screener"
            className="mt-4 inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
          >
            ← 스크리너에서 보기
          </TransitionLink>
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-4xl space-y-6 px-3 py-6 sm:px-4 sm:py-8">
      {/* Header */}
      <header className="space-y-3">
        {/* Breadcrumb + tag */}
        <div className="flex flex-wrap items-center gap-2">
          <TransitionLink
            href="/screener"
            className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive"
          >
            ← 스크리너에서 보기
          </TransitionLink>
        </div>

        {/* Title row */}
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
            {row ? row.companyName : "..."}
          </h1>
          <span className="orbitron text-xl font-black text-slate-400 sm:text-2xl">{ticker.toUpperCase()}</span>
          {canonical && !rowLoading ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: sectorColor(canonical) }}
              />
              {sectorLabelKo(canonical)}
            </span>
          ) : null}
        </div>

        {/* Key badges */}
        {row && !rowLoading ? (
          <div className="flex flex-wrap gap-2">
            <Badge label="현재가" value={fmtPrice(row.price)} />
            <Badge label="시가총액" value={fmtMcap(row.marketCap)} />
            <Badge label="PER" value={row.per.toFixed(1)} />
            {row.perBandCurrent > 0 ? (
              <Badge
                label="PER 밴드"
                value={perBandPositionText(row.perBandCurrent, row.perBandMin, row.perBandMax)}
                className={perBandPositionColor(row.perBandCurrent, row.perBandMin, row.perBandMax)}
              />
            ) : null}
            <Badge label="12개월 수익률" value={fmtPct(row.return12m)} />
            <TransitionLink
              href="/superinvestors"
              className="inline-flex min-h-7 items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 text-[10px] font-black uppercase tracking-[0.1em] text-amber-700 transition hover:border-brand-interactive hover:text-brand-interactive"
            >
              구루 보유 보기
            </TransitionLink>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-8 w-24 rounded-lg bg-slate-200" />
            ))}
          </div>
        )}
      </header>

      {/* Body */}
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-5">
        {detailLoading ? (
          <div className="space-y-4 py-8 text-center">
            <div className="mx-auto h-5 w-1/3 rounded bg-slate-200" />
            <div className="mx-auto h-4 w-1/2 rounded bg-slate-200" />
            <div className="mx-auto h-4 w-2/3 rounded bg-slate-200" />
          </div>
        ) : detail ? (
          <StockDetailBody detail={detail} f13Entries={f13Entries} />
        ) : (
          <div className="py-8 text-center">
            <p className="text-sm font-black text-slate-700">상세 데이터를 불러올 수 없습니다</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              /data/global-scouter/stocks/detail/{ticker}.json 을 확인해 주세요.
            </p>
          </div>
        )}
      </section>

      {/* Footer links */}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <TransitionLink
          href={`/screener?ticker=${encodeURIComponent(ticker)}`}
          className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive"
        >
          ← 스크리너에서 보기
        </TransitionLink>
        <TransitionLink
          href="/superinvestors"
          className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive"
        >
          구루 보유 보기
        </TransitionLink>
      </footer>
    </main>
  );
}

function Badge({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 ${className ?? "bg-slate-50"}`}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-500">{label}</span>
      <span className="orbitron tabular-nums text-xs font-black text-slate-900">{value}</span>
    </div>
  );
}
