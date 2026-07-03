"use client";

import TransitionLink from "@/components/TransitionLink";
import { CpMeterRow, CpSectionCard } from "@/components/canvas-plus/kit";
import { ROUTES } from "@/lib/routes";
import type { SectorRow, SectorSourceMeta } from "@/lib/sectors/types";

function fmtPct(value: number | null | undefined, digits = 1): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "—";
}

function fmtPp(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${(Math.abs(value) * 100).toFixed(1)}%p`;
}

/**
 * Always visible on both desktop and mobile (no tab gate) — 13F sector
 * positioning is a fourth, differentiated axis, not a repeat of momentum.
 * Brief: _tmp/w5-briefs/brief-sectors.md section D/F.
 */
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

  const quarter = sourceMeta.smartMoneyQuarter ?? "확인 중";
  const cohort = sourceMeta.smartMoneyCohortCount ? ` · ${sourceMeta.smartMoneyCohortCount}인` : "";
  const generated = sourceMeta.smartMoneyGeneratedAt?.slice(0, 10) ?? null;
  const disclaimer = sourceMeta.smartMoneyDisclaimer ?? "13F 공시 기반 장기 보유 포지션만 집계합니다. 공시는 최대 45일 늦게 반영됩니다.";

  return (
    <CpSectionCard
      className={className}
      eyebrow="13F · 기관 보유"
      title="스마트머니 섹터 동향"
      meta={`${quarter}${cohort}`}
      footnote={`${generated ? `${generated} 생성 · ` : ""}${disclaimer}`}
    >
      <div className="cpw5-sectors-card-grid" data-cols="2">
        {smartRows.map(({ row, smart }) => {
          const deltaPositive = (smart.delta4q ?? 0) >= 0;
          return (
            <div key={row.key} className="cpw5-sectors-card">
              <CpMeterRow
                variant="boxed"
                label={`${row.name} · ${row.etf}`}
                value={fmtPct(smart.weight)}
                percent={typeof smart.weight === "number" ? smart.weight * 100 : 0}
              />
              <div className="cpw5-sectors-card__head" style={{ marginTop: 8 }}>
                <span
                  className="cpw5-sectors-bar-relative"
                  data-tone={deltaPositive ? "positive" : "negative"}
                >
                  4Q 증감 {fmtPp(smart.delta4q)}
                </span>
                <span className="cpw5-sectors-bar-absolute">평균 보유 {fmtPct(smart.avgHoldingWeight)}</span>
              </div>
              {smart.topHoldings.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {smart.topHoldings.slice(0, 4).map((holding) => (
                    <span key={holding} className="cpw5-sectors-holding-chip">
                      {holding}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-right">
        <TransitionLink
          href={ROUTES.superinvestors}
          className="text-[11px] font-black text-[var(--cp-accent-strong)] hover:underline"
        >
          투자 대가 보기 →
        </TransitionLink>
      </div>
    </CpSectionCard>
  );
}
