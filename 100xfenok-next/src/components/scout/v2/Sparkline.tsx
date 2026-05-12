"use client";

import type { ScoutTone } from "./types";

const STROKE: Record<ScoutTone, string> = {
  up: "#10b981",
  down: "#f43f5e",
  warn: "#f59e0b",
  flat: "#64748b",
};

export default function Sparkline({
  points,
  tone = "flat",
  width = 88,
  height = 28,
}: {
  points: number[];
  tone?: ScoutTone;
  width?: number;
  height?: number;
}) {
  if (points.length === 0) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const padY = 3;
  const usableH = height - padY * 2;
  const stroke = STROKE[tone];
  const coords = points.map((v, i) => {
    const x = points.length === 1 ? width / 2 : (i / (points.length - 1)) * width;
    const y = padY + usableH * (1 - (v - min) / range);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
