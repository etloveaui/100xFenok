"use client";

// Shared chart chrome for /market-valuation (FORGE Slice B0, Claude/cc-29).
//
// Sits on top of cx-9's MarketChartEngine (low-level Chart.js renderer). Adds the
// pro-investor chrome the owner asked for: series toggle ("switch", #7), range
// selector (progressive disclosure — default curated, MAX reaches full depth so the
// zero-dormant mandate is honoured at the UI), and a hover readout (readable chart,
// not a static picture #6/#7/#10). This is presentation only: panel adapters own the
// semantics and pass explicit, correctly-ordered series.

import { useCallback, useEffect, useMemo, useState } from "react";

import { MarketChartEngine } from "./MarketChartEngine";
import type {
  MarketChartHoverPoint,
  MarketChartSeries,
  MarketChartType,
  MarketChartValueFormatter,
} from "./types";

export interface MarketChartRange {
  id: string;
  label: string;
  /** Trailing labels to show; omit = MAX (all reachable depth). */
  count?: number;
}

export interface MarketChartFrameProps {
  title?: string;
  subtitle?: string;
  ariaLabel: string;
  series: readonly MarketChartSeries[];
  type?: MarketChartType;
  ranges?: readonly MarketChartRange[];
  defaultRangeId?: string;
  showLegend?: boolean;
  togglableSeries?: boolean;
  heightClassName?: string;
  suggestedMin?: number;
  suggestedMax?: number;
  formatValue?: MarketChartValueFormatter;
  /** Footnote shown when not hovering, e.g. source + default/reachable coverage. */
  footnote?: string;
  /** Drop the outer card chrome when embedded in a parent shell (e.g. SlotShell). */
  bare?: boolean;
  /** Fired on range change — lets a panel lazy-load raw depth when MAX is selected. */
  onRangeChange?: (rangeId: string) => void;
}

// Mirrors the engine palette so toggle chips match the rendered line colors.
const FRAME_PALETTE = [
  "#0072B2",
  "#E69F00",
  "#56B4E9",
  "#D55E00",
  "#009E73",
  "#6b7280",
] as const;

const DEFAULT_RANGES: readonly MarketChartRange[] = [
  { id: "1Y", label: "1Y", count: 12 },
  { id: "5Y", label: "5Y", count: 60 },
  { id: "MAX", label: "MAX" },
];

function orderedLabels(series: readonly MarketChartSeries[]): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const item of series) {
    for (const point of item.points) {
      if (seen.has(point.label)) continue;
      seen.add(point.label);
      labels.push(point.label);
    }
  }
  return labels;
}

function applyRange(
  series: readonly MarketChartSeries[],
  range: MarketChartRange | undefined,
): readonly MarketChartSeries[] {
  if (!range?.count) return series;
  const labels = orderedLabels(series);
  if (labels.length <= range.count) return series;
  const kept = new Set(labels.slice(labels.length - range.count));
  return series.map((item) => ({
    ...item,
    points: item.points.filter((point) => kept.has(point.label)),
  }));
}

function defaultHiddenIds(series: readonly MarketChartSeries[]): ReadonlySet<string> {
  return new Set(series.filter((item) => item.hidden).map((item) => item.id));
}

export function MarketChartFrame({
  title,
  subtitle,
  ariaLabel,
  series,
  type = "line",
  ranges = DEFAULT_RANGES,
  defaultRangeId,
  showLegend = true,
  togglableSeries = true,
  heightClassName = "h-72",
  suggestedMin,
  suggestedMax,
  formatValue,
  footnote,
  bare = false,
  onRangeChange,
}: MarketChartFrameProps) {
  const [rangeId, setRangeId] = useState<string>(
    defaultRangeId ?? ranges[ranges.length - 1]?.id ?? "MAX",
  );
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() =>
    defaultHiddenIds(series),
  );
  const [hover, setHover] = useState<MarketChartHoverPoint | null>(null);

  useEffect(() => {
    setHiddenIds(defaultHiddenIds(series));
  }, [series]);

  const activeRange = useMemo(
    () => ranges.find((range) => range.id === rangeId) ?? ranges[ranges.length - 1],
    [ranges, rangeId],
  );

  const renderedSeries = useMemo(
    () =>
      applyRange(series, activeRange).map((item) => ({
        ...item,
        hidden: hiddenIds.has(item.id),
      })),
    [series, activeRange, hiddenIds],
  );

  const toggleSeries = useCallback((id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const fmt = useMemo<MarketChartValueFormatter>(
    () => formatValue ?? ((value) => (value === null ? "—" : String(value))),
    [formatValue],
  );

  const showRanges = ranges.length > 1;
  const showToggles = togglableSeries && series.length > 1;

  return (
    <figure
      className={
        bare
          ? "min-w-0"
          : "min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      }
    >
      {(title || showRanges) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            {title && (
              <figcaption className="truncate text-sm font-extrabold text-slate-800">
                {title}
              </figcaption>
            )}
            {subtitle && (
              <p className="truncate text-xs font-semibold text-slate-400">{subtitle}</p>
            )}
          </div>
          {showRanges && (
            <div className="flex shrink-0 gap-1" role="group" aria-label="기간 선택">
              {ranges.map((range) => {
                const active = range.id === activeRange?.id;
                return (
                  <button
                    key={range.id}
                    type="button"
                    onClick={() => {
                      setRangeId(range.id);
                      onRangeChange?.(range.id);
                    }}
                    aria-pressed={active}
                    className={
                      active
                        ? "rounded-md bg-slate-800 px-2 py-1 text-[11px] font-bold text-white"
                        : "rounded-md bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-200"
                    }
                  >
                    {range.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showToggles && (
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="시리즈 토글">
          {series.map((item, index) => {
            const off = hiddenIds.has(item.id);
            const dot = item.color ?? FRAME_PALETTE[index % FRAME_PALETTE.length];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => toggleSeries(item.id)}
                aria-pressed={!off}
                className={
                  off
                    ? "inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-300"
                    : "inline-flex items-center gap-1 rounded-full border border-slate-300 px-2 py-0.5 text-[11px] font-bold text-slate-600"
                }
              >
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: off ? "#cbd5e1" : dot }}
                />
                {item.label}
              </button>
            );
          })}
        </div>
      )}

      <MarketChartEngine
        type={type}
        series={renderedSeries}
        ariaLabel={ariaLabel}
        heightClassName={heightClassName}
        showLegend={showLegend}
        suggestedMin={suggestedMin}
        suggestedMax={suggestedMax}
        formatValue={fmt}
        onHoverPoint={setHover}
      />

      <div
        className="mt-2 min-h-[1.25rem] text-[11px] font-semibold text-slate-500"
        aria-live="polite"
      >
        {hover ? (
          <span>
            <span className="font-bold text-slate-700">{hover.label}</span>
            {"  "}
            {hover.points
              .filter((point) => point.value !== null)
              .map((point) => `${point.seriesLabel} ${fmt(point.value)}`)
              .join("   ")}
          </span>
        ) : (
          footnote && <span className="text-slate-400">{footnote}</span>
        )}
      </div>
    </figure>
  );
}
