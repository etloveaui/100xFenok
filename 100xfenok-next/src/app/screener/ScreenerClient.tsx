"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import TransitionLink from "@/components/TransitionLink";
import DataStateNotice, { DataStateBadge } from "@/components/DataStateNotice";
import MacroContextCard from "@/components/macro/MacroContextCard";
import MarketQuickLinks from "@/components/market/MarketQuickLinks";
import PerBandBar from "@/components/screener/PerBandBar";
import { useScreenerData } from "@/hooks/useScreenerData";
import type { ScreenerSortKey, SortDir, ScreenerStock } from "@/lib/screener/types";
import { formatPercent, formatSignedPercentDecimal } from "@/lib/dashboard/formatters";
import { bandPct, bandLabel, normalizeBandTuple, BAND_CHEAP, BAND_RICH } from "@/lib/screener/bands";
import { makeDataState } from "@/lib/data-state";
import { ROUTES } from "@/lib/routes";
import { estimateCompletenessFromValues, estimateCompletenessTone, hasEstimateGap } from "@/lib/estimate-completeness";
import { interpretStockMetrics } from "@/lib/screener/deterministicRules";
import MetricHelp from "@/components/MetricHelp";
import ScreenerDesktopTable from "./ScreenerDesktopTable";
import ScreenerTanstackTable from "./ScreenerTanstackTable";
import StockDetailPanel from "./StockDetailPanel";
import { loadActionSummaryMap, type ActionSummaryRecord } from "@/features/stock-analyzer/data/action-summary-provider";
import type { MacroContextId } from "@/lib/macro-chart/context";
import {
  updateScreenerUrl,
  defaultScreenerFilterState,
  coerceColumnPreset,
  coerceActionFilter,
  coerceConnectionFilter,
  coerceFenokEdgeFilter,
  coerceConvictionFilter,
  parseFilterNumber,
  PRESET_KEYS,
  PRESET_LABEL,
  MOBILE_PRESET_KEYS,
  type ActionFilter,
  type ConnectionFilter,
  type FenokEdgeFilter,
  type ConvictionFilter,
  type ColumnPreset,
  type ScreenerFilterState,
} from "@/lib/screener/filter-url";

const PAGE_SIZE = 50;
type ScreenerDensity = "compact" | "standard" | "comfortable";
type ScreenerViewMode = "table" | "card";

const VIEW_MODE_LABEL: Record<ScreenerViewMode, string> = {
  table: "테이블",
  card: "카드",
};

const VIEW_MODE_BUTTONS: ScreenerViewMode[] = ["table", "card"];

const DENSITY_LABEL: Record<ScreenerDensity, string> = {
  compact: "콤팩트",
  standard: "표준",
  comfortable: "편안함",
};

const DENSITY_BUTTONS: ScreenerDensity[] = ["compact", "standard", "comfortable"];

const DENSITY_ROW_HEIGHT: Record<ScreenerDensity, number> = {
  compact: 32,
  standard: 40,
  comfortable: 48,
};

const DENSITY_TABLE_CLASS: Record<ScreenerDensity, {
  scroller: string;
  table: string;
  headerCell: string;
  bodyCell: string;
  tickerCell: string;
}> = {
  compact: {
    scroller: "max-h-[720px]",
    table: "text-xs",
    headerCell: "px-2 py-1.5",
    bodyCell: "px-2 py-1.5",
    tickerCell: "min-h-9 px-1",
  },
  standard: {
    scroller: "max-h-[620px]",
    table: "text-sm",
    headerCell: "px-2 py-2",
    bodyCell: "px-2 py-2",
    tickerCell: "min-h-11 px-1.5",
  },
  comfortable: {
    scroller: "max-h-[560px]",
    table: "text-sm",
    headerCell: "px-3 py-3",
    bodyCell: "px-3 py-3",
    tickerCell: "min-h-14 px-2",
  },
};

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
  { key: "fenokEdgeScore", label: "Fenok Edge", align: "right" },
  { key: "name", label: "종목", align: "left" },
  { key: "sector", label: "섹터", align: "left" },
  { key: "country", label: "국가", align: "left" },
  { key: "price", label: "가격", align: "right" },
  { key: "marketCap", label: "시총", align: "right" },
  { key: "per", label: "PER", align: "right" },
  { key: "pbr", label: "PBR", align: "right" },
  { key: "peg", label: "PEG", align: "right" },
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
  { key: "connectionCount", label: "연결", align: "left" },
  { key: "fenokConvictionScore", label: "Fenok 컨빅션", align: "right" },
  { key: "profitabilityScore", label: "수익성", align: "right" },
  { key: "growthScore", label: "성장", align: "right" },
  { key: "technicalFlowScore", label: "기술/자금", align: "right" },
  { key: "durabilityProfitabilityScore", label: "내구 수익성", align: "right" },
  { key: "upsidePotentialScore", label: "상방 잠재력", align: "right" },
  { key: "downsidePressureScore", label: "하방 압력", align: "right" },
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

function formatCoverage(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "미확인";
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
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

function fenokEdgeTone(score: number | null): string {
  if (score === null) return "border-slate-200 bg-slate-50 text-slate-500";
  if (score >= 70) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (score >= 60) return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (score >= 50) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function fenokEdgeDirectionLabel(direction: string | null | undefined): string {
  if (direction === "upside_bias") return "상방";
  if (direction === "downside_bias") return "하방";
  if (direction === "balanced") return "중립";
  return "방향 미정";
}

function fenokEdgeDirectionMark(direction: string | null | undefined): string {
  if (direction === "upside_bias") return "▲";
  if (direction === "downside_bias") return "▼";
  if (direction === "balanced") return "•";
  return "·";
}

function fenokEdgeTitle(stock: ScreenerStock): string {
  const coverage = typeof stock.fenokSignalCoverageRatio === "number"
    ? `coverage=${Math.round(stock.fenokSignalCoverageRatio * 100)}%`
    : "coverage=unknown";
  return [
    "Fenok 파생 upside/downside 프록시",
    fenokEdgeDirectionLabel(stock.fenokEdgeDirection),
    confidenceText(stock.fenokSignalConfidence),
    coverage,
    stock.fenokSignalAsOf ? `as_of=${stock.fenokSignalAsOf}` : null,
  ].filter(Boolean).join(" · ");
}

function convictionCallLabel(call: ScreenerStock["fenokConvictionCall"]): string {
  return call ?? "미정";
}

function convictionTone(score: number | null, call: ScreenerStock["fenokConvictionCall"]): string {
  if (score === null || score === undefined) return "border-slate-200 bg-slate-50 text-slate-500";
  if (call === "집중") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (call === "혼재") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (call === "희석") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-500";
}

function signalDirectionLabel(direction: string | null | undefined): string {
  if (direction === "positive" || direction === "upside_bias") return "상";
  if (direction === "negative" || direction === "downside_bias") return "하";
  if (direction === "neutral" || direction === "balanced") return "중";
  return "·";
}

function signalScoreTone(score: number | null): string {
  if (score === null || score === undefined) return "border-slate-200 bg-slate-50 text-slate-500";
  if (score >= 70) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (score >= 60) return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (score >= 50) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-500";
}

function downsideRiskTone(score: number | null): string {
  if (score === null || score === undefined) return "border-slate-200 bg-slate-50 text-slate-500";
  if (score >= 70) return "border-rose-200 bg-rose-50 text-rose-700";
  if (score >= 60) return "border-amber-200 bg-amber-50 text-amber-700";
  if (score >= 50) return "border-slate-200 bg-slate-50 text-slate-500";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function convictionTooltip(stock: ScreenerStock): string {
  const lines = ["Fenok 4-신호 동등가중 종합 · 매수권유 아님"];
  const push = (label: string, score: number | null | undefined, direction: string | null | undefined) => {
    const s = typeof score === "number" && Number.isFinite(score) ? Math.round(score) : "—";
    lines.push(`${label}: ${s} · ${signalDirectionLabel(direction)}`);
  };
  push("수익성", stock.profitabilityScore, stock.profitabilityDirection);
  push("성장", stock.growthScore, stock.growthDirection);
  push("기술/자금", stock.technicalFlowScore, stock.technicalFlowDirection);
  push("Fenok Edge", stock.fenokEdgeScore, stock.fenokEdgeDirection);
  const coverage = typeof stock.fenokSignalCoverageRatio === "number"
    ? `coverage=${Math.round(stock.fenokSignalCoverageRatio * 100)}%`
    : "coverage=unknown";
  lines.push([confidenceText(stock.fenokSignalConfidence), coverage, stock.fenokSignalAsOf ? `as_of=${stock.fenokSignalAsOf}` : null].filter(Boolean).join(" · "));
  return lines.join("\n");
}

function guruHoldersCount(stock: ScreenerStock): number | null {
  return typeof stock.guruHolders === "number" && Number.isFinite(stock.guruHolders) && stock.guruHolders > 0
    ? stock.guruHolders
    : null;
}

function hasGuruHolders(stock: ScreenerStock): boolean {
  return guruHoldersCount(stock) !== null;
}

function GuruHolderBadge({ stock, compact = false }: { stock: ScreenerStock; compact?: boolean }) {
  const holders = guruHoldersCount(stock);
  if (holders === null) return null;
  return (
    <TransitionLink
      href={ROUTES.superinvestorsByTicker(stock.ticker)}
      data-testid="screener-guru-badge"
      data-ticker={stock.ticker}
      data-superinvestors-href={ROUTES.superinvestorsByTicker(stock.ticker)}
      className="inline-flex shrink-0 items-center rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-black text-violet-700 transition hover:border-violet-400 hover:bg-violet-100"
      title={`${stock.ticker} 기관·고수 보유 ${holders.toLocaleString("ko-KR")}명 — 클릭하면 /superinvestors 종목별 보유로 이동`}
      onClick={(event) => event.stopPropagation()}
    >
      {compact ? `고수 ${holders}` : `기관·고수 ${holders}`}
    </TransitionLink>
  );
}

const CONNECTION_BADGES = [
  { key: "marketFacts", label: "시세", className: "border-sky-200 bg-sky-50 text-sky-700" },
  { key: "filings", label: "공시", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  { key: "smartMoney", label: "13F", className: "border-violet-200 bg-violet-50 text-violet-700" },
  { key: "indexMembership", label: "지수", className: "border-amber-200 bg-amber-50 text-amber-700" },
  { key: "singleStockEtfs", label: "ETF", className: "border-cyan-200 bg-cyan-50 text-cyan-700" },
] as const;

function connectionTitle(stock: ScreenerStock): string {
  const connection = stock.connection;
  if (!connection) return "연결 인덱스 없음";
  const asOf = [
    connection.asOf?.marketFacts ? `시세 ${connection.asOf.marketFacts}` : null,
    connection.asOf?.filings ? `공시 ${connection.asOf.filings}` : null,
    connection.asOf?.sec13f ? `13F ${connection.asOf.sec13f}` : null,
    connection.asOf?.actionIndex ? `신호 ${connection.asOf.actionIndex}` : null,
    connection.serviceCount ? `단일종목 ETF ${connection.serviceCount}개` : null,
  ].filter(Boolean);
  return asOf.length ? asOf.join(" · ") : "연결 인덱스 확인됨";
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildConnectionCsv(rows: ScreenerStock[]): string {
  const header = [
    "ticker",
    "name",
    "sector",
    "country",
    "connection_count",
    "market_facts",
    "filings",
    "sec_13f",
    "index_membership",
    "single_stock_etfs",
    "service_count",
    "single_stock_etf_tickers",
    "single_stock_etf_resolution_methods",
    "single_stock_etf_resolution_sources",
    "profile_as_of",
    "market_facts_as_of",
    "filings_as_of",
    "sec_13f_as_of",
    "etf_universe_as_of",
  ];
  const body = rows.map((stock) => {
    const connection = stock.connection;
    const flags = connection?.flags;
    const serviceLinks = connection?.singleStockEtfs ?? [];
    return [
      stock.ticker,
      stock.name,
      stock.sector,
      stock.country,
      connection?.count ?? "",
      flags?.marketFacts === true ? "1" : "0",
      flags?.filings === true ? "1" : "0",
      flags?.smartMoney === true ? "1" : "0",
      flags?.indexMembership === true ? "1" : "0",
      flags?.singleStockEtfs === true ? "1" : "0",
      connection?.serviceCount ?? "",
      serviceLinks.map((link) => link.ticker).join("|"),
      [...new Set(serviceLinks.map((link) => link.resolution_method).filter(Boolean))].join("|"),
      [...new Set(serviceLinks.map((link) => link.resolution_source).filter(Boolean))].join("|"),
      connection?.asOf?.profile ?? "",
      connection?.asOf?.marketFacts ?? "",
      connection?.asOf?.filings ?? "",
      connection?.asOf?.sec13f ?? "",
      serviceLinks.find((link) => typeof link.as_of?.etf_universe === "string")?.as_of?.etf_universe ?? "",
    ].map(csvCell).join(",");
  });
  return [header.join(","), ...body].join("\n");
}

function downloadConnectionCsv(rows: ScreenerStock[]) {
  if (typeof window === "undefined" || rows.length === 0) return;
  const blob = new Blob([buildConnectionCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `100xfenok-screener-connections-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function singleStockEtfTickers(rows: ScreenerStock[]): string[] {
  const seen = new Set<string>();
  const tickers: string[] = [];
  for (const stock of rows) {
    for (const link of stock.connection?.singleStockEtfs ?? []) {
      const ticker = String(link.ticker || "").trim().toUpperCase();
      if (!ticker || seen.has(ticker)) continue;
      seen.add(ticker);
      tickers.push(ticker);
    }
  }
  return tickers;
}

function buildSingleStockEtfCompareHref(rows: ScreenerStock[]): string | null {
  const tickers = singleStockEtfTickers(rows);
  if (tickers.length < 2) return null;
  return `/etfs/compare?tickers=${encodeURIComponent(tickers.slice(0, 4).join(","))}`;
}

function ConnectionPills({ stock, compact = false }: { stock: ScreenerStock; compact?: boolean }) {
  const connection = stock.connection;
  if (!connection) return <span className="text-slate-300">—</span>;
  const active = CONNECTION_BADGES.filter((badge) => connection.flags[badge.key]);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1" title={connectionTitle(stock)}>
      <span className="orbitron rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-black tabular-nums text-slate-800">
        {connection.count}
      </span>
      {active.slice(0, compact ? 2 : 4).map((badge) => (
        <span key={badge.key} className={cx("rounded-full border px-1.5 py-0.5 text-[9px] font-black", badge.className)}>
          {badge.label}
        </span>
      ))}
      {compact && active.length > 2 ? (
        <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-black text-slate-600">
          +{active.length - 2}
        </span>
      ) : null}
    </span>
  );
}

function getMomentumClass(value: number | null): string {
  if (value === null) return "text-[var(--c-ink-4)]";
  return value >= 0 ? "text-[var(--c-up)]" : "text-[var(--c-down)]";
}

function renderCell(stock: ScreenerStock, key: ScreenerSortKey, preset?: ColumnPreset): React.ReactNode {
  switch (key) {
    case "ticker":
      return (
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-sm font-black text-[var(--c-ink)]">{stock.ticker}</span>
          <GuruHolderBadge stock={stock} compact />
        </span>
      );
    case "name":
      return (
        <span className="block min-w-0 max-w-[180px]">
          <span className="orbitron text-sm font-black text-[var(--c-ink)]">{stock.ticker}</span>
          <span className="block truncate text-[11px] font-semibold text-[var(--c-ink-3)]" title={stock.name ?? undefined}>
            {stock.name ?? "—"}
          </span>
        </span>
      );
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
    case "fenokEdgeScore": {
      const score = typeof stock.fenokEdgeScore === "number" && Number.isFinite(stock.fenokEdgeScore)
        ? Math.round(stock.fenokEdgeScore)
        : null;
      return (
        <span className="inline-flex min-w-[64px] justify-end">
          <span
            className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black tabular-nums", fenokEdgeTone(score))}
            title={fenokEdgeTitle(stock)}
            aria-label={`Fenok 엣지 점수 ${fenokEdgeDirectionLabel(stock.fenokEdgeDirection)} ${score ?? "정보 없음"}`}
          >
            <span aria-hidden="true">{fenokEdgeDirectionMark(stock.fenokEdgeDirection)}</span>
            {score ?? "—"}
          </span>
        </span>
      );
    }
    case "fenokConvictionScore": {
      const shortScore = typeof stock.fenokShortTermScore === "number" && Number.isFinite(stock.fenokShortTermScore)
        ? Math.round(stock.fenokShortTermScore)
        : null;
      const longScore = typeof stock.fenokLongTermScore === "number" && Number.isFinite(stock.fenokLongTermScore)
        ? Math.round(stock.fenokLongTermScore)
        : null;
      const isPicks = preset === "fenokPicks";
      return (
        <span className={cx("inline-flex flex-col items-end gap-1", isPicks ? "min-w-[140px]" : "min-w-[80px]")}>
          <span className="inline-flex flex-wrap justify-end gap-1">
            <span
              className={cx("inline-flex items-center gap-0.5 rounded-full border px-1.5 py-[2px] text-[10px] font-black tabular-nums", signalScoreTone(shortScore))}
              title="단기 Fenok 점수 · 매수권유 아님"
              aria-label={`단기 컨빅션 ${shortScore ?? "정보 없음"}`}
            >
              <span aria-hidden="true">단기</span>
              {shortScore ?? "—"}
            </span>
            <span
              className={cx("inline-flex items-center gap-0.5 rounded-full border px-1.5 py-[2px] text-[10px] font-black tabular-nums", signalScoreTone(longScore))}
              title="장기 Fenok 점수 · 매수권유 아님"
              aria-label={`장기 컨빅션 ${longScore ?? "정보 없음"}`}
            >
              <span aria-hidden="true">장기</span>
              {longScore ?? "—"}
            </span>
          </span>
          {isPicks ? (
            <span className="inline-flex flex-wrap justify-end gap-1">
              {[
                { label: "수익", score: stock.profitabilityScore, direction: stock.profitabilityDirection, tone: "signal" as const },
                { label: "내구", score: stock.durabilityProfitabilityScore, direction: null, tone: "signal" as const },
                { label: "성장", score: stock.growthScore, direction: stock.growthDirection, tone: "signal" as const },
                { label: "기술", score: stock.technicalFlowScore, direction: stock.technicalFlowDirection, tone: "signal" as const },
                { label: "상방", score: stock.upsidePotentialScore, direction: null, tone: "signal" as const },
                { label: "하방", score: stock.downsidePressureScore, direction: null, tone: "risk" as const },
              ].map((item) => {
                const itemScore = typeof item.score === "number" && Number.isFinite(item.score) ? Math.round(item.score) : null;
                return (
                  <span
                    key={item.label}
                    className={cx("inline-flex items-center gap-0.5 rounded border px-1 py-[1px] text-[9px] font-black tabular-nums", item.tone === "risk" ? downsideRiskTone(itemScore) : signalScoreTone(itemScore))}
                    title={`${item.label} ${signalDirectionLabel(item.direction)} · Fenok 파생 신호`}
                    aria-label={`${item.label} ${itemScore ?? "정보 없음"}`}
                  >
                    <span aria-hidden="true">{item.label}</span>
                    {itemScore ?? "—"}
                  </span>
                );
              })}
            </span>
          ) : null}
        </span>
      );
    }
    case "profitabilityScore":
    case "growthScore":
    case "technicalFlowScore":
    case "durabilityProfitabilityScore":
    case "upsidePotentialScore": {
      const score = typeof stock[key] === "number" && Number.isFinite(stock[key]) ? Math.round(stock[key] as number) : null;
      const direction = key === "profitabilityScore"
        ? stock.profitabilityDirection
        : key === "growthScore"
          ? stock.growthDirection
          : key === "technicalFlowScore"
            ? stock.technicalFlowDirection
            : null;
      const titleSuffix = key === "durabilityProfitabilityScore"
        ? `데이터 ${formatCoverage(stock.durabilityProfitabilityCoverage)} · Fenok 파생 신호 · 매수권유 아님`
        : "Fenok 파생 신호 · 매수권유 아님";
      return (
        <span className="inline-flex min-w-[64px] justify-end">
          <span
            className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black tabular-nums", signalScoreTone(score))}
            title={`${columnLabel(key)} ${signalDirectionLabel(direction)} · ${titleSuffix}`}
            aria-label={`${columnLabel(key)} ${score ?? "정보 없음"}`}
          >
            <span aria-hidden="true">{signalDirectionLabel(direction)}</span>
            {score ?? "—"}
          </span>
        </span>
      );
    }
    case "downsidePressureScore": {
      const score = typeof stock.downsidePressureScore === "number" && Number.isFinite(stock.downsidePressureScore)
        ? Math.round(stock.downsidePressureScore)
        : null;
      return (
        <span className="inline-flex min-w-[64px] justify-end">
          <span
            className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black tabular-nums", downsideRiskTone(score))}
            title={`${columnLabel(key)} · 하방 위험 축: 높을수록 위험 · Fenok 파생 신호 · 매수권유 아님`}
            aria-label={`${columnLabel(key)} ${score ?? "정보 없음"}`}
          >
            {score ?? "—"}
          </span>
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
    case "peg":
      return <span className="orbitron tabular-nums text-slate-700">{fmtNum(stock.peg, 2)}</span>;
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
      return guruHoldersCount(stock) !== null ? (
        <span className="orbitron tabular-nums font-bold text-violet-700">{guruHoldersCount(stock)}</span>
      ) : (
        <span className="text-slate-300">—</span>
      );
    case "connectionCount":
      return <ConnectionPills stock={stock} />;
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
        <span className="orbitron font-black tabular-nums text-slate-800 text-[10px] truncate">
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

const ESTIMATE_PERIOD_LABELS = ["FY+1", "FY+2", "FY+3"] as const;

type MobileEstimateTrendRow = {
  label: string;
  values: Array<number | null | undefined>;
  formatValue: (value: number | null) => string;
  tone?: "signed" | "neutral";
};

type MobileEstimateTrendSection = {
  title: string;
  rows: MobileEstimateTrendRow[];
};

function hasFiniteTrendValue(row: MobileEstimateTrendRow): boolean {
  return row.values.some((value) => typeof value === "number" && Number.isFinite(value));
}

function normalizeTrendValue(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function trendValueClass(value: number | null, tone: MobileEstimateTrendRow["tone"]): string {
  if (value === null || tone !== "signed") return "text-slate-900";
  return getMomentumClass(value);
}

function buildMobileEstimateTrendSections(stock: ScreenerStock): MobileEstimateTrendSection[] {
  const sections: MobileEstimateTrendSection[] = [
    {
      title: "밸류",
      rows: [
        { label: "PER", values: [stock.forwardPeFy1, stock.forwardPeFy2, stock.forwardPeFy3], formatValue: (value) => fmtNum(value, 1) },
        { label: "EPS", values: [stock.forwardEpsFy1, stock.forwardEpsFy2, stock.forwardEpsFy3], formatValue: fmtEps },
      ],
    },
    {
      title: "성장",
      rows: [
        { label: "매출", values: [stock.revenueGrowthFy1, stock.revenueGrowthFy2, stock.revenueGrowthFy3], formatValue: fmtSignedPctPoint, tone: "signed" },
        { label: "EPS", values: [stock.epsGrowthFy1, stock.epsGrowthFy2, stock.epsGrowthFy3], formatValue: fmtSignedPctPoint, tone: "signed" },
      ],
    },
    {
      title: "수익성",
      rows: [
        { label: "ROE", values: [stock.roeFy1, stock.roeFy2, stock.roeFy3], formatValue: (value) => (value === null ? "—" : `${value.toFixed(1)}%`), tone: "signed" },
        { label: "OPM", values: [stock.operatingMarginFy1, stock.operatingMarginFy2, stock.operatingMarginFy3], formatValue: (value) => (value === null ? "—" : `${value.toFixed(1)}%`), tone: "signed" },
        { label: "GPM", values: [stock.grossMarginFy1, stock.grossMarginFy2, stock.grossMarginFy3], formatValue: (value) => (value === null ? "—" : `${value.toFixed(1)}%`), tone: "signed" },
      ],
    },
  ];

  return sections
    .map((section) => ({ ...section, rows: section.rows.filter(hasFiniteTrendValue) }))
    .filter((section) => section.rows.length > 0);
}

function MobileEstimateTrendSections({ stock, compact = false }: { stock: ScreenerStock; compact?: boolean }) {
  const sections = buildMobileEstimateTrendSections(stock);
  if (sections.length === 0) {
    if (compact) return null;
    return (
      <div className="px-3 pb-3">
        <div className="border-t border-[var(--c-line-2)] pt-3 text-xs font-bold text-[var(--c-ink-3)]">추정치 없음</div>
      </div>
    );
  }

  return (
    <div
      data-testid={compact ? "screener-mobile-estimate-trend" : undefined}
      className={cx(
        "space-y-3 px-3",
        compact ? "border-t border-[var(--c-line-2)] py-3" : "pb-3",
      )}
    >
      {sections.map((section) => (
        <div key={section.title} className={compact ? "rounded-xl border border-[var(--c-line-2)] bg-[var(--c-surface-2)] px-3 py-2" : "border-t border-[var(--c-line-2)] pt-3"}>
          <div className="mb-2 flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-2)]">{section.title}</span>
            <span className="grid w-full grid-cols-2 gap-1 text-center text-[9px] font-black text-[var(--c-ink-2)] sm:w-auto sm:min-w-[132px] sm:grid-cols-3">
              {ESTIMATE_PERIOD_LABELS.map((label) => <span key={`${section.title}-${label}`}>{label}</span>)}
            </span>
          </div>
          <div className="space-y-1.5">
            {section.rows.map((row) => {
              const completeness = estimateCompletenessFromValues(row.values);
              const showGap = hasEstimateGap(completeness);
              return (
                <div key={`${section.title}-${row.label}`} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[62px_minmax(0,1fr)] sm:items-center sm:gap-2">
                  <span className="min-w-0 truncate text-[10px] font-black text-slate-500">
                    {row.label}
                    {showGap ? (
                      <span className={cx("ml-1 rounded-full px-1 py-[1px] text-[8px]", estimateCompletenessTone(completeness))}>
                        {completeness.label}
                      </span>
                    ) : null}
                  </span>
                  <span className="grid min-w-0 grid-cols-2 gap-1 sm:grid-cols-3">
                    {row.values.map((raw, index) => {
                      const value = normalizeTrendValue(raw);
                      return (
                        <span
                          key={`${section.title}-${row.label}-${ESTIMATE_PERIOD_LABELS[index]}`}
                          className={cx("orbitron min-w-0 truncate text-right text-[11px] font-black tabular-nums", trendValueClass(value, row.tone))}
                          title={`${row.label} ${ESTIMATE_PERIOD_LABELS[index]} ${row.formatValue(value)}`}
                        >
                          {row.formatValue(value)}
                        </span>
                      );
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function MobileMetric({ stock, metricKey, preset }: { stock: ScreenerStock; metricKey: ScreenerSortKey; preset?: ColumnPreset }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--c-line-2)] bg-[var(--c-surface-2)] px-3 py-2">
      <span className="block truncate text-[11px] font-black uppercase tracking-[0.06em] text-[var(--c-ink-2)]">
        <MetricHelp label={columnLabel(metricKey)} metricKey={metricKey} align="right" />
      </span>
      <span className="mt-1 block min-w-0 truncate text-right text-sm font-black text-[var(--c-ink)]">
        {renderMobileCell(stock, metricKey, preset)}
      </span>
    </div>
  );
}

function mobileMetricKeys(preset: ColumnPreset): ScreenerSortKey[] {
  const keys = MOBILE_PRESET_KEYS[preset];
  return keys.slice(0, 8);
}

function ScreenerEmptyState({
  canvasPlusPreview,
  hasFilters,
  onResetFilters,
}: {
  canvasPlusPreview: boolean;
  hasFilters: boolean;
  onResetFilters: () => void;
}) {
  if (!canvasPlusPreview) {
    return (
      <div className="col-span-full px-2 py-10 text-center text-sm font-semibold text-[var(--c-ink-3)]">
        조건에 맞는 종목이 없습니다.
      </div>
    );
  }

  return (
    <div className="cp-screener-empty-state" data-canvas-plus-screener-empty-state="true">
      <p>조건에 맞는 종목이 없습니다.</p>
      {hasFilters ? (
        <button
          type="button"
          onClick={onResetFilters}
          className="cp-button cp-screener-empty-action"
          data-variant="ghost"
          data-density="compact"
        >
          필터 초기화
        </button>
      ) : null}
    </div>
  );
}

function MobileStockCard({
  stock,
  expanded,
  detailId,
  preset,
  selected,
  canvasPlusPreview,
  onToggle,
  onSelectedChange,
}: {
  stock: ScreenerStock;
  expanded: boolean;
  detailId: string;
  preset: ColumnPreset;
  selected: boolean;
  canvasPlusPreview: boolean;
  onToggle: () => void;
  onSelectedChange: () => void;
}) {
  const lowEvidence = stock.lowEvidence === true;
  const confidence = confidenceText(stock.confidenceLabel);
  const detail = [confidence, lowEvidence ? "증거 부족" : null].filter(Boolean).join(" · ");
  const actionTitle = [...(stock.actionReasons ?? []), detail].filter(Boolean).join(" · ");
  const estimateSummary = preset === "estimate" ? interpretStockMetrics(stock).estimateSummary : null;
  const metrics = mobileMetricKeys(preset);
  return (
    <article
      data-screener-stock-card
      data-canvas-plus-screener-card={canvasPlusPreview ? "mobile" : undefined}
      className={canvasPlusPreview ? "cp-screener-stock-card cp-screener-stock-card--mobile" : "overflow-hidden rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel)] shadow-[var(--sh-sm)]"}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--c-line-2)] px-3 py-2">
        <label className="inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-[11px] font-black text-[var(--c-ink-2)]">
          <input
            type="checkbox"
            checked={selected}
            onChange={onSelectedChange}
            className="h-5 min-h-5 w-5 min-w-5 accent-[var(--c-ink)]"
          />
          선택
        </label>
        <span className="text-[10px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-2)]">
          {stock.connection?.singleStockEtfs?.length ? "ETF 연결" : "단일 종목"}
        </span>
      </div>
      <div className="flex min-h-14 w-full min-w-0 items-start gap-2 px-3 py-3 text-left transition hover:bg-[var(--c-surface-2)]">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailId}
          aria-label={`${stock.ticker} 상세 ${expanded ? "접기" : "펼치기"}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--c-surface-2)] text-sm font-black text-[var(--c-ink-2)] transition focus:outline-none focus:ring-2 focus:ring-brand-interactive/40"
        >
          {expanded ? "-" : "+"}
        </button>
        <div onClick={onToggle} className="min-w-0 flex-1 cursor-pointer">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-base font-black text-slate-950">{stock.ticker}</span>
            <GuruHolderBadge stock={stock} compact />
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-700">
              {COUNTRY_LABEL[stock.country] ?? stock.country ?? "—"}
            </span>
            <span
              className={cx("max-w-full truncate rounded-full border px-2 py-0.5 text-[10px] font-black", actionTone(stock.actionBucket, stock.confidenceLabel, lowEvidence))}
              title={actionTitle}
            >
              {stock.actionLabel ?? "관찰"} · {stock.actionScore != null ? Math.round(stock.actionScore) : "—"}
            </span>
            {stock.connection ? <ConnectionPills stock={stock} compact /> : null}
          </span>
          <span className="mt-1 block min-w-0 truncate text-sm font-bold text-slate-700" title={stock.name ?? undefined}>{stock.name}</span>
          <span className="mt-0.5 block min-w-0 truncate text-[11px] font-bold text-[var(--c-ink-2)]">
            {stock.sector || "섹터 미정"}
            {stock.actionReasons?.[0] ? ` · ${stock.actionReasons[0]}` : ""}
          </span>
          {estimateSummary ? (
            <span className="mt-1 block min-w-0 truncate text-[11px] font-black text-[var(--c-brand)]">{estimateSummary}</span>
          ) : null}
        </div>
        <div onClick={onToggle} className="shrink-0 cursor-pointer text-right">
          <span className="orbitron block text-sm font-black tabular-nums text-slate-950">
            {stock.price === null ? "—" : `$${stock.price.toFixed(2)}`}
          </span>
          <span className="orbitron mt-1 block text-[11px] font-black tabular-nums text-slate-500">
            {fmtMarketCap(stock.marketCap)}
          </span>
          <span className={cx("orbitron mt-1 block text-[11px] font-black tabular-nums", getMomentumClass(stock.return12m))}>
            {fmtSignedPct(stock.return12m)}
          </span>
        </div>
      </div>
      <div data-testid="screener-mobile-metric-grid" className="grid grid-cols-2 gap-2 border-t border-[var(--c-line-2)] px-3 py-3 sm:grid-cols-4">
        {metrics.map((metricKey) => (
          <MobileMetric key={metricKey} stock={stock} metricKey={metricKey} preset={preset} />
        ))}
      </div>
      {preset === "estimate" ? <MobileEstimateTrendSections stock={stock} compact /> : null}
      {expanded ? (
        <div id={detailId} className={canvasPlusPreview ? "cp-screener-detail-shell" : "border-t border-[var(--c-line-2)]"}>
          <StockDetailPanel ticker={stock.ticker} stock={stock} canvasPlusPreview={canvasPlusPreview} />
        </div>
      ) : null}
    </article>
  );
}

function DesktopStockCard({
  stock,
  expanded,
  detailId,
  preset,
  selected,
  canvasPlusPreview,
  onToggle,
  onSelectedChange,
}: {
  stock: ScreenerStock;
  expanded: boolean;
  detailId: string;
  preset: ColumnPreset;
  selected: boolean;
  canvasPlusPreview: boolean;
  onToggle: () => void;
  onSelectedChange: () => void;
}) {
  const lowEvidence = stock.lowEvidence === true;
  const confidence = confidenceText(stock.confidenceLabel);
  const detail = [confidence, lowEvidence ? "증거 부족" : null].filter(Boolean).join(" · ");
  const actionTitle = [...(stock.actionReasons ?? []), detail].filter(Boolean).join(" · ");
  const metrics = mobileMetricKeys(preset).slice(0, 6);
  return (
    <article
      data-screener-stock-card
      data-screener-desktop-stock-card
      data-canvas-plus-screener-card={canvasPlusPreview ? "desktop" : undefined}
      className={canvasPlusPreview ? "cp-screener-stock-card cp-screener-stock-card--desktop" : "overflow-hidden rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel)] shadow-[var(--sh-sm)]"}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--c-line-2)] px-4 py-3">
        <label className="inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-[11px] font-black text-[var(--c-ink-2)]">
          <input
            type="checkbox"
            checked={selected}
            onChange={onSelectedChange}
            className="h-5 min-h-5 w-5 min-w-5 accent-[var(--c-ink)]"
          />
          선택
        </label>
        <TransitionLink
          href={ROUTES.stock(stock.ticker)}
          className="inline-flex min-h-11 items-center rounded-full border border-[var(--c-line)] px-3 text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-2)] transition hover:border-[var(--c-ink-4)] hover:text-[var(--c-ink)]"
        >
          상세
        </TransitionLink>
      </div>
      <div className="flex min-w-0 items-start gap-3 px-4 py-4">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailId}
          aria-label={`${stock.ticker} 상세 ${expanded ? "접기" : "펼치기"}`}
          onClick={onToggle}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--c-surface-2)] text-sm font-black text-[var(--c-ink-2)] transition focus:outline-none focus:ring-2 focus:ring-brand-interactive/40"
        >
          {expanded ? "-" : "+"}
        </button>
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="orbitron text-lg font-black text-slate-950">{stock.ticker}</span>
            <GuruHolderBadge stock={stock} compact />
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
          <span className="mt-1 block min-w-0 truncate text-sm font-bold text-slate-700" title={stock.name ?? undefined}>{stock.name}</span>
          <span className="mt-0.5 block min-w-0 truncate text-[11px] font-bold text-[var(--c-ink-2)]">
            {stock.sector || "섹터 미정"}
            {stock.connection ? " · 연결 데이터 있음" : ""}
          </span>
        </button>
        <button type="button" onClick={onToggle} className="shrink-0 text-right">
          <span className="orbitron block text-base font-black tabular-nums text-slate-950">
            {stock.price === null ? "—" : `$${stock.price.toFixed(2)}`}
          </span>
          <span className="orbitron mt-1 block text-[11px] font-black tabular-nums text-slate-500">
            {fmtMarketCap(stock.marketCap)}
          </span>
          <span className={cx("orbitron mt-1 block text-[11px] font-black tabular-nums", getMomentumClass(stock.return12m))}>
            {fmtSignedPct(stock.return12m)}
          </span>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-[var(--c-line-2)] px-4 py-3 lg:grid-cols-3">
        {metrics.map((metricKey) => (
          <MobileMetric key={metricKey} stock={stock} metricKey={metricKey} preset={preset} />
        ))}
      </div>
      {expanded ? (
        <div id={detailId} className={canvasPlusPreview ? "cp-screener-detail-shell" : "border-t border-[var(--c-line-2)]"}>
          <StockDetailPanel ticker={stock.ticker} stock={stock} canvasPlusPreview={canvasPlusPreview} />
        </div>
      ) : null}
    </article>
  );
}

export default function ScreenerClient({
  enableCanvasPlusPreview = false,
  initialSearch = "",
  initialSector = "",
  initialMacroContextId,
  initialPreset,
  initialActionFilter,
  initialConnectionFilter,
  initialFilters,
}: {
  initialSearch?: string;
  initialSector?: string;
  initialMacroContextId?: MacroContextId;
  initialPreset?: string;
  initialActionFilter?: string;
  initialConnectionFilter?: string;
  initialFilters?: Partial<ScreenerFilterState>;
  enableCanvasPlusPreview?: boolean;
}) {
  const initialFilterValues = initialFilters ?? defaultScreenerFilterState();
  const {
    stocks: rawStocks,
    dataReady,
    failed,
    sourceDate,
    connectionIndexDate,
    connectionIndexReady,
    sectors,
    countries,
  } = useScreenerData();
  const [guruMap, setGuruMap] = useState<Record<string, number> | null>(null);
  const [actionMap, setActionMap] = useState<Record<string, ActionSummaryRecord> | null>(null);

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
    loadActionSummaryMap()
      .then((map) => {
        if (cancelled) return;
        const next: Record<string, ActionSummaryRecord> = {};
        for (const [symbol, row] of map) next[symbol] = row;
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
        peg: (() => {
          const fpe = action?.forwardPeFy1 ?? s.peForward ?? null;
          const eg = action?.epsGrowthFy1 ?? null;
          return fpe !== null && fpe > 0 && eg !== null && eg > 0 ? fpe / eg : null;
        })(),
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
  const [selectedSectors, setSelectedSectors] = useState<string[]>(() => {
    if (initialFilterValues.selectedSectors && initialFilterValues.selectedSectors.length > 0) {
      return initialFilterValues.selectedSectors;
    }
    return initialSector ? [initialSector] : [];
  });
  const [selectedCountries, setSelectedCountries] = useState<string[]>(() => initialFilterValues.selectedCountries ?? []);
  const [perMin, setPerMin] = useState(() => initialFilterValues.perMin ?? "");
  const [perMax, setPerMax] = useState(() => initialFilterValues.perMax ?? "");
  const [forwardPerMax, setForwardPerMax] = useState(() => initialFilterValues.forwardPerMax ?? "");
  const [revenueGrowthMin, setRevenueGrowthMin] = useState(() => initialFilterValues.revenueGrowthMin ?? "");
  const [epsGrowthMin, setEpsGrowthMin] = useState(() => initialFilterValues.epsGrowthMin ?? "");
  const [dividendYieldMin, setDividendYieldMin] = useState(() => initialFilterValues.dividendYieldMin ?? "");
  const [dividendYieldMax, setDividendYieldMax] = useState(() => initialFilterValues.dividendYieldMax ?? "");
  const [roeFy1Min, setRoeFy1Min] = useState(() => initialFilterValues.roeFy1Min ?? "");
  const [ret3yMin, setRet3yMin] = useState(() => initialFilterValues.ret3yMin ?? "");
  const [ret5yMin, setRet5yMin] = useState(() => initialFilterValues.ret5yMin ?? "");
  const [marketCapMin, setMarketCapMin] = useState(() => initialFilterValues.marketCapMin ?? "");
  const [marketCapMax, setMarketCapMax] = useState(() => initialFilterValues.marketCapMax ?? "");
  const [pbrMin, setPbrMin] = useState(() => initialFilterValues.pbrMin ?? "");
  const [pbrMax, setPbrMax] = useState(() => initialFilterValues.pbrMax ?? "");
  const [pegMax, setPegMax] = useState(() => initialFilterValues.pegMax ?? "");
  const [roeMin, setRoeMin] = useState(() => initialFilterValues.roeMin ?? "");
  const [opmMin, setOpmMin] = useState(() => initialFilterValues.opmMin ?? "");
  const [return12mMin, setReturn12mMin] = useState(() => initialFilterValues.return12mMin ?? "");
  const [profitableOnly, setProfitableOnly] = useState(() => initialFilterValues.profitableOnly ?? false);
  const [bandFilter, setBandFilter] = useState<"" | "cheap" | "fair" | "rich">(() => initialFilterValues.bandFilter ?? "");
  const [actionFilter, setActionFilter] = useState<ActionFilter>(() => coerceActionFilter(initialActionFilter || initialFilterValues.actionFilter));
  const [fenokEdgeMin, setFenokEdgeMin] = useState<FenokEdgeFilter>(() => coerceFenokEdgeFilter(initialFilterValues.fenokEdgeMin));
  const [convictionMin, setConvictionMin] = useState<ConvictionFilter>(() => coerceConvictionFilter(initialFilterValues.convictionMin));
  const [connectionFilter, setConnectionFilter] = useState<ConnectionFilter>(() => coerceConnectionFilter(initialConnectionFilter || initialFilterValues.connectionFilter));
  const [sortKey, setSortKey] = useState<ScreenerSortKey>(() => initialFilterValues.sortKey ?? "marketCap");
  const [sortDir, setSortDir] = useState<SortDir>(() => initialFilterValues.sortDir ?? "desc");
  const [page, setPage] = useState(0);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(() => initialSearch || null);
  const [selectedTickers, setSelectedTickers] = useState<ReadonlySet<string>>(() => new Set());
  const [prevInitialSearch, setPrevInitialSearch] = useState(initialSearch);
  const [prevInitialSector, setPrevInitialSector] = useState(initialSector);

  if (prevInitialSearch !== initialSearch) {
    setPrevInitialSearch(initialSearch);
    setSearch(initialSearch);
    setExpandedTicker(initialSearch || null);
  }
  if (prevInitialSector !== initialSector) {
    setPrevInitialSector(initialSector);
    setSelectedSectors(initialSector ? [initialSector] : []);
  }

  const initialColumnPreset = coerceColumnPreset(initialPreset);
  const [preset, setPreset] = useState<ColumnPreset>(() => initialColumnPreset ?? initialFilterValues.preset ?? "basic");
  const [viewMode, setViewMode] = useState<ScreenerViewMode>("table");
  const [density, setDensity] = useState<ScreenerDensity>("standard");
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);

  useEffect(() => {
    if (initialColumnPreset) return;
    const saved = localStorage.getItem("screener-preset") as ColumnPreset | null;
    if (!saved || !PRESET_KEYS[saved]) return;
    const frame = window.requestAnimationFrame(() => {
      setPreset(saved);
      setSortKey((current) => {
        if (PRESET_KEYS[saved].includes(current)) return current;
        setSortDir("desc");
        return saved === "fenokPicks" ? "fenokConvictionScore" : "marketCap";
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialColumnPreset]);

  useEffect(() => {
    const saved = localStorage.getItem("screener-density");
    if (saved === "compact" || saved === "standard" || saved === "comfortable") {
      const frame = window.requestAnimationFrame(() => setDensity(saved));
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("screener-view-mode");
    if (saved === "table" || saved === "card") {
      const frame = window.requestAnimationFrame(() => setViewMode(saved));
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, []);

  // Ensure Fenok Picks always defaults to conviction desc when no explicit valid sort is set.
  useEffect(() => {
    if (preset !== "fenokPicks") return;
    if (PRESET_KEYS.fenokPicks.includes(sortKey)) return;

    const frame = window.requestAnimationFrame(() => {
      setSortKey("fenokConvictionScore");
      setSortDir("desc");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [preset, sortKey]);

  const activeColumns = useMemo(() => {
    const keys = new Set(PRESET_KEYS[preset]);
    return COLUMNS.filter((c) => keys.has(c.key));
  }, [preset]);

  function handlePresetChange(next: ColumnPreset) {
    setPreset(next);
    localStorage.setItem("screener-preset", next);
    // Default sort for Fenok Picks is conviction desc; otherwise reset to a valid column
    if (next === "fenokPicks") {
      setSortKey("fenokConvictionScore");
      setSortDir("desc");
    } else {
      const validKeys = PRESET_KEYS[next];
      if (!validKeys.includes(sortKey)) {
        setSortKey("marketCap");
        setSortDir("desc");
      }
    }
  }

  function handleDensityChange(next: ScreenerDensity) {
    setDensity(next);
    localStorage.setItem("screener-density", next);
  }

  function handleViewModeChange(next: ScreenerViewMode) {
    setViewMode(next);
    localStorage.setItem("screener-view-mode", next);
  }

  // Sync filter state to URL for deep-link round-trips.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = updateScreenerUrl(window.location.href, {
      search,
      selectedSectors,
      selectedCountries,
      perMin,
      perMax,
      forwardPerMax,
      revenueGrowthMin,
      epsGrowthMin,
      dividendYieldMin,
      dividendYieldMax,
      roeFy1Min,
      ret3yMin,
      ret5yMin,
      marketCapMin,
      marketCapMax,
      pbrMin,
      pbrMax,
      pegMax,
      roeMin,
      opmMin,
      return12mMin,
      profitableOnly,
      bandFilter,
      actionFilter,
      fenokEdgeMin,
      convictionMin,
      connectionFilter,
      sortKey,
      sortDir,
      preset,
    });
    if (next !== window.location.href) {
      window.history.replaceState(null, "", next);
    }
  }, [
    search,
    selectedSectors,
    selectedCountries,
    perMin,
    perMax,
    forwardPerMax,
    revenueGrowthMin,
    epsGrowthMin,
    dividendYieldMin,
    dividendYieldMax,
    roeFy1Min,
    ret3yMin,
    ret5yMin,
    marketCapMin,
    marketCapMax,
    pbrMin,
    pbrMax,
    pegMax,
    roeMin,
    opmMin,
    return12mMin,
    profitableOnly,
    bandFilter,
    actionFilter,
    fenokEdgeMin,
    convictionMin,
    connectionFilter,
    sortKey,
    sortDir,
    preset,
  ]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const perMinValue = parseFilterNumber(perMin);
    const perMaxValue = parseFilterNumber(perMax);
    const forwardPerMaxValue = parseFilterNumber(forwardPerMax);
    const revenueGrowthMinValue = parseFilterNumber(revenueGrowthMin);
    const epsGrowthMinValue = parseFilterNumber(epsGrowthMin);
    const dividendYieldMinValue = parseFilterNumber(dividendYieldMin);
    const dividendYieldMaxValue = parseFilterNumber(dividendYieldMax);
    const roeFy1MinValue = parseFilterNumber(roeFy1Min);
    const ret3yMinValue = parseFilterNumber(ret3yMin);
    const ret5yMinValue = parseFilterNumber(ret5yMin);
    const marketCapMinValue = parseFilterNumber(marketCapMin);
    const marketCapMaxValue = parseFilterNumber(marketCapMax);
    const pbrMinValue = parseFilterNumber(pbrMin);
    const pbrMaxValue = parseFilterNumber(pbrMax);
    const pegMaxValue = parseFilterNumber(pegMax);
    const roeMinValue = parseFilterNumber(roeMin);
    const opmMinValue = parseFilterNumber(opmMin);
    const return12mMinValue = parseFilterNumber(return12mMin);
    const fenokEdgeMinValue = parseFilterNumber(fenokEdgeMin);
    const convictionMinValue = parseFilterNumber(convictionMin);

    return stocks.filter((stock) => {
      if (query && !stock.ticker.toLowerCase().includes(query) && !stock.name.toLowerCase().includes(query)) {
        return false;
      }
      if (selectedSectors.length > 0 && !selectedSectors.includes(stock.sector)) return false;
      if (selectedCountries.length > 0 && !selectedCountries.includes(stock.country)) return false;
      if (profitableOnly && (stock.per === null || stock.per <= 0)) return false;
      if (actionFilter === "guru_held") {
        if (!hasGuruHolders(stock)) return false;
      } else if (actionFilter && stock.actionBucket !== actionFilter) {
        return false;
      }
      if (fenokEdgeMinValue !== null && (stock.fenokEdgeScore === null || stock.fenokEdgeScore === undefined || stock.fenokEdgeScore < fenokEdgeMinValue)) return false;
      if (convictionMinValue !== null && (stock.fenokConvictionScore === null || stock.fenokConvictionScore === undefined || stock.fenokConvictionScore < convictionMinValue)) return false;
      if (connectionFilter && !stock.connection?.flags[connectionFilter]) return false;
      if (perMinValue !== null && (stock.per === null || stock.per < perMinValue)) return false;
      if (perMaxValue !== null && (stock.per === null || stock.per <= 0 || stock.per > perMaxValue)) return false;
      if (forwardPerMaxValue !== null && ((stock.forwardPeFy1 ?? null) === null || (stock.forwardPeFy1 as number) <= 0 || (stock.forwardPeFy1 as number) > forwardPerMaxValue)) return false;
      if (revenueGrowthMinValue !== null && ((stock.revenueGrowthFy1 ?? null) === null || (stock.revenueGrowthFy1 as number) < revenueGrowthMinValue)) return false;
      if (epsGrowthMinValue !== null && ((stock.epsGrowthFy1 ?? null) === null || (stock.epsGrowthFy1 as number) < epsGrowthMinValue)) return false;
      if (dividendYieldMinValue !== null && (stock.dividendYield === null || (stock.dividendYield * 100) < dividendYieldMinValue)) return false;
      if (dividendYieldMaxValue !== null && (stock.dividendYield === null || (stock.dividendYield * 100) > dividendYieldMaxValue)) return false;
      if (roeFy1MinValue !== null && ((stock.roeFy1 ?? null) === null || (stock.roeFy1 as number) < roeFy1MinValue)) return false;
      if (ret3yMinValue !== null && (stock.ret3y === null || (stock.ret3y * 100) < ret3yMinValue)) return false;
      if (ret5yMinValue !== null && (stock.ret5y === null || (stock.ret5y * 100) < ret5yMinValue)) return false;
      if (marketCapMinValue !== null && (stock.marketCap === null || stock.marketCap < marketCapMinValue * 1000)) return false;
      if (marketCapMaxValue !== null && (stock.marketCap === null || stock.marketCap > marketCapMaxValue * 1000)) return false;
      if (pbrMinValue !== null && (stock.pbr === null || stock.pbr < pbrMinValue)) return false;
      if (pbrMaxValue !== null && (stock.pbr === null || stock.pbr > pbrMaxValue)) return false;
      if (pegMaxValue !== null && (stock.peg === null || stock.peg > pegMaxValue)) return false;
      if (roeMinValue !== null && (stock.roe === null || stock.roe * 100 < roeMinValue)) return false;
      if (opmMinValue !== null && (stock.opm === null || stock.opm * 100 < opmMinValue)) return false;
      if (return12mMinValue !== null && (stock.return12m === null || stock.return12m * 100 < return12mMinValue)) return false;

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
  }, [stocks, search, selectedSectors, selectedCountries, perMin, perMax, forwardPerMax, revenueGrowthMin, epsGrowthMin, dividendYieldMin, dividendYieldMax, roeFy1Min, ret3yMin, ret5yMin, marketCapMin, marketCapMax, pbrMin, pbrMax, pegMax, roeMin, opmMin, return12mMin, profitableOnly, bandFilter, actionFilter, fenokEdgeMin, convictionMin, connectionFilter]);

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

  const stateKey = `${search}|${selectedSectors.join(",")}|${selectedCountries.join(",")}|${perMin}|${perMax}|${forwardPerMax}|${revenueGrowthMin}|${epsGrowthMin}|${dividendYieldMin}|${dividendYieldMax}|${roeFy1Min}|${ret3yMin}|${ret5yMin}|${marketCapMin}|${marketCapMax}|${pbrMin}|${pbrMax}|${pegMax}|${roeMin}|${opmMin}|${return12mMin}|${profitableOnly}|${bandFilter}|${actionFilter}|${fenokEdgeMin}|${convictionMin}|${connectionFilter}|${sortKey}|${sortDir}|${preset}`;
  const [prevStateKey, setPrevStateKey] = useState(stateKey);
  if (prevStateKey !== stateKey) {
    setPrevStateKey(stateKey);
    if (page !== 0) setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const singleStockEtfCompareHref = useMemo(() => buildSingleStockEtfCompareHref(sorted), [sorted]);
  const selectedRows = useMemo(
    () => sorted.filter((stock) => selectedTickers.has(stock.ticker)),
    [selectedTickers, sorted],
  );
  const selectedSingleStockEtfCount = useMemo(() => singleStockEtfTickers(selectedRows).length, [selectedRows]);
  const selectedSingleStockEtfCompareHref = useMemo(() => buildSingleStockEtfCompareHref(selectedRows), [selectedRows]);
  const pageSelectedCount = pageRows.filter((stock) => selectedTickers.has(stock.ticker)).length;
  const allPageSelected = pageRows.length > 0 && pageSelectedCount === pageRows.length;
  const screenerDataState = useMemo(() => {
    if (failed) {
      return makeDataState({
        status: "error",
        label: "종목 데이터 오류",
        detail: "스크리너 데이터를 불러오지 못했습니다. 잠시 후 다시 열거나 다른 화면으로 이동해 주세요.",
        asOf: sourceDate,
      });
    }
    if (!dataReady) {
      return makeDataState({
        status: "pending",
        label: "종목 데이터 확인 중",
        detail: "글로벌 종목 데이터와 보강 지표를 읽고 있습니다.",
        asOf: sourceDate,
      });
    }
    if (stocks.length === 0) {
      return makeDataState({
        status: "unavailable",
        label: "표시할 종목 없음",
        detail: "데이터 파일은 열렸지만 표시 가능한 종목이 없습니다.",
        asOf: sourceDate,
      });
    }
    const missingPrice = stocks.filter((stock) => stock.price === null).length;
    if (missingPrice > 0) {
      return makeDataState({
        status: "partial",
        label: "일부 가격 없음",
        detail: `${missingPrice.toLocaleString("ko-KR")}개 종목은 가격 없이 표시됩니다. 정렬과 필터는 확인된 값 기준입니다.`,
        asOf: sourceDate,
      });
    }
    return makeDataState({
      status: "ready",
      label: "종목 데이터 준비됨",
      detail: connectionIndexReady
        ? `${stocks.length.toLocaleString("ko-KR")}개 종목과 연결 인덱스를 표시할 수 있습니다.`
        : `${stocks.length.toLocaleString("ko-KR")}개 종목을 표시할 수 있습니다. 연결 인덱스는 준비 전입니다.`,
      asOf: connectionIndexDate ?? sourceDate,
    });
  }, [connectionIndexDate, connectionIndexReady, dataReady, failed, sourceDate, stocks]);

  const toggleSort = useCallback((key: ScreenerSortKey) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      const textColumn = key === "ticker" || key === "name" || key === "sector" || key === "country";
      setSortDir(textColumn || key === "rank" ? "asc" : "desc");
    }
  }, [sortKey]);

  const toggleSelectedTicker = useCallback((ticker: string) => {
    setSelectedTickers((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  }, []);

  const selectPageRows = useCallback(() => {
    setSelectedTickers((prev) => {
      const next = new Set(prev);
      for (const stock of pageRows) next.add(stock.ticker);
      return next;
    });
  }, [pageRows]);

  const deselectPageRows = useCallback(() => {
    setSelectedTickers((prev) => {
      const next = new Set(prev);
      for (const stock of pageRows) next.delete(stock.ticker);
      return next;
    });
  }, [pageRows]);

  const onToggleExpandedTicker = useCallback((ticker: string) => {
    setExpandedTicker((prev) => (prev === ticker ? null : ticker));
  }, []);

  const renderGuruHolderBadge = useCallback(
    (stock: ScreenerStock) => <GuruHolderBadge stock={stock} compact />,
    [],
  );

  function selectFilteredRows() {
    setSelectedTickers(new Set(sorted.map((stock) => stock.ticker)));
  }

  function clearSelectedRows() {
    setSelectedTickers(new Set());
  }

  function resetFilters() {
    setSearch("");
    setSelectedSectors([]);
    setSelectedCountries([]);
    setPerMin("");
    setPerMax("");
    setForwardPerMax("");
    setRevenueGrowthMin("");
    setEpsGrowthMin("");
    setDividendYieldMin("");
    setDividendYieldMax("");
    setRoeFy1Min("");
    setRet3yMin("");
    setRet5yMin("");
    setMarketCapMin("");
    setMarketCapMax("");
    setPbrMin("");
    setPbrMax("");
    setPegMax("");
    setRoeMin("");
    setOpmMin("");
    setReturn12mMin("");
    setProfitableOnly(false);
    setBandFilter("");
    setActionFilter("");
    setFenokEdgeMin("");
    setConvictionMin("");
    setConnectionFilter("");
    setSortKey("marketCap");
    setSortDir("desc");
  }

  function getFilterState(): ScreenerFilterState {
    return {
      search,
      selectedSectors,
      selectedCountries,
      perMin,
      perMax,
      forwardPerMax,
      revenueGrowthMin,
      epsGrowthMin,
      dividendYieldMin,
      dividendYieldMax,
      roeFy1Min,
      ret3yMin,
      ret5yMin,
      marketCapMin,
      marketCapMax,
      pbrMin,
      pbrMax,
      pegMax,
      roeMin,
      opmMin,
      return12mMin,
      profitableOnly,
      bandFilter,
      actionFilter,
      fenokEdgeMin,
      convictionMin,
      connectionFilter,
      sortKey,
      sortDir,
      preset,
    };
  }

  function applyFilterState(next: ScreenerFilterState) {
    setSearch(next.search);
    setSelectedSectors(next.selectedSectors);
    setSelectedCountries(next.selectedCountries);
    setPerMin(next.perMin);
    setPerMax(next.perMax);
    setForwardPerMax(next.forwardPerMax);
    setRevenueGrowthMin(next.revenueGrowthMin);
    setEpsGrowthMin(next.epsGrowthMin);
    setDividendYieldMin(next.dividendYieldMin);
    setDividendYieldMax(next.dividendYieldMax);
    setRoeFy1Min(next.roeFy1Min);
    setRet3yMin(next.ret3yMin);
    setRet5yMin(next.ret5yMin);
    setMarketCapMin(next.marketCapMin);
    setMarketCapMax(next.marketCapMax);
    setPbrMin(next.pbrMin);
    setPbrMax(next.pbrMax);
    setPegMax(next.pegMax);
    setRoeMin(next.roeMin);
    setOpmMin(next.opmMin);
    setReturn12mMin(next.return12mMin);
    setProfitableOnly(next.profitableOnly);
    setBandFilter(next.bandFilter);
    setActionFilter(next.actionFilter);
    setFenokEdgeMin(coerceFenokEdgeFilter(next.fenokEdgeMin));
    setConvictionMin(coerceConvictionFilter(next.convictionMin));
    setConnectionFilter(next.connectionFilter);
    setSortKey(next.sortKey);
    setSortDir(next.sortDir);
    setPreset(next.preset);
    if (typeof window !== "undefined") {
      localStorage.setItem("screener-preset", next.preset);
    }
  }

  const [savedPresets, setSavedPresets] = useState<{ name: string; state: ScreenerFilterState }[]>([]);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [presetName, setPresetName] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame: number | null = null;
    try {
      const raw = localStorage.getItem("screener-filter-presets");
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const presets = parsed.filter((p): p is { name: string; state: ScreenerFilterState } => typeof p === "object" && p !== null && typeof (p as { name?: unknown }).name === "string" && typeof (p as { state?: unknown }).state === "object");
        frame = window.requestAnimationFrame(() => setSavedPresets(presets));
      }
    } catch {
      // ignore malformed localStorage
    }
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("screener-filter-presets", JSON.stringify(savedPresets));
  }, [savedPresets]);

  function handleSavePreset() {
    const name = presetName.trim();
    if (!name) return;
    setSavedPresets((prev) => {
      const filtered = prev.filter((p) => p.name !== name);
      return [...filtered, { name, state: getFilterState() }];
    });
    setPresetName("");
  }

  function handleLoadPreset(state: ScreenerFilterState) {
    applyFilterState(state);
    setPresetMenuOpen(false);
  }

  function handleDeletePreset(name: string) {
    setSavedPresets((prev) => prev.filter((p) => p.name !== name));
  }

  const hasFilters = Boolean(search || selectedSectors.length || selectedCountries.length || perMin || perMax || forwardPerMax || revenueGrowthMin || epsGrowthMin || dividendYieldMin || dividendYieldMax || roeFy1Min || ret3yMin || ret5yMin || marketCapMin || marketCapMax || pbrMin || pbrMax || pegMax || roeMin || opmMin || return12mMin || profitableOnly || bandFilter || actionFilter || fenokEdgeMin || convictionMin || connectionFilter);

  const ACTION_FILTER_LABEL: Record<ActionFilter, string> = {
    "": "",
    guru_held: "기관·고수 보유",
    smart_money: "기관/고수 주목",
    value_momentum: "저평가+모멘텀",
    index_core: "지수 핵심",
    income: "배당 점검",
    momentum: "모멘텀 리더",
    watch: "관찰",
  };
  const CONNECTION_FILTER_LABEL: Record<ConnectionFilter, string> = {
    "": "",
    filings: "공시 요약 연결",
    smartMoney: "13F 보유 연결",
    indexMembership: "지수 편입 연결",
    singleStockEtfs: "단일종목 ETF 연결",
  };

  const activeFilterChips: { active: boolean; label: string; clear: () => void }[] = [
    { active: Boolean(search.trim()), label: `검색: ${search.trim()}`, clear: () => setSearch("") },
    ...(perMin || perMax
      ? [
          {
            active: true,
            label: perMin && perMax ? `PER ${perMin}~${perMax}` : perMin ? `PER ≥ ${perMin}` : `PER ≤ ${perMax}`,
            clear: () => {
              setPerMin("");
              setPerMax("");
            },
          },
        ]
      : []),
    { active: Boolean(forwardPerMax), label: `예상 PER ≤ ${forwardPerMax}`, clear: () => setForwardPerMax("") },
    ...(marketCapMin || marketCapMax
      ? [
          {
            active: true,
            label: marketCapMin && marketCapMax ? `시총 ${marketCapMin}~${marketCapMax}$B` : marketCapMin ? `시총 ≥ ${marketCapMin}$B` : `시총 ≤ ${marketCapMax}$B`,
            clear: () => {
              setMarketCapMin("");
              setMarketCapMax("");
            },
          },
        ]
      : []),
    ...(pbrMin || pbrMax
      ? [
          {
            active: true,
            label: pbrMin && pbrMax ? `PBR ${pbrMin}~${pbrMax}` : pbrMin ? `PBR ≥ ${pbrMin}` : `PBR ≤ ${pbrMax}`,
            clear: () => {
              setPbrMin("");
              setPbrMax("");
            },
          },
        ]
      : []),
    { active: Boolean(pegMax), label: `PEG ≤ ${pegMax}`, clear: () => setPegMax("") },
    { active: Boolean(roeMin), label: `ROE ≥ ${roeMin}%`, clear: () => setRoeMin("") },
    { active: Boolean(opmMin), label: `OPM ≥ ${opmMin}%`, clear: () => setOpmMin("") },
    { active: Boolean(return12mMin), label: `12M 수익률 ≥ ${return12mMin}%`, clear: () => setReturn12mMin("") },
    ...(dividendYieldMin || dividendYieldMax
      ? [
          {
            active: true,
            label: dividendYieldMin && dividendYieldMax ? `배당 ${dividendYieldMin}~${dividendYieldMax}%` : dividendYieldMin ? `배당 ≥ ${dividendYieldMin}%` : `배당 ≤ ${dividendYieldMax}%`,
            clear: () => {
              setDividendYieldMin("");
              setDividendYieldMax("");
            },
          },
        ]
      : []),
    { active: Boolean(roeFy1Min), label: `FY+1 ROE ≥ ${roeFy1Min}%`, clear: () => setRoeFy1Min("") },
    { active: Boolean(ret3yMin), label: `3Y 수익률 ≥ ${ret3yMin}%`, clear: () => setRet3yMin("") },
    { active: Boolean(ret5yMin), label: `5Y 수익률 ≥ ${ret5yMin}%`, clear: () => setRet5yMin("") },
    { active: Boolean(revenueGrowthMin), label: `매출+1 ≥ ${revenueGrowthMin}%`, clear: () => setRevenueGrowthMin("") },
    { active: Boolean(epsGrowthMin), label: `EPS+1 ≥ ${epsGrowthMin}%`, clear: () => setEpsGrowthMin("") },
    { active: profitableOnly, label: "흑자만", clear: () => setProfitableOnly(false) },
    ...(bandFilter
      ? [{ active: true, label: `밴드: ${bandFilter === "cheap" ? "저평가" : bandFilter === "fair" ? "적정" : "고평가"}`, clear: () => setBandFilter("") }]
      : []),
    ...(actionFilter
      ? [{ active: true, label: `신호: ${ACTION_FILTER_LABEL[actionFilter]}`, clear: () => setActionFilter("") }]
      : []),
    ...(fenokEdgeMin
      ? [{ active: true, label: `Fenok Edge ≥ ${fenokEdgeMin}`, clear: () => setFenokEdgeMin("") }]
      : []),
    ...(convictionMin
      ? [{ active: true, label: `Fenok 컨빅션 ≥ ${convictionMin}`, clear: () => setConvictionMin("") }]
      : []),
    ...(connectionFilter
      ? [{ active: true, label: `연결: ${CONNECTION_FILTER_LABEL[connectionFilter]}`, clear: () => setConnectionFilter("" as ConnectionFilter) }]
      : []),
    ...(selectedSectors.length > 0 ? [{ active: true, label: `섹터: ${selectedSectors.length}개`, clear: () => setSelectedSectors([]) }] : []),
    ...(selectedCountries.length > 0 ? [{ active: true, label: `국가: ${selectedCountries.length}개`, clear: () => setSelectedCountries([]) }] : []),
  ].filter((chip) => chip.active);

  const [scaleOpen, setScaleOpen] = useState(false);
  const [valueOpen, setValueOpen] = useState(false);
  const [growthOpen, setGrowthOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [filterDeckOpen, setFilterDeckOpen] = useState(false);

  const scaleCount = Number(Boolean(search.trim())) + selectedSectors.length + selectedCountries.length + Number(Boolean(marketCapMin)) + Number(Boolean(marketCapMax));
  const valueCount = Number(Boolean(perMin)) + Number(Boolean(perMax)) + Number(Boolean(forwardPerMax)) + Number(Boolean(pbrMin)) + Number(Boolean(pbrMax)) + Number(Boolean(pegMax)) + Number(Boolean(bandFilter)) + Number(profitableOnly);
  const growthCount =
    Number(Boolean(revenueGrowthMin)) + Number(Boolean(epsGrowthMin)) + Number(Boolean(dividendYieldMin)) + Number(Boolean(dividendYieldMax)) + Number(Boolean(return12mMin)) + Number(Boolean(ret3yMin)) + Number(Boolean(ret5yMin));
  const qualityCount = Number(Boolean(roeMin)) + Number(Boolean(roeFy1Min)) + Number(Boolean(opmMin)) + Number(Boolean(actionFilter)) + Number(Boolean(fenokEdgeMin)) + Number(Boolean(convictionMin)) + Number(Boolean(connectionFilter));
  const activeFilterCount = scaleCount + valueCount + growthCount + qualityCount;
  const pricedCount = sorted.filter((stock) => stock.price !== null).length;
  const missingPriceCount = Math.max(0, sorted.length - pricedCount);
  const priceCoverageRatio = sorted.length > 0 ? Math.round((pricedCount / sorted.length) * 100) : 0;
  const filterPreviewLabel = activeFilterChips.length > 0
    ? activeFilterChips.slice(0, 5).map((chip) => chip.label).join(" · ")
    : "매크로 · 이벤트 · 리스크 · 경기 · 비교";
  const sourceDateLabel = sourceDate ?? "확인 중";
  const densityClass = DENSITY_TABLE_CLASS[density];

  useEffect(() => {
    if (typeof window === "undefined") return;
    const frame = window.requestAnimationFrame(() => {
      if (window.innerWidth >= 768) setScaleOpen(true);
      if (!enableCanvasPlusPreview) return;
      if (scaleCount > 0) setScaleOpen(true);
      if (valueCount > 0) setValueOpen(true);
      if (growthCount > 0) setGrowthOpen(true);
      if (qualityCount > 0) setQualityOpen(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [enableCanvasPlusPreview, scaleCount, valueCount, growthCount, qualityCount]);

  return (
    <div
      className={enableCanvasPlusPreview ? "canvas-plus cp-screener-service" : "data-shell-page"}
      data-canvas-plus-screener-service={enableCanvasPlusPreview ? "true" : undefined}
    >
      {enableCanvasPlusPreview ? (
        <section className="cpw4-hero" data-density="compact">
          <div className="cpw4-hero__top">
            <div className="cpw4-hero__copy">
              <p className="cpw4-kicker">SCREENER</p>
              <h1>종목 스크리너</h1>
              <p>글로벌 {stocks.length.toLocaleString("ko-KR")}개 종목을 가격·밸류에이션·Fenok 신호로 좁혀 봅니다.</p>
            </div>
            <div className="cpw4-freshness" aria-label={`데이터 기준 ${sourceDateLabel}`}>
              <span className="cpw4-freshness__dot" aria-hidden="true" />
              기준 {sourceDateLabel}
            </div>
          </div>

          <div className="cpw4-nav-row">
            <div className="cpw4-universe-tabs" role="tablist" aria-label="스크리너 범위">
              <button type="button" className="cpw4-universe-tab" role="tab" aria-selected={true}>
                <span>주식</span>
                <strong>{stocks.length.toLocaleString("ko-KR")}</strong>
              </button>
              <TransitionLink href={ROUTES.etfs} className="cpw4-universe-tab" role="tab" aria-selected={false}>
                ETF
              </TransitionLink>
              <div className="cpw4-preset-wrap">
                <button
                  type="button"
                  className="cpw4-universe-tab"
                  role="tab"
                  aria-selected={false}
                  aria-expanded={presetMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => setPresetMenuOpen((v) => !v)}
                >
                  내 프리셋
                </button>
                {presetMenuOpen && (
                  <div className="cp-screener-preset-menu cpw4-saved-preset-menu">
                    <div className="cp-screener-preset-row">
                      <input
                        type="text"
                        value={presetName}
                        onChange={(event) => setPresetName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") handleSavePreset();
                        }}
                        placeholder="프리셋 이름"
                        className="cp-screener-preset-input"
                      />
                      <button
                        type="button"
                        onClick={handleSavePreset}
                        disabled={!presetName.trim()}
                        className="cp-button cp-screener-preset-save"
                        data-variant="primary"
                        data-density="compact"
                      >
                        저장
                      </button>
                    </div>
                    {savedPresets.length > 0 ? (
                      <div className="cp-screener-preset-list">
                        {savedPresets.map((p) => (
                          <div key={p.name} className="cp-screener-preset-item">
                            <button
                              type="button"
                              onClick={() => handleLoadPreset(p.state)}
                              className="cp-screener-preset-load"
                              title={p.name}
                            >
                              {p.name}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeletePreset(p.name)}
                              className="cp-screener-preset-delete"
                              aria-label={`${p.name} 삭제`}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="cpw4-saved-preset-empty">저장된 프리셋이 없습니다.</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <form className="cpw4-search" onSubmit={(event) => event.preventDefault()}>
              <label className="sr-only" htmlFor="cp-screener-search-input">
                티커 또는 종목명 검색
              </label>
              <span className="cpw4-search__icon" aria-hidden="true" />
              <input
                id="cp-screener-search-input"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="NVDA"
                className="cpw4-search__input"
                data-canvas-plus-screener-search="true"
              />
              {search.trim() ? (
                <button type="button" className="cpw4-search__clear" onClick={() => setSearch("")}>
                  초기화
                </button>
              ) : (
                <span className="cpw4-search__hint">/</span>
              )}
            </form>
          </div>
        </section>
      ) : (
        <section className="panel data-shell-header">
          <div className="data-shell-head-main">
            <p className="data-shell-kicker">종목 스크리너</p>
            <h1 className="data-shell-title">종목 스크리너</h1>
            <p className="data-shell-desc">
              글로벌 {stocks.length.toLocaleString()}개 종목을 PER·PBR·배당·수익률로 필터링하고 비교합니다.
            </p>
          </div>
          <div className="data-shell-head-actions">
            <DataStateBadge state={screenerDataState} />
            <button
              type="button"
              onClick={() => downloadConnectionCsv(sorted)}
              disabled={!connectionIndexReady || sorted.length === 0}
              className="data-shell-link disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-600"
            >
              필터 CSV
            </button>
            {singleStockEtfCompareHref ? (
              <TransitionLink href={singleStockEtfCompareHref} className="data-shell-link">
                필터 ETF 비교
              </TransitionLink>
            ) : null}
            <TransitionLink href={ROUTES.sectors} className="data-shell-link">
              섹터
            </TransitionLink>
            <MarketQuickLinks />
            <div className="relative">
              <button
                type="button"
                onClick={() => setPresetMenuOpen((v) => !v)}
                className="data-shell-link"
                aria-expanded={presetMenuOpen}
                aria-haspopup="menu"
              >
                필터 저장
              </button>
              {presetMenuOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={presetName}
                      onChange={(event) => setPresetName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") handleSavePreset();
                      }}
                      placeholder="프리셋 이름"
                      className="min-h-9 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
                    />
                    <button
                      type="button"
                      onClick={handleSavePreset}
                      disabled={!presetName.trim()}
                      className="rounded-lg border border-brand-interactive bg-brand-interactive px-2 text-xs font-black text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-200 disabled:text-slate-600"
                    >
                      저장
                    </button>
                  </div>
                  {savedPresets.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {savedPresets.map((p) => (
                        <div key={p.name} className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => handleLoadPreset(p.state)}
                            className="min-h-8 flex-1 truncate rounded-lg px-2 text-left text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
                            title={p.name}
                          >
                            {p.name}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePreset(p.name)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-slate-500 transition hover:bg-slate-100 hover:text-red-600"
                            aria-label={`${p.name} 삭제`}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {screenerDataState.status !== "ready" ? (
        enableCanvasPlusPreview ? (
          <section className="cp-card cp-screener-data-state-card" data-canvas-plus-screener-data-state="true">
            <DataStateNotice state={screenerDataState} />
          </section>
        ) : (
          <DataStateNotice state={screenerDataState} />
        )
      ) : null}

      {initialMacroContextId ? (
        <MacroContextCard contextId={initialMacroContextId} surface="screener" />
      ) : null}

      <section
        className={enableCanvasPlusPreview
          ? cx("cp-card cp-screener-selection-card cpw4-selection-card", selectedTickers.size === 0 && "cpw4-selection-card--empty")
          : "rounded-[1.25rem] border border-slate-200 bg-white p-3 shadow-sm"}
        data-canvas-plus-screener-selection-actions={enableCanvasPlusPreview ? "true" : undefined}
      >
        <div className={enableCanvasPlusPreview ? "cp-screener-selection-layout" : "flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"}>
          <div className={enableCanvasPlusPreview ? "cp-screener-selection-copy" : "min-w-0"}>
            <p className={enableCanvasPlusPreview ? "cp-screener-section-label" : "text-[11px] font-black uppercase tracking-[0.1em] text-slate-500"}>선택 작업</p>
            <p className={enableCanvasPlusPreview ? "cp-screener-selection-summary" : "mt-1 text-sm font-bold text-slate-700"}>
              현재 필터에서 {selectedRows.length.toLocaleString("ko-KR")}개 선택
              {selectedRows.length > 0 ? ` · 연결 ETF ${selectedSingleStockEtfCount.toLocaleString("ko-KR")}개` : ""}
            </p>
          </div>
          <div className={enableCanvasPlusPreview ? "cp-screener-selection-actions" : "flex flex-wrap gap-2"}>
            <button
              type="button"
              onClick={allPageSelected ? deselectPageRows : selectPageRows}
              disabled={pageRows.length === 0}
              className={enableCanvasPlusPreview ? "cp-button cp-screener-action-button" : "min-h-9 rounded-md border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 text-xs font-black text-[var(--c-ink-2)] transition hover:border-[var(--brand-interactive)] hover:text-[var(--brand-interactive)] disabled:cursor-not-allowed disabled:bg-[var(--c-surface-2)] disabled:text-[var(--c-ink-2)]"}
              data-variant={enableCanvasPlusPreview ? "ghost" : undefined}
              data-density={enableCanvasPlusPreview ? "compact" : undefined}
            >
              {allPageSelected ? "페이지 해제" : "페이지 선택"}
            </button>
            <button
              type="button"
              onClick={selectFilteredRows}
              disabled={sorted.length === 0}
              className={enableCanvasPlusPreview ? "cp-button cp-screener-action-button" : "min-h-9 rounded-md border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 text-xs font-black text-[var(--c-ink-2)] transition hover:border-[var(--brand-interactive)] hover:text-[var(--brand-interactive)] disabled:cursor-not-allowed disabled:bg-[var(--c-surface-2)] disabled:text-[var(--c-ink-2)]"}
              data-variant={enableCanvasPlusPreview ? "ghost" : undefined}
              data-density={enableCanvasPlusPreview ? "compact" : undefined}
            >
              필터 전체 선택
            </button>
            <button
              type="button"
              onClick={clearSelectedRows}
              disabled={selectedTickers.size === 0}
              className={enableCanvasPlusPreview ? "cp-button cp-screener-action-button" : "min-h-9 rounded-md border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-xs font-black text-[var(--c-ink-2)] transition hover:border-[var(--brand-interactive)] hover:text-[var(--brand-interactive)] disabled:cursor-not-allowed disabled:bg-[var(--c-surface-2)] disabled:text-[var(--c-ink-2)]"}
              data-variant={enableCanvasPlusPreview ? "ghost" : undefined}
              data-density={enableCanvasPlusPreview ? "compact" : undefined}
            >
              선택 해제
            </button>
            <button
              type="button"
              onClick={() => downloadConnectionCsv(selectedRows)}
              disabled={!connectionIndexReady || selectedRows.length === 0}
              className={enableCanvasPlusPreview ? "cp-button cp-screener-action-button" : "min-h-9 rounded-md bg-[var(--c-ink)] px-3 text-xs font-black text-[var(--c-panel)] transition hover:bg-[var(--brand-interactive)] disabled:cursor-not-allowed disabled:bg-[var(--c-surface-2)] disabled:text-[var(--c-ink-2)]"}
              data-variant={enableCanvasPlusPreview ? "primary" : undefined}
              data-density={enableCanvasPlusPreview ? "compact" : undefined}
            >
              선택 CSV
            </button>
            {selectedSingleStockEtfCompareHref ? (
              <TransitionLink
                href={selectedSingleStockEtfCompareHref}
                className={enableCanvasPlusPreview ? "cp-button cp-screener-action-button" : "inline-flex min-h-9 items-center rounded-md bg-[var(--c-ink)] px-3 text-xs font-black text-[var(--c-panel)] transition hover:bg-[var(--brand-interactive)]"}
                data-variant={enableCanvasPlusPreview ? "primary" : undefined}
                data-density={enableCanvasPlusPreview ? "compact" : undefined}
              >
                선택 ETF 비교
              </TransitionLink>
            ) : (
              <span className={enableCanvasPlusPreview ? "cp-screener-disabled-action" : "inline-flex min-h-9 items-center rounded-md border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 text-xs font-black text-[var(--c-ink-2)]"}>
                선택 ETF 부족
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Filter bar */}
      {enableCanvasPlusPreview ? (
        <section className="cpw4-filter-shell" data-canvas-plus-screener-filter-deck="true">
          <button
            type="button"
            className="cpw4-filter-summary"
            aria-expanded={filterDeckOpen}
            onClick={() => setFilterDeckOpen((v) => !v)}
          >
            <span className="cpw4-filter-summary__lead">
              <span className="cpw4-filter-summary__chevron" aria-hidden="true">{filterDeckOpen ? "▲" : "▼"}</span>
              <span className="cpw4-filter-summary__label">필터</span>
              <span className="cpw4-filter-summary__preview">{filterPreviewLabel}</span>
            </span>
            <span className="cpw4-filter-summary__coverage">
              <span className="cpw4-coverage-bar" aria-hidden="true">
                <span style={{ width: `${priceCoverageRatio}%` }} />
              </span>
              <span>
                {pricedCount.toLocaleString("ko-KR")}개 가격 확인 · {missingPriceCount.toLocaleString("ko-KR")}개 가격 없이 표시
              </span>
            </span>
            <span className="cpw4-filter-summary__count">
              {sorted.length.toLocaleString("ko-KR")}개 종목
              {activeFilterCount > 0 ? <strong>{activeFilterCount}</strong> : null}
            </span>
          </button>

          {filterDeckOpen ? (
            <div className="cp-card cp-screener-filter-deck cpw4-filter-drawer">
              <div className="cp-screener-filter-groups">
            <div className="cp-screener-filter-group">
              <button
                type="button"
                onClick={() => setScaleOpen((v) => !v)}
                className="cp-screener-filter-group__toggle"
                aria-expanded={scaleOpen}
              >
                <span>종목 범위</span>
                <span className="cp-screener-filter-group__meta">
                  {scaleCount > 0 ? (
                    <span className="cp-screener-filter-count" data-active="true">
                      {scaleCount}
                    </span>
                  ) : null}
                  <span className="cp-screener-filter-chevron" aria-hidden="true">
                    {scaleOpen ? "▲" : "▼"}
                  </span>
                </span>
              </button>
              {scaleOpen ? (
                <div className="cp-screener-filter-grid cp-screener-filter-grid--scope">
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">섹터</span>
                    <select
                      value=""
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value && !selectedSectors.includes(value)) {
                          setSelectedSectors((prev) => [...prev, value]);
                        }
                      }}
                      className="cp-screener-control"
                    >
                      <option value="">섹터 추가</option>
                      {sectors
                        .filter((item) => !selectedSectors.includes(item))
                        .map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                    </select>
                    {selectedSectors.length > 0 ? (
                      <div className="cp-screener-inline-chip-row">
                        {selectedSectors.map((item) => (
                          <span key={item} className="cp-screener-inline-chip">
                            {item}
                            <button
                              type="button"
                              onClick={() => setSelectedSectors((prev) => prev.filter((s) => s !== item))}
                              aria-label={`Remove ${item}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">국가</span>
                    <select
                      value=""
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value && !selectedCountries.includes(value)) {
                          setSelectedCountries((prev) => [...prev, value]);
                        }
                      }}
                      className="cp-screener-control"
                    >
                      <option value="">국가 추가</option>
                      {countries
                        .filter((code) => !selectedCountries.includes(code))
                        .map((code) => (
                          <option key={code} value={code}>
                            {COUNTRY_LABEL[code] ?? code}
                          </option>
                        ))}
                    </select>
                    {selectedCountries.length > 0 ? (
                      <div className="cp-screener-inline-chip-row">
                        {selectedCountries.map((code) => (
                          <span key={code} className="cp-screener-inline-chip">
                            {COUNTRY_LABEL[code] ?? code}
                            <button
                              type="button"
                              onClick={() => setSelectedCountries((prev) => prev.filter((c) => c !== code))}
                              aria-label={`Remove ${code}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">시총 최소($B)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={marketCapMin}
                      onChange={(event) => setMarketCapMin(event.target.value)}
                      placeholder="예: 100"
                      className="cp-screener-control"
                    />
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">시총 최대($B)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={marketCapMax}
                      onChange={(event) => setMarketCapMax(event.target.value)}
                      placeholder="예: 1000"
                      className="cp-screener-control"
                    />
                  </label>
                </div>
              ) : null}
            </div>

            <div className="cp-screener-filter-group">
              <button
                type="button"
                onClick={() => setValueOpen((v) => !v)}
                className="cp-screener-filter-group__toggle"
                aria-expanded={valueOpen}
              >
                <span>가치 조건</span>
                <span className="cp-screener-filter-group__meta">
                  {valueCount > 0 ? (
                    <span className="cp-screener-filter-count" data-active="true">
                      {valueCount}
                    </span>
                  ) : null}
                  <span className="cp-screener-filter-chevron" aria-hidden="true">
                    {valueOpen ? "▲" : "▼"}
                  </span>
                </span>
              </button>
              {valueOpen ? (
                <div className="cp-screener-filter-grid">
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">PER 최소</span>
                    <input type="number" inputMode="decimal" value={perMin} onChange={(event) => setPerMin(event.target.value)} placeholder="예: 5" className="cp-screener-control" />
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">PER 최대</span>
                    <input type="number" inputMode="decimal" value={perMax} onChange={(event) => setPerMax(event.target.value)} placeholder="예: 20" className="cp-screener-control" />
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">예상 PER 상한</span>
                    <input type="number" inputMode="decimal" value={forwardPerMax} onChange={(event) => setForwardPerMax(event.target.value)} placeholder="예: 25" className="cp-screener-control" />
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">PBR 최소</span>
                    <input type="number" inputMode="decimal" value={pbrMin} onChange={(event) => setPbrMin(event.target.value)} placeholder="예: 0.5" className="cp-screener-control" />
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">PBR 최대</span>
                    <input type="number" inputMode="decimal" value={pbrMax} onChange={(event) => setPbrMax(event.target.value)} placeholder="예: 1.5" className="cp-screener-control" />
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">PEG 최대</span>
                    <input type="number" inputMode="decimal" value={pegMax} onChange={(event) => setPegMax(event.target.value)} placeholder="예: 1" className="cp-screener-control" />
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">PER 밴드</span>
                    <select
                      value={bandFilter}
                      onChange={(event) => setBandFilter(event.target.value as "" | "cheap" | "fair" | "rich")}
                      className="cp-screener-control"
                    >
                      <option value="">전체 밴드</option>
                      <option value="cheap">저평가 (하위 25%)</option>
                      <option value="fair">적정 (중간 50%)</option>
                      <option value="rich">고평가 (상위 25%)</option>
                    </select>
                  </label>
                  <label className="cp-screener-check">
                    <input
                      type="checkbox"
                      checked={profitableOnly}
                      onChange={(event) => setProfitableOnly(event.target.checked)}
                      className="cp-screener-check__input"
                    />
                    <span>흑자 종목만 (PER &gt; 0)</span>
                  </label>
                </div>
              ) : null}
            </div>

            <div className="cp-screener-filter-group">
              <button
                type="button"
                onClick={() => setGrowthOpen((v) => !v)}
                className="cp-screener-filter-group__toggle"
                aria-expanded={growthOpen}
              >
                <span>성장·수익</span>
                <span className="cp-screener-filter-group__meta">
                  {growthCount > 0 ? (
                    <span className="cp-screener-filter-count" data-active="true">
                      {growthCount}
                    </span>
                  ) : null}
                  <span className="cp-screener-filter-chevron" aria-hidden="true">
                    {growthOpen ? "▲" : "▼"}
                  </span>
                </span>
              </button>
              {growthOpen ? (
                <div className="cp-screener-filter-grid">
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">매출+1 최소</span>
                    <input type="number" inputMode="decimal" value={revenueGrowthMin} onChange={(event) => setRevenueGrowthMin(event.target.value)} placeholder="예: 10" className="cp-screener-control" />
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">EPS+1 최소</span>
                    <input type="number" inputMode="decimal" value={epsGrowthMin} onChange={(event) => setEpsGrowthMin(event.target.value)} placeholder="예: 10" className="cp-screener-control" />
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">배당률 최소 (%)</span>
                    <input type="number" inputMode="decimal" value={dividendYieldMin} onChange={(event) => setDividendYieldMin(event.target.value)} placeholder="예: 3" className="cp-screener-control" />
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">배당률 최대 (%)</span>
                    <input type="number" inputMode="decimal" value={dividendYieldMax} onChange={(event) => setDividendYieldMax(event.target.value)} placeholder="예: 6" className="cp-screener-control" />
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">12M 수익률 최소 (%)</span>
                    <input type="number" inputMode="decimal" value={return12mMin} onChange={(event) => setReturn12mMin(event.target.value)} placeholder="예: 0" className="cp-screener-control" />
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">3Y 수익률 최소 (%)</span>
                    <input type="number" inputMode="decimal" value={ret3yMin} onChange={(event) => setRet3yMin(event.target.value)} placeholder="예: 20" className="cp-screener-control" />
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">5Y 수익률 최소 (%)</span>
                    <input type="number" inputMode="decimal" value={ret5yMin} onChange={(event) => setRet5yMin(event.target.value)} placeholder="예: 50" className="cp-screener-control" />
                  </label>
                </div>
              ) : null}
            </div>

            <div className="cp-screener-filter-group">
              <button
                type="button"
                onClick={() => setQualityOpen((v) => !v)}
                className="cp-screener-filter-group__toggle"
                aria-expanded={qualityOpen}
              >
                <span>품질·신호</span>
                <span className="cp-screener-filter-group__meta">
                  {qualityCount > 0 ? (
                    <span className="cp-screener-filter-count" data-active="true">
                      {qualityCount}
                    </span>
                  ) : null}
                  <span className="cp-screener-filter-chevron" aria-hidden="true">
                    {qualityOpen ? "▲" : "▼"}
                  </span>
                </span>
              </button>
              {qualityOpen ? (
                <div className="cp-screener-filter-grid">
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">ROE 최소 (%)</span>
                    <input type="number" inputMode="decimal" value={roeMin} onChange={(event) => setRoeMin(event.target.value)} placeholder="예: 20" className="cp-screener-control" />
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">FY+1 ROE 최소 (%)</span>
                    <input type="number" inputMode="decimal" value={roeFy1Min} onChange={(event) => setRoeFy1Min(event.target.value)} placeholder="예: 15" className="cp-screener-control" />
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">OPM 최소 (%)</span>
                    <input type="number" inputMode="decimal" value={opmMin} onChange={(event) => setOpmMin(event.target.value)} placeholder="예: 15" className="cp-screener-control" />
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">투자 신호</span>
                    <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value as ActionFilter)} className="cp-screener-control">
                      <option value="">전체 신호</option>
                      <option value="guru_held">기관·고수 보유</option>
                      <option value="smart_money">기관/고수 주목</option>
                      <option value="value_momentum">저평가+모멘텀</option>
                      <option value="index_core">지수 핵심</option>
                      <option value="income">배당 점검</option>
                      <option value="momentum">모멘텀 리더</option>
                      <option value="watch">관찰</option>
                    </select>
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">Fenok Edge</span>
                    <select
                      value={fenokEdgeMin}
                      onChange={(event) => setFenokEdgeMin(event.target.value as FenokEdgeFilter)}
                      className="cp-screener-control"
                      title="Fenok 파생 upside/downside 프록시"
                    >
                      <option value="">전체 Edge</option>
                      <option value="70">70 이상</option>
                      <option value="60">60 이상</option>
                      <option value="50">50 이상</option>
                    </select>
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">Fenok 컨빅션</span>
                    <select
                      value={convictionMin}
                      onChange={(event) => setConvictionMin(event.target.value as ConvictionFilter)}
                      className="cp-screener-control"
                      title="Fenok 4-신호 동등가중 종합 · 매수권유 아님"
                    >
                      <option value="">전체 컨빅션</option>
                      <option value="70">70 이상</option>
                      <option value="60">60 이상</option>
                      <option value="50">50 이상</option>
                    </select>
                  </label>
                  <label className="cp-screener-field">
                    <span className="cp-screener-field__label">연결 범위</span>
                    <select
                      value={connectionFilter}
                      onChange={(event) => setConnectionFilter(event.target.value as ConnectionFilter)}
                      disabled={!connectionIndexReady}
                      className="cp-screener-control"
                    >
                      <option value="">전체 연결</option>
                      <option value="filings">공시 요약 연결</option>
                      <option value="smartMoney">13F 보유 연결</option>
                      <option value="indexMembership">지수 편입 연결</option>
                      <option value="singleStockEtfs">단일종목 ETF 연결</option>
                    </select>
                  </label>
                </div>
              ) : null}
            </div>
          </div>

          <div className="cp-screener-filter-footer">
            {activeFilterChips.length > 0 ? (
              <div className="cp-screener-chip-row" data-canvas-plus-screener-active-chips="true">
                {activeFilterChips.map((chip) => (
                  <span key={chip.label} className="cp-screener-chip">
                    {chip.label}
                    <button type="button" onClick={chip.clear} aria-label={`Clear ${chip.label}`}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="cp-screener-filter-summary">
              <span>
                <strong className="orbitron">{sorted.length.toLocaleString()}</strong>개 종목
              </span>
              {hasFilters ? (
                <button type="button" onClick={resetFilters} className="cp-button cp-screener-reset-button" data-variant="ghost" data-density="compact">
                  초기화
                </button>
              ) : null}
            </div>
          </div>
            </div>
          ) : null}
        </section>
      ) : (
      <section className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)]">
        <div className="flex flex-col gap-3">
          {/* Scale & Domain */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <button
              type="button"
              onClick={() => setScaleOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 transition hover:bg-slate-100"
            >
              <span>Scale & Domain</span>
              <span className="flex items-center gap-2">
                {scaleCount > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--brand-interactive)] px-1 text-[10px] font-black text-white">
                    {scaleCount}
                  </span>
                )}
                <span className="text-slate-500">{scaleOpen ? "▲" : "▼"}</span>
              </span>
            </button>
            {scaleOpen && (
              <div className={cx("mt-3 grid gap-3 sm:grid-cols-2", enableCanvasPlusPreview ? "lg:grid-cols-4" : "lg:grid-cols-5")}>
                {!enableCanvasPlusPreview ? (
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
                ) : null}
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">섹터</span>
                  <select
                    value=""
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value && !selectedSectors.includes(value)) {
                        setSelectedSectors((prev) => [...prev, value]);
                      }
                    }}
                    className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
                  >
                    <option value="">섹터 추가</option>
                    {sectors
                      .filter((item) => !selectedSectors.includes(item))
                      .map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                  </select>
                  {selectedSectors.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {selectedSectors.map((item) => (
                        <span
                          key={item}
                          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-900"
                        >
                          {item}
                          <button
                            type="button"
                            onClick={() => setSelectedSectors((prev) => prev.filter((s) => s !== item))}
                            className="text-slate-500 hover:text-slate-900"
                            aria-label={`Remove ${item}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">국가</span>
                  <select
                    value=""
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value && !selectedCountries.includes(value)) {
                        setSelectedCountries((prev) => [...prev, value]);
                      }
                    }}
                    className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
                  >
                    <option value="">국가 추가</option>
                    {countries
                      .filter((code) => !selectedCountries.includes(code))
                      .map((code) => (
                        <option key={code} value={code}>
                          {COUNTRY_LABEL[code] ?? code}
                        </option>
                      ))}
                  </select>
                  {selectedCountries.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {selectedCountries.map((code) => (
                        <span
                          key={code}
                          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-900"
                        >
                          {COUNTRY_LABEL[code] ?? code}
                          <button
                            type="button"
                            onClick={() => setSelectedCountries((prev) => prev.filter((c) => c !== code))}
                            className="text-slate-500 hover:text-slate-900"
                            aria-label={`Remove ${code}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">시총 최소($B)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={marketCapMin}
                    onChange={(event) => setMarketCapMin(event.target.value)}
                    placeholder="예: 100"
                    className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">시총 최대($B)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={marketCapMax}
                    onChange={(event) => setMarketCapMax(event.target.value)}
                    placeholder="예: 1000"
                    className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Value & Valuation */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <button
              type="button"
              onClick={() => setValueOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 transition hover:bg-slate-100"
            >
              <span>Value & Valuation</span>
              <span className="flex items-center gap-2">
                {valueCount > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--brand-interactive)] px-1 text-[10px] font-black text-white">
                    {valueCount}
                  </span>
                )}
                <span className="text-slate-500">{valueOpen ? "▲" : "▼"}</span>
              </span>
            </button>
            {valueOpen && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">PER 최소</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={perMin}
                    onChange={(event) => setPerMin(event.target.value)}
                    placeholder="예: 5"
                    className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
                  />
                </label>
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
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">PBR 최소</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={pbrMin}
                    onChange={(event) => setPbrMin(event.target.value)}
                    placeholder="예: 0.5"
                    className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">PBR 최대</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={pbrMax}
                    onChange={(event) => setPbrMax(event.target.value)}
                    placeholder="예: 1.5"
                    className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">PEG 최대</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={pegMax}
                    onChange={(event) => setPegMax(event.target.value)}
                    placeholder="예: 1"
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
                <label className="inline-flex items-center gap-2 self-end text-sm font-bold text-[var(--c-ink-2)]">
                  <input
                    type="checkbox"
                    checked={profitableOnly}
                    onChange={(event) => setProfitableOnly(event.target.checked)}
                    className="h-5 w-5 min-h-5 min-w-5 rounded border-slate-300 text-brand-interactive"
                  />
                  흑자 종목만 (PER &gt; 0)
                </label>
              </div>
            )}
          </div>

          {/* Growth & Return */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <button
              type="button"
              onClick={() => setGrowthOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 transition hover:bg-slate-100"
            >
              <span>Growth & Return</span>
              <span className="flex items-center gap-2">
                {growthCount > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--brand-interactive)] px-1 text-[10px] font-black text-white">
                    {growthCount}
                  </span>
                )}
                <span className="text-slate-500">{growthOpen ? "▲" : "▼"}</span>
              </span>
            </button>
            {growthOpen && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">배당률 최대 (%)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={dividendYieldMax}
                    onChange={(event) => setDividendYieldMax(event.target.value)}
                    placeholder="예: 6"
                    className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">12M 수익률 최소 (%)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={return12mMin}
                    onChange={(event) => setReturn12mMin(event.target.value)}
                    placeholder="예: 0"
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
              </div>
            )}
          </div>

          {/* Quality & Signals */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <button
              type="button"
              onClick={() => setQualityOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 transition hover:bg-slate-100"
            >
              <span>Quality & Signals</span>
              <span className="flex items-center gap-2">
                {qualityCount > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--brand-interactive)] px-1 text-[10px] font-black text-white">
                    {qualityCount}
                  </span>
                )}
                <span className="text-slate-500">{qualityOpen ? "▲" : "▼"}</span>
              </span>
            </button>
            {qualityOpen && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">ROE 최소 (%)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={roeMin}
                    onChange={(event) => setRoeMin(event.target.value)}
                    placeholder="예: 20"
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
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">OPM 최소 (%)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={opmMin}
                    onChange={(event) => setOpmMin(event.target.value)}
                    placeholder="예: 15"
                    className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">투자 신호</span>
                  <select
                    value={actionFilter}
                    onChange={(event) => setActionFilter(event.target.value as ActionFilter)}
                    className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
                  >
                    <option value="">전체 신호</option>
                    <option value="guru_held">기관·고수 보유</option>
                    <option value="smart_money">기관/고수 주목</option>
                    <option value="value_momentum">저평가+모멘텀</option>
                    <option value="index_core">지수 핵심</option>
                    <option value="income">배당 점검</option>
                    <option value="momentum">모멘텀 리더</option>
                    <option value="watch">관찰</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">Fenok Edge</span>
                  <select
                    value={fenokEdgeMin}
                    onChange={(event) => setFenokEdgeMin(event.target.value as FenokEdgeFilter)}
                    className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
                    title="Fenok 파생 upside/downside 프록시"
                  >
                    <option value="">전체 Edge</option>
                    <option value="70">70 이상</option>
                    <option value="60">60 이상</option>
                    <option value="50">50 이상</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">Fenok 컨빅션</span>
                  <select
                    value={convictionMin}
                    onChange={(event) => setConvictionMin(event.target.value as ConvictionFilter)}
                    className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
                    title="Fenok 4-신호 동등가중 종합 · 매수권유 아님"
                  >
                    <option value="">전체 컨빅션</option>
                    <option value="70">70 이상</option>
                    <option value="60">60 이상</option>
                    <option value="50">50 이상</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">연결 범위</span>
                  <select
                    value={connectionFilter}
                    onChange={(event) => setConnectionFilter(event.target.value as ConnectionFilter)}
                    disabled={!connectionIndexReady}
                    className="min-h-10 rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-sm font-semibold text-[var(--c-ink)] outline-none transition focus:border-brand-interactive disabled:bg-[var(--c-surface-2)] disabled:text-[var(--c-ink-3)]"
                  >
                    <option value="">전체 연결</option>
                    <option value="filings">공시 요약 연결</option>
                    <option value="smartMoney">13F 보유 연결</option>
                    <option value="indexMembership">지수 편입 연결</option>
                    <option value="singleStockEtfs">단일종목 ETF 연결</option>
                  </select>
                </label>
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div />
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
        {activeFilterChips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {activeFilterChips.map((chip) => (
              <span
                key={chip.label}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-900"
              >
                {chip.label}
                <button
                  type="button"
                  onClick={chip.clear}
                  className="text-slate-500 hover:text-slate-900"
                  aria-label={`Clear ${chip.label}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>
      )}

      {/* Preset selector */}
      {!enableCanvasPlusPreview ? (
      <div
        className={enableCanvasPlusPreview ? "cp-card cp-screener-toolbar-card" : "flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"}
        data-canvas-plus-screener-toolbar={enableCanvasPlusPreview ? "true" : undefined}
      >
        <div className={enableCanvasPlusPreview ? "cp-screener-toolbar-section cp-screener-preset-toolbar" : "flex flex-wrap items-center gap-2"}>
          <span className={enableCanvasPlusPreview ? "cp-screener-section-label" : "text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]"}>컬럼</span>
          {(Object.keys(PRESET_KEYS) as ColumnPreset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => handlePresetChange(p)}
              aria-pressed={preset === p}
              data-canvas-plus-active={enableCanvasPlusPreview ? String(preset === p) : undefined}
              className={enableCanvasPlusPreview
                ? "cp-screener-segment"
                : cx(
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
        <div className={enableCanvasPlusPreview ? "cp-screener-toolbar-controls" : "flex flex-wrap items-center gap-3"}>
          <div data-screener-view-mode-control className={enableCanvasPlusPreview ? "cp-screener-toolbar-section cp-screener-view-toolbar" : "hidden flex-wrap items-center gap-2 md:flex"}>
            <span className={enableCanvasPlusPreview ? "cp-screener-section-label" : "text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]"}>표시</span>
            {VIEW_MODE_BUTTONS.map((item) => (
              <button
                key={item}
                type="button"
                data-screener-view-mode-option={item}
                onClick={() => handleViewModeChange(item)}
                aria-pressed={viewMode === item}
                data-canvas-plus-active={enableCanvasPlusPreview ? String(viewMode === item) : undefined}
                className={enableCanvasPlusPreview
                  ? "cp-screener-segment"
                  : cx(
                    "inline-flex min-h-11 items-center rounded-full px-3 text-[11px] font-black uppercase tracking-[0.1em] transition sm:min-h-7",
                    viewMode === item
                      ? "border border-[var(--c-brand)] bg-[var(--c-brand-soft)] text-[var(--c-brand)]"
                      : "border border-[var(--c-line)] bg-[var(--c-panel)] text-[var(--c-ink-3)] hover:border-[var(--c-ink-4)] hover:text-[var(--c-ink)]",
                  )}
              >
                {VIEW_MODE_LABEL[item]}
              </button>
            ))}
          </div>
          <div data-screener-density-control className={enableCanvasPlusPreview ? "cp-screener-toolbar-section cp-screener-density-toolbar" : "flex flex-wrap items-center gap-2"}>
            <span className={enableCanvasPlusPreview ? "cp-screener-section-label" : "text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]"}>밀도</span>
            {DENSITY_BUTTONS.map((item) => (
              <button
                key={item}
                type="button"
                data-screener-density-option={item}
                data-canvas-plus-row-height={enableCanvasPlusPreview ? DENSITY_ROW_HEIGHT[item] : undefined}
                onClick={() => handleDensityChange(item)}
                aria-pressed={density === item}
                data-canvas-plus-active={enableCanvasPlusPreview ? String(density === item) : undefined}
                className={enableCanvasPlusPreview
                  ? "cp-screener-segment"
                  : cx(
                    "inline-flex min-h-11 items-center rounded-full px-3 text-[11px] font-black uppercase tracking-[0.1em] transition sm:min-h-7",
                    density === item
                      ? "border border-[var(--c-ink)] bg-[var(--c-ink)] text-white"
                      : "border border-[var(--c-line)] bg-[var(--c-panel)] text-[var(--c-ink-3)] hover:border-[var(--c-ink-4)] hover:text-[var(--c-ink)]",
                  )}
              >
                {DENSITY_LABEL[item]}
              </button>
            ))}
          </div>
        </div>
      </div>
      ) : null}

      {/* Results */}
      <section
        className={enableCanvasPlusPreview
          ? cx("cp-card cp-screener-results-shell", !dataReady && "cp-screener-results-shell--muted")
          : cx("rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-2 shadow-[var(--sh-sm)] sm:p-3", !dataReady && "opacity-60")}
        data-canvas-plus-screener-results-shell={enableCanvasPlusPreview ? "true" : undefined}
      >
        {enableCanvasPlusPreview ? (
          <div className="cpw4-results-header">
            <div className="cpw4-results-title">
              <strong>결과 {sorted.length.toLocaleString("ko-KR")}개</strong>
              <span>| {safePage + 1} / {pageCount} 페이지</span>
            </div>
            <div className="cpw4-results-tools" data-canvas-plus-screener-toolbar="true">
              <div className="cpw4-column-lens">
                <button
                  type="button"
                  className="cpw4-column-chip"
                  aria-expanded={columnMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => setColumnMenuOpen((v) => !v)}
                >
                  컬럼 {PRESET_LABEL[preset]} <span aria-hidden="true">⌄</span>
                </button>
                {columnMenuOpen ? (
                  <div className="cpw4-column-menu" role="menu" aria-label="컬럼 preset">
                    {(Object.keys(PRESET_KEYS) as ColumnPreset[]).map((p) => (
                      <button
                        key={p}
                        type="button"
                        role="menuitemradio"
                        aria-checked={preset === p}
                        onClick={() => {
                          handlePresetChange(p);
                          setColumnMenuOpen(false);
                        }}
                        data-canvas-plus-active={String(preset === p)}
                        className="cpw4-column-menu__item"
                      >
                        {PRESET_LABEL[p]}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div data-screener-view-mode-control className="cpw4-icon-toggle-group" aria-label="결과 표시 방식">
                {VIEW_MODE_BUTTONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    data-screener-view-mode-option={item}
                    onClick={() => handleViewModeChange(item)}
                    aria-label={VIEW_MODE_LABEL[item]}
                    aria-pressed={viewMode === item}
                    data-canvas-plus-active={String(viewMode === item)}
                    className="cpw4-icon-button"
                  >
                    <span className={item === "table" ? "cpw4-icon-table" : "cpw4-icon-card"} aria-hidden="true" />
                  </button>
                ))}
              </div>

              <div data-screener-density-control className="cpw4-density-group" aria-label="행 밀도">
                {DENSITY_BUTTONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    data-screener-density-option={item}
                    data-canvas-plus-row-height={DENSITY_ROW_HEIGHT[item]}
                    onClick={() => handleDensityChange(item)}
                    aria-label={DENSITY_LABEL[item]}
                    aria-pressed={density === item}
                    data-canvas-plus-active={String(density === item)}
                    className="cpw4-density-button"
                  >
                    {item === "compact" ? "C" : item === "standard" ? "S" : "L"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div className={enableCanvasPlusPreview ? "cp-screener-results-mobile space-y-3 md:hidden" : "space-y-3 md:hidden"}>
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
                selected={selectedTickers.has(stock.ticker)}
                canvasPlusPreview={enableCanvasPlusPreview}
                onToggle={() => setExpandedTicker((prev) => (prev === stock.ticker ? null : stock.ticker))}
                onSelectedChange={() => toggleSelectedTicker(stock.ticker)}
              />
            );
          })}
          {dataReady && pageRows.length === 0 ? (
            <ScreenerEmptyState canvasPlusPreview={enableCanvasPlusPreview} hasFilters={hasFilters} onResetFilters={resetFilters} />
          ) : null}
        </div>

        <div className={enableCanvasPlusPreview ? "cp-screener-results-body hidden md:block" : "hidden md:block"}>
          {viewMode === "card" ? (
            <div
              data-screener-card-grid
              data-canvas-plus-screener-card-grid={enableCanvasPlusPreview ? "true" : undefined}
              className={enableCanvasPlusPreview ? "cp-screener-card-grid" : "grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3"}
            >
              {pageRows.map((stock) => {
                const expanded = expandedTicker === stock.ticker;
                const detailId = `screener-card-detail-${stock.ticker}`;
                return (
                  <DesktopStockCard
                    key={stock.ticker}
                    stock={stock}
                    expanded={expanded}
                    detailId={detailId}
                    preset={preset}
                    selected={selectedTickers.has(stock.ticker)}
                    canvasPlusPreview={enableCanvasPlusPreview}
                    onToggle={() => setExpandedTicker((prev) => (prev === stock.ticker ? null : stock.ticker))}
                    onSelectedChange={() => toggleSelectedTicker(stock.ticker)}
                  />
                );
              })}
              {dataReady && pageRows.length === 0 ? (
                <ScreenerEmptyState canvasPlusPreview={enableCanvasPlusPreview} hasFilters={hasFilters} onResetFilters={resetFilters} />
              ) : null}
            </div>
          ) : (
            <ScreenerTanstackTable
              activeColumns={activeColumns}
              allPageSelected={allPageSelected}
              dataReady={dataReady}
              density={density}
              densityClass={densityClass}
              hasFilters={hasFilters}
              canvasPlusPreview={enableCanvasPlusPreview}
              enabled={enableCanvasPlusPreview}
              expandedTicker={expandedTicker}
              fallback={
                <ScreenerDesktopTable
                  activeColumns={activeColumns}
                  allPageSelected={allPageSelected}
                  dataReady={dataReady}
                  density={density}
                  densityClass={densityClass}
                  hasFilters={hasFilters}
                  canvasPlusPreview={enableCanvasPlusPreview}
                  expandedTicker={expandedTicker}
                  pageRows={pageRows}
                  preset={preset}
                  selectedTickers={selectedTickers}
                  sortDir={sortDir}
                  sortKey={sortKey}
                  deselectPageRows={deselectPageRows}
                  onToggleExpandedTicker={onToggleExpandedTicker}
                  onResetFilters={resetFilters}
                  renderCell={renderCell}
                  renderGuruHolderBadge={renderGuruHolderBadge}
                  selectPageRows={selectPageRows}
                  toggleSelectedTicker={toggleSelectedTicker}
                  toggleSort={toggleSort}
                />
              }
              pageRows={pageRows}
              preset={preset}
              selectedTickers={selectedTickers}
              onResetFilters={resetFilters}
              sortDir={sortDir}
              sortKey={sortKey}
              deselectPageRows={deselectPageRows}
              onToggleExpandedTicker={onToggleExpandedTicker}
              renderCell={renderCell}
              renderGuruHolderBadge={renderGuruHolderBadge}
              selectPageRows={selectPageRows}
              toggleSelectedTicker={toggleSelectedTicker}
              toggleSort={toggleSort}
            />
          )}
        </div>

        {/* Pagination */}
        {sorted.length > PAGE_SIZE ? (
          <div className={enableCanvasPlusPreview ? "cp-screener-pagination" : "mt-3 flex items-center justify-between gap-3 px-2"}>
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              disabled={safePage === 0}
              className={enableCanvasPlusPreview ? "cp-button cp-screener-page-button" : "inline-flex min-h-9 items-center rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-2)] transition enabled:hover:border-[var(--brand-interactive)] disabled:cursor-not-allowed disabled:bg-[var(--c-surface-2)]"}
              data-variant={enableCanvasPlusPreview ? "ghost" : undefined}
              data-density={enableCanvasPlusPreview ? "compact" : undefined}
            >
              이전
            </button>
            <span className={enableCanvasPlusPreview ? "cp-screener-page-status" : "orbitron text-xs font-bold tabular-nums text-[var(--c-ink-3)]"}>
              {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
              disabled={safePage >= pageCount - 1}
              className={enableCanvasPlusPreview ? "cp-button cp-screener-page-button" : "inline-flex min-h-9 items-center rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-2)] transition enabled:hover:border-[var(--brand-interactive)] disabled:cursor-not-allowed disabled:bg-[var(--c-surface-2)]"}
              data-variant={enableCanvasPlusPreview ? "ghost" : undefined}
              data-density={enableCanvasPlusPreview ? "compact" : undefined}
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
