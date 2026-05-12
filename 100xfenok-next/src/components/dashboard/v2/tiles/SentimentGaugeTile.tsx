"use client";

import TileShell from "../TileShell";
import { v2cx } from "../types";
import type { V2Freshness } from "../types";
import type { DashboardSnapshot } from "@/lib/dashboard/types";
import { clamp } from "@/lib/dashboard/formatters";

/**
 * V2 Fear & Greed — AUDIT P0 (enlarge gauge) + P1 (pointer + tick marks).
 * Gauge is 150x90, half-arc with 0/50/100 ticks and a rotating pointer.
 * 56px number + auto-tinted label band.
 */
export default function SentimentGaugeTile({
  dashboard,
  freshness,
  muted,
}: {
  dashboard: DashboardSnapshot;
  freshness: V2Freshness;
  muted: boolean;
}) {
  const value = Math.round(clamp(dashboard.fearGreedScore, 0, 100));
  const offset = Number((126 * (1 - value / 100)).toFixed(2));
  const pointerAngle = -90 + (value / 100) * 180;
  const labelClass =
    value >= 55
      ? "hp-stat__label--green"
      : value <= 45
        ? "hp-stat__label--red"
        : "hp-stat__label--amber";

  return (
    <TileShell
      kicker="Fear & Greed"
      title={dashboard.fearGreedLabel}
      freshness={freshness}
      span="wide"
      muted={muted}
      action={
        <button type="button" className="hp-btn hp-btn--pill">
          게이지 상세 →
        </button>
      }
    >
      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
        <div
          style={{ width: 150, height: 90, position: "relative", flexShrink: 0 }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 100 55" style={{ width: "100%", height: "100%" }}>
            <defs>
              <linearGradient id="fgV2Grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#ef4444" />
                <stop offset="50%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#22c55e" />
              </linearGradient>
            </defs>
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke="var(--hp-tile-bg-softer)"
              strokeWidth={9}
              strokeLinecap="round"
            />
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke="url(#fgV2Grad)"
              strokeWidth={9}
              strokeLinecap="round"
              strokeDasharray={126}
              strokeDashoffset={offset}
            />
            <text x={8} y={55} fontSize={6} fill="var(--hp-ink-3)" fontWeight={700}>
              0
            </text>
            <text
              x={47}
              y={8}
              fontSize={6}
              fill="var(--hp-ink-3)"
              fontWeight={700}
            >
              50
            </text>
            <text
              x={87}
              y={55}
              fontSize={6}
              fill="var(--hp-ink-3)"
              fontWeight={700}
            >
              100
            </text>
            <g transform={`translate(50 50) rotate(${pointerAngle})`}>
              <line
                x1={0}
                y1={0}
                x2={0}
                y2={-38}
                stroke="var(--hp-ink)"
                strokeWidth={2}
                strokeLinecap="round"
              />
              <circle cx={0} cy={0} r={3} fill="var(--hp-ink)" />
            </g>
          </svg>
        </div>
        <div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 900,
              fontSize: 56,
              color: "var(--hp-ink)",
              lineHeight: 1,
              letterSpacing: "-0.015em",
            }}
          >
            {value}
          </div>
          <div
            className={v2cx("hp-stat__label", labelClass)}
            style={{ marginTop: 10 }}
          >
            {dashboard.fearGreedLabel}
          </div>
        </div>
      </div>
    </TileShell>
  );
}
