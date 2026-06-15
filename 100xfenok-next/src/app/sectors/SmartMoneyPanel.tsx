"use client";

import { useEffect, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { CANONICAL_SECTORS, sectorLabelKo } from "@/lib/design/sectorMap";
import type { CanonicalSector } from "@/lib/design/sectorMap";

type SectorHistory = { quarters: string[]; series: Record<string, number[]> };

const canonicalSectorSet = new Set<string>(CANONICAL_SECTORS);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sectorDisplayLabel(sector: string): string {
  if (canonicalSectorSet.has(sector)) {
    return sectorLabelKo(sector as CanonicalSector);
  }
  return sector || "기타";
}

function normalizeSectorHistory(value: unknown): SectorHistory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<SectorHistory>;
  if (!Array.isArray(raw.quarters) || !raw.series || typeof raw.series !== "object" || Array.isArray(raw.series)) {
    return null;
  }
  const series: Record<string, number[]> = {};
  for (const [sector, values] of Object.entries(raw.series)) {
    if (typeof sector !== "string" || !Array.isArray(values)) continue;
    const nums = values.filter(isFiniteNumber);
    if (nums.length > 0) series[sector] = nums;
  }
  return raw.quarters.length > 0 && Object.keys(series).length > 0 ? { quarters: raw.quarters, series } : null;
}

export default function SmartMoneyPanel() {
  const [hist, setHist] = useState<SectorHistory | null>(null);
  const [quarter, setQuarter] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/sec-13f/analytics/portfolio_views.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        const next = normalizeSectorHistory(j?.total?.sector_history);
        if (!next) return;
        setHist(next);
        setQuarter(j.metadata?.quarter ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!hist) return null;

  const n = hist.quarters.length;
  if (n === 0) return null;
  const backIdx = Math.max(0, n - 5); // ~4 quarters back
  const rows = Object.entries(hist.series)
    .filter(([, arr]) => arr.length > 0)
    .map(([sector, arr]) => ({
      sector,
      now: arr[n - 1] ?? 0,
      delta: (arr[n - 1] ?? 0) - (arr[backIdx] ?? 0),
    }))
    .filter((r) => r.now >= 0.005)
    .sort((a, b) => b.now - a.now);

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-black tracking-tight text-slate-950">스마트머니 섹터 동향</h2>
        <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-violet-700">
          구루 30인 13F · {quarter ?? "—"}
        </span>
        <TransitionLink href="/superinvestors" className="ml-auto text-[11px] font-black text-brand-interactive hover:underline">
          구루 보기 →
        </TransitionLink>
      </div>
      <p className="mt-1 text-[10px] font-semibold text-slate-400">
        슈퍼인베스터 합산 포트폴리오의 섹터 비중과 최근 1년(4분기) 변화 — 13F 공시는 45일 지연
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {rows.map((r) => (
          <div key={r.sector} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="truncate text-[10px] font-black text-slate-500">
              {sectorDisplayLabel(r.sector)}
            </p>
            <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
              <span className="orbitron shrink-0 text-sm font-black tabular-nums text-slate-950">
                {(r.now * 100).toFixed(1)}%
              </span>
              <span
                className={`orbitron shrink-0 text-[10px] font-bold tabular-nums ${
                  r.delta >= 0 ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                {r.delta >= 0 ? "▲" : "▼"} {(Math.abs(r.delta) * 100).toFixed(1)}%p
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
