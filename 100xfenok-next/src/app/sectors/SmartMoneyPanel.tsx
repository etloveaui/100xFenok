"use client";

import TransitionLink from "@/components/TransitionLink";
import { EmptyState, EvidenceRail, Panel, PanelHeader, Pill } from "@/components/ui";
import { ROUTES } from "@/lib/routes";
import { formatAsOf } from "@/lib/data-state";
import type { SectorRow, SectorSourceMeta } from "@/lib/sectors/types";

function fmtPct(value: number | null | undefined, digits = 1): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "—";
}

function fmtPp(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${(Math.abs(value) * 100).toFixed(1)}%p`;
}

function openEvidence(path: string) {
  window.open(path, "_blank", "noopener");
}

export default function SmartMoneyPanel({
  rows,
  sourceMeta,
  loading,
  ready,
  failed,
  stale,
  asOf,
  coverage,
  onRetry,
  className,
}: {
  rows: SectorRow[];
  sourceMeta: SectorSourceMeta;
  loading: boolean;
  ready: boolean;
  failed: boolean;
  stale: boolean;
  asOf: string | null;
  coverage: string;
  onRetry: () => void;
  className?: string;
}) {
  const smartRows = (ready ? rows : [])
    .filter((row) => row.smartMoney)
    .map((row) => ({ row, smart: row.smartMoney! }))
    .sort((a, b) => (b.smart.weight ?? -Infinity) - (a.smart.weight ?? -Infinity));

  const empty = !loading && (!ready || smartRows.length === 0);
  const quarter = sourceMeta.smartMoneyQuarter ?? "확인 중";
  const cohort = sourceMeta.smartMoneyCohortCount ? ` · ${sourceMeta.smartMoneyCohortCount}인` : "";
  const asOfLabel = formatAsOf(asOf) ?? "—";

  return (
    <Panel
      className={className ?? ""}
      loading={loading}
      empty={empty}
      emptyReason={failed || !ready ? "13F 기관 보유 데이터를 불러오지 못했습니다" : "표시할 섹터 보유 집계가 없습니다"}
      emptyNextRefresh="분기 종료 후 최대 45일"
      emptyActionLabel={failed || !ready ? "다시 시도" : undefined}
      onEmptyAction={failed || !ready ? onRetry : undefined}
      stale={stale}
      asOf={asOf ?? undefined}
      onRetry={stale ? onRetry : undefined}
    >
      {ready && smartRows.length > 0 && (
        <div data-sectors-smart-money>
          <PanelHeader
            eyebrow="13F · 기관 보유"
            title="스마트머니 섹터 동향"
            right={<span className="sec-head-note">{quarter}{cohort}</span>}
          />
          <div className="sec-smart-grid">
            {smartRows.map(({ row, smart }) => {
              const delta = smart.delta4q;
              const deltaTone = typeof delta === "number" && Number.isFinite(delta)
                ? delta >= 0 ? "up" as const : "down" as const
                : null;
              return (
                <div key={row.key} className="sec-smart-cell" data-sectors-smart-row={row.etf}>
                  <div className="sec-smart-top">
                    <span className="sec-smart-name">
                      {row.name} <span className="sec-ticker">{row.etf}</span>
                    </span>
                    <span className="sec-smart-delta">
                      4Q 증감{" "}
                      <span className={deltaTone === "up" ? "sec-up tabular-nums" : deltaTone === "down" ? "sec-down tabular-nums" : "sec-mute tabular-nums"}>
                        {fmtPp(delta)}
                      </span>
                    </span>
                  </div>
                  <div className="sec-smart-bottom">
                    <span className="sec-smart-avg">평균 보유 <span className="tabular-nums">{fmtPct(smart.avgHoldingWeight)}</span></span>
                    {smart.topHoldings.length > 0 ? (
                      <span className="sec-smart-holdings">
                        {smart.topHoldings.slice(0, 3).map((holding) => (
                          <Pill key={holding} className="sec-ticker">{holding}</Pill>
                        ))}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="sec-smart-more">
            <TransitionLink href={ROUTES.superinvestors} className="sec-more-link">
              투자 대가 보기 →
            </TransitionLink>
          </div>
        </div>
      )}
      {ready && smartRows.length === 0 && (
        <EmptyState reason="표시할 섹터 보유 집계가 없습니다" nextRefresh="분기 종료 후 최대 45일" />
      )}
      <EvidenceRail
        // 13F resolves to a quarter-end clock, which always exceeds the fresh
        // window — a present cohort therefore renders the dc-specified 대기
        // (amber) rail with the 45-day filing note, never fresh.
        freshness={loading ? "pending" : failed || !ready ? "error" : "stale"}
        source="SEC EDGAR 13F"
        asOf={asOfLabel}
        coverage={coverage}
        next="분기 종료 후 최대 45일"
        onRetry={failed || !ready || stale ? onRetry : undefined}
        onEvidence={ready && !failed ? () => openEvidence("/data/sec-13f/analytics/portfolio_views.json") : undefined}
      />
    </Panel>
  );
}
