"use client";

import TransitionLink from "@/components/TransitionLink";
import type { SectorRow, SectorSourceMeta } from "@/lib/sectors/types";

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function fmtPct(value: number | null | undefined, digits = 1): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "—";
}

function fmtPp(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "▲" : "▼";
  return `${sign} ${(Math.abs(value) * 100).toFixed(1)}%p`;
}

export default function SmartMoneyPanel({
  rows,
  sourceMeta,
  className,
}: {
  rows: SectorRow[];
  sourceMeta: SectorSourceMeta;
  className?: string;
}) {
  const smartRows = rows
    .filter((row) => row.smartMoney)
    .map((row) => ({ row, smart: row.smartMoney! }))
    .sort((a, b) => (b.smart.weight ?? -Infinity) - (a.smart.weight ?? -Infinity));

  if (smartRows.length === 0) return null;

  const quarter = sourceMeta.smartMoneyQuarter ?? "—";
  const cohort = sourceMeta.smartMoneyCohortCount ? ` · ${sourceMeta.smartMoneyCohortCount}인` : "";
  const generated = sourceMeta.smartMoneyGeneratedAt?.slice(0, 10) ?? null;

  return (
    <section className={cx("rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-black tracking-tight text-slate-950">스마트머니 섹터 동향</h2>
        <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-violet-700">
          13F {quarter}{cohort}
        </span>
        <TransitionLink href="/superinvestors" className="ml-auto text-[11px] font-black text-brand-interactive hover:underline">
          구루 보기 →
        </TransitionLink>
      </div>
      <p className="mt-1 text-[10px] font-semibold text-slate-400">
        {generated ? `${generated} 생성 · ` : ""}{sourceMeta.smartMoneyDisclaimer ?? "13F 장기 보유 포지션 기준 섹터 비중"}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {smartRows.map(({ row, smart }) => (
          <div key={row.key} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <p className="min-w-0 truncate text-[11px] font-black text-slate-600">
                {row.name}
                <span className="ml-1 text-slate-400">{row.etf}</span>
              </p>
              <span
                className={cx(
                  "orbitron shrink-0 text-[10px] font-bold tabular-nums",
                  (smart.delta4q ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700",
                )}
              >
                {fmtPp(smart.delta4q)}
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="orbitron text-base font-black tabular-nums text-slate-950">{fmtPct(smart.weight)}</span>
              <span className="text-[10px] font-bold text-slate-400">
                평균 보유 {fmtPct(smart.avgHoldingWeight)}
              </span>
            </div>
            {smart.topHoldings.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {smart.topHoldings.slice(0, 4).map((holding) => (
                  <span key={holding} className="max-w-full truncate rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                    {holding}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
