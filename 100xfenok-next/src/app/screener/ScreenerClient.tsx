"use client";

import { Fragment, useMemo, useState, useEffect } from "react";
import TransitionLink from "@/components/TransitionLink";
import { useScreenerData } from "@/hooks/useScreenerData";
import type { ScreenerSortKey, SortDir, ScreenerStock } from "@/lib/screener/types";
import { formatPercent, formatSignedPercentDecimal } from "@/lib/dashboard/formatters";
import { bandPct, bandClass, bandLabel, normalizeBandTuple, BAND_CHEAP, BAND_RICH } from "@/lib/screener/bands";
import { estimateCompletenessFromValues, estimateCompletenessTone, hasEstimateGap } from "@/lib/estimate-completeness";
import { interpretStockMetrics } from "@/lib/screener/deterministicRules";
import MetricHelp from "@/components/MetricHelp";
import StockDetailPanel from "./StockDetailPanel";

const PAGE_SIZE = 50;

interface ActionRow {
  symbol: string;
  actionScore?: number | null;
  confidenceLabel?: string | null;
  actionLabel?: string | null;
  actionBucket?: string | null;
  actionReasons?: string[];
  lowEvidence?: boolean | null;
  guruHolders?: number | null;
  forwardPeFy1?: number | null;
  forwardEpsFy1?: number | null;
  revenueGrowthFy1?: number | null;
  epsGrowthFy1?: number | null;
  forwardPeFy2?: number | null;
  forwardEpsFy2?: number | null;
  revenueGrowthFy2?: number | null;
  epsGrowthFy2?: number | null;
  forwardPeFy3?: number | null;
  forwardEpsFy3?: number | null;
  revenueGrowthFy3?: number | null;
  epsGrowthFy3?: number | null;
  grossMarginFy1?: number | null;
  operatingMarginFy1?: number | null;
  roeFy1?: number | null;
  grossMarginFy2?: number | null;
  operatingMarginFy2?: number | null;
  roeFy2?: number | null;
  grossMarginFy3?: number | null;
  operatingMarginFy3?: number | null;
  roeFy3?: number | null;
}
interface ActionSummaryDoc {
  fields?: string[];
  rows?: Array<ActionRow | unknown[]>;
}
type ActionFilter = "" | "smart_money" | "value_momentum" | "index_core" | "income" | "momentum" | "watch";

function normalizeActionRow(row: ActionRow | unknown[], fields: string[]): ActionRow | null {
  if (!Array.isArray(row)) return row.symbol ? row : null;
  const value = (key: string): unknown => {
    const index = fields.indexOf(key);
    return index >= 0 ? row[index] : undefined;
  };
  const numberValue = (key: string): number | null => {
    const raw = value(key);
    return typeof raw === "number" ? raw : null;
  };
  const symbol = value("symbol");
  if (typeof symbol !== "string" || symbol.length === 0) return null;
  const actionReasons = value("actionReasons");
  return {
    symbol,
    actionScore: numberValue("actionScore"),
    confidenceLabel: typeof value("confidenceLabel") === "string" ? value("confidenceLabel") as string : null,
    actionLabel: typeof value("actionLabel") === "string" ? value("actionLabel") as string : null,
    actionBucket: typeof value("actionBucket") === "string" ? value("actionBucket") as string : null,
    actionReasons: Array.isArray(actionReasons) ? actionReasons.filter((item): item is string => typeof item === "string") : [],
    lowEvidence: typeof value("lowEvidence") === "boolean" ? value("lowEvidence") as boolean : false,
    guruHolders: numberValue("guruHolders"),
    forwardPeFy1: numberValue("forwardPeFy1"),
    forwardEpsFy1: numberValue("forwardEpsFy1"),
    revenueGrowthFy1: numberValue("revenueGrowthFy1"),
    epsGrowthFy1: numberValue("epsGrowthFy1"),
    grossMarginFy1: numberValue("grossMarginFy1"),
    operatingMarginFy1: numberValue("operatingMarginFy1"),
    roeFy1: numberValue("roeFy1"),
    forwardPeFy2: numberValue("forwardPeFy2"),
    forwardEpsFy2: numberValue("forwardEpsFy2"),
    revenueGrowthFy2: numberValue("revenueGrowthFy2"),
    epsGrowthFy2: numberValue("epsGrowthFy2"),
    grossMarginFy2: numberValue("grossMarginFy2"),
    operatingMarginFy2: numberValue("operatingMarginFy2"),
    roeFy2: numberValue("roeFy2"),
    forwardPeFy3: numberValue("forwardPeFy3"),
    forwardEpsFy3: numberValue("forwardEpsFy3"),
    revenueGrowthFy3: numberValue("revenueGrowthFy3"),
    epsGrowthFy3: numberValue("epsGrowthFy3"),
    grossMarginFy3: numberValue("grossMarginFy3"),
    operatingMarginFy3: numberValue("operatingMarginFy3"),
    roeFy3: numberValue("roeFy3"),
  };
}

const COUNTRY_LABEL: Record<string, string> = {
  US: "미국",
  KR: "한국",
  JP: "일본",
  CN: "중국",
  HK: "홍콩",
  XX: "기타",
};

const COLUMNS: ReadonlyArray<{ key: ScreenerSortKey; label: string; align: "left" | "right" }> = [
  { key: "ticker", label: "티커", align: "left" },
  { key: "actionScore", label: "투자 신호", align: "left" },
  { key: "name", label: "종목", align: "left" },
  { key: "sector", label: "섹터", align: "left" },
  { key: "country", label: "국가", align: "left" },
  { key: "price", label: "가격", align: "right" },
  { key: "marketCap", label: "시총", align: "right" },
  { key: "per", label: "PER", align: "right" },
  { key: "pbr", label: "PBR", align: "right" },
  { key: "dividendYield", label: "배당", align: "right" },
  { key: "return12m", label: "12M", align: "right" },
  { key: "roe", label: "ROE", align: "right" },
  { key: "opm", label: "OPM", align: "right" },
  { key: "eps", label: "EPS", align: "right" },
  { key: "growthRate", label: "3M 성장", align: "right" },
  { key: "momentum1m", label: "1M", align: "right" },
  { key: "momentum3m", label: "3M 모멘텀", align: "right" },
  { key: "momentum6m", label: "6M", align: "right" },
  { key: "momentum12m", label: "12M", align: "right" },
  { key: "rank", label: "순위", align: "right" },
  { key: "guruHolders", label: "대가 보유", align: "right" },
  { key: "perBandCurrent", label: "PER 밴드", align: "left" },
  { key: "peForward", label: "Fwd PER", align: "right" },
  { key: "epsForward", label: "Fwd EPS", align: "right" },
  { key: "forwardPeFy1", label: "FY+1 PER", align: "right" },
  { key: "forwardEpsFy1", label: "FY+1 EPS", align: "right" },
  { key: "revenueGrowthFy1", label: "매출+1", align: "right" },
  { key: "epsGrowthFy1", label: "EPS+1", align: "right" },
  { key: "roeFy1", label: "FY+1 ROE", align: "right" },
  { key: "operatingMarginFy1", label: "FY+1 OPM", align: "right" },
  { key: "grossMarginFy1", label: "FY+1 GPM", align: "right" },
  { key: "forwardPeFy2", label: "FY+2 PER", align: "right" },
  { key: "forwardEpsFy2", label: "FY+2 EPS", align: "right" },
  { key: "revenueGrowthFy2", label: "매출+2", align: "right" },
  { key: "epsGrowthFy2", label: "EPS+2", align: "right" },
  { key: "roeFy2", label: "FY+2 ROE", align: "right" },
  { key: "operatingMarginFy2", label: "FY+2 OPM", align: "right" },
  { key: "grossMarginFy2", label: "FY+2 GPM", align: "right" },
  { key: "forwardPeFy3", label: "FY+3 PER", align: "right" },
  { key: "forwardEpsFy3", label: "FY+3 EPS", align: "right" },
  { key: "revenueGrowthFy3", label: "매출+3", align: "right" },
  { key: "epsGrowthFy3", label: "EPS+3", align: "right" },
  { key: "roeFy3", label: "FY+3 ROE", align: "right" },
  { key: "operatingMarginFy3", label: "FY+3 OPM", align: "right" },
  { key: "grossMarginFy3", label: "FY+3 GPM", align: "right" },
  { key: "dividendTtm", label: "Div TTM", align: "right" },
  { key: "ret1y", label: "1Y", align: "right" },
  { key: "ret3y", label: "3Y", align: "right" },
  { key: "ret5y", label: "5Y", align: "right" },
];

type ColumnPreset = "basic" | "action" | "value" | "estimate" | "momentum" | "dividend" | "guru";

const PRESET_KEYS: Record<ColumnPreset, ScreenerSortKey[]> = {
  basic: ["ticker", "actionScore", "name", "sector", "country", "price", "marketCap", "per", "pbr", "dividendYield", "return12m"],
  action: ["ticker", "actionScore", "name", "sector", "guruHolders", "perBandCurrent", "return12m", "ret1y", "dividendYield", "marketCap"],
  value: ["ticker", "name", "sector", "per", "peForward", "forwardPeFy1", "pbr", "roe", "opm", "perBandCurrent", "rank"],
  estimate: [
    "ticker",
    "actionScore",
    "name",
    "sector",
    "forwardPeFy1",
    "forwardPeFy2",
    "forwardPeFy3",
    "forwardEpsFy1",
    "forwardEpsFy2",
    "forwardEpsFy3",
    "revenueGrowthFy1",
    "revenueGrowthFy2",
    "revenueGrowthFy3",
    "epsGrowthFy1",
    "epsGrowthFy2",
    "epsGrowthFy3",
    "roeFy1",
    "roeFy2",
    "roeFy3",
    "operatingMarginFy1",
    "operatingMarginFy2",
    "operatingMarginFy3",
    "grossMarginFy1",
    "grossMarginFy2",
    "grossMarginFy3",
    "perBandCurrent",
    "marketCap",
  ],
  momentum: ["ticker", "name", "sector", "growthRate", "momentum1m", "momentum3m", "momentum6m", "momentum12m", "rank"],
  dividend: ["ticker", "name", "sector", "dividendYield", "dividendTtm", "ret1y", "ret3y", "ret5y", "per", "pbr", "marketCap"],
  guru: ["ticker", "name", "sector", "guruHolders", "per", "peForward", "perBandCurrent", "roe", "marketCap", "return12m"],
};

const PRESET_LABEL: Record<ColumnPreset, string> = {
  basic: "기본",
  action: "투자 신호",
  value: "가치",
  estimate: "추정치",
  momentum: "모멘텀",
  dividend: "배당",
  guru: "대가 관심",
};

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function fmtMarketCap(mn: number | null): string {
  if (mn === null) return "—";
  if (mn >= 1_000_000) return `$${(mn / 1_000_000).toFixed(2)}T`;
  if (mn >= 1_000) return `$${(mn / 1_000).toFixed(1)}B`;
  return `$${Math.round(mn)}M`;
}
function fmtNum(value: number | null, digits = 2): string {
  return value === null ? "—" : value.toFixed(digits);
}
function fmtSignedPct(value: number | null): string {
  return value === null ? "—" : formatSignedPercentDecimal(value, 1);
}
function fmtSignedPctPoint(value: number | null): string {
  if (value === null) return "—";
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${Math.abs(value).toFixed(1)}%`;
}
function fmtYield(value: number | null): string {
  return value === null ? "—" : formatPercent(value * 100, 2);
}
function fmtRoe(value: number | null): string {
  return value === null ? "—" : formatPercent(value * 100, 1);
}
function fmtOpm(value: number | null): string {
  return value === null ? "—" : formatPercent(value * 100, 1);
}
function fmtEps(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

type EstimateCellKey =
  | "forwardPeFy1" | "forwardPeFy2" | "forwardPeFy3"
  | "forwardEpsFy1" | "forwardEpsFy2" | "forwardEpsFy3"
  | "revenueGrowthFy1" | "revenueGrowthFy2" | "revenueGrowthFy3"
  | "epsGrowthFy1" | "epsGrowthFy2" | "epsGrowthFy3"
  | "roeFy1" | "roeFy2" | "roeFy3"
  | "operatingMarginFy1" | "operatingMarginFy2" | "operatingMarginFy3"
  | "grossMarginFy1" | "grossMarginFy2" | "grossMarginFy3";

function estimateGroupValues(stock: ScreenerStock, key: EstimateCellKey): Array<number | null | undefined> {
  if (key.startsWith("forwardPeFy")) return [stock.forwardPeFy1, stock.forwardPeFy2, stock.forwardPeFy3];
  if (key.startsWith("forwardEpsFy")) return [stock.forwardEpsFy1, stock.forwardEpsFy2, stock.forwardEpsFy3];
  if (key.startsWith("revenueGrowthFy")) return [stock.revenueGrowthFy1, stock.revenueGrowthFy2, stock.revenueGrowthFy3];
  if (key.startsWith("epsGrowthFy")) return [stock.epsGrowthFy1, stock.epsGrowthFy2, stock.epsGrowthFy3];
  if (key.startsWith("roeFy")) return [stock.roeFy1, stock.roeFy2, stock.roeFy3];
  if (key.startsWith("operatingMarginFy")) return [stock.operatingMarginFy1, stock.operatingMarginFy2, stock.operatingMarginFy3];
  return [stock.grossMarginFy1, stock.grossMarginFy2, stock.grossMarginFy3];
}

function renderEstimateCell(
  stock: ScreenerStock,
  key: EstimateCellKey,
  formatValue: (value: number | null) => string,
  valueClass: string,
): React.ReactNode {
  const raw = stock[key];
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  const completeness = estimateCompletenessFromValues(estimateGroupValues(stock, key));
  const showGap = hasEstimateGap(completeness);
  return (
    <span
      className="inline-flex min-w-[58px] flex-col items-end gap-0.5 leading-none"
      title={`FY+1~FY+3 추정치 ${completeness.label}`}
    >
      <span className={cx("orbitron tabular-nums", valueClass)}>{formatValue(value)}</span>
      {showGap ? (
        <span className={cx("rounded-full px-1.5 py-[1px] text-[9px] font-black", estimateCompletenessTone(completeness))}>
          {completeness.label}
        </span>
      ) : null}
    </span>
  );
}
function fmtRank(value: number | null): string {
  return value === null ? "—" : value.toLocaleString();
}

function confidenceText(label: string | null | undefined): string {
  if (label === "high") return "신뢰 높음";
  if (label === "medium") return "신뢰 중간";
  if (label === "low") return "신뢰 낮음";
  return "신뢰 미정";
}

function confidenceClass(label: string | null | undefined, lowEvidence: boolean): string {
  if (lowEvidence || label === "low") return "text-[var(--c-ink-2)]";
  if (label === "medium") return "text-[var(--c-warn)]";
  if (label === "high") return "text-[var(--c-up)]";
  return "text-[var(--c-ink-2)]";
}

function actionTone(bucket: string | null | undefined, confidenceLabel?: string | null, lowEvidence = false): string {
  if (lowEvidence || confidenceLabel === "low") return "border-slate-200 bg-slate-50 text-slate-700";
  if (bucket === "smart_money") return "border-violet-200 bg-violet-50 text-violet-700";
  if (bucket === "value_momentum") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (bucket === "index_core") return "border-sky-200 bg-sky-50 text-sky-700";
  if (bucket === "income") return "border-amber-200 bg-amber-50 text-amber-700";
  if (bucket === "momentum") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function getMomentumClass(value: number | null): string {
  if (value === null) return "text-[var(--c-ink-4)]";
  return value >= 0 ? "text-[var(--c-up)]" : "text-[var(--c-down)]";
}

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

function PerBandBar({ current, min, avg, max }: { current: number | null; min: number | null; avg: number | null; max: number | null }) {
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
    <div className="inline-flex min-w-[176px] flex-col items-start gap-1" title={title} role="img" aria-label={title}>
      <div className="flex max-w-full items-center gap-1.5">
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

function renderCell(stock: ScreenerStock, key: ScreenerSortKey, preset?: ColumnPreset): React.ReactNode {
  switch (key) {
    case "ticker":
      return <span className="text-sm font-black text-[var(--c-ink)]">{stock.ticker}</span>;
    case "name":
      return <span className="block max-w-[180px] truncate text-sm font-semibold text-[var(--c-ink)]">{stock.name}</span>;
    case "actionScore": {
      const lowEvidence = stock.lowEvidence === true;
      const confidence = confidenceText(stock.confidenceLabel);
      const detail = [confidence, lowEvidence ? "증거 부족" : null].filter(Boolean).join(" · ");
      const estimateSummary = preset === "estimate" ? interpretStockMetrics(stock).estimateSummary : null;
      const title = [...(stock.actionReasons ?? []), detail].filter(Boolean).join(" · ");
      return (
        <span className="flex min-w-0 max-w-[180px] flex-col items-start gap-1" title={[title, estimateSummary].filter(Boolean).join(" · ")}>
          <span className={cx("max-w-full truncate rounded-full border px-2 py-0.5 text-[10px] font-black", actionTone(stock.actionBucket, stock.confidenceLabel, lowEvidence))}>
            {stock.actionLabel ?? "관찰"} · {stock.actionScore != null ? Math.round(stock.actionScore) : "—"}
          </span>
          <span className={cx("max-w-full truncate text-[10px] font-black", confidenceClass(stock.confidenceLabel, lowEvidence))}>
            {detail}
          </span>
          {estimateSummary ? (
            <span className="max-w-full truncate text-[10px] font-semibold text-[var(--c-brand)]">{estimateSummary}</span>
          ) : stock.actionReasons?.[0] ? (
            <span className="max-w-full truncate text-[10px] font-semibold text-[var(--c-ink-4)]">{stock.actionReasons[0]}</span>
          ) : null}
        </span>
      );
    }
    case "sector":
      return <span className="text-xs font-bold text-slate-500">{stock.sector || "—"}</span>;
    case "country":
      return <span className="text-xs font-bold text-slate-500">{COUNTRY_LABEL[stock.country] ?? stock.country ?? "—"}</span>;
    case "price":
      return <span className="orbitron tabular-nums text-slate-900">{stock.price === null ? "—" : `$${stock.price.toFixed(2)}`}</span>;
    case "marketCap":
      return <span className="orbitron tabular-nums text-slate-700">{fmtMarketCap(stock.marketCap)}</span>;
    case "per":
      return <span className="orbitron tabular-nums text-slate-900">{fmtNum(stock.per, 1)}</span>;
    case "pbr":
      return <span className="orbitron tabular-nums text-slate-700">{fmtNum(stock.pbr, 2)}</span>;
    case "dividendYield":
      return <span className="orbitron tabular-nums text-slate-600">{fmtYield(stock.dividendYield)}</span>;
    case "return12m":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.return12m))}>{fmtSignedPct(stock.return12m)}</span>;
    case "roe":
      return <span className="orbitron tabular-nums text-slate-900">{fmtRoe(stock.roe)}</span>;
    case "opm":
      return <span className="orbitron tabular-nums text-slate-700">{fmtOpm(stock.opm)}</span>;
    case "eps":
      return <span className="orbitron tabular-nums text-slate-900">{fmtEps(stock.eps)}</span>;
    case "growthRate":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.growthRate))}>{fmtSignedPct(stock.growthRate)}</span>;
    case "momentum1m":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.momentum1m))}>{fmtSignedPct(stock.momentum1m)}</span>;
    case "momentum3m":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.momentum3m))}>{fmtSignedPct(stock.momentum3m)}</span>;
    case "momentum6m":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.momentum6m))}>{fmtSignedPct(stock.momentum6m)}</span>;
    case "momentum12m":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.momentum12m))}>{fmtSignedPct(stock.momentum12m)}</span>;
    case "roeFy1":
    case "roeFy2":
    case "roeFy3":
      return renderEstimateCell(stock, key, (value) => (value === null ? "—" : `${value.toFixed(1)}%`), "text-slate-900");
    case "operatingMarginFy1":
    case "operatingMarginFy2":
    case "operatingMarginFy3":
      return renderEstimateCell(stock, key, (value) => (value === null ? "—" : `${value.toFixed(1)}%`), "text-slate-700");
    case "grossMarginFy1":
    case "grossMarginFy2":
    case "grossMarginFy3":
      return renderEstimateCell(stock, key, (value) => (value === null ? "—" : `${value.toFixed(1)}%`), "text-slate-700");
    case "guruHolders":
      return stock.guruHolders != null ? (
        <span className="orbitron tabular-nums font-bold text-violet-700">{stock.guruHolders}</span>
      ) : (
        <span className="text-slate-300">—</span>
      );
    case "rank":
      return <span className="orbitron tabular-nums text-slate-600">{fmtRank(stock.rank)}</span>;
    case "perBandCurrent":
      return <PerBandBar current={stock.perBandCurrent} min={stock.perBandMin} avg={stock.perBandAvg} max={stock.perBandMax} />;
    case "peForward":
      return <span className="orbitron tabular-nums text-slate-900">{fmtNum(stock.peForward, 1)}</span>;
    case "epsForward":
      return <span className="orbitron tabular-nums text-slate-700">{fmtEps(stock.epsForward)}</span>;
    case "forwardPeFy1":
    case "forwardPeFy2":
    case "forwardPeFy3":
      return renderEstimateCell(stock, key, (value) => fmtNum(value, 1), "text-slate-900");
    case "forwardEpsFy1":
    case "forwardEpsFy2":
    case "forwardEpsFy3":
      return renderEstimateCell(stock, key, fmtEps, "text-slate-700");
    case "revenueGrowthFy1":
    case "revenueGrowthFy2":
    case "revenueGrowthFy3":
    case "epsGrowthFy1":
    case "epsGrowthFy2":
    case "epsGrowthFy3":
      return renderEstimateCell(stock, key, fmtSignedPctPoint, cx("font-black", getMomentumClass(stock[key] ?? null)));
    case "dividendTtm":
      return <span className="orbitron tabular-nums text-slate-600">{stock.dividendTtm === null ? "—" : `$${stock.dividendTtm.toFixed(2)}`}</span>;
    case "ret1y":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.ret1y))}>{fmtSignedPct(stock.ret1y)}</span>;
    case "ret3y":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.ret3y))}>{fmtSignedPct(stock.ret3y)}</span>;
    case "ret5y":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.ret5y))}>{fmtSignedPct(stock.ret5y)}</span>;
    default:
      return "—";
  }
}

const MOBILE_PRESET_KEYS: Record<ColumnPreset, ScreenerSortKey[]> = {
  basic: ["marketCap", "per", "dividendYield", "return12m"],
  action: ["marketCap", "guruHolders", "return12m", "dividendYield"],
  value: ["per", "peForward", "pbr", "perBandCurrent", "roe", "opm"],
  estimate: [
    "forwardPeFy1",
    "forwardPeFy2",
    "forwardPeFy3",
    "forwardEpsFy1",
    "forwardEpsFy2",
    "forwardEpsFy3",
    "revenueGrowthFy1",
    "revenueGrowthFy2",
    "revenueGrowthFy3",
    "epsGrowthFy1",
    "epsGrowthFy2",
    "epsGrowthFy3",
    "roeFy1",
    "roeFy2",
    "roeFy3",
    "operatingMarginFy1",
    "operatingMarginFy2",
    "operatingMarginFy3",
    "grossMarginFy1",
    "grossMarginFy2",
    "grossMarginFy3",
  ],
  momentum: ["growthRate", "momentum1m", "momentum3m", "momentum6m"],
  dividend: ["dividendYield", "dividendTtm", "ret1y", "ret3y"],
  guru: ["guruHolders", "per", "peForward", "return12m"],
};

function columnLabel(key: ScreenerSortKey): string {
  return COLUMNS.find((column) => column.key === key)?.label ?? key;
}

function renderMobileCell(stock: ScreenerStock, key: ScreenerSortKey, preset?: ColumnPreset): React.ReactNode {
  switch (key) {
    case "perBandCurrent": {
      const band = normalizeBandTuple(stock.perBandCurrent, stock.perBandMin, stock.perBandMax);
      if (!band) return <span className="text-slate-300">—</span>;
      const [safeCurrent, safeMin, safeMax] = band;
      const pct = bandPct(safeCurrent, safeMin, safeMax);
      const label = bandLabel(pct);
      return (
        <span className="orbitron font-black text-slate-800 text-[10px] truncate">
          {safeCurrent.toFixed(1)}x ({label} {Math.round(pct * 100)}%)
        </span>
      );
    }
    case "actionScore": {
      const lowEvidence = stock.lowEvidence === true;
      return (
        <span className={cx("rounded-full border px-1.5 py-0.5 text-[9px] font-black shrink-0 truncate", actionTone(stock.actionBucket, stock.confidenceLabel, lowEvidence))}>
          {stock.actionLabel ?? "관찰"} · {stock.actionScore != null ? Math.round(stock.actionScore) : "—"}
        </span>
      );
    }
    default:
      return renderCell(stock, key, preset);
  }
}

function MobileMetric({ stock, metricKey, preset }: { stock: ScreenerStock; metricKey: ScreenerSortKey; preset?: ColumnPreset }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <span className="block truncate text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-2)]">
        <MetricHelp label={columnLabel(metricKey)} metricKey={metricKey} align="right" />
      </span>
      <span className="mt-1 block min-w-0 truncate text-right text-sm font-black text-slate-900">
        {renderMobileCell(stock, metricKey, preset)}
      </span>
    </div>
  );
}

function MobileStockCard({
  stock,
  expanded,
  detailId,
  preset,
  onToggle,
}: {
  stock: ScreenerStock;
  expanded: boolean;
  detailId: string;
  preset: ColumnPreset;
  onToggle: () => void;
}) {
  const lowEvidence = stock.lowEvidence === true;
  const confidence = confidenceText(stock.confidenceLabel);
  const detail = [confidence, lowEvidence ? "증거 부족" : null].filter(Boolean).join(" · ");
  const actionTitle = [...(stock.actionReasons ?? []), detail].filter(Boolean).join(" · ");
  const estimateSummary = preset === "estimate" ? interpretStockMetrics(stock).estimateSummary : null;
  const metrics = MOBILE_PRESET_KEYS[preset];
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_-18px_rgba(15,23,42,0.35)]">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailId}
        aria-label={`${stock.ticker} 상세 ${expanded ? "접기" : "펼치기"}`}
        onClick={onToggle}
        className="flex w-full min-w-0 items-start gap-3 px-3 py-3 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-interactive/40"
      >
        <span className="mt-1 w-4 shrink-0 text-center text-xs font-black text-slate-400" aria-hidden="true">
          {expanded ? "-" : "+"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-base font-black text-slate-950">{stock.ticker}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-700">
              {COUNTRY_LABEL[stock.country] ?? stock.country ?? "—"}
            </span>
            <span
              className={cx("max-w-full truncate rounded-full border px-2 py-0.5 text-[10px] font-black", actionTone(stock.actionBucket, stock.confidenceLabel, lowEvidence))}
              title={actionTitle}
            >
              {stock.actionLabel ?? "관찰"} · {stock.actionScore != null ? Math.round(stock.actionScore) : "—"}
            </span>
          </span>
          <span className="mt-1 block min-w-0 truncate text-sm font-bold text-slate-700">{stock.name}</span>
          <span className="mt-0.5 block min-w-0 truncate text-[11px] font-bold text-[var(--c-ink-2)]">
            {stock.sector || "섹터 미정"}
            {stock.actionReasons?.[0] ? ` · ${stock.actionReasons[0]}` : ""}
          </span>
          {estimateSummary ? (
            <span className="mt-1 block min-w-0 truncate text-[11px] font-black text-[var(--c-brand)]">{estimateSummary}</span>
          ) : null}
        </span>
        <span className="shrink-0 text-right">
          <span className="orbitron block text-sm font-black tabular-nums text-slate-950">
            {stock.price === null ? "—" : `$${stock.price.toFixed(2)}`}
          </span>
          <span className="orbitron mt-1 block text-[11px] font-black tabular-nums text-slate-500">
            {fmtMarketCap(stock.marketCap)}
          </span>
          <span className={cx("orbitron mt-1 block text-[11px] font-black tabular-nums", getMomentumClass(stock.return12m))}>
            {fmtSignedPct(stock.return12m)}
          </span>
        </span>
      </button>
      <div className="grid grid-cols-2 gap-2 px-3 pb-3">
        {metrics.map((metricKey) => (
          <MobileMetric key={metricKey} stock={stock} metricKey={metricKey} preset={preset} />
        ))}
      </div>
      {expanded ? (
        <div id={detailId}>
          <StockDetailPanel ticker={stock.ticker} stock={stock} />
        </div>
      ) : null}
    </article>
  );
}

export default function ScreenerClient({ initialSearch = "" }: { initialSearch?: string }) {
  const { stocks: rawStocks, dataReady, failed, sourceDate, sectors, countries } = useScreenerData();
  const [guruMap, setGuruMap] = useState<Record<string, number> | null>(null);
  const [actionMap, setActionMap] = useState<Record<string, ActionRow> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/sec-13f/analytics/guru_holders_index.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.holders) setGuruMap(j.holders as Record<string, number>);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/computed/stock_action_summary.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ActionSummaryDoc | null) => {
        if (cancelled || !Array.isArray(j?.rows)) return;
        const next: Record<string, ActionRow> = {};
        j.rows.forEach((row) => {
          const normalized = normalizeActionRow(row, j.fields ?? []);
          if (normalized?.symbol) next[normalized.symbol] = normalized;
        });
        setActionMap(next);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const stocks = useMemo(() => {
    if (!guruMap && !actionMap) return rawStocks;
    return rawStocks.map((s) => {
      const action = actionMap?.[s.ticker];
      return {
        ...s,
        guruHolders: action?.guruHolders ?? guruMap?.[s.ticker] ?? null,
        actionScore: action?.actionScore ?? null,
        confidenceLabel: action?.confidenceLabel ?? null,
        actionLabel: action?.actionLabel ?? null,
        actionBucket: action?.actionBucket ?? null,
        actionReasons: action?.actionReasons ?? [],
        lowEvidence: action?.lowEvidence ?? null,
        forwardPeFy1: action?.forwardPeFy1 ?? s.peForward ?? null,
        forwardEpsFy1: action?.forwardEpsFy1 ?? s.epsForward ?? null,
        revenueGrowthFy1: action?.revenueGrowthFy1 ?? null,
        epsGrowthFy1: action?.epsGrowthFy1 ?? null,
        grossMarginFy1: action?.grossMarginFy1 ?? null,
        operatingMarginFy1: action?.operatingMarginFy1 ?? null,
        roeFy1: action?.roeFy1 ?? null,
        forwardPeFy2: action?.forwardPeFy2 ?? null,
        forwardEpsFy2: action?.forwardEpsFy2 ?? null,
        revenueGrowthFy2: action?.revenueGrowthFy2 ?? null,
        epsGrowthFy2: action?.epsGrowthFy2 ?? null,
        grossMarginFy2: action?.grossMarginFy2 ?? null,
        operatingMarginFy2: action?.operatingMarginFy2 ?? null,
        roeFy2: action?.roeFy2 ?? null,
        forwardPeFy3: action?.forwardPeFy3 ?? null,
        forwardEpsFy3: action?.forwardEpsFy3 ?? null,
        revenueGrowthFy3: action?.revenueGrowthFy3 ?? null,
        epsGrowthFy3: action?.epsGrowthFy3 ?? null,
        grossMarginFy3: action?.grossMarginFy3 ?? null,
        operatingMarginFy3: action?.operatingMarginFy3 ?? null,
        roeFy3: action?.roeFy3 ?? null,
      };
    });
  }, [rawStocks, guruMap, actionMap]);

  const [search, setSearch] = useState(initialSearch);
  const [sector, setSector] = useState("");
  const [country, setCountry] = useState("");
  const [perMax, setPerMax] = useState("");
  const [forwardPerMax, setForwardPerMax] = useState("");
  const [revenueGrowthMin, setRevenueGrowthMin] = useState("");
  const [epsGrowthMin, setEpsGrowthMin] = useState("");
  const [dividendYieldMin, setDividendYieldMin] = useState("");
  const [roeFy1Min, setRoeFy1Min] = useState("");
  const [ret3yMin, setRet3yMin] = useState("");
  const [ret5yMin, setRet5yMin] = useState("");
  const [profitableOnly, setProfitableOnly] = useState(false);
  const [bandFilter, setBandFilter] = useState<"" | "cheap" | "fair" | "rich">("");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortKey, setSortKey] = useState<ScreenerSortKey>("marketCap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(() => initialSearch || null);
  const [prevInitialSearch, setPrevInitialSearch] = useState(initialSearch);

  if (prevInitialSearch !== initialSearch) {
    setPrevInitialSearch(initialSearch);
    setSearch(initialSearch);
    setExpandedTicker(initialSearch || null);
  }

  const [preset, setPreset] = useState<ColumnPreset>("basic");

  useEffect(() => {
    const saved = localStorage.getItem("screener-preset") as ColumnPreset | null;
    if (!saved || !PRESET_KEYS[saved]) return;
    const frame = window.requestAnimationFrame(() => {
      setPreset(saved);
      setSortKey((current) => {
        if (PRESET_KEYS[saved].includes(current)) return current;
        setSortDir("desc");
        return "marketCap";
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const activeColumns = useMemo(() => {
    const keys = new Set(PRESET_KEYS[preset]);
    return COLUMNS.filter((c) => keys.has(c.key));
  }, [preset]);

  function handlePresetChange(next: ColumnPreset) {
    setPreset(next);
    localStorage.setItem("screener-preset", next);
    // Reset sort to a column that exists in the new preset
    const validKeys = PRESET_KEYS[next];
    if (!validKeys.includes(sortKey)) {
      setSortKey("marketCap");
      setSortDir("desc");
    }
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const perMaxValue = perMax.trim() === "" ? null : Number(perMax);
    const perMaxValid = perMaxValue !== null && !Number.isNaN(perMaxValue);
    const forwardPerMaxValue = forwardPerMax.trim() === "" ? null : Number(forwardPerMax);
    const forwardPerMaxValid = forwardPerMaxValue !== null && !Number.isNaN(forwardPerMaxValue);
    const revenueGrowthMinValue = revenueGrowthMin.trim() === "" ? null : Number(revenueGrowthMin);
    const revenueGrowthMinValid = revenueGrowthMinValue !== null && !Number.isNaN(revenueGrowthMinValue);
    const epsGrowthMinValue = epsGrowthMin.trim() === "" ? null : Number(epsGrowthMin);
    const epsGrowthMinValid = epsGrowthMinValue !== null && !Number.isNaN(epsGrowthMinValue);
    const dividendYieldMinValue = dividendYieldMin.trim() === "" ? null : Number(dividendYieldMin);
    const dividendYieldMinValid = dividendYieldMinValue !== null && !Number.isNaN(dividendYieldMinValue);
    const roeFy1MinValue = roeFy1Min.trim() === "" ? null : Number(roeFy1Min);
    const roeFy1MinValid = roeFy1MinValue !== null && !Number.isNaN(roeFy1MinValue);
    const ret3yMinValue = ret3yMin.trim() === "" ? null : Number(ret3yMin);
    const ret3yMinValid = ret3yMinValue !== null && !Number.isNaN(ret3yMinValue);
    const ret5yMinValue = ret5yMin.trim() === "" ? null : Number(ret5yMin);
    const ret5yMinValid = ret5yMinValue !== null && !Number.isNaN(ret5yMinValue);

    return stocks.filter((stock) => {
      if (query && !stock.ticker.toLowerCase().includes(query) && !stock.name.toLowerCase().includes(query)) {
        return false;
      }
      if (sector && stock.sector !== sector) return false;
      if (country && stock.country !== country) return false;
      if (profitableOnly && (stock.per === null || stock.per <= 0)) return false;
      if (actionFilter && stock.actionBucket !== actionFilter) return false;
      if (perMaxValid && (stock.per === null || stock.per <= 0 || stock.per > (perMaxValue as number))) return false;
      if (forwardPerMaxValid && ((stock.forwardPeFy1 ?? null) === null || (stock.forwardPeFy1 as number) <= 0 || (stock.forwardPeFy1 as number) > (forwardPerMaxValue as number))) return false;
      if (revenueGrowthMinValid && ((stock.revenueGrowthFy1 ?? null) === null || (stock.revenueGrowthFy1 as number) < (revenueGrowthMinValue as number))) return false;
      if (epsGrowthMinValid && ((stock.epsGrowthFy1 ?? null) === null || (stock.epsGrowthFy1 as number) < (epsGrowthMinValue as number))) return false;
      if (dividendYieldMinValid && (stock.dividendYield === null || (stock.dividendYield * 100) < (dividendYieldMinValue as number))) return false;
      if (roeFy1MinValid && ((stock.roeFy1 ?? null) === null || (stock.roeFy1 as number) < (roeFy1MinValue as number))) return false;
      if (ret3yMinValid && (stock.ret3y === null || (stock.ret3y * 100) < (ret3yMinValue as number))) return false;
      if (ret5yMinValid && (stock.ret5y === null || (stock.ret5y * 100) < (ret5yMinValue as number))) return false;

      if (bandFilter) {
        const band = normalizeBandTuple(stock.perBandCurrent, stock.perBandMin, stock.perBandMax);
        if (!band) return false;
        const pct = bandPct(...band);
        if (bandFilter === "cheap" && pct > BAND_CHEAP) return false;
        if (bandFilter === "fair" && (pct <= BAND_CHEAP || pct >= BAND_RICH)) return false;
        if (bandFilter === "rich" && pct < BAND_RICH) return false;
      }
      return true;
    });
  }, [stocks, search, sector, country, perMax, forwardPerMax, revenueGrowthMin, epsGrowthMin, dividendYieldMin, roeFy1Min, ret3yMin, ret5yMin, profitableOnly, bandFilter, actionFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const stateKey = `${search}|${sector}|${country}|${perMax}|${forwardPerMax}|${revenueGrowthMin}|${epsGrowthMin}|${dividendYieldMin}|${roeFy1Min}|${ret3yMin}|${ret5yMin}|${profitableOnly}|${bandFilter}|${actionFilter}|${sortKey}|${sortDir}|${preset}`;
  const [prevStateKey, setPrevStateKey] = useState(stateKey);
  if (prevStateKey !== stateKey) {
    setPrevStateKey(stateKey);
    if (page !== 0) setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: ScreenerSortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      const textColumn = key === "ticker" || key === "name" || key === "sector" || key === "country";
      setSortDir(textColumn || key === "rank" ? "asc" : "desc");
    }
  }

  function resetFilters() {
    setSearch("");
    setSector("");
    setCountry("");
    setPerMax("");
    setForwardPerMax("");
    setRevenueGrowthMin("");
    setEpsGrowthMin("");
    setDividendYieldMin("");
    setRoeFy1Min("");
    setRet3yMin("");
    setRet5yMin("");
    setProfitableOnly(false);
    setBandFilter("");
    setActionFilter("");
  }

  const hasFilters = Boolean(search || sector || country || perMax || forwardPerMax || revenueGrowthMin || epsGrowthMin || dividendYieldMin || roeFy1Min || ret3yMin || ret5yMin || profitableOnly || bandFilter || actionFilter);
  const advancedFiltersActive = Boolean(perMax || forwardPerMax || revenueGrowthMin || epsGrowthMin || dividendYieldMin || roeFy1Min || ret3yMin || ret5yMin || bandFilter || actionFilter);

  return (
    <div className="data-shell-page">
      <section className="panel data-shell-header">
        <div className="data-shell-head-main">
          <p className="data-shell-kicker">종목 스크리너</p>
          <h1 className="data-shell-title">종목 스크리너</h1>
          <p className="data-shell-desc">
            글로벌 {stocks.length.toLocaleString()}개 종목을 PER·PBR·배당·수익률로 필터링하고 비교합니다.
          </p>
        </div>
        <div className="data-shell-head-actions">
          {sourceDate ? (
            <span className="data-shell-pill ok">
              <span />
              {sourceDate}
            </span>
          ) : null}
          <TransitionLink href="/sectors" className="data-shell-link">
            섹터
          </TransitionLink>
        </div>
      </section>

      {failed ? (
        <div role="alert" className="rounded-[1.2rem] border border-[var(--c-line)] bg-[var(--c-surface-2)] px-4 py-3 text-sm font-semibold text-[var(--c-ink-2)]">
          종목 데이터를 불러오지 못했습니다.
        </div>
      ) : null}

      {/* Filter bar */}
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">검색</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="티커 또는 종목명"
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">섹터</span>
            <select
              value={sector}
              onChange={(event) => setSector(event.target.value)}
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
            >
              <option value="">전체 섹터</option>
              {sectors.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">국가</span>
            <select
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
            >
              <option value="">전체 국가</option>
              {countries.map((code) => (
                <option key={code} value={code}>
                  {COUNTRY_LABEL[code] ?? code}
                </option>
              ))}
            </select>
          </label>
          <div id="advanced-filters" className={filtersOpen ? "contents" : "hidden md:contents"}>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">PER 최대</span>
              <input
                type="number"
                inputMode="decimal"
                value={perMax}
                onChange={(event) => setPerMax(event.target.value)}
                placeholder="예: 20"
                className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">예상 PER 상한</span>
              <input
                type="number"
                inputMode="decimal"
                value={forwardPerMax}
                onChange={(event) => setForwardPerMax(event.target.value)}
                placeholder="예: 25"
                className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">매출+1 최소</span>
              <input
                type="number"
                inputMode="decimal"
                value={revenueGrowthMin}
                onChange={(event) => setRevenueGrowthMin(event.target.value)}
                placeholder="예: 10"
                className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">EPS+1 최소</span>
              <input
                type="number"
                inputMode="decimal"
                value={epsGrowthMin}
                onChange={(event) => setEpsGrowthMin(event.target.value)}
                placeholder="예: 10"
                className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">배당률 최소 (%)</span>
              <input
                type="number"
                inputMode="decimal"
                value={dividendYieldMin}
                onChange={(event) => setDividendYieldMin(event.target.value)}
                placeholder="예: 3"
                className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">FY+1 ROE 최소 (%)</span>
              <input
                type="number"
                inputMode="decimal"
                value={roeFy1Min}
                onChange={(event) => setRoeFy1Min(event.target.value)}
                placeholder="예: 15"
                className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">3Y 수익률 최소 (%)</span>
              <input
                type="number"
                inputMode="decimal"
                value={ret3yMin}
                onChange={(event) => setRet3yMin(event.target.value)}
                placeholder="예: 20"
                className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">5Y 수익률 최소 (%)</span>
              <input
                type="number"
                inputMode="decimal"
                value={ret5yMin}
                onChange={(event) => setRet5yMin(event.target.value)}
                placeholder="예: 50"
                className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">PER 밴드</span>
              <select
                value={bandFilter}
                onChange={(event) => setBandFilter(event.target.value as "" | "cheap" | "fair" | "rich")}
                className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
              >
                <option value="">전체 밴드</option>
                <option value="cheap">저평가 (하위 25%)</option>
                <option value="fair">적정 (중간 50%)</option>
                <option value="rich">고평가 (상위 25%)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">투자 신호</span>
              <select
                value={actionFilter}
                onChange={(event) => setActionFilter(event.target.value as ActionFilter)}
                className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
              >
                <option value="">전체 신호</option>
                <option value="smart_money">기관/고수 주목</option>
                <option value="value_momentum">저평가+모멘텀</option>
                <option value="index_core">지수 핵심</option>
                <option value="income">배당 점검</option>
                <option value="momentum">모멘텀 리더</option>
                <option value="watch">관찰</option>
              </select>
            </label>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen((value) => !value)}
          aria-expanded={filtersOpen}
          aria-controls="advanced-filters"
          className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)] md:hidden"
        >
          {filtersOpen ? "고급 필터 접기" : advancedFiltersActive ? "고급 필터 적용 중" : "고급 필터 열기"}
        </button>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm font-bold text-[var(--c-ink-2)]">
            <input
              type="checkbox"
              checked={profitableOnly}
              onChange={(event) => setProfitableOnly(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-interactive"
            />
            흑자 종목만 (PER &gt; 0)
          </label>
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-[var(--c-ink-3)]">
              <strong className="orbitron text-[var(--c-ink)]">{sorted.length.toLocaleString()}</strong>개 종목
            </span>
            {hasFilters ? (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex min-h-11 items-center rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)] transition hover:border-[var(--c-down)] hover:text-[var(--c-down)] sm:min-h-8"
              >
                초기화
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {/* Preset selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">뷰</span>
        {(Object.keys(PRESET_KEYS) as ColumnPreset[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => handlePresetChange(p)}
            aria-pressed={preset === p}
            className={cx(
              "inline-flex min-h-11 items-center rounded-full px-3 text-[11px] font-black uppercase tracking-[0.1em] transition sm:min-h-7",
              preset === p
                ? "border border-[var(--c-brand)] bg-[var(--c-brand-soft)] text-[var(--c-brand)]"
                : "border border-[var(--c-line)] bg-[var(--c-panel)] text-[var(--c-ink-3)] hover:border-[var(--c-ink-4)] hover:text-[var(--c-ink)]",
            )}
          >
            {PRESET_LABEL[p]}
          </button>
        ))}
      </div>

      {/* Results */}
      <section className={cx("rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-2 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-3", !dataReady && "opacity-60")}>
        <div className="space-y-3 md:hidden">
          {pageRows.map((stock) => {
            const expanded = expandedTicker === stock.ticker;
            const detailId = `screener-mobile-detail-${stock.ticker}`;
            return (
              <MobileStockCard
                key={stock.ticker}
                stock={stock}
                expanded={expanded}
                detailId={detailId}
                preset={preset}
                onToggle={() => setExpandedTicker((prev) => (prev === stock.ticker ? null : stock.ticker))}
              />
            );
          })}
          {dataReady && pageRows.length === 0 ? (
            <div className="px-2 py-10 text-center text-sm font-semibold text-[var(--c-ink-3)]">
              조건에 맞는 종목이 없습니다.
            </div>
          ) : null}
        </div>

        <div className="hidden md:block">
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-[var(--c-line)] text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-2)]">
                  {activeColumns.map((column) => {
                    const active = column.key === sortKey;
                    return (
                      <th
                        key={column.key}
                        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                        className={cx("px-2 py-2", column.align === "right" ? "text-right" : "text-left")}
                      >
                        <div className={cx("inline-flex items-center gap-1", column.align === "right" && "justify-end")}>
                          <button
                            type="button"
                            onClick={() => toggleSort(column.key)}
                            aria-label={`${column.label} 정렬 ${active ? (sortDir === "asc" ? "오름차순" : "내림차순") : "정렬 안 됨"}`}
                            className={cx(
                              "inline-flex items-center gap-1 transition hover:text-[var(--c-ink)]",
                              column.align === "right" && "flex-row-reverse",
                              active ? "text-brand-navy" : "text-[var(--c-ink)]",
                            )}
                          >
                            {column.label}
                            <span className="text-[9px]">{active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
                          </button>
                          <MetricHelp label={column.label} metricKey={column.key} showLabel={false} align={column.align === "right" ? "right" : "left"} />
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((stock) => {
                  const expanded = expandedTicker === stock.ticker;
                  const detailId = `screener-detail-${stock.ticker}`;
                  return (
                  <Fragment key={stock.ticker}>
                    <tr
                      onClick={() =>
                        setExpandedTicker((prev) => (prev === stock.ticker ? null : stock.ticker))
                      }
                      className="cursor-pointer border-b border-[var(--c-line-2)] transition last:border-0 hover:bg-[var(--c-surface-2)]"
                    >
                      {activeColumns.map((column) => (
                        <td
                          key={column.key}
                          className={cx("px-2 py-2", column.align === "right" ? "text-right" : "text-left")}
                        >
                          {column.key === "ticker" ? (
                            <button
                              type="button"
                              aria-expanded={expanded}
                              aria-controls={detailId}
                              aria-label={`${stock.ticker} 상세 ${expanded ? "접기" : "펼치기"}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setExpandedTicker((prev) => (prev === stock.ticker ? null : stock.ticker));
                              }}
                              className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-md px-1.5 text-left text-sm font-black text-[var(--c-ink)] transition hover:bg-[var(--c-surface-2)] focus:outline-none focus:ring-2 focus:ring-brand-interactive/40"
                            >
                              <span className="w-3 text-center text-[10px] text-[var(--c-ink-4)]" aria-hidden="true">{expanded ? "-" : "+"}</span>
                              <span className="truncate">{stock.ticker}</span>
                            </button>
                          ) : renderCell(stock, column.key, preset)}
                        </td>
                      ))}
                    </tr>
                    {expanded ? (
                      <tr id={detailId}>
                        <td colSpan={activeColumns.length} className="p-0">
                          <StockDetailPanel ticker={stock.ticker} stock={stock} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                  );
                })}
                {dataReady && pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={activeColumns.length} className="px-2 py-10 text-center text-sm font-semibold text-[var(--c-ink-3)]">
                      조건에 맞는 종목이 없습니다.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {sorted.length > PAGE_SIZE ? (
          <div className="mt-3 flex items-center justify-between gap-3 px-2">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              disabled={safePage === 0}
              className="inline-flex min-h-9 items-center rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-2)] transition enabled:hover:border-brand-interactive disabled:opacity-40"
            >
              이전
            </button>
            <span className="orbitron text-xs font-bold tabular-nums text-[var(--c-ink-3)]">
              {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
              disabled={safePage >= pageCount - 1}
              className="inline-flex min-h-9 items-center rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-2)] transition enabled:hover:border-brand-interactive disabled:opacity-40"
            >
              다음
            </button>
          </div>
        ) : null}
      </section>

      <p className="px-1 text-[11px] text-[var(--c-ink-2)]">
        데이터: 기업 실적 · 밸류에이션 · 가격/배당 히스토리 · 기관 공시 · 통합 스코어. 정렬 시 결측치는 항상 뒤로 정렬됩니다.
      </p>
    </div>
  );
}
