import * as React from "react";

type RankBarTone = "brand" | "gain" | "loss" | "muted";

type RankBarRow = {
  key: string;
  label: string;
  value: number | null;
  /** preformatted value string; falls back to the raw number */
  display?: string;
  tone?: RankBarTone;
};

type RankBarsProps = {
  rows: RankBarRow[];
  /** bar scale ceiling; defaults to the largest non-null value */
  max?: number;
  ariaLabel?: string;
  className?: string;
};

const toneColor: Record<RankBarTone, string> = {
  brand: "var(--c-brand)",
  gain: "var(--c-up)",
  loss: "var(--c-down)",
  muted: "var(--c-neutral)",
};

export function RankBars({ rows, max, ariaLabel, className = "" }: RankBarsProps) {
  const numeric = rows
    .map((row) => row.value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const scale = Math.max(0, max ?? (numeric.length > 0 ? Math.max(...numeric) : 0));

  return (
    <div className={`flex w-full flex-col ${className}`} role="list" aria-label={ariaLabel}>
      {rows.map((row) => {
        const value = typeof row.value === "number" && Number.isFinite(row.value) ? row.value : null;
        const pct = value !== null && scale > 0 ? Math.max(0, Math.min(100, (value / scale) * 100)) : 0;
        return (
          <div key={row.key} role="listitem" className="flex min-h-[28px] items-center gap-2.5">
            <span className="w-[96px] shrink-0 truncate text-[12px] text-[var(--c-ink-2)]">{row.label}</span>
            <span className="h-[6px] min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--c-surface-2)]">
              <i className="block h-full rounded-full" style={{ width: `${pct}%`, background: toneColor[row.tone ?? "brand"] }} />
            </span>
            <span
              className={`shrink-0 text-right tabular-nums text-[13px] font-semibold ${value === null ? "text-[var(--c-ink-3)]" : "text-[var(--c-ink)]"}`}
            >
              {value === null ? "-" : row.display ?? String(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
