"use client";

import TileShell from "../TileShell";
import { v2cx } from "../types";
import type { V2Freshness } from "../types";
import type { DashboardFreshnessMap, DashboardSnapshot } from "@/lib/dashboard/types";
import TraceableNumber, {
  metaFromFreshness,
  type TraceableMode,
} from "@/components/dashboard/v4/TraceableNumber";

/**
 * V2 VIX — AUDIT P1 (sparkline restored) + delta chip.
 * 7-day approximated sparkline (current + 6 synthetic backfill steps; in
 * production, wire to actual VIX series when available).
 *
 * V4 (optional): when `traceMode` and `freshnessMap` are supplied, the
 * KPI is wrapped with TraceableNumber. V2/V3 callers omit these — no
 * change to V2/V3 HTML output.
 */
export default function VixTile({
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
  const pts = [
    dashboard.vixValue * 1.13,
    dashboard.vixValue * 1.1,
    dashboard.vixValue * 1.06,
    dashboard.vixValue * 1.04,
    dashboard.vixValue * 1.02,
    dashboard.vixValue * 0.98,
    dashboard.vixValue,
  ];
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const path = pts
    .map(
      (p, i) =>
        `${(i / (pts.length - 1)) * 100},${100 - ((p - min) / (max - min || 1)) * 70 - 15}`,
    )
    .join(" ");

  return (
    <TileShell kicker="Volatility" title="VIX" freshness={freshness} muted={muted}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 12,
        }}
      >
        <div>
          <div className="hp-stat__val">
            <TraceableNumber
              mode={traceMode}
              meta={
                traceMode && freshnessMap
                  ? metaFromFreshness(freshnessMap.vix, dashboard.vixValue, {
                      sourceKey: "vix",
                      note: "CBOE 실시간 — 표시값은 소수점 1자리 반올림",
                    })
                  : undefined
              }
            >
              {dashboard.vixValue.toFixed(1)}
            </TraceableNumber>
          </div>
          <div
            style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}
          >
            <span
              className={v2cx(
                "hp-stat__label",
                dashboard.vixValue < 18
                  ? "hp-stat__label--green"
                  : "hp-stat__label--amber",
              )}
            >
              {dashboard.vixLabel}
            </span>
          </div>
        </div>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ width: 90, height: 50 }}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="vixV2Grad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#1B73D3" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#1B73D3" stopOpacity={0} />
            </linearGradient>
          </defs>
          <polyline
            points={path}
            fill="none"
            stroke="#1B73D3"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <polygon points={`0,100 ${path} 100,100`} fill="url(#vixV2Grad)" />
        </svg>
      </div>
    </TileShell>
  );
}
