"use client";

import { v2cx, type V2Freshness } from "./types";

const TONE_STYLE: Record<
  V2Freshness["tone"],
  { dot: string; bg: string; fg: string; border: string; pulse: boolean }
> = {
  live: {
    dot: "#22c55e",
    bg: "rgba(16,185,129,0.10)",
    fg: "#047857",
    border: "rgba(34,197,94,0.28)",
    pulse: true,
  },
  dated: {
    dot: "#94a3b8",
    bg: "var(--hp-tile-bg-soft)",
    fg: "var(--hp-ink-3)",
    border: "var(--hp-stroke)",
    pulse: false,
  },
  stale: {
    dot: "#f59e0b",
    bg: "rgba(245,158,11,0.10)",
    fg: "#b45309",
    border: "rgba(245,158,11,0.28)",
    pulse: false,
  },
  offline: {
    dot: "#94a3b8",
    bg: "var(--hp-tile-bg-softer)",
    fg: "var(--hp-ink-3)",
    border: "var(--hp-stroke-2)",
    pulse: false,
  },
};

export default function FreshnessBadge({ meta }: { meta: V2Freshness }) {
  const s = TONE_STYLE[meta.tone];
  return (
    <span
      className="hp-chip"
      style={{
        background: s.bg,
        color: s.fg,
        borderColor: s.border,
      }}
    >
      <span
        className={v2cx("hp-dot", s.pulse && "hp-dot--pulse")}
        style={{ background: s.dot }}
        aria-hidden="true"
      />
      {meta.label}
    </span>
  );
}
