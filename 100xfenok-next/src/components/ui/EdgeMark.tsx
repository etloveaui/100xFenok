import * as React from "react";

type EdgeMarkProps = {
  score: number; // 0-100
  size?: 22 | 16 | 88;
  className?: string;
  showValue?: boolean;
};

/* 12-tick ring: weak #e84a5a, neutral #0f172a, strong #1aa86f, track #e2e8f0 */
function bandColor(score: number) {
  if (score < 45) return "#e84a5a";
  if (score < 65) return "#0f172a";
  return "#1aa86f";
}

const TICK_POS: Array<[number, number, number, number]> = [
  [44, 6, 44, 14],
  [63, 11, 59, 18],
  [77, 25, 70, 29],
  [82, 44, 74, 44],
  [77, 63, 70, 59],
  [63, 77, 59, 70],
  [44, 82, 44, 74],
  [25, 77, 29, 70],
  [11, 63, 18, 59],
  [6, 44, 14, 44],
  [11, 25, 18, 29],
  [25, 11, 29, 18],
];

export function EdgeMark({ score, size = 22, className = "", showValue = true }: EdgeMarkProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const filled = Math.round((clamped / 100) * 12);
  const color = bandColor(clamped);
  const dim = size;
  const strokeW = size === 88 ? 3 : size === 22 ? 2 : 2;
  // For 22/16 we show fewer ticks visually? Keep 12 but scale stroke
  return (
    <span className={`inline-flex items-center justify-center ${className}`} aria-label={`Edge ${score}`}>
      <svg width={dim} height={dim} viewBox="0 0 88 88" className="block">
        <g stroke="#e2e8f0" strokeWidth={strokeW} strokeLinecap="round">
          {TICK_POS.map(([x1, y1, x2, y2], i) => (
            <line key={`t-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
        </g>
        <g stroke={color} strokeWidth={strokeW} strokeLinecap="round">
          {TICK_POS.slice(0, filled).map(([x1, y1, x2, y2], i) => (
            <line key={`f-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
        </g>
        {showValue && size === 88 && (
          <text x="44" y="50" textAnchor="middle" fontSize="22" fontWeight={600} fill="#0f172a" fontFamily="var(--font-pretendard), system-ui, sans-serif">
            {Math.round(clamped)}
          </text>
        )}
      </svg>
    </span>
  );
}
