"use client";

// In-page ledger chart panels (FORGE Slice B, Claude/cc-29).
//
// Self-loading panels cx-9 drops into MarketValuationClient to replace bespoke SVGs.
// - ErpHistoryPanel: ERP (FCFE/DDM) + 10Y on one % axis, S&P year-end on the right
//   axis (toggle on) — feedback #6 (give ERP a reference).
// - AnnualReturnsChartPanel: 101-year S&P returns as a responsive bar chart, which
//   fixes the 760px fixed-width clipping — feedback #8.

import { useEffect, useMemo, useState } from "react";

import {
  annualReturnsModel,
  type AnnualReturnLatest,
} from "../models/annualReturnsModel";
import { loadErpHistoryModel, type ErpHistoryModel } from "../models/erpHistoryModel";
import {
  pmiActivityModel,
  type PmiActivityModel,
} from "../models/pmiActivityModel";
import type { MarketModel, SeriesPoint } from "../models/types";
import {
  yardeniOverlayModel,
  type YardeniOverlayModel,
} from "../models/yardeniOverlayModel";
import { formatAsOf, isStaleAsOf } from "../freshness";

import { MarketChartFrame } from "./MarketChartFrame";
import type { MarketChartSeries, MarketChartValueFormatter } from "./types";

function yearLabel(point: SeriesPoint): string {
  if (typeof point.year === "number") return String(point.year);
  if (typeof point.year === "string" && point.year.length > 0) return point.year;
  return point.date.slice(0, 4);
}

function yearPoints(series: readonly SeriesPoint[]) {
  return series.map((point) => ({ label: yearLabel(point), value: point.value }));
}

const erpFormat: MarketChartValueFormatter = (value) => {
  if (value === null) return "—";
  return Math.abs(value) >= 1000
    ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)
    : `${value.toFixed(2)}`;
};

const pctFormat: MarketChartValueFormatter = (value) =>
  value === null ? "—" : `${value.toFixed(1)}%`;

const oneDecimal: MarketChartValueFormatter = (value) =>
  value === null ? "—" : value.toFixed(1);

const indexFormat: MarketChartValueFormatter = (value) =>
  value === null
    ? "—"
    : new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value);

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function AsOfPill({ value }: { value: string | null | undefined }) {
  const label = formatAsOf(value);
  if (!label) return null;
  const stale = isStaleAsOf(value);
  return (
    <span
      className={cx(
        "mt-1 inline-flex rounded-full border px-2 py-1 text-[10px] font-black tabular-nums",
        stale
          ? "border-[var(--c-warn)] bg-[var(--c-warn-soft)] text-[var(--c-warn)]"
          : "border-[var(--c-line)] bg-[var(--c-surface-2)] text-[var(--c-ink-3)]",
      )}
      title={stale ? "7일 이상 오래된 자료입니다." : undefined}
    >
      기준 {label}
      {stale ? " · 오래됨" : ""}
    </span>
  );
}

function finiteField(point: SeriesPoint, key: string): number | null {
  const value = point[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pointsFromField(series: readonly SeriesPoint[], key: string) {
  return series
    .map((point) => ({
      label: point.date,
      value: finiteField(point, key),
    }))
    .filter((point) => point.value !== null);
}

function fmtMetric(value: number | null, digits = 1, suffix = ""): string {
  return value === null ? "—" : `${value.toFixed(digits)}${suffix}`;
}

function fmtIndex(value: number | null): string {
  return value === null
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtSigned(value: number | null, digits = 1): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function yardeniVerdict(premiumPct: number | null): { label: string; tone: string } {
  if (premiumPct === null) return { label: "데이터 부족", tone: "text-slate-400" };
  if (premiumPct > 15) return { label: "고평가 프리미엄", tone: "text-rose-600" };
  if (premiumPct > 5) return { label: "다소 프리미엄", tone: "text-amber-600" };
  if (premiumPct >= -5) return { label: "적정 범위", tone: "text-slate-600" };
  return { label: "할인 구간", tone: "text-emerald-600" };
}

function toneDot(tone: string): string {
  if (tone === "emerald") return "bg-emerald-500";
  if (tone === "amber") return "bg-amber-500";
  if (tone === "rose") return "bg-rose-500";
  return "bg-slate-400";
}

export function ErpHistoryPanel() {
  const [model, setModel] = useState<ErpHistoryModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadErpHistoryModel().then((next) => {
      if (!cancelled) setModel(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const series = useMemo<MarketChartSeries[]>(() => {
    if (!model) return [];
    return [
      { id: "erp_fcfe", label: "ERP (FCFE)", points: yearPoints(model.erpFcfe) },
      { id: "erp_ddm", label: "ERP (DDM)", points: yearPoints(model.erpDdm) },
      { id: "tbond", label: "10Y Treasury", points: yearPoints(model.tbond) },
      {
        id: "sp500",
        label: "S&P 500 (연말)",
        points: yearPoints(model.sp500Annual),
        yAxisId: "y1",
        hidden: true,
      },
    ];
  }, [model]);

  return (
    <MarketChartFrame
      title="Damodaran ERP 역사 (vs 금리 · S&P)"
      ariaLabel="Damodaran 내재 ERP, 10Y 금리, S&P 500 연말값 추이"
      series={series}
      type="line"
      sortLabels
      formatValue={erpFormat}
      ranges={[
        { id: "20Y", label: "20Y", count: 20 },
        { id: "40Y", label: "40Y", count: 40 },
        { id: "MAX", label: "전체" },
      ]}
      defaultRangeId="MAX"
      footnote="Damodaran 내재 ERP · 좌축 %, S&P는 우축 · 토글로 비교"
    />
  );
}

export function AnnualReturnsChartPanel() {
  const [model, setModel] = useState<MarketModel<AnnualReturnLatest> | null>(null);

  useEffect(() => {
    let cancelled = false;
    annualReturnsModel().then((next) => {
      if (!cancelled) setModel(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const series = useMemo<MarketChartSeries[]>(() => {
    if (!model) return [];
    return [
      {
        id: "sp500_return",
        label: "S&P 500 연수익률",
        points: yearPoints(model.series),
      },
    ];
  }, [model]);

  return (
    <MarketChartFrame
      title="S&P 500 연도별 수익률"
      ariaLabel="S&P 500 연도별 총수익률 (1926~)"
      series={series}
      type="bar"
      togglableSeries={false}
      formatValue={pctFormat}
      ranges={[
        { id: "10Y", label: "10Y", count: 10 },
        { id: "30Y", label: "30Y", count: 30 },
        { id: "MAX", label: "전체" },
      ]}
      defaultRangeId="MAX"
      footnote="연간 총수익률 · 반응형 차트로 카드 넘침 해소"
    />
  );
}

export function YardeniOverlayChartPanel() {
  const [model, setModel] = useState<YardeniOverlayModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    yardeniOverlayModel().then((next) => {
      if (!cancelled) setModel(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const series = useMemo<MarketChartSeries[]>(() => {
    if (!model) return [];
    return [
      {
        id: "spx",
        label: "S&P 500",
        points: pointsFromField(model.series, "spx"),
        colorToken: "brand",
      },
      {
        id: "fair_value",
        label: "적정가",
        points: pointsFromField(model.series, "fair_value"),
        colorToken: "fairValue",
      },
    ];
  }, [model]);

  const verdict = yardeniVerdict(model?.latest.premiumPct ?? null);

  return (
    <section className="min-w-0 rounded-[1.2rem] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-black tracking-tight text-slate-950">
            Yardeni Bond PER
          </h2>
          <p className="mt-1 min-w-0 break-words text-[11px] font-semibold leading-5 text-slate-500">
            S&P 500과 회사채 금리 기반 적정가를 같은 축에서 비교합니다.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cx("text-xs font-black", verdict.tone)}>{verdict.label}</p>
          <AsOfPill value={model?.latest.date} />
        </div>
      </div>

      <MarketChartFrame
        bare
        ariaLabel="Yardeni Bond PER 기반 S&P 500 적정가 비교"
        series={series}
        type="line"
        formatValue={indexFormat}
        ranges={[
          { id: "1Y", label: "1Y", count: 52 },
          { id: "5Y", label: "5Y", count: 260 },
          { id: "MAX", label: "전체" },
        ]}
        defaultRangeId="5Y"
        footnote={`야데니 원천 데이터 ${model?.meta.reachable_count.toLocaleString("ko-KR") ?? "—"}주 · 전체 기간은 1990년 이후`}
      />

      <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-5">
        {[
          ["S&P 500", fmtIndex(model?.latest.spx ?? null)],
          ["적정가", fmtIndex(model?.latest.fairValue ?? null)],
          ["프리미엄", fmtMetric(model?.latest.premiumPct ?? null, 1, "%")],
          ["Bond PER", fmtMetric(model?.latest.bondPer ?? null, 1, "x")],
          ["Spread avg", fmtMetric(model?.latest.spreadAvg ?? null, 2, "%")],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="truncate text-[9px] font-black uppercase tracking-[0.08em] text-slate-400">
              {label}
            </p>
            <p className="orbitron mt-1 truncate text-xs font-black tabular-nums text-slate-800">
              {value}
            </p>
          </div>
        ))}
      </div>
      {typeof model?.latest.premiumPercentile === "number" ? (
        <p className="mt-3 text-[11px] font-bold text-slate-500">
          1990년 이후 프리미엄 상위 {model.latest.premiumPercentile}% 수준
        </p>
      ) : null}
    </section>
  );
}

export function PmiActivityChartPanel() {
  const [model, setModel] = useState<PmiActivityModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    pmiActivityModel().then((next) => {
      if (!cancelled) setModel(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const series = useMemo<MarketChartSeries[]>(() => {
    if (!model) return [];
    return model.datasets.map((dataset) => ({
      id: dataset.id,
      label: dataset.label,
      colorToken: dataset.colorToken,
      yAxisId: dataset.axis === "cli" ? "y1" : "y",
      points: dataset.series.map((point) => ({
        label: point.date,
        value: point.value,
      })),
    }));
  }, [model]);

  return (
    <section className="min-w-0 rounded-[1.2rem] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-black tracking-tight text-slate-950">
            PMI · ISM 활동 시계열
          </h2>
          <p className="mt-1 min-w-0 break-words text-[11px] font-semibold leading-5 text-slate-500">
            PMI/ISM은 좌축, OECD CLI 미국은 우축으로 비교합니다.
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">
            확장 {model?.latest.expansionCount ?? 0}
          </span>
          <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-700">
            위축 {model?.latest.contractionCount ?? 0}
          </span>
        </div>
      </div>

      <MarketChartFrame
        bare
        ariaLabel="PMI, ISM, OECD CLI 활동 지표 시계열"
        series={series}
        type="line"
        sortLabels
        formatValue={oneDecimal}
        ranges={[
          { id: "1Y", label: "1Y", count: 12 },
          { id: "5Y", label: "5Y", count: 60 },
          { id: "MAX", label: "전체" },
        ]}
        defaultRangeId="5Y"
        footnote={`경기 설문 ${model?.meta.reachable_count.toLocaleString("ko-KR") ?? "—"}개 관측치 · 전체 기간은 월간 원천 데이터 기준`}
      />

      <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">
        {(model?.internals ?? []).map((group) => (
          <div key={group.id} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">
                  {group.label}
                </p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300">
                  {group.period ?? group.releaseDate ?? "—"}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-600">
                확장 {group.expansionCount} / 위축 {group.contractionCount}
              </span>
            </div>
            <div className="mt-3 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
              {group.components.map((component) => (
                <div key={component.id} className="min-w-0 rounded-lg bg-white px-2.5 py-2">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-[10px] font-black text-slate-500">
                      {component.label}
                    </span>
                    <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", toneDot(component.tone))} />
                  </div>
                  <div className="mt-1 flex min-w-0 items-baseline justify-between gap-2">
                    <span className="orbitron text-sm font-black tabular-nums text-slate-950">
                      {fmtMetric(component.value, 1)}
                    </span>
                    <span
                      className={cx(
                        "text-[10px] font-black tabular-nums",
                        component.delta1m === null
                          ? "text-slate-300"
                          : component.delta1m >= 0
                            ? "text-emerald-600"
                            : "text-rose-600",
                      )}
                    >
                      {fmtSigned(component.delta1m)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
