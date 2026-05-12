"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * V4 RegimeSparkline — 200×40 px, 5-day SPY line + RISK-ON/OFF band.
 *
 * Client-side only. Reads sessionStorage('v4.regimeHist.spy') for prior
 * snapshot pulls; degrades gracefully when history is empty.
 *
 * Integration: call `pushRegimeHistoryPoint(snapshot)` from
 * useDashboardData() whenever a fresh DashboardSnapshot lands — that's
 * the only wiring required. No new feed.
 */

export type RegimeHistPoint = {
  /** ms since epoch when this snapshot was pulled. */
  t: number;
  /** SPY price at that moment (`dashboard.quickIndices.spy`). */
  spy: number;
  /** `dashboard.regime.state` ('RISK-ON' / 'RISK-OFF' / 'NEUTRAL'). */
  regime?: string;
};

const SS_KEY = "v4.regimeHist.spy";
const MAX_POINTS = 7;

function readHistory(): RegimeHistPoint[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(SS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(-MAX_POINTS) : [];
  } catch {
    return [];
  }
}

function writeHistory(arr: RegimeHistPoint[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SS_KEY, JSON.stringify(arr.slice(-MAX_POINTS)));
  } catch {
    /* quota / private mode — silently skip */
  }
}

/**
 * Call this every time a new DashboardSnapshot lands. Idempotent if
 * `t` matches an existing point (won't append duplicates within 60s).
 */
export function pushRegimeHistoryPoint(p: RegimeHistPoint) {
  const cur = readHistory();
  const last = cur[cur.length - 1];
  if (last && Math.abs(last.t - p.t) < 60_000) return;
  writeHistory([...cur, p]);
}

export type RegimeTone = "up" | "down" | "neutral";

export type RegimeSparklineProps = {
  width?: number;
  height?: number;
  regimeTone?: RegimeTone;
  /** Bump to force re-read sessionStorage (e.g. after a new poll). */
  refreshKey?: number | string;
};

export default function RegimeSparkline({
  width = 200,
  height = 40,
  regimeTone = "up",
  refreshKey = 0,
}: RegimeSparklineProps) {
  const [hist, setHist] = useState<RegimeHistPoint[]>(() => readHistory());

  useEffect(() => {
    // Sync with external sessionStorage when the parent bumps refreshKey
    // (snapshot tick). Not a cascading render — sessionStorage mutates
    // outside React's tree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHist(readHistory());
  }, [refreshKey]);

  const view = useMemo(() => {
    const pts = hist.map((h) => Number(h.spy)).filter((v) => !isNaN(v));
    if (pts.length === 0) {
      return { path: "", areaPath: "", dots: [] as { x: number; y: number }[], pctChange: null as number | null, isUp: true };
    }
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const range = max - min || 1;
    const padY = 6;
    const xs = pts.map((_, i) => (pts.length === 1 ? width / 2 : (i / (pts.length - 1)) * width));
    const ys = pts.map((v) => padY + (height - padY * 2) * (1 - (v - min) / range));

    const path = pts.map((_, i) => `${i === 0 ? "M" : "L"} ${xs[i].toFixed(1)} ${ys[i].toFixed(1)}`).join(" ");
    const areaPath = path
      ? `${path} L ${xs[xs.length - 1].toFixed(1)} ${height} L ${xs[0].toFixed(1)} ${height} Z`
      : "";
    const dots = pts.length <= 2 ? pts.map((_, i) => ({ x: xs[i], y: ys[i] })) : [];

    const first = pts[0];
    const last = pts[pts.length - 1];
    const pctChange = pts.length >= 2 ? ((last - first) / first) * 100 : null;
    const isUp = pctChange == null ? true : pctChange >= 0;
    return { path, areaPath, dots, pctChange, isUp };
  }, [hist, width, height]);

  const bandColor =
    regimeTone === "down"
      ? "rgba(244,63,94,0.10)"
      : regimeTone === "neutral"
        ? "rgba(148,163,184,0.10)"
        : "rgba(16,185,129,0.10)";

  const empty = hist.length === 0;
  const onePoint = hist.length === 1;

  return (
    <div
      role="img"
      aria-label={
        empty
          ? "SPY 5일 추세 — 이력 준비 중"
          : `SPY 5일 추세 ${view.pctChange != null ? view.pctChange.toFixed(2) + "%" : ""}`
      }
      style={{
        position: "relative",
        width,
        height,
        flexShrink: 0,
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, display: "block" }}
      >
        <rect x="0" y="2" width={width} height={height - 4} fill={bandColor} />
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="#e2e8f0"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        {view.areaPath ? (
          <path d={view.areaPath} fill={view.isUp ? "rgba(16,185,129,0.12)" : "rgba(244,63,94,0.12)"} />
        ) : null}
        {view.path ? (
          <path
            d={view.path}
            fill="none"
            stroke="#1B73D3"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {view.dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r="2.2" fill="#1B73D3" />
        ))}
      </svg>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 8px",
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: ".1em",
            color: "#94a3b8",
            background: "rgba(255,255,255,0.78)",
            padding: "1px 4px",
            borderRadius: 3,
          }}
        >
          5D SPY
        </span>
        {empty ? (
          <span
            style={{
              fontFamily: "'Noto Sans KR',sans-serif",
              fontSize: 10.5,
              color: "#94a3b8",
              fontWeight: 500,
            }}
          >
            이력 준비 중
          </span>
        ) : onePoint ? (
          <span
            style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 10,
              color: "#475569",
              background: "rgba(255,255,255,0.78)",
              padding: "1px 4px",
              borderRadius: 3,
            }}
          >
            1pt
          </span>
        ) : (
          <span
            style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 10,
              fontWeight: 700,
              color: view.isUp ? "#047857" : "#9f1239",
              background: "rgba(255,255,255,0.78)",
              padding: "1px 4px",
              borderRadius: 3,
            }}
          >
            {view.pctChange! >= 0 ? "+" : ""}
            {view.pctChange!.toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  );
}
