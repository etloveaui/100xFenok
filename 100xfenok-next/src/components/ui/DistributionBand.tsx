import * as React from "react";

type DistributionTone = "loss" | "warn" | "neutral" | "gain" | "muted";

type DistributionSegment = {
  key: string;
  count: number;
  tone: DistributionTone;
};

type DistributionBandProps = {
  segments: DistributionSegment[];
  height?: number;
  /** threshold marks under the band; 0 and 100 are always shown */
  ticks?: number[];
  ariaLabel?: string;
  className?: string;
};

/* tone colors reuse globals.css semantics: loss/gain/warn-ink are the fnk color tokens, greys are the light-system neutral steps */
const toneColor: Record<DistributionTone, string> = {
  loss: "var(--fnk-color-loss)",
  warn: "var(--fnk-color-warn-ink)",
  neutral: "var(--c-neutral)",
  gain: "var(--fnk-color-gain)",
  muted: "var(--fnk-neutral-300)",
};

export function DistributionBand({
  segments,
  height = 10,
  ticks = [20, 40, 60, 80],
  ariaLabel,
  className = "",
}: DistributionBandProps) {
  const visible = segments.filter((segment) => segment.count > 0);
  const total = visible.reduce((sum, segment) => sum + segment.count, 0);
  const marks = [0, ...ticks.filter((tick) => tick > 0 && tick < 100), 100].filter(
    (mark, index, all) => all.indexOf(mark) === index,
  );
  const counts = visible.map((segment) => `${segment.key} ${segment.count}`).join(" · ");
  const label = `${ariaLabel ? `${ariaLabel} · ` : ""}${counts ? `${counts} · ` : ""}합계 ${total}`;

  return (
    <div className={`w-full ${className}`}>
      <div
        className="flex w-full overflow-hidden rounded-[3px] bg-[var(--c-surface-2)]"
        style={{ height }}
        role="img"
        aria-label={label}
      >
        {visible.map((segment) => (
          <span
            key={segment.key}
            className="block h-full"
            style={{ width: `${(segment.count / total) * 100}%`, background: toneColor[segment.tone] }}
          />
        ))}
      </div>
      <div className="relative mt-1 h-[13px] w-full text-[11px] tabular-nums text-[var(--c-ink-3)]">
        {marks.map((mark) => (
          <span
            key={`tick-${mark}`}
            className="absolute top-0 whitespace-nowrap"
            style={{
              left: `${mark}%`,
              transform: mark === 0 ? "none" : mark === 100 ? "translateX(-100%)" : "translateX(-50%)",
            }}
          >
            {mark}
          </span>
        ))}
      </div>
    </div>
  );
}
