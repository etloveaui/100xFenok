"use client";

import TileShell from "../TileShell";
import type { V2Freshness } from "../types";
import type { DashboardFreshnessMap, DashboardSnapshot } from "@/lib/dashboard/types";
import TraceableNumber, {
  metaFromFreshness,
  type TraceableMode,
} from "@/components/dashboard/v4/TraceableNumber";

function colorFor(value: number) {
  if (value >= 1.5) return { bg: "color-mix(in srgb, var(--c-up) 28%, transparent)", fg: "var(--c-up)" };
  if (value >= 0.5) return { bg: "color-mix(in srgb, var(--c-up) 16%, transparent)", fg: "var(--c-up)" };
  if (value >= 0) return { bg: "color-mix(in srgb, var(--c-up) 8%, transparent)", fg: "var(--hp-ink-2)" };
  if (value > -0.5) return { bg: "color-mix(in srgb, var(--c-down) 8%, transparent)", fg: "var(--hp-ink-2)" };
  if (value > -1.5) return { bg: "color-mix(in srgb, var(--c-down) 16%, transparent)", fg: "var(--c-down)" };
  return { bg: "color-mix(in srgb, var(--c-down) 28%, transparent)", fg: "var(--c-down)" };
}

/**
 * V2 Breadth — AUDIT P1 fix: 11-sector mini-heatmap replaces the V1
 * up/down count pills. Tone color encodes magnitude; grid responsive.
 */
export default function BreadthHeatmapTile({
  dashboard,
  freshness,
  muted,
  traceMode,
  freshnessMap,
}: {
  dashboard: DashboardSnapshot;
  freshness: V2Freshness;
  muted: boolean;
  traceMode?: TraceableMode;
  freshnessMap?: DashboardFreshnessMap;
}) {
  const cells = dashboard.sectorRows
    .slice(0, 11)
    .map((sector) => ({ key: sector.etf, value: sector.displayChange }));
  while (cells.length < 11) {
    cells.push({ key: `—${cells.length}`, value: 0 });
  }

  return (
    <TileShell
      kicker="Breadth"
      title="Sectors"
      freshness={freshness}
      span="wide"
      muted={muted}
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <span className="hp-breadth-pill hp-breadth-pill--up">
          <span className="hp-dot" style={{ background: "var(--c-up)" }} aria-hidden="true" />
          상승{" "}
          <TraceableNumber
            mode={traceMode}
            meta={
              traceMode && freshnessMap
                ? metaFromFreshness(
                    freshnessMap.benchmarks ?? freshnessMap["ticker:XLK"],
                    dashboard.sectorUp,
                    {
                      sourceKey: "benchmarks",
                      note: `${dashboard.sectorRows.length}개 섹터 ETF 일일 변동률 집계 (mode: ${dashboard.sectorMode})`,
                    },
                  )
                : undefined
            }
          >
            {dashboard.sectorUp}
          </TraceableNumber>
        </span>
        <span className="hp-breadth-pill hp-breadth-pill--down">
          <span className="hp-dot" style={{ background: "var(--c-down)" }} aria-hidden="true" />
          하락 {dashboard.sectorDown}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gap: 4,
        }}
      >
        {cells.map((cell) => {
          const c = colorFor(cell.value);
          return (
            <div
              key={cell.key}
              style={{
                background: c.bg,
                color: c.fg,
                padding: "6px 4px",
                borderRadius: 6,
                textAlign: "center",
                border: "1px solid var(--hp-stroke)",
                minHeight: 42,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 2,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--hp-ink-3)",
                  letterSpacing: "0.02em",
                }}
              >
                {cell.key}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 900,
                  fontSize: 13,
                }}
              >
                {cell.value >= 0 ? "+" : ""}
                {cell.value.toFixed(1)}
              </div>
            </div>
          );
        })}
      </div>
    </TileShell>
  );
}
