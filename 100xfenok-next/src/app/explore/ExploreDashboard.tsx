"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TransitionLink from "@/components/TransitionLink";
import { sectorLabelKo } from "@/lib/design/sectorMap";
import type { CanonicalSector } from "@/lib/design/sectorMap";

type MomentumMap = Record<string, Record<string, number>>;

const INDEX_CHIPS: Array<{ key: string; label: string }> = [
  { key: "sp500", label: "S&P 500" },
  { key: "nasdaq100", label: "나스닥 100" },
  { key: "russell2000", label: "러셀 2000" },
  { key: "kospi", label: "코스피" },
  { key: "nikkei", label: "니케이" },
  { key: "emerging", label: "이머징" },
];

const SECTOR_KEYS: Array<{ key: string; canonical: CanonicalSector }> = [
  { key: "information_technology", canonical: "Technology" },
  { key: "communication_services", canonical: "Communication Services" },
  { key: "consumer_discretionary", canonical: "Consumer Discretionary" },
  { key: "consumer_staples", canonical: "Consumer Staples" },
  { key: "energy", canonical: "Energy" },
  { key: "financials", canonical: "Financials" },
  { key: "health_care", canonical: "Healthcare" },
  { key: "industrials", canonical: "Industrials" },
  { key: "materials", canonical: "Materials" },
  { key: "real_estate", canonical: "Real Estate" },
  { key: "utilities", canonical: "Utilities" },
];

function pct(v: number | undefined): string {
  if (v === undefined || Number.isNaN(v)) return "—";
  const p = (v * 100).toFixed(1);
  return v >= 0 ? `+${p}%` : `${p}%`;
}

function toneClass(v: number | undefined): string {
  if (v === undefined) return "text-slate-400";
  return v >= 0 ? "text-emerald-700" : "text-rose-700";
}

export default function ExploreDashboard() {
  const router = useRouter();
  const [momentum, setMomentum] = useState<MomentumMap | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/data/benchmarks/summaries.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.momentum) setMomentum(j.momentum as MomentumMap);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const t = query.trim().toUpperCase();
    if (t) router.push(`/stock/${encodeURIComponent(t)}`);
  }

  return (
    <section className="mt-6 space-y-3">
      {/* Ticker jump */}
      <form onSubmit={onSearch} className="flex max-w-md items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="티커로 바로 이동 (예: AAPL, NVDA)"
          aria-label="티커 검색"
          className="min-h-10 w-full rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-brand-interactive"
        />
        <button
          type="submit"
          className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-brand-interactive px-4 text-sm font-black text-white transition hover:opacity-90"
        >
          종목 상세 →
        </button>
      </form>

      {/* Market pulse strip */}
      <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">시장 펄스 · YTD</span>
          {INDEX_CHIPS.map((c) => {
            const v = momentum?.[c.key]?.ytd;
            return (
              <TransitionLink key={c.key} href="/market-valuation" className="group inline-flex items-baseline gap-1.5">
                <span className="text-xs font-bold text-slate-600 group-hover:text-slate-950">{c.label}</span>
                <span className={`orbitron text-xs font-black tabular-nums ${toneClass(v)}`}>
                  {momentum ? pct(v) : "…"}
                </span>
              </TransitionLink>
            );
          })}
        </div>

        {/* Sector heat strip */}
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-11">
          {SECTOR_KEYS.map(({ key, canonical }) => {
            const v = momentum?.[key]?.["1m"];
            const bg =
              v === undefined
                ? "#f1f5f9"
                : v >= 0
                  ? `rgba(5,150,105,${Math.min(0.85, 0.15 + Math.abs(v) * 8)})`
                  : `rgba(225,29,72,${Math.min(0.85, 0.15 + Math.abs(v) * 8)})`;
            const strong = v !== undefined && Math.abs(v) * 8 + 0.15 > 0.45;
            return (
              <TransitionLink
                key={key}
                href="/sectors"
                className="rounded-lg px-2 py-1.5 text-center transition hover:opacity-80"
                style={{ backgroundColor: bg }}
                title={`${sectorLabelKo(canonical)} 1개월 ${pct(v)}`}
              >
                <span className="block truncate text-[10px] font-black" style={{ color: strong ? "#ffffff" : "#0f172a" }}>
                  {sectorLabelKo(canonical)}
                </span>
                <span className="orbitron block text-[10px] font-bold tabular-nums" style={{ color: strong ? "#ffffff" : "#334155" }}>
                  {momentum ? pct(v) : "…"}
                </span>
              </TransitionLink>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] font-semibold text-slate-400">섹터 = 최근 1개월 수익률 · 클릭 시 섹터 히트맵</p>
      </div>
    </section>
  );
}
