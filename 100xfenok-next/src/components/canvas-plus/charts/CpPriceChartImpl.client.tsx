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

function cpClassNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

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

function readCpToken(container: HTMLElement, tokenName: string, fallbackToken?: string): string {
  const scope = container.closest(".canvas-plus") ?? document.documentElement;
  const scopeStyles = getComputedStyle(scope);
  const rootStyles = getComputedStyle(document.documentElement);
  const value = scopeStyles.getPropertyValue(tokenName).trim();
  if (value) return value;
  if (fallbackToken) {
    const fallback = scopeStyles.getPropertyValue(fallbackToken).trim() || rootStyles.getPropertyValue(fallbackToken).trim();
    if (fallback) return fallback;
  }
  return rootStyles.getPropertyValue(tokenName).trim() || "currentColor";
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

function CpW4ToneValue({ value, mode = "fraction" }: { value: number | null; mode?: "fraction" | "percent" }) {
  const tone = isFiniteNumber(value) && value < 0 ? "negative" : isFiniteNumber(value) && value > 0 ? "positive" : "neutral";
  return <span className={cpClassNames("cpw4-num", tone)}>{formatSignedPercent(value, 1, mode)}</span>;
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
      className={cpClassNames("cpw4-price-section", className)}
      data-cpw4-price-section
      data-chart-range={range}
      aria-label={`${symbol ?? title} 가격 차트 구성`}
    >
      <h2 className="cpw4-verdict">
        {isFiniteNumber(stats.lowGain) && isFiniteNumber(highGapAbs) ? (
          <>
            {stats.rangeLabel} 저점 대비 <CpW4ToneValue value={stats.lowGain} /> 올랐지만, 고점까지는 아직{" "}
            <span className="cpw4-num negative">{formatUnsignedPercent(highGapAbs)}</span> 남았다
          </>
        ) : (
          verdict
        )}
      </h2>

      <div className="cpw4-range-strip" aria-label={`${stats.rangeLabel} 가격 범위`}>
        <div className="cpw4-range-cell">
          <span className="cpw4-range-label">{stats.rangeLabel} 고가</span>
          <strong className="cpw4-range-value">{formatCurrency(stats.high, currency)}</strong>
          <span className="cpw4-range-sub negative">현재가 대비 {formatSignedPercent(stats.highGap)}</span>
        </div>
        <div className="cpw4-range-cell">
          <span className="cpw4-range-label">{stats.rangeLabel} 저가</span>
          <strong className="cpw4-range-value">{formatCurrency(stats.low, currency)}</strong>
          <span className="cpw4-range-sub positive">현재가 대비 {formatSignedPercent(stats.lowGain)}</span>
        </div>
        <div className="cpw4-range-cell">
          <span className="cpw4-range-label">{stats.rangeLabel} 수익률</span>
          <strong className={cpClassNames("cpw4-range-value", isFiniteNumber(stats.periodReturn) && stats.periodReturn < 0 ? "negative" : "positive")}>
            {formatSignedPercent(stats.periodReturn)}
          </strong>
          <span className="cpw4-range-sub">{range} 보유 기준</span>
        </div>
        <div className="cpw4-range-cell">
          <span className="cpw4-range-label">최근 거래일 시가</span>
          <strong className="cpw4-range-value muted">{formatCurrency(isFiniteNumber(latest?.open) ? latest.open : null, currency)}</strong>
        </div>
        <div className="cpw4-range-cell">
          <span className="cpw4-range-label">최근 거래일 고가</span>
          <strong className="cpw4-range-value muted">{formatCurrency(isFiniteNumber(latest?.high) ? latest.high : null, currency)}</strong>
        </div>
        <div className="cpw4-range-cell">
          <span className="cpw4-range-label">최근 거래일 저가</span>
          <strong className="cpw4-range-value muted">{formatCurrency(isFiniteNumber(latest?.low) ? latest.low : null, currency)}</strong>
        </div>
        <div className="cpw4-range-cell">
          <span className="cpw4-range-label">최근 거래일 거래량</span>
          <strong className="cpw4-range-value muted">{formatVolume(isFiniteNumber(latest?.volume) ? latest.volume : null)}</strong>
          <span className="cpw4-range-sub">10일 평균 {formatVolume(stats.averageVolume)}</span>
        </div>
      </div>

      <div className="cpw4-card cpw4-chart-card">
        <div className="cpw4-chart-head">
          <div>
            <p className="cpw4-eyebrow">PRICE ACTION · 가격 · 거래량</p>
            <p className="cpw4-chart-sub">거래량은 강도만, 방향은 캔들이 말합니다</p>
          </div>
          <div className="cpw4-chart-legend" aria-label="차트 범례">
            <span><i className="positive" />상승 마감</span>
            <span><i className="negative" />하락 마감</span>
            <span><i className="volume" />거래량</span>
          </div>
        </div>
        <CpPriceChartCore
          {...props}
          composition="default"
          className="cpw4-chart-shell"
          height={height}
          hideHeader
          showVolume
          volumeTone="muted"
        />
      </div>

      <div className="cpw4-tier2">
        <div className="cpw4-card">
          <div>
            <h3 className="cpw4-section-title">최근 거래일 상세</h3>
            <p className="cpw4-section-sub">{formatDateLabel(latest?.time)} · 정규장</p>
          </div>
          <div className="cpw4-table-wrap">
            <table className="cpw4-table">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>시가</th>
                  <th>고가</th>
                  <th>저가</th>
                  <th>종가</th>
                  <th>거래량</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{symbol ?? title}</td>
                  <td>{formatPlainNumber(isFiniteNumber(latest?.open) ? latest.open : null)}</td>
                  <td>{formatPlainNumber(isFiniteNumber(latest?.high) ? latest.high : null)}</td>
                  <td>{formatPlainNumber(isFiniteNumber(latest?.low) ? latest.low : null)}</td>
                  <td>{formatPlainNumber(latestClose)}</td>
                  <td>{formatInteger(latest?.volume)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="cpw4-card">
          <div>
            <h3 className="cpw4-section-title">월봉 종가 추이</h3>
            <p className="cpw4-section-sub">최근 3개월 마감 기준</p>
          </div>
          <div className="cpw4-table-wrap">
            <table className="cpw4-table">
              <thead>
                <tr>
                  <th>월</th>
                  <th>종가</th>
                  <th>전월비</th>
                </tr>
              </thead>
              <tbody>
                {stats.monthlyRows.length > 0 ? (
                  stats.monthlyRows.map((row) => (
                    <tr key={row.month}>
                      <td>{row.month}</td>
                      <td>{formatPlainNumber(row.close)}</td>
                      <td className={isFiniteNumber(row.change) && row.change < 0 ? "negative" : "positive"}>{formatSignedPercent(row.change)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3}>월봉 계산에 필요한 가격 데이터가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {(annualRows.length > 0 || indexRows.length > 0 || skippedBlocks.length > 0) ? (
        <div className="cpw4-tier3">
          {annualRows.length > 0 ? (
            <div className="cpw4-card">
              <div>
                <h3 className="cpw4-section-title">연도별 수익률</h3>
                <p className="cpw4-section-sub">캘린더 이어 기준</p>
              </div>
              <div className="cpw4-year-grid">
                {annualRows.map((row) => (
                  <div className="cpw4-year-cell" key={row.year}>
                    <span>{row.year}</span>
                    <strong className={row.returnPct < 0 ? "negative" : "positive"}>
                      {formatSignedPercent(row.returnPct, 1, "percent")}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {indexRows.length > 0 ? (
            <div className="cpw4-card">
              <div>
                <h3 className="cpw4-section-title">동일기간 지수 대비</h3>
                <p className="cpw4-section-sub">{range} 수익률</p>
              </div>
              <div className="cpw4-index-strip">
                {indexRows.map((row) => (
                  <div className="cpw4-index-row" key={row.label}>
                    <span>{row.label}</span>
                    <strong className={row.returnPct < 0 ? "negative" : "positive"}>
                      {formatSignedPercent(row.returnPct, 1, "percent")}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {skippedBlocks.length > 0 ? (
            <p className="cpw4-skip-note">소스 미전달로 생략: {skippedBlocks.join(", ")}</p>
          ) : null}
        </div>
      ) : null}

      <p className="cpw4-footnote">
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

function CpPriceChartCore(props: CpPriceChartProps) {
  const {
    kind,
    data,
    title,
    summary,
    headingLevel = "h2",
    ariaLabel,
    range = "1Y",
    height = 280,
    density = "default",
    showGrid = true,
    showCrosshair = true,
    showVolume = false,
    volumeTone = "directional",
    hideHeader = false,
    className,
    emptyLabel = "차트 데이터 없음",
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

    const backgroundColor = readCpToken(container, "--cp-chart-bg", "--cp-surface");
    const textColor = readCpToken(container, "--cp-chart-axis", "--cp-text-muted");
    const gridColor = readCpToken(container, "--cp-chart-grid", "--cp-divider");
    const crosshairColor = readCpToken(container, "--cp-chart-crosshair", "--cp-text-soft");
    const lineColor = readCpToken(container, "--cp-chart-line-1", "--cp-accent");
    const areaColor = readCpToken(container, "--cp-chart-line-2", "--cp-accent");
    const positiveColor = readCpToken(container, "--cp-chart-positive-line", "--cp-positive");
    const negativeColor = readCpToken(container, "--cp-chart-negative-line", "--cp-negative");
    const mutedVolumeColor = readCpToken(container, "--cp-chart-volume", "--cp-border-strong");

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
      const series = chart.addSeries(CandlestickSeries, {
        upColor: positiveColor,
        downColor: negativeColor,
        borderUpColor: positiveColor,
        borderDownColor: negativeColor,
        wickUpColor: positiveColor,
        wickDownColor: negativeColor,
      });
      series.setData(toCandlestickData(data));

      if (showVolume) {
        const volumeSeries = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "",
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
        lineWidth: kind === "sparkline" ? 1 : 2,
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

  const HeadingTag = headingLevel;

  return (
    <section
      ref={shellRef}
      className={cpClassNames("cp-chart-shell", className)}
      data-cp-price-chart
      data-chart-kind={kind}
      data-chart-range={range}
      data-density={density}
      aria-label={ariaLabel ?? title}
    >
      {!hideHeader ? (
        <header className="cp-chart-shell__header">
          <div>
            <HeadingTag className="cp-chart-shell__title">{title}</HeadingTag>
            <p className="cp-chart-summary" data-cp-price-chart-summary>
              {summary}
            </p>
          </div>
          <span className="cp-chart-shell__range">{range}</span>
        </header>
      ) : null}

      {!hasData ? <p className="cp-chart-fallback">{emptyLabel}</p> : null}
      {hasData && !isVisible ? <div className="cp-chart-skeleton" aria-hidden="true" /> : null}
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
