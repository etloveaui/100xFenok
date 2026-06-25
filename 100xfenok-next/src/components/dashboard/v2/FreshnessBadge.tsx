"use client";

import { v2cx, type V2Freshness } from "./types";

const TONE_STYLE: Record<
  V2Freshness["tone"],
  { dot: string; bg: string; fg: string; border: string; pulse: boolean }
> = {
  live: {
    dot: "var(--c-up)",
    bg: "color-mix(in srgb, var(--c-up) 10%, transparent)",
    fg: "var(--c-up)",
    border: "color-mix(in srgb, var(--c-up) 28%, transparent)",
    pulse: true,
  },
  dated: {
    dot: "var(--c-ink-4)",
    bg: "var(--hp-tile-bg-soft)",
    fg: "var(--hp-ink-3)",
    border: "var(--hp-stroke)",
    pulse: false,
  },
  stale: {
    dot: "var(--c-warn)",
    bg: "color-mix(in srgb, var(--c-warn) 10%, transparent)",
    fg: "var(--c-warn)",
    border: "color-mix(in srgb, var(--c-warn) 28%, transparent)",
    pulse: false,
  },
  offline: {
    dot: "var(--c-ink-4)",
    bg: "var(--hp-tile-bg-softer)",
    fg: "var(--hp-ink-3)",
    border: "var(--hp-stroke-2)",
    pulse: false,
  },
};

export default function FreshnessBadge({ meta }: { meta: V2Freshness }) {
  const s = TONE_STYLE[meta.tone];
  const compactLabel = meta.compactLabel ?? meta.label;
  const microLabel = meta.microLabel ?? compactLabel;

  return (
    <span
      className="hp-chip responsive-freshness"
      style={{
        background: s.bg,
        color: s.fg,
        borderColor: s.border,
      }}
      aria-label={meta.label}
      title={meta.label}
    >
      <span
        className={v2cx("hp-dot", s.pulse && "hp-dot--pulse")}
        style={{ background: s.dot }}
        aria-hidden="true"
      />
      <span className="sr-only">{meta.label}</span>
      <span className="responsive-freshness__label responsive-freshness__label--full" aria-hidden="true">
        {meta.label}
      </span>
      <span className="responsive-freshness__label responsive-freshness__label--compact" aria-hidden="true">
        {compactLabel}
      </span>
      <span className="responsive-freshness__label responsive-freshness__label--micro" aria-hidden="true">
        {microLabel}
      </span>
    </span>
  );
}
