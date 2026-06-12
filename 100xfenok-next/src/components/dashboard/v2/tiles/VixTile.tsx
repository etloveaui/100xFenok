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
 * V2 VIX — actual VIX history sparkline + delta chip.
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
  const pts = dashboard.vixHistory.map((point) => point.value);
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const path = pts.length >= 2
    ? pts
        .map(
          (p, i) =>
            `${(i / (pts.length - 1)) * 100},${100 - ((p - min) / (max - min || 1)) * 70 - 15}`,
        )
        .join(" ")
    : "";
  const latestHistory = dashboard.vixHistory[dashboard.vixHistory.length - 1] ?? null;

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
        {path ? (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ width: 90, height: 50 }}
            role="img"
            aria-label={`최근 VIX 실제 추이 · 최신 ${latestHistory?.date ?? "—"} ${dashboard.vixValue.toFixed(1)} · 범위 ${min.toFixed(1)}~${max.toFixed(1)}`}
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
        ) : null}
      </div>
    </TileShell>
  );
}
