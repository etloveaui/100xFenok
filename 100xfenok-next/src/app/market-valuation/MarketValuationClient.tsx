"use client";

import TransitionLink from "@/components/TransitionLink";
import { useMarketValuation } from "@/hooks/useMarketValuation";
import type { ValuationBand } from "@/lib/market-valuation/types";
import { formatPercent } from "@/lib/dashboard/formatters";

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Map a history percentile to a rich/cheap verdict. */
function valuationMeta(pct: number | null): { label: string; tone: string; dot: string } {
  if (pct === null) return { label: "—", tone: "text-slate-400", dot: "bg-slate-300" };
  if (pct >= 80) return { label: "고평가", tone: "text-rose-600", dot: "bg-rose-500" };
  if (pct >= 60) return { label: "다소 높음", tone: "text-amber-600", dot: "bg-amber-500" };
  if (pct >= 40) return { label: "역사적 중립", tone: "text-slate-600", dot: "bg-slate-400" };
  if (pct >= 20) return { label: "다소 낮음", tone: "text-sky-600", dot: "bg-sky-500" };
  return { label: "저평가", tone: "text-emerald-600", dot: "bg-emerald-500" };
}

function positionPct(value: number | null, min: number | null, max: number | null): number | null {
  if (value === null || min === null || max === null || max === min) return null;
  return Math.min(100, Math.max(0, Math.round(((value - min) / (max - min)) * 100)));
}

function fmt(value: number | null, digits: number): string {
  return value === null ? "—" : value.toFixed(digits);
}

function ValuationRow({ label, band, digits }: { label: string; band: ValuationBand; digits: number }) {
  const meta = valuationMeta(band.percentile);
  const curPos = positionPct(band.current, band.min, band.max);
  const avgPos = positionPct(band.avg, band.min, band.max);
  return (
    <div className="rounded-[1rem] border border-slate-200 bg-white/70 px-3 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">{label}</span>
        <span className="orbitron text-xl font-black text-slate-950">{fmt(band.current, digits)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] font-bold">
        <span className={cx("inline-flex items-center gap-1", meta.tone)}>
          <span className={cx("h-1.5 w-1.5 rounded-full", meta.dot)} />
          {meta.label}
          {band.percentile !== null ? <span className="text-slate-400">· 역사 {band.percentile}%</span> : null}
        </span>
        <span className="tabular-nums text-slate-400">
          {fmt(band.min, digits)} ~ {fmt(band.max, digits)}
        </span>
      </div>
      {/* 16-year band gauge: min ── avg ── max, with current marker */}
      <div className="relative mt-2 h-2 rounded-full bg-gradient-to-r from-emerald-200 via-slate-200 to-rose-200">
        {avgPos !== null ? (
          <span className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-slate-400" style={{ left: `${avgPos}%` }} aria-hidden="true" />
        ) : null}
        {curPos !== null ? (
          <span
            className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow"
            style={{ left: `${curPos}%` }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="mt-1 flex justify-between text-[9px] font-bold uppercase tracking-wider text-slate-300">
        <span>저평가</span>
        <span>avg {fmt(band.avg, digits)}</span>
        <span>고평가</span>
      </div>
    </div>
  );
}

export default function MarketValuationClient() {
  const { indices, dataReady, failed, sourceDate } = useMarketValuation();

  return (
    <main className="container mx-auto max-w-5xl space-y-4 overflow-x-hidden px-3 py-4 sm:px-4 sm:py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-interactive">Market Valuation</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">시장 밸류에이션</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
            주요 미국 지수가 <strong className="text-slate-800">역사적으로 비싼지/싼지</strong>. Fwd P/E·P/B를 16년 밴드와 대조합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sourceDate ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {sourceDate}
            </span>
          ) : null}
          <TransitionLink
            href="/explore"
            className="inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.12em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
          >
            Explore
          </TransitionLink>
        </div>
      </header>

      {failed ? (
        <div className="rounded-[1.2rem] border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
          지수 밸류에이션 데이터를 불러오지 못했습니다.
        </div>
      ) : null}

      <div className={cx("grid gap-4 sm:grid-cols-2", !dataReady && "opacity-60")}>
        {indices.map((index) => (
          <section
            key={index.id}
            className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-5"
          >
            <header className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">{index.nameEn}</p>
                <h2 className="truncate text-lg font-black tracking-tight text-slate-950">{index.name}</h2>
              </div>
              <div className="text-right">
                <p className="orbitron text-lg font-black tabular-nums text-slate-900">
                  {index.price === null ? "—" : index.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{index.date ?? "—"}</p>
              </div>
            </header>

            <div className="mt-3 grid gap-2">
              <ValuationRow label="Fwd P/E" band={index.pe} digits={1} />
              <ValuationRow label="P/B" band={index.pb} digits={2} />
              <div className="flex items-center justify-between rounded-[1rem] border border-slate-200 bg-white/70 px-3 py-2">
                <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">ROE</span>
                <span className="orbitron text-lg font-black tabular-nums text-slate-900">
                  {index.roe === null ? "—" : formatPercent(index.roe * 100, 1)}
                </span>
              </div>
            </div>
          </section>
        ))}
      </div>

      <p className="px-1 text-[11px] text-slate-400">
        역사 밴드 = 2010년 이후 weekly 시계열의 min/avg/max. percentile은 현재값의 역사적 위치(높을수록 고평가). 데이터: Bloomberg benchmarks. 참고용입니다.
      </p>
    </main>
  );
}
