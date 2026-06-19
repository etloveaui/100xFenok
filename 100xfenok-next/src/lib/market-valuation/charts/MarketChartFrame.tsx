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

import { useMarketChartTheme } from "./chartTheme";
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
  /** Trailing labels to show; omit count+months = MAX (all reachable depth). */
  count?: number;
  /**
   * Window by elapsed months instead of label count. For charts whose x labels
   * are ISO dates (liquidity, sentiment, AAII) and whose summary is downsampled,
   * a trailing-N-labels window is meaningless — "1Y" must mean the last 12 months
   * of dates, not the last 12 sampled points. Takes precedence over `count`.
   */
  months?: number;
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
  /** Left (y) axis unit title, e.g. "TGA ($B)". */
  yAxisTitle?: string;
  /** Right (y1) axis unit title for dual-axis charts, e.g. "Stablecoin ($B)". */
  y1AxisTitle?: string;
  /** Footnote shown when not hovering, e.g. source + default/reachable coverage. */
  footnote?: string;
  /** Drop the outer card chrome when embedded in a parent shell (e.g. SlotShell). */
  bare?: boolean;
  /** Fired on range change — lets a panel lazy-load raw depth when MAX is selected. */
  onRangeChange?: (rangeId: string) => void;
  /**
   * Sort the x-axis chronologically/lexically. Needed for date/year charts whose
   * series have different coverage (e.g. ERP FCFE 2001+ vs DDM 1961+), where the
   * first-seen label union would otherwise interleave out of order.
   */
  sortLabels?: boolean;
}

const DEFAULT_RANGES: readonly MarketChartRange[] = [
  { id: "1Y", label: "1Y", count: 12 },
  { id: "5Y", label: "5Y", count: 60 },
  { id: "MAX", label: "전체" },
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

/**
 * ISO date string `months` before an ISO `YYYY-MM-DD` anchor. Lexical order on
 * ISO dates is chronological, so the windowed filter compares label strings
 * directly — no Date parsing, no timezone edge cases.
 */
function isoMonthsBefore(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return iso;
  const zeroBased = y * 12 + (m - 1) - months;
  const ny = Math.floor(zeroBased / 12);
  const nm = (((zeroBased % 12) + 12) % 12) + 1;
  const dd = Number.isFinite(d) ? d : 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function applyRange(
  series: readonly MarketChartSeries[],
  range: MarketChartRange | undefined,
  sortLabels: boolean,
): readonly MarketChartSeries[] {
  if (!range) return series;
  // Date-window mode (ISO-date charts): "1Y" = last 12 months of dates, robust
  // to summary downsampling vs raw MAX depth. Takes precedence over count.
  if (range.months != null) {
    const labels = orderedLabels(series);
    if (!labels.length) return series;
    const latest = labels.reduce((a, b) => (a > b ? a : b));
    const cutoff = isoMonthsBefore(latest, range.months);
    return series.map((item) => ({
      ...item,
      points: item.points.filter((point) => point.label >= cutoff),
    }));
  }
  // Count mode (year/month-cadence ledger charts): keep trailing-N labels.
  if (!range.count) return series;
  const labels = orderedLabels(series);
  const ordered = sortLabels ? [...labels].sort((a, b) => a.localeCompare(b)) : labels;
  if (ordered.length <= range.count) return series;
  const kept = new Set(ordered.slice(ordered.length - range.count));
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
  yAxisTitle,
  y1AxisTitle,
  footnote,
  bare = false,
  onRangeChange,
  sortLabels = false,
}: MarketChartFrameProps) {
  const [rangeId, setRangeId] = useState<string>(
    defaultRangeId ?? ranges[ranges.length - 1]?.id ?? "MAX",
  );
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() =>
    defaultHiddenIds(series),
  );
  const [hover, setHover] = useState<MarketChartHoverPoint | null>(null);
  const [announcedHover, setAnnouncedHover] = useState<MarketChartHoverPoint | null>(null);
  const theme = useMarketChartTheme();

  useEffect(() => {
    setHiddenIds(defaultHiddenIds(series));
  }, [series]);

  useEffect(() => {
    const timer = window.setTimeout(() => setAnnouncedHover(hover), 200);
    return () => window.clearTimeout(timer);
  }, [hover]);

  const activeRange = useMemo(
    () => ranges.find((range) => range.id === rangeId) ?? ranges[ranges.length - 1],
    [ranges, rangeId],
  );

  const renderedSeries = useMemo(
    () =>
      applyRange(series, activeRange, sortLabels).map((item) => ({
        ...item,
        hidden: hiddenIds.has(item.id),
      })),
    [series, activeRange, hiddenIds, sortLabels],
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
              <p className="truncate text-xs font-semibold text-[var(--c-ink-2)]">{subtitle}</p>
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
                        : "rounded-md bg-[var(--c-surface-2)] px-2 py-1 text-[11px] font-bold text-[var(--c-ink-2)] hover:bg-[var(--c-line-2)]"
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
            const dot = theme.seriesColor(item, index);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => toggleSeries(item.id)}
                aria-pressed={!off}
                className={
                  off
                    ? "inline-flex items-center gap-1 rounded-full border border-[var(--c-line)] px-2 py-0.5 text-[11px] font-bold text-[var(--c-ink-3)]"
                    : "inline-flex items-center gap-1 rounded-full border border-[var(--c-line)] px-2 py-0.5 text-[11px] font-bold text-[var(--c-ink-2)]"
                }
              >
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: off ? theme.token("line") : dot }}
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
        sortLabels={sortLabels}
        suggestedMin={suggestedMin}
        suggestedMax={suggestedMax}
        yAxisTitle={yAxisTitle}
        y1AxisTitle={y1AxisTitle}
        formatValue={fmt}
        onHoverPoint={setHover}
      />

      <div
        className="mt-2 min-h-[1.25rem] text-[11px] font-semibold text-[var(--c-ink-2)]"
        aria-atomic="true"
        role="status"
      >
        {announcedHover ? (
          <span>
            <span className="font-bold text-[var(--c-ink)]">{announcedHover.label}</span>
            {"  "}
            {announcedHover.points
              .filter((point) => point.value !== null)
              .map((point) => `${point.seriesLabel} ${fmt(point.value)}`)
              .join("   ")}
          </span>
        ) : (
          footnote && <span className="text-[var(--c-ink-2)]">{footnote}</span>
        )}
      </div>
    </figure>
  );
}
