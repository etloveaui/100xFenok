"use client";

import TileShell from "../TileShell";
import { v2cx } from "../types";
import type { V2Freshness, V2RegimeAxis } from "../types";
import type { DashboardFreshnessMap, DashboardSnapshot } from "@/lib/dashboard/types";
import { formatSignedBillions } from "@/lib/dashboard/formatters";
import TraceableNumber, {
  metaFromFreshness,
  type TraceableMode,
} from "@/components/dashboard/v4/TraceableNumber";
import RegimeSparkline from "@/components/dashboard/v4/RegimeSparkline";

function axisBg(index: number, tone: V2RegimeAxis["tone"]) {
  if (tone === "down") return "linear-gradient(to right,var(--c-down),var(--c-warn))";
  if (index === 0) return "linear-gradient(to right,var(--c-up),var(--c-info))";
  if (index === 1) return "linear-gradient(to right,var(--c-info),var(--c-brand))";
  return "linear-gradient(to right,var(--c-warn),var(--c-down))";
}

function gaugeClass(regimeClass: string) {
  if (regimeClass === "is-risk-on") return "hp-regime__gauge--risk-on";
  if (regimeClass === "is-risk-off") return "hp-regime__gauge--risk-off";
  return "hp-regime__gauge--neutral";
}

/**
 * Hero "Market Pulse" tile (V2 Regime, AUDIT P0+P1).
 * Confidence + delta chip · 3-axis bars with detail · 3초 / 30초 summary.
 */
export default function MarketPulseTile({
  dashboard,
  regimeLabel,
  regimeClass,
  regimeConfidence,
  regimeAxes,
  freshness,
  muted,
  traceMode,
  freshnessMap,
  showSparkline,
  sparklineRefreshKey,
}: {
  dashboard: DashboardSnapshot;
  regimeLabel: string;
  regimeClass: string;
  regimeConfidence: number;
  regimeAxes: V2RegimeAxis[];
  freshness: V2Freshness;
  muted: boolean;
  /** V4 — wrap confidence KPI in TraceableNumber. */
  traceMode?: TraceableMode;
  freshnessMap?: DashboardFreshnessMap;
  /** V4 — render the 200x40 RegimeSparkline above the 3-axis bars. */
  showSparkline?: boolean;
  /** V4 — bump to force RegimeSparkline to re-read sessionStorage. */
  sparklineRefreshKey?: number | string;
}) {
  return (
    <TileShell
      kicker="Market Regime"
      title={regimeLabel}
      freshness={freshness}
      span="hero"
      muted={muted}
      action={
        <button type="button" className="hp-btn hp-btn--pill">
          상세 리포트 →
        </button>
      }
    >
      <div className="hp-regime">
        <div className={v2cx("hp-regime__gauge", gaugeClass(regimeClass))}>
          <div>
            <div className="hp-kicker">판정 신뢰도</div>
            <div
              className="hp-num-xl"
              style={{ marginTop: 6, fontSize: 44 }}
            >
              <TraceableNumber
                mode={traceMode}
                meta={
                  traceMode && freshnessMap
                    ? metaFromFreshness(
                        freshnessMap.sentiment ?? freshnessMap.benchmarks,
                        regimeConfidence,
                        {
                          sourceKey: "regime",
                          note: "심리·확산·안정 3축 가중 합산 (V1 page.tsx 알고리즘 기준)",
                        },
                      )
                    : undefined
                }
              >
                {regimeConfidence}%
              </TraceableNumber>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--hp-ink-3)",
                marginTop: 4,
              }}
            >
              3축 합의 기준
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <div
              className="hp-chip"
              style={{
                background: "var(--hp-tile-bg-softer)",
                color: "var(--hp-ink-2)",
                borderColor: "var(--hp-stroke)",
              }}
            >
              {regimeClass === "is-risk-off" ? "▼" : "▲"} {regimeLabel}
            </div>
            {showSparkline ? (
              <RegimeSparkline
                width={200}
                height={40}
                regimeTone={
                  regimeClass === "is-risk-off"
                    ? "down"
                    : regimeClass === "is-neutral"
                      ? "neutral"
                      : "up"
                }
                refreshKey={sparklineRefreshKey}
              />
            ) : null}
          </div>
        </div>
        <div className="hp-regime__bars">
          {regimeAxes.map((axis, idx) => (
            <div key={axis.label}>
              <div className="hp-bar__row">
                <span>{axis.label}</span>
                <span>{axis.value}%</span>
              </div>
              <div className="hp-bar__track">
                <div
                  className="hp-bar__fill"
                  style={{
                    width: `${axis.value}%`,
                    background: axisBg(idx, axis.tone),
                  }}
                />
              </div>
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: 13,
                  color: "var(--hp-ink-2)",
                  fontWeight: 500,
                }}
              >
                {axis.detail}
              </p>
            </div>
          ))}
        </div>
        <div className="hp-regime__summary">
          <div
            className="hp-regime__summary-cell"
            style={{ borderLeft: "3px solid var(--brand-interactive)" }}
          >
            <div className="hp-kicker">3초 요약</div>
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 14,
                fontWeight: 700,
                color: "var(--hp-ink)",
              }}
            >
              {regimeLabel} {regimeConfidence}% · {dashboard.fearGreedLabel}
            </p>
          </div>
          <div
            className="hp-regime__summary-cell"
            style={{ borderLeft: "3px solid var(--brand-gold-deep)" }}
          >
            <div className="hp-kicker">30초 오버뷰</div>
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 14,
                fontWeight: 700,
                color: "var(--hp-ink)",
              }}
            >
              섹터 {dashboard.sectorUp}/{dashboard.sectorRows.length} · 유동성{" "}
              {formatSignedBillions(dashboard.liquidityFlow)}
            </p>
          </div>
        </div>
      </div>
    </TileShell>
  );
}
