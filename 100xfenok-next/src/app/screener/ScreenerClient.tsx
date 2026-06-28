"use client";

import { Fragment, useMemo, useState, useEffect, useRef } from "react";
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
import StockDetailPanel from "./StockDetailPanel";
import { loadActionSummaryMap, type ActionSummaryRecord } from "@/features/stock-analyzer/data/action-summary-provider";
import type { MacroContextId } from "@/lib/macro-chart/context";

const PAGE_SIZE = 50;
const DESKTOP_ROW_HEIGHT = 52;
const DESKTOP_VIRTUAL_HEIGHT = 620;
const DESKTOP_VIRTUAL_OVERSCAN = 6;

type ActionFilter = "" | "guru_held" | "smart_money" | "value_momentum" | "index_core" | "income" | "momentum" | "watch";
type ConnectionFilter = "" | "filings" | "smartMoney" | "indexMembership" | "singleStockEtfs";

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
  { key: "connectionCount", label: "연결", align: "left" },
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

type ColumnPreset = "basic" | "action" | "connected" | "value" | "estimate" | "momentum" | "dividend" | "guru";

const PRESET_KEYS: Record<ColumnPreset, ScreenerSortKey[]> = {
  basic: ["ticker", "actionScore", "name", "sector", "country", "price", "marketCap", "per", "pbr", "dividendYield", "return12m"],
  action: ["ticker", "actionScore", "name", "sector", "guruHolders", "perBandCurrent", "return12m", "ret1y", "dividendYield", "marketCap"],
  connected: ["ticker", "connectionCount", "actionScore", "name", "sector", "guruHolders", "marketCap", "perBandCurrent", "forwardPeFy1", "return12m"],
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
  connected: "연결 데이터",
  value: "가치",
  estimate: "추정치",
  momentum: "모멘텀",
  dividend: "배당",
  guru: "대가 관심",
};

function coerceColumnPreset(value: string | null | undefined): ColumnPreset | null {
  return value && value in PRESET_KEYS ? (value as ColumnPreset) : null;
}

function coerceActionFilter(value: string | null | undefined): ActionFilter {
  if (
    value === "guru_held" ||
    value === "smart_money" ||
    value === "value_momentum" ||
    value === "index_core" ||
    value === "income" ||
    value === "momentum" ||
    value === "watch"
  ) {
    return value;
  }
  return "";
}

function coerceConnectionFilter(value: string | null | undefined): ConnectionFilter {
  if (value === "filings" || value === "smartMoney" || value === "indexMembership" || value === "singleStockEtfs") {
    return value;
  }
  return "";
}

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
    <span
      data-testid="screener-guru-badge"
      data-ticker={stock.ticker}
      data-superinvestors-href={ROUTES.superinvestorsByTicker(stock.ticker)}
      className="pointer-events-none inline-flex shrink-0 items-center rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-black text-violet-700"
      title={`${stock.ticker} 기관·고수 보유 ${holders.toLocaleString("ko-KR")}명`}
    >
      {compact ? `고수 ${holders}` : `기관·고수 ${holders}`}
    </span>
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

const MOBILE_PRESET_KEYS: Record<ColumnPreset, ScreenerSortKey[]> = {
  basic: ["marketCap", "per", "pbr", "dividendYield", "return12m", "roe", "opm", "eps"],
  action: ["actionScore", "marketCap", "guruHolders", "perBandCurrent", "return12m", "ret1y", "dividendYield", "connectionCount"],
  connected: ["connectionCount", "guruHolders", "forwardPeFy1", "return12m", "marketCap", "perBandCurrent", "dividendYield", "ret1y"],
  value: ["per", "peForward", "forwardPeFy1", "pbr", "roe", "opm", "perBandCurrent", "rank"],
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
  momentum: ["growthRate", "momentum1m", "momentum3m", "momentum6m", "momentum12m", "return12m", "ret1y", "rank"],
  dividend: ["dividendYield", "dividendTtm", "ret1y", "ret3y", "ret5y", "per", "pbr", "marketCap"],
  guru: ["guruHolders", "per", "peForward", "perBandCurrent", "roe", "marketCap", "return12m", "connectionCount"],
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

function MobileStockCard({
  stock,
  expanded,
  detailId,
  preset,
  selected,
  onToggle,
  onSelectedChange,
}: {
  stock: ScreenerStock;
  expanded: boolean;
  detailId: string;
  preset: ColumnPreset;
  selected: boolean;
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
    <article className="overflow-hidden rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel)] shadow-[var(--sh-sm)]">
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
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailId}
        aria-label={`${stock.ticker} 상세 ${expanded ? "접기" : "펼치기"}`}
        onClick={onToggle}
        className="flex min-h-14 w-full min-w-0 items-start gap-2 px-3 py-3 text-left transition hover:bg-[var(--c-surface-2)] focus:outline-none focus:ring-2 focus:ring-brand-interactive/40"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--c-surface-2)] text-sm font-black text-[var(--c-ink-2)]" aria-hidden="true">
          {expanded ? "-" : "+"}
        </span>
        <span className="min-w-0 flex-1">
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
      <div data-testid="screener-mobile-metric-grid" className="grid grid-cols-2 gap-2 border-t border-[var(--c-line-2)] px-3 py-3 sm:grid-cols-4">
        {metrics.map((metricKey) => (
          <MobileMetric key={metricKey} stock={stock} metricKey={metricKey} preset={preset} />
        ))}
      </div>
      {preset === "estimate" ? <MobileEstimateTrendSections stock={stock} compact /> : null}
      {expanded ? (
        <div id={detailId} className="border-t border-[var(--c-line-2)]">
          <StockDetailPanel ticker={stock.ticker} stock={stock} />
        </div>
      ) : null}
    </article>
  );
}

export default function ScreenerClient({
  initialSearch = "",
  initialSector = "",
  initialMacroContextId,
  initialPreset,
  initialActionFilter,
  initialConnectionFilter,
}: {
  initialSearch?: string;
  initialSector?: string;
  initialMacroContextId?: MacroContextId;
  initialPreset?: string;
  initialActionFilter?: string;
  initialConnectionFilter?: string;
}) {
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
  const [selectedSectors, setSelectedSectors] = useState<string[]>(() => (initialSector ? [initialSector] : []));
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [perMax, setPerMax] = useState("");
  const [forwardPerMax, setForwardPerMax] = useState("");
  const [revenueGrowthMin, setRevenueGrowthMin] = useState("");
  const [epsGrowthMin, setEpsGrowthMin] = useState("");
  const [dividendYieldMin, setDividendYieldMin] = useState("");
  const [roeFy1Min, setRoeFy1Min] = useState("");
  const [ret3yMin, setRet3yMin] = useState("");
  const [ret5yMin, setRet5yMin] = useState("");
  const [marketCapMin, setMarketCapMin] = useState("");
  const [marketCapMax, setMarketCapMax] = useState("");
  const [pbrMin, setPbrMin] = useState("");
  const [pbrMax, setPbrMax] = useState("");
  const [roeMin, setRoeMin] = useState("");
  const [opmMin, setOpmMin] = useState("");
  const [return12mMin, setReturn12mMin] = useState("");
  const [profitableOnly, setProfitableOnly] = useState(false);
  const [bandFilter, setBandFilter] = useState<"" | "cheap" | "fair" | "rich">("");
  const [actionFilter, setActionFilter] = useState<ActionFilter>(() => coerceActionFilter(initialActionFilter));
  const [connectionFilter, setConnectionFilter] = useState<ConnectionFilter>(() => coerceConnectionFilter(initialConnectionFilter));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortKey, setSortKey] = useState<ScreenerSortKey>("marketCap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
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
  const [preset, setPreset] = useState<ColumnPreset>(() => initialColumnPreset ?? "basic");

  useEffect(() => {
    if (initialColumnPreset) return;
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
  }, [initialColumnPreset]);

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
    const marketCapMinValue = marketCapMin.trim() === "" ? null : Number(marketCapMin);
    const marketCapMinValid = marketCapMinValue !== null && !Number.isNaN(marketCapMinValue);
    const marketCapMaxValue = marketCapMax.trim() === "" ? null : Number(marketCapMax);
    const marketCapMaxValid = marketCapMaxValue !== null && !Number.isNaN(marketCapMaxValue);
    const pbrMinValue = pbrMin.trim() === "" ? null : Number(pbrMin);
    const pbrMinValid = pbrMinValue !== null && !Number.isNaN(pbrMinValue);
    const pbrMaxValue = pbrMax.trim() === "" ? null : Number(pbrMax);
    const pbrMaxValid = pbrMaxValue !== null && !Number.isNaN(pbrMaxValue);
    const roeMinValue = roeMin.trim() === "" ? null : Number(roeMin);
    const roeMinValid = roeMinValue !== null && !Number.isNaN(roeMinValue);
    const opmMinValue = opmMin.trim() === "" ? null : Number(opmMin);
    const opmMinValid = opmMinValue !== null && !Number.isNaN(opmMinValue);
    const return12mMinValue = return12mMin.trim() === "" ? null : Number(return12mMin);
    const return12mMinValid = return12mMinValue !== null && !Number.isNaN(return12mMinValue);

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
      if (connectionFilter && !stock.connection?.flags[connectionFilter]) return false;
      if (perMaxValid && (stock.per === null || stock.per <= 0 || stock.per > (perMaxValue as number))) return false;
      if (forwardPerMaxValid && ((stock.forwardPeFy1 ?? null) === null || (stock.forwardPeFy1 as number) <= 0 || (stock.forwardPeFy1 as number) > (forwardPerMaxValue as number))) return false;
      if (revenueGrowthMinValid && ((stock.revenueGrowthFy1 ?? null) === null || (stock.revenueGrowthFy1 as number) < (revenueGrowthMinValue as number))) return false;
      if (epsGrowthMinValid && ((stock.epsGrowthFy1 ?? null) === null || (stock.epsGrowthFy1 as number) < (epsGrowthMinValue as number))) return false;
      if (dividendYieldMinValid && (stock.dividendYield === null || (stock.dividendYield * 100) < (dividendYieldMinValue as number))) return false;
      if (roeFy1MinValid && ((stock.roeFy1 ?? null) === null || (stock.roeFy1 as number) < (roeFy1MinValue as number))) return false;
      if (ret3yMinValid && (stock.ret3y === null || (stock.ret3y * 100) < (ret3yMinValue as number))) return false;
      if (ret5yMinValid && (stock.ret5y === null || (stock.ret5y * 100) < (ret5yMinValue as number))) return false;
      if (marketCapMinValid && (stock.marketCap === null || stock.marketCap < (marketCapMinValue as number) * 1000)) return false;
      if (marketCapMaxValid && (stock.marketCap === null || stock.marketCap > (marketCapMaxValue as number) * 1000)) return false;
      if (pbrMinValid && (stock.pbr === null || stock.pbr < (pbrMinValue as number))) return false;
      if (pbrMaxValid && (stock.pbr === null || stock.pbr > (pbrMaxValue as number))) return false;
      if (roeMinValid && (stock.roe === null || stock.roe * 100 < (roeMinValue as number))) return false;
      if (opmMinValid && (stock.opm === null || stock.opm * 100 < (opmMinValue as number))) return false;
      if (return12mMinValid && (stock.return12m === null || stock.return12m * 100 < (return12mMinValue as number))) return false;

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
  }, [stocks, search, selectedSectors, selectedCountries, perMax, forwardPerMax, revenueGrowthMin, epsGrowthMin, dividendYieldMin, roeFy1Min, ret3yMin, ret5yMin, marketCapMin, marketCapMax, pbrMin, pbrMax, roeMin, opmMin, return12mMin, profitableOnly, bandFilter, actionFilter, connectionFilter]);

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

  const stateKey = `${search}|${selectedSectors.join(",")}|${selectedCountries.join(",")}|${perMax}|${forwardPerMax}|${revenueGrowthMin}|${epsGrowthMin}|${dividendYieldMin}|${roeFy1Min}|${ret3yMin}|${ret5yMin}|${marketCapMin}|${marketCapMax}|${pbrMin}|${pbrMax}|${roeMin}|${opmMin}|${return12mMin}|${profitableOnly}|${bandFilter}|${actionFilter}|${connectionFilter}|${sortKey}|${sortDir}|${preset}`;
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
  const desktopScrollRef = useRef<HTMLDivElement | null>(null);
  const [desktopScrollMetrics, setDesktopScrollMetrics] = useState({ scrollTop: 0, viewportHeight: DESKTOP_VIRTUAL_HEIGHT });

  useEffect(() => {
    const node = desktopScrollRef.current;
    if (!node) return;

    let frame = 0;
    const readScrollMetrics = () => {
      frame = 0;
      setDesktopScrollMetrics({
        scrollTop: node.scrollTop,
        viewportHeight: node.clientHeight || DESKTOP_VIRTUAL_HEIGHT,
      });
    };
    const scheduleRead = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(readScrollMetrics);
    };

    readScrollMetrics();
    node.addEventListener("scroll", scheduleRead, { passive: true });
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleRead);
    resizeObserver?.observe(node);

    return () => {
      node.removeEventListener("scroll", scheduleRead);
      resizeObserver?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [activeColumns.length, pageRows.length, preset, safePage]);

  useEffect(() => {
    const node = desktopScrollRef.current;
    if (!node) return;
    node.scrollTop = 0;
    const frame = window.requestAnimationFrame(() => {
      setDesktopScrollMetrics({
        scrollTop: 0,
        viewportHeight: node.clientHeight || DESKTOP_VIRTUAL_HEIGHT,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [safePage, stateKey]);

  const desktopVirtualStart = Math.max(0, Math.floor(desktopScrollMetrics.scrollTop / DESKTOP_ROW_HEIGHT) - DESKTOP_VIRTUAL_OVERSCAN);
  const desktopVirtualCount = Math.ceil(desktopScrollMetrics.viewportHeight / DESKTOP_ROW_HEIGHT) + DESKTOP_VIRTUAL_OVERSCAN * 2;
  const desktopVirtualEnd = Math.min(pageRows.length, desktopVirtualStart + desktopVirtualCount);
  const desktopVirtualRows = pageRows.slice(desktopVirtualStart, desktopVirtualEnd);
  const desktopTopSpacerHeight = desktopVirtualStart * DESKTOP_ROW_HEIGHT;
  const desktopBottomSpacerHeight = Math.max(0, (pageRows.length - desktopVirtualEnd) * DESKTOP_ROW_HEIGHT);

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

  function toggleSort(key: ScreenerSortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      const textColumn = key === "ticker" || key === "name" || key === "sector" || key === "country";
      setSortDir(textColumn || key === "rank" ? "asc" : "desc");
    }
  }

  function toggleSelectedTicker(ticker: string) {
    setSelectedTickers((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  }

  function selectPageRows() {
    setSelectedTickers((prev) => {
      const next = new Set(prev);
      for (const stock of pageRows) next.add(stock.ticker);
      return next;
    });
  }

  function deselectPageRows() {
    setSelectedTickers((prev) => {
      const next = new Set(prev);
      for (const stock of pageRows) next.delete(stock.ticker);
      return next;
    });
  }

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
    setPerMax("");
    setForwardPerMax("");
    setRevenueGrowthMin("");
    setEpsGrowthMin("");
    setDividendYieldMin("");
    setRoeFy1Min("");
    setRet3yMin("");
    setRet5yMin("");
    setMarketCapMin("");
    setMarketCapMax("");
    setPbrMin("");
    setPbrMax("");
    setRoeMin("");
    setOpmMin("");
    setReturn12mMin("");
    setProfitableOnly(false);
    setBandFilter("");
    setActionFilter("");
    setConnectionFilter("");
  }

  const hasFilters = Boolean(search || selectedSectors.length || selectedCountries.length || perMax || forwardPerMax || revenueGrowthMin || epsGrowthMin || dividendYieldMin || roeFy1Min || ret3yMin || ret5yMin || marketCapMin || marketCapMax || pbrMin || pbrMax || roeMin || opmMin || return12mMin || profitableOnly || bandFilter || actionFilter || connectionFilter);
  const advancedFiltersActive = Boolean(perMax || forwardPerMax || revenueGrowthMin || epsGrowthMin || dividendYieldMin || roeFy1Min || ret3yMin || ret5yMin || marketCapMin || marketCapMax || pbrMin || pbrMax || roeMin || opmMin || return12mMin || bandFilter || actionFilter || connectionFilter);
  const activeAdvancedFilterCount = [
    perMax,
    forwardPerMax,
    revenueGrowthMin,
    epsGrowthMin,
    dividendYieldMin,
    roeFy1Min,
    ret3yMin,
    ret5yMin,
    marketCapMin,
    marketCapMax,
    pbrMin,
    pbrMax,
    roeMin,
    opmMin,
    return12mMin,
    bandFilter,
    actionFilter,
    connectionFilter,
  ].filter(Boolean).length;

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
    { active: Boolean(perMax), label: `PER ≤ ${perMax}`, clear: () => setPerMax("") },
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
    { active: Boolean(roeMin), label: `ROE ≥ ${roeMin}%`, clear: () => setRoeMin("") },
    { active: Boolean(opmMin), label: `OPM ≥ ${opmMin}%`, clear: () => setOpmMin("") },
    { active: Boolean(return12mMin), label: `12M 수익률 ≥ ${return12mMin}%`, clear: () => setReturn12mMin("") },
    { active: Boolean(dividendYieldMin), label: `배당 ≥ ${dividendYieldMin}%`, clear: () => setDividendYieldMin("") },
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
    ...(connectionFilter
      ? [{ active: true, label: `연결: ${CONNECTION_FILTER_LABEL[connectionFilter]}`, clear: () => setConnectionFilter("" as ConnectionFilter) }]
      : []),
    ...(selectedSectors.length > 0 ? [{ active: true, label: `섹터: ${selectedSectors.length}개`, clear: () => setSelectedSectors([]) }] : []),
    ...(selectedCountries.length > 0 ? [{ active: true, label: `국가: ${selectedCountries.length}개`, clear: () => setSelectedCountries([]) }] : []),
  ].filter((chip) => chip.active);

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
        </div>
      </section>

      {screenerDataState.status !== "ready" ? (
        <DataStateNotice state={screenerDataState} />
      ) : null}

      {initialMacroContextId ? (
        <MacroContextCard contextId={initialMacroContextId} surface="screener" />
      ) : null}

      <section className="rounded-[1.25rem] border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">선택 작업</p>
            <p className="mt-1 text-sm font-bold text-slate-700">
              현재 필터에서 {selectedRows.length.toLocaleString("ko-KR")}개 선택
              {selectedRows.length > 0 ? ` · 연결 ETF ${selectedSingleStockEtfCount.toLocaleString("ko-KR")}개` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={allPageSelected ? deselectPageRows : selectPageRows}
              disabled={pageRows.length === 0}
              className="min-h-9 rounded-md border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 text-xs font-black text-[var(--c-ink-2)] transition hover:border-[var(--brand-interactive)] hover:text-[var(--brand-interactive)] disabled:cursor-not-allowed disabled:bg-[var(--c-surface-2)] disabled:text-[var(--c-ink-2)]"
            >
              {allPageSelected ? "페이지 해제" : "페이지 선택"}
            </button>
            <button
              type="button"
              onClick={selectFilteredRows}
              disabled={sorted.length === 0}
              className="min-h-9 rounded-md border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 text-xs font-black text-[var(--c-ink-2)] transition hover:border-[var(--brand-interactive)] hover:text-[var(--brand-interactive)] disabled:cursor-not-allowed disabled:bg-[var(--c-surface-2)] disabled:text-[var(--c-ink-2)]"
            >
              필터 전체 선택
            </button>
            <button
              type="button"
              onClick={clearSelectedRows}
              disabled={selectedTickers.size === 0}
              className="min-h-9 rounded-md border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-xs font-black text-[var(--c-ink-2)] transition hover:border-[var(--brand-interactive)] hover:text-[var(--brand-interactive)] disabled:cursor-not-allowed disabled:bg-[var(--c-surface-2)] disabled:text-[var(--c-ink-2)]"
            >
              선택 해제
            </button>
            <button
              type="button"
              onClick={() => downloadConnectionCsv(selectedRows)}
              disabled={!connectionIndexReady || selectedRows.length === 0}
              className="min-h-9 rounded-md bg-[var(--c-ink)] px-3 text-xs font-black text-[var(--c-panel)] transition hover:bg-[var(--brand-interactive)] disabled:cursor-not-allowed disabled:bg-[var(--c-surface-2)] disabled:text-[var(--c-ink-2)]"
            >
              선택 CSV
            </button>
            {selectedSingleStockEtfCompareHref ? (
              <TransitionLink href={selectedSingleStockEtfCompareHref} className="inline-flex min-h-9 items-center rounded-md bg-[var(--c-ink)] px-3 text-xs font-black text-[var(--c-panel)] transition hover:bg-[var(--brand-interactive)]">
                선택 ETF 비교
              </TransitionLink>
            ) : (
              <span className="inline-flex min-h-9 items-center rounded-md border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 text-xs font-black text-[var(--c-ink-2)]">
                선택 ETF 부족
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Filter bar */}
      <section className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)]">
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
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen((value) => !value)}
          aria-expanded={filtersOpen}
          aria-controls="advanced-filters"
          aria-label={`고급 필터 ${filtersOpen ? "접기" : "열기"}${activeAdvancedFilterCount > 0 ? `, ${activeAdvancedFilterCount}개 적용 중` : ""}`}
          className="mt-3 inline-flex min-h-10 w-full items-center justify-between gap-2 rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)] md:hidden"
        >
          <span>{filtersOpen ? "고급 필터 접기" : "고급 필터 열기"}</span>
          <span
            data-testid="screener-mobile-advanced-count"
            className={cx(
              "inline-flex min-h-7 shrink-0 items-center rounded-full px-2.5 text-[10px] tracking-normal",
              advancedFiltersActive
                ? "bg-[var(--brand-interactive)] text-white"
                : "border border-[var(--c-line)] bg-[var(--c-panel)] text-[var(--c-ink-2)]",
            )}
          >
            {activeAdvancedFilterCount > 0 ? `${activeAdvancedFilterCount}개 적용` : "상세 조건"}
          </span>
        </button>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm font-bold text-[var(--c-ink-2)]">
            <input
              type="checkbox"
              checked={profitableOnly}
              onChange={(event) => setProfitableOnly(event.target.checked)}
              className="h-5 w-5 min-h-5 min-w-5 rounded border-slate-300 text-brand-interactive"
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
      <section className={cx("rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-2 shadow-[var(--sh-sm)] sm:p-3", !dataReady && "opacity-60")}>
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
                selected={selectedTickers.has(stock.ticker)}
                onToggle={() => setExpandedTicker((prev) => (prev === stock.ticker ? null : stock.ticker))}
                onSelectedChange={() => toggleSelectedTicker(stock.ticker)}
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
          <div
            ref={desktopScrollRef}
            data-testid="screener-desktop-virtual-scroll"
            className="-mx-1 max-h-[620px] overflow-auto px-1"
          >
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-[var(--c-line)] bg-[var(--c-panel)] text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-2)]">
                  <th className="w-12 px-2 py-2 text-left">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={(event) => (event.target.checked ? selectPageRows() : deselectPageRows())}
                      aria-label="현재 페이지 종목 선택"
                      className="h-5 min-h-5 w-5 min-w-5 accent-slate-900"
                    />
                  </th>
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
                              "inline-flex items-center gap-1 text-[var(--c-ink)] transition hover:text-[var(--c-ink)]",
                              column.align === "right" && "flex-row-reverse",
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
                {desktopTopSpacerHeight > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={activeColumns.length + 1} className="border-0 p-0" style={{ height: desktopTopSpacerHeight }} />
                  </tr>
                ) : null}
                {desktopVirtualRows.map((stock) => {
                  const expanded = expandedTicker === stock.ticker;
                  const detailId = `screener-detail-${stock.ticker}`;
                  return (
                  <Fragment key={stock.ticker}>
                    <tr
                      data-testid="screener-desktop-row"
                      data-ticker={stock.ticker}
                      onClick={() =>
                        setExpandedTicker((prev) => (prev === stock.ticker ? null : stock.ticker))
                      }
                      className="cursor-pointer border-b border-[var(--c-line-2)] transition last:border-0 hover:bg-[var(--c-surface-2)]"
                    >
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={selectedTickers.has(stock.ticker)}
                          onChange={() => toggleSelectedTicker(stock.ticker)}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`${stock.ticker} 선택`}
                          className="h-5 min-h-5 w-5 min-w-5 accent-slate-900"
                        />
                      </td>
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
                              className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-md px-1.5 text-left text-sm font-black text-[var(--c-ink)] transition hover:bg-[var(--c-surface-2)] focus:outline-none focus:ring-2 focus:ring-brand-interactive/40"
                            >
                              <span className="w-5 text-center text-[12px] text-[var(--c-ink-4)]" aria-hidden="true">{expanded ? "-" : "+"}</span>
                              <span className="truncate">{stock.ticker}</span>
                              <GuruHolderBadge stock={stock} compact />
                            </button>
                          ) : renderCell(stock, column.key, preset)}
                        </td>
                      ))}
                    </tr>
                    {expanded ? (
                      <tr id={detailId} data-testid="screener-desktop-detail-row" data-ticker={stock.ticker}>
                        <td colSpan={activeColumns.length + 1} className="p-0">
                          <StockDetailPanel ticker={stock.ticker} stock={stock} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                  );
                })}
                {desktopBottomSpacerHeight > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={activeColumns.length + 1} className="border-0 p-0" style={{ height: desktopBottomSpacerHeight }} />
                  </tr>
                ) : null}
                {dataReady && pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={activeColumns.length + 1} className="px-2 py-10 text-center text-sm font-semibold text-[var(--c-ink-3)]">
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
              className="inline-flex min-h-9 items-center rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-2)] transition enabled:hover:border-[var(--brand-interactive)] disabled:cursor-not-allowed disabled:bg-[var(--c-surface-2)]"
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
              className="inline-flex min-h-9 items-center rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-2)] transition enabled:hover:border-[var(--brand-interactive)] disabled:cursor-not-allowed disabled:bg-[var(--c-surface-2)]"
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
