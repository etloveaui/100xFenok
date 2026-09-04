"use client";

import { Bar, EvidenceRail, Panel, PanelHeader } from "@/components/ui";
import { formatAsOf, isStaleAsOf } from "@/lib/data-state";
import type { SectorRow } from "@/lib/sectors/types";

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export default function ValuationBandPanel({
  rows,
  loading,
  ready,
  failed,
  stale,
  clock,
  source,
  coverage,
  lkgClock,
  onRetry,
}: {
  rows: SectorRow[];
  loading: boolean;
  ready: boolean;
  failed: boolean;
  stale: boolean;
  clock: string | null;
  source: string | null;
  coverage: string;
  lkgClock: string | null;
  onRetry: () => void;
}) {
  const bandCount = ready ? rows.filter((row) => finiteNumber(row.valuation?.peBand?.percentile)).length : 0;
  const empty = !loading && (!ready || rows.length === 0);
  const asOfLabel = formatAsOf(clock) ?? "—";
  // A valuation band is a quarterly fixture, not a fresh quote — a complete
  // band set renders the dc-specified fixed rail, never fresh.
  const incomplete = ready && bandCount < rows.length;
  const clockStale = isStaleAsOf(clock);

  return (
    <Panel
      loading={loading}
      empty={empty}
      emptyReason={failed || !ready ? "밸류에이션 밴드 자료를 불러오지 못했습니다" : "표시할 밴드 자료가 없습니다"}
      emptyNextRefresh="다음 분기 갱신"
      emptyActionLabel={failed || !ready ? "다시 시도" : undefined}
      onEmptyAction={failed || !ready ? onRetry : undefined}
      stale={stale || clockStale}
      asOf={clock ?? undefined}
      onRetry={stale || clockStale ? onRetry : undefined}
    >
      {ready && rows.length > 0 && (
        <div data-sectors-valuation-bands="true">
          <PanelHeader
            eyebrow="Valuation"
            title="밸류에이션 밴드"
            right={<span className="sec-head-note">Fwd P/E 5년 밴드</span>}
          />
          <div className="sec-band-head" aria-hidden="true">
            <span>섹터</span>
            <span className="sec-band-head-num">Fwd P/E</span>
            <span>밴드 위치</span>
            <span className="sec-band-head-num">백분위</span>
          </div>
          {rows.map((row) => {
            const band = row.valuation?.peBand ?? null;
            const pe = row.valuation?.pe ?? null;
            const percentile = band && finiteNumber(band.percentile) ? Math.max(0, Math.min(100, band.percentile * 100)) : null;
            return (
              <div key={row.key} className="sec-band-row" data-sectors-band-row={row.etf}>
                <span className="sec-band-name">
                  {row.name} <span className="sec-ticker">{row.etf}</span>
                </span>
                <span className="sec-band-pe tabular-nums">{finiteNumber(pe) ? `${pe.toFixed(1)}배` : "—"}</span>
                {percentile !== null ? (
                  <Bar
                    value={percentile}
                    className={percentile >= 50 ? "sec-bar-down" : "sec-bar-up"}
                    aria-label={`${row.name} 밴드 위치 ${Math.round(percentile)}`}
                  />
                ) : (
                  <span className="sec-band-missing">밴드 -</span>
                )}
                <span className="sec-band-pct tabular-nums">{percentile !== null ? Math.round(percentile) : "—"}</span>
              </div>
            );
          })}
        </div>
      )}
      <EvidenceRail
        freshness={loading ? "pending" : failed || !ready ? "error" : stale || clockStale ? "stale" : incomplete ? "partial" : "fixed"}
        source={source ?? "밸류에이션 자료"}
        asOf={asOfLabel}
        coverage={coverage}
        lkgAsOf={(stale || clockStale) && lkgClock ? (formatAsOf(lkgClock) ?? lkgClock) : undefined}
        onRetry={failed || !ready || stale || clockStale || incomplete ? onRetry : undefined}
        onEvidence={ready && !failed ? () => window.open("/data/benchmarks/us_sectors.json", "_blank", "noopener") : undefined}
      />
    </Panel>
  );
}
