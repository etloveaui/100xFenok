"use client";

import type { WrapTone } from "./types";

const TONE_STROKE: Record<WrapTone, string> = {
  up: "#10b981",
  down: "#f43f5e",
  warn: "#f59e0b",
  flat: "#475569",
};

export default function Sparkline({
  points,
  tone = "flat",
  width = 88,
  height = 28,
}: {
  points: number[];
  tone?: WrapTone;
  width?: number;
  height?: number;
}) {
  if (points.length === 0) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const padY = 3;
  const usableH = height - padY * 2;
  const stroke = TONE_STROKE[tone];
  const coords = points.map((v, i) => {
    const x = points.length === 1 ? width / 2 : (i / (points.length - 1)) * width;
    const y = padY + usableH * (1 - (v - min) / range);
    return { x, y };
  });
  const path = coords
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const last = coords[coords.length - 1];
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r={2.2} fill={stroke} />
    </svg>
  );
}
