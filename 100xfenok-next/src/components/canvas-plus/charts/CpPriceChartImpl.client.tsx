"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  type AreaData,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
} from "lightweight-charts";

import type { CpChartDatum, CpPriceChartProps } from "@/components/canvas-plus/charts/types";
import { formatCompactNumber, formatCurrency as formatSharedCurrency, formatDecimal, formatInteger, normalizeCurrency } from "@/lib/format";
import {
  lightChartTheme,
  lwCandlestickSeriesOptions,
  lwChartOptions,
  lwLineSeriesOptions,
  lwVolumeSeriesOptions,
} from "@/lib/chart-theme";
import { EmptyState, EvidenceRail, Panel, PanelHeader, Row, Stat, StatStrip, useDelayedLoading } from "@/components/ui";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function chartClose(datum: CpChartDatum | null | undefined): number | null {
  if (!datum) return null;
  if (isFiniteNumber(datum.close)) return datum.close;
  return isFiniteNumber(datum.value) ? datum.value : null;
}

function chartHigh(datum: CpChartDatum): number | null {
  if (isFiniteNumber(datum.high)) return datum.high;
  return chartClose(datum);
}

function chartLow(datum: CpChartDatum): number | null {
  if (isFiniteNumber(datum.low)) return datum.low;
  return chartClose(datum);
}

function formatCurrency(value: number | null, currency = "USD"): string {
  if (!isFiniteNumber(value)) return "—";
  const currencyCode = normalizeCurrency(currency);
  if (currencyCode === "USD") return formatSharedCurrency(value, "USD");
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPlainNumber(value: number | null, digits = 2): string {
  return formatDecimal(value, { digits });
}

function formatSignedPercent(value: number | null, digits = 1, mode: "fraction" | "percent" = "fraction"): string {
  if (!isFiniteNumber(value)) return "—";
  const pct = mode === "percent" ? value : value * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

function formatUnsignedPercent(value: number | null, digits = 1, mode: "fraction" | "percent" = "fraction"): string {
  if (!isFiniteNumber(value)) return "—";
  const pct = Math.abs(mode === "percent" ? value : value * 100);
  return `${pct.toFixed(digits)}%`;
}

function formatVolume(value: number | null): string {
  return formatCompactNumber(value);
}

function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

function pctChange(from: number | null, to: number | null): number | null {
  if (!isFiniteNumber(from) || !isFiniteNumber(to) || from === 0) return null;
  return (to - from) / Math.abs(from);
}

function sortedChartData(data: readonly CpChartDatum[]): CpChartDatum[] {
  return data
    .filter((datum) => datum.time && chartClose(datum) !== null)
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time));
}

function buildMonthlyRows(data: readonly CpChartDatum[]) {
  const byMonth = new Map<string, { month: string; close: number; time: string }>();
  for (const datum of sortedChartData(data)) {
    const close = chartClose(datum);
    if (!isFiniteNumber(close)) continue;
    const month = datum.time.slice(0, 7);
    byMonth.set(month, { month, close, time: datum.time });
  }

  const rows = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  return rows
    .map((row, index) => {
      const previous = rows[index - 1];
      return {
        ...row,
        change: previous ? pctChange(previous.close, row.close) : null,
      };
    })
    .slice(-3)
    .reverse();
}

function buildW4Stats(data: readonly CpChartDatum[], range: string) {
  const sorted = sortedChartData(data);
  const latest = sorted[sorted.length - 1] ?? null;
  const first = sorted[0] ?? null;
  const latestClose = chartClose(latest);
  const firstClose = chartClose(first);

  let high: number | null = null;
  let low: number | null = null;
  for (const datum of sorted) {
    const datumHigh = chartHigh(datum);
    const datumLow = chartLow(datum);
    if (isFiniteNumber(datumHigh)) high = high === null ? datumHigh : Math.max(high, datumHigh);
    if (isFiniteNumber(datumLow)) low = low === null ? datumLow : Math.min(low, datumLow);
  }

  const recentVolumes = sorted
    .slice(-10)
    .map((datum) => datum.volume)
    .filter(isFiniteNumber);
  const averageVolume =
    recentVolumes.length > 0 ? recentVolumes.reduce((sum, value) => sum + value, 0) / recentVolumes.length : null;
  const rangeLabel = range === "1Y" ? "52주" : "선택 구간";
  const lowGain = pctChange(low, latestClose);
  const highGap = pctChange(high, latestClose);
  const periodReturn = pctChange(firstClose, latestClose);

  return {
    averageVolume,
    firstClose,
    high,
    highGap,
    latest,
    latestClose,
    low,
    lowGain,
    monthlyRows: buildMonthlyRows(sorted),
    periodReturn,
    rangeLabel,
    sortedCount: sorted.length,
  };
}

function toLineData(data: readonly CpChartDatum[]): LineData<Time>[] {
  return data
    .filter((datum): datum is CpChartDatum & { value: number } => Number.isFinite(datum.value))
    .map((datum) => ({ time: datum.time, value: datum.value }));
}

function toAreaData(data: readonly CpChartDatum[]): AreaData<Time>[] {
  return data
    .filter((datum): datum is CpChartDatum & { value: number } => Number.isFinite(datum.value))
    .map((datum) => ({ time: datum.time, value: datum.value }));
}

function toCandlestickData(data: readonly CpChartDatum[]): CandlestickData<Time>[] {
  return data
    .filter(
      (datum): datum is CpChartDatum & { open: number; high: number; low: number; close: number } =>
        Number.isFinite(datum.open) &&
        Number.isFinite(datum.high) &&
        Number.isFinite(datum.low) &&
        Number.isFinite(datum.close),
    )
    .map((datum) => ({
      time: datum.time,
      open: datum.open,
      high: datum.high,
      low: datum.low,
      close: datum.close,
    }));
}

function toVolumeData(
  data: readonly CpChartDatum[],
  positiveColor: string,
  negativeColor: string,
  mutedColor: string,
  volumeTone: "directional" | "muted",
): HistogramData<Time>[] {
  return data
    .filter((datum): datum is CpChartDatum & { volume: number } => Number.isFinite(datum.volume))
    .map((datum) => {
      const isDownBar = typeof datum.open === "number" && typeof datum.close === "number" && datum.close < datum.open;
      return {
        time: datum.time,
        value: datum.volume,
        color: volumeTone === "muted" ? mutedColor : isDownBar ? negativeColor : positiveColor,
      };
    });
}

function CpW4PriceSectionInner(props: CpPriceChartProps) {
  const {
    data,
    title,
    summary,
    symbol,
    range = "1Y",
    height = 420,
    currency = "USD",
    annualReturns = [],
    indexComparisons = [],
    footnote,
    className,
    emptyLabel,
  } = props;
  const stats = useMemo(() => buildW4Stats(data, range), [data, range]);
  const latest = stats.latest;
  const latestClose = stats.latestClose;
  const annualRows = annualReturns.slice(0, 8);
  const indexRows = indexComparisons.slice(0, 6);
  const skippedBlocks = [
    annualRows.length === 0 ? "연도별 수익률" : null,
    indexRows.length === 0 ? "동일기간 지수 대비" : null,
  ].filter((item): item is string => Boolean(item));

  const highGapAbs = isFiniteNumber(stats.highGap) ? Math.abs(stats.highGap) : null;
  const verdict =
    isFiniteNumber(stats.lowGain) && isFiniteNumber(highGapAbs)
      ? `${stats.rangeLabel} 저점 대비 ${formatSignedPercent(stats.lowGain)} 올랐지만, 고점까지는 아직 ${formatUnsignedPercent(highGapAbs)} 남았다`
      : stats.sortedCount >= 2
        ? summary
        : emptyLabel ?? "가격 차트 데이터 대기";

  return (
    <section
      className={className}
      data-cpw4-price-section
      data-chart-range={range}
      aria-label={`${symbol ?? title} 가격 차트 구성`}
    >
      <Panel>
        <PanelHeader eyebrow={`Price · ${stats.rangeLabel}`} title={`${symbol ?? title} 가격 위치`} />
        <p className="px-4 py-2 text-[13px] font-semibold text-slate-900">{verdict}</p>
        <StatStrip className="mx-4 my-2 flex-wrap">
          <div className="min-w-[30%] flex-1"><Stat label={`${stats.rangeLabel} 고가`} value={formatCurrency(stats.high, currency)} sub={`현재가 대비 ${formatSignedPercent(stats.highGap)}`} /></div>
          <div className="min-w-[30%] flex-1"><Stat label={`${stats.rangeLabel} 저가`} value={formatCurrency(stats.low, currency)} sub={`현재가 대비 ${formatSignedPercent(stats.lowGain)}`} /></div>
          <div className="min-w-[30%] flex-1"><Stat label={`${stats.rangeLabel} 수익률`} value={formatSignedPercent(stats.periodReturn)} sub={`${range} 보유 기준`} /></div>
          <div className="min-w-[30%] flex-1"><Stat label="최근 거래일 시가" value={formatCurrency(isFiniteNumber(latest?.open) ? latest.open : null, currency)} /></div>
          <div className="min-w-[30%] flex-1"><Stat label="최근 거래일 고가" value={formatCurrency(isFiniteNumber(latest?.high) ? latest.high : null, currency)} /></div>
          <div className="min-w-[30%] flex-1"><Stat label="최근 거래일 저가" value={formatCurrency(isFiniteNumber(latest?.low) ? latest.low : null, currency)} /></div>
          <div className="min-w-[30%] flex-1"><Stat label="최근 거래일 거래량" value={formatVolume(isFiniteNumber(latest?.volume) ? latest.volume : null)} sub={`10일 평균 ${formatVolume(stats.averageVolume)}`} /></div>
        </StatStrip>
        <EvidenceRail freshness={stats.sortedCount >= 2 ? "fresh" : "stale"} source="가격 데이터" asOf={formatDateLabel(latest?.time)} coverage={`${range} 위치 요약`} next={stats.sortedCount >= 2 ? undefined : "차트 데이터 확보 시"} skeletonDelayMs={120} />
      </Panel>

      <Panel>
        <PanelHeader eyebrow="Price Action · 가격 · 거래량" title="가격 · 거래량" />
        <p className="px-4 pt-2 text-[11px] text-slate-500" aria-label="차트 범례">상승 마감 · 하락 마감 · 거래량 — 거래량은 강도만, 방향은 캔들이 말합니다</p>
        <div className="px-4 py-2">
          <CpPriceChartCore
            {...props}
            composition="default"
            height={height}
            hideHeader
            showVolume
            volumeTone="muted"
          />
        </div>
        <EvidenceRail
          freshness={stats.sortedCount >= 2 ? "fresh" : "stale"}
          source="가격 데이터"
          asOf={formatDateLabel(latest?.time)}
          coverage={`${range} 가격·거래량`}
          next={stats.sortedCount >= 2 ? undefined : "차트 데이터 확보 시"}
          skeletonDelayMs={120}
        />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader eyebrow={formatDateLabel(latest?.time)} title="최근 거래일 상세" right={<span className="text-[11px] text-slate-500">정규장</span>} />
          <div className="overflow-x-auto px-4 py-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                  <th className="px-2 py-2 text-left">구분</th>
                  <th className="px-2 py-2 text-right">시가</th>
                  <th className="px-2 py-2 text-right">고가</th>
                  <th className="px-2 py-2 text-right">저가</th>
                  <th className="px-2 py-2 text-right">종가</th>
                  <th className="px-2 py-2 text-right">거래량</th>
                </tr>
              </thead>
              <tbody>
                <tr className="text-slate-900">
                  <td className="px-2 py-2 font-semibold">{symbol ?? title}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatPlainNumber(isFiniteNumber(latest?.open) ? latest.open : null)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatPlainNumber(isFiniteNumber(latest?.high) ? latest.high : null)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatPlainNumber(isFiniteNumber(latest?.low) ? latest.low : null)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatPlainNumber(latestClose)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatInteger(latest?.volume)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <EvidenceRail freshness={stats.sortedCount >= 2 ? "fresh" : "stale"} source="가격 데이터" asOf={formatDateLabel(latest?.time)} coverage="최근 거래일" next={stats.sortedCount >= 2 ? undefined : "차트 데이터 확보 시"} skeletonDelayMs={120} />
        </Panel>

        <Panel>
          <PanelHeader eyebrow="최근 3개월 마감 기준" title="월봉 종가 추이" />
          <div className="overflow-x-auto px-4 py-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                  <th className="px-2 py-2 text-left">월</th>
                  <th className="px-2 py-2 text-right">종가</th>
                  <th className="px-2 py-2 text-right">전월비</th>
                </tr>
              </thead>
              <tbody>
                {stats.monthlyRows.length > 0 ? (
                  stats.monthlyRows.map((row) => (
                    <tr key={row.month} className="border-b border-slate-100 text-slate-900 last:border-b-0">
                      <td className="px-2 py-2 font-semibold">{row.month}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatPlainNumber(row.close)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{isFiniteNumber(row.change) ? (row.change < 0 ? "▼ " : "▲ ") : ""}{formatSignedPercent(row.change)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-2 py-2">
                      <EmptyState reason="월봉 계산에 필요한 가격 데이터가 없습니다." nextRefresh="월봉 데이터 확보 시" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <EvidenceRail freshness={stats.monthlyRows.length > 0 ? "fresh" : "stale"} source="가격 데이터" asOf={formatDateLabel(latest?.time)} coverage={`월봉 ${stats.monthlyRows.length}개월`} next={stats.monthlyRows.length > 0 ? undefined : "월봉 데이터 확보 시"} skeletonDelayMs={120} />
        </Panel>
      </div>

      {(annualRows.length > 0 || indexRows.length > 0 || skippedBlocks.length > 0) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {annualRows.length > 0 ? (
            <Panel>
              <PanelHeader eyebrow="캘린더 이어 기준" title="연도별 수익률" />
              {annualRows.map((row) => (
                <Row key={row.year}>
                  <span className="truncate text-[12px] text-slate-700">{row.year}</span>
                  <span className="truncate text-[12px] text-slate-500" />
                  <span className="text-right text-[12px] font-semibold tabular-nums text-slate-900">{row.returnPct < 0 ? "▼ " : "▲ "}{formatSignedPercent(row.returnPct, 1, "percent")}</span>
                </Row>
              ))}
              <EvidenceRail freshness="fresh" source="가격 데이터" asOf={formatDateLabel(latest?.time)} coverage={`연도별 ${annualRows.length}년`} skeletonDelayMs={120} />
            </Panel>
          ) : null}

          {indexRows.length > 0 ? (
            <Panel>
              <PanelHeader eyebrow={`${range} 수익률`} title="동일기간 지수 대비" />
              {indexRows.map((row) => (
                <Row key={row.label}>
                  <span className="truncate text-[12px] text-slate-700">{row.label}</span>
                  <span className="truncate text-[12px] text-slate-500" />
                  <span className="text-right text-[12px] font-semibold tabular-nums text-slate-900">{row.returnPct < 0 ? "▼ " : "▲ "}{formatSignedPercent(row.returnPct, 1, "percent")}</span>
                </Row>
              ))}
              <EvidenceRail freshness="fresh" source="가격 데이터" asOf={formatDateLabel(latest?.time)} coverage={`지수 대비 ${indexRows.length}건`} skeletonDelayMs={120} />
            </Panel>
          ) : null}

          {skippedBlocks.length > 0 ? (
            <p className="px-1 py-1 text-[11px] text-slate-500">소스 미전달로 생략: {skippedBlocks.join(", ")}</p>
          ) : null}
        </div>
      ) : null}

      <p className="px-1 py-2 text-[11px] leading-4 text-slate-500">
        {footnote ?? `표시가 ${formatDateLabel(latest?.time)} 기준 · ${symbol ?? title} ${range} 가격 데이터`}
      </p>
    </section>
  );
}

export function CpW4PriceSectionImpl(props: CpPriceChartProps) {
  return <CpPriceChartImpl {...props} composition="w4" />;
}

export function CpPriceChartImpl(props: CpPriceChartProps) {
  if ((props.composition ?? "default") === "w4") {
    return <CpW4PriceSectionInner {...props} />;
  }

  return <CpPriceChartCore {...props} />;
}

function CpChartZeroData({
  pending,
  loadError,
  onRetry,
  emptyLabel,
}: {
  pending?: boolean;
  loadError?: string | null;
  onRetry?: () => void;
  emptyLabel: string;
}) {
  const showPending = useDelayedLoading(pending, 120);
  if (showPending) {
    return <div className="cp-chart-skeleton" aria-hidden="true" />;
  }
  if (pending) return null;
  if (loadError) {
    return (
      <EmptyState
        reason={loadError}
        nextRefresh="가격 데이터 연결 시"
        actionLabel={onRetry ? "다시 시도" : undefined}
        onAction={onRetry}
      />
    );
  }
  return <EmptyState reason={emptyLabel} nextRefresh="차트 데이터 확보 시" />;
}

function CpPriceChartCore(props: CpPriceChartProps) {
  const {
    kind,
    data,
    title,
    ariaLabel,
    range = "1Y",
    height = 280,
    density = "default",
    showGrid = true,
    showCrosshair = true,
    showVolume = false,
    volumeTone = "directional",
    className,
    emptyLabel = "차트 데이터 없음",
    pending,
    loadError,
    onRetry,
  } = props;
  const shellRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(() => typeof window !== "undefined" && !("IntersectionObserver" in window));
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const hasData = useMemo(() => {
    if (kind === "candlestick") {
      return data.some(
        (datum) =>
          Number.isFinite(datum.open) &&
          Number.isFinite(datum.high) &&
          Number.isFinite(datum.low) &&
          Number.isFinite(datum.close),
      );
    }
    return data.some((datum) => Number.isFinite(datum.value));
  }, [data, kind]);
  const showChartSkeleton = useDelayedLoading(hasData && !isVisible, 120);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    if (!("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px 0px" },
    );

    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const container = canvasRef.current;
    if (!container || !isVisible || !hasData) return;

    const chartBase = lwChartOptions();
    const candleBase = lwCandlestickSeriesOptions();
    const lineBase = lwLineSeriesOptions();
    const volumeBase = lwVolumeSeriesOptions();
    const backgroundColor = chartBase.layout.background.color;
    const textColor = chartBase.layout.textColor;
    const gridColor = chartBase.grid.vertLines.color;
    const crosshairColor = lightChartTheme.text;
    const lineColor = lineBase.color;
    const areaColor = lightChartTheme.accent;
    const positiveColor = candleBase.upColor;
    const negativeColor = candleBase.downColor;
    const mutedVolumeColor = volumeBase.color;

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { color: backgroundColor },
        textColor,
      },
      grid: {
        vertLines: { color: showGrid && !prefersReducedMotion ? gridColor : "transparent" },
        horzLines: { color: showGrid && !prefersReducedMotion ? gridColor : "transparent" },
      },
      crosshair: {
        horzLine: { color: showCrosshair ? crosshairColor : "transparent", visible: showCrosshair },
        vertLine: { color: showCrosshair ? crosshairColor : "transparent", visible: showCrosshair },
      },
      rightPriceScale: {
        borderColor: gridColor,
      },
      timeScale: {
        borderColor: gridColor,
        timeVisible: false,
        secondsVisible: false,
      },
    });

    if (kind === "candlestick") {
      const series = chart.addSeries(CandlestickSeries, { ...candleBase });
      series.setData(toCandlestickData(data));

      if (showVolume) {
        const volumeSeries = chart.addSeries(HistogramSeries, {
          ...volumeBase,
          priceFormat: { type: "volume" as const },
        });
        volumeSeries.setData(toVolumeData(data, positiveColor, negativeColor, mutedVolumeColor, volumeTone));
        chart.priceScale("").applyOptions({
          scaleMargins: {
            top: 0.78,
            bottom: 0,
          },
        });
      }
    } else if (kind === "area") {
      const series = chart.addSeries(AreaSeries, {
        lineColor: areaColor,
        topColor: areaColor,
        bottomColor: backgroundColor,
        lineWidth: 2,
      });
      series.setData(toAreaData(data));
    } else {
      const series = chart.addSeries(LineSeries, {
        color: kind === "sparkline" ? positiveColor : lineColor,
        lineWidth: kind === "sparkline" ? 1 : lineBase.lineWidth,
        priceLineVisible: kind !== "sparkline",
        lastValueVisible: kind !== "sparkline",
      });
      series.setData(toLineData(data));
      if (kind === "sparkline") {
        chart.applyOptions({
          rightPriceScale: { visible: false },
          timeScale: { visible: false },
        });
      }
    }

    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      chart.resize(Math.max(240, Math.round(entry.contentRect.width)), height);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [data, hasData, height, isVisible, kind, prefersReducedMotion, showCrosshair, showGrid, showVolume, volumeTone]);

  return (
    <section
      ref={shellRef}
      className={className}
      data-cp-price-chart
      data-chart-kind={kind}
      data-chart-range={range}
      data-density={density}
      aria-label={ariaLabel ?? title}
    >
      {!hasData ? <CpChartZeroData pending={pending} loadError={loadError} onRetry={onRetry} emptyLabel={emptyLabel} /> : null}
      {showChartSkeleton ? <div className="cp-chart-skeleton" aria-hidden="true" /> : null}
      {hasData ? (
        <div
          ref={canvasRef}
          className="cp-chart-shell__canvas"
          data-cp-price-chart-canvas
          data-reduced-motion={prefersReducedMotion ? "true" : "false"}
          style={{ minHeight: height }}
        />
      ) : null}
    </section>
  );
}
