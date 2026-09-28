import * as React from "react";

type SparklineTone = "auto" | "gain" | "loss" | "brand";

type SparklineProps = {
  values: number[];
  height?: number;
  /** "auto" picks gain/loss from first vs last; flat stays neutral */
  tone?: SparklineTone;
  /** 1px zero baseline when the range crosses zero */
  zeroLine?: boolean;
  ariaLabel?: string;
  className?: string;
};

const VIEW_WIDTH = 280;

export function Sparkline({ values, height = 28, tone = "auto", zeroLine, ariaLabel, className = "" }: SparklineProps) {
  const series = values.filter((value) => Number.isFinite(value));

  if (series.length < 2) {
    return (
      <div
        className={`w-full rounded-[3px] bg-[var(--c-surface-2)] ${className}`}
        style={{ height }}
        role="img"
        aria-label={ariaLabel ? `${ariaLabel} · 차트 데이터 대기` : "차트 데이터 대기"}
        title="차트 데이터 대기"
      />
    );
  }

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const pad = Math.min(2, height / 4);
  const toY = (value: number) => pad + (height - pad * 2) * (1 - (value - min) / span);
  const points = series
    .map((value, index) => `${((index / (series.length - 1)) * VIEW_WIDTH).toFixed(2)},${toY(value).toFixed(2)}`)
    .join(" ");
  const first = series[0];
  const last = series[series.length - 1];
  const stroke =
    tone === "gain"
      ? "var(--c-up)"
      : tone === "loss"
        ? "var(--c-down)"
        : tone === "brand"
          ? "var(--c-brand)"
          : last > first
            ? "var(--c-up)"
            : last < first
              ? "var(--c-down)"
              : "var(--c-neutral)";
  const showZero = Boolean(zeroLine) && min < 0 && max > 0;

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      className={`block w-full ${className}`}
      role="img"
      aria-label={ariaLabel ?? "추세 차트"}
    >
      {showZero && (
        <line
          x1={0}
          y1={toY(0)}
          x2={VIEW_WIDTH}
          y2={toY(0)}
          stroke="var(--c-line-2)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        points={points}
      />
    </svg>
  );
}
