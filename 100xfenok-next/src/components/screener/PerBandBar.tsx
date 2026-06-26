import { BAND_CHEAP, BAND_RICH, bandClass, bandLabel, bandPct, normalizeBandTuple } from "@/lib/screener/bands";

type PerBandBarProps = {
  current: number | null;
  min: number | null;
  avg: number | null;
  max: number | null;
};

const BADGE_CLASS_MAP: Record<string, string> = {
  emerald: "bg-[var(--c-up-soft)] text-[var(--c-up)]",
  slate: "bg-[var(--c-surface-2)] text-[var(--c-ink-2)]",
  rose: "bg-[var(--c-down-soft)] text-[var(--c-down)]",
};

const DOT_CLASS_MAP: Record<string, string> = {
  emerald: "bg-[var(--c-up)]",
  slate: "bg-[var(--c-neutral)]",
  rose: "bg-[var(--c-down)]",
};

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function PerBandBar({ current, min, avg, max }: PerBandBarProps) {
  const band = normalizeBandTuple(current, min, max);
  if (!band) {
    return <span className="text-[var(--c-ink-4)]">—</span>;
  }
  const [safeCurrent, safeMin, safeMax] = band;
  const pct = bandPct(safeCurrent, safeMin, safeMax);
  const avgBand = normalizeBandTuple(avg, safeMin, safeMax);
  const safeAvg = avgBand?.[0] ?? null;
  const avgPct = safeAvg !== null ? bandPct(safeAvg, safeMin, safeMax) : null;
  const cls = bandClass(pct);
  const label = bandLabel(pct);
  const badgeClass = BADGE_CLASS_MAP[cls];
  const dotClass = DOT_CLASS_MAP[cls];
  const title = `현재 ${safeCurrent.toFixed(1)} · 평균 ${safeAvg !== null ? safeAvg.toFixed(1) : "—"} · 8Y ${safeMin.toFixed(1)}~${safeMax.toFixed(1)} · ${Math.round(pct * 100)}%`;
  const isClampedHigh = pct >= 1;
  const isClampedLow = pct <= 0;

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col items-start gap-1" title={title} role="img" aria-label={title}>
      <div className="flex max-w-full min-w-0 flex-wrap items-center gap-1.5">
        <div className="relative h-2 w-20 shrink-0 overflow-hidden rounded-full">
          {/* 3-zone shading */}
          <div className="absolute inset-y-0 left-0 bg-[var(--c-up-soft)]" style={{ width: `${BAND_CHEAP * 100}%` }} />
          <div className="absolute inset-y-0 bg-[var(--c-surface-2)]" style={{ left: `${BAND_CHEAP * 100}%`, width: `${(BAND_RICH - BAND_CHEAP) * 100}%` }} />
          <div className="absolute inset-y-0 right-0 bg-[var(--c-down-soft)]" style={{ width: `${(1 - BAND_RICH) * 100}%` }} />

          {/* avg line */}
          {avgPct !== null && (
            <div className="absolute top-0 h-full w-[1.5px] bg-[var(--c-ink-3)]" style={{ left: `${avgPct * 100}%` }} />
          )}

          {/* edge marker or dot */}
          {isClampedHigh ? (
            <div
              className="absolute top-1/2 border-y-4 border-l-[6px] border-y-transparent border-l-[var(--c-down)]"
              style={{ right: 0, transform: "translateY(-50%)" }}
            />
          ) : isClampedLow ? (
            <div
              className="absolute top-1/2 border-y-4 border-r-[6px] border-y-transparent border-r-[var(--c-up)]"
              style={{ left: 0, transform: "translateY(-50%)" }}
            />
          ) : (
            <div
              className={cx("absolute top-1/2 h-2.5 w-2.5 rounded-full border-2 border-white", dotClass)}
              style={{ left: `${pct * 100}%`, transform: "translate(-50%, -50%)" }}
            />
          )}
        </div>

        <span className="orbitron shrink-0 tabular-nums text-[9px] font-black text-[var(--c-ink-2)]">
          현재 {safeCurrent.toFixed(1)}x
        </span>

        <span className={cx("orbitron shrink-0 tabular-nums rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide", badgeClass)}>
          {label} {Math.round(pct * 100)}%
        </span>
      </div>
      <span className="max-w-full truncate text-[9px] font-bold tabular-nums text-[var(--c-ink-4)]">
        평균 {safeAvg !== null ? safeAvg.toFixed(1) : "—"} · 8Y {safeMin.toFixed(1)}~{safeMax.toFixed(1)}
      </span>
    </div>
  );
}
