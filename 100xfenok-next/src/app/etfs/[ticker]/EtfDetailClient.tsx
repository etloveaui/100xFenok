"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import WatchStar from "@/components/WatchStar";
import { formatSignedPercent } from "@/lib/format";
import TickerSurfaceEventsCard from "@/app/stock/[ticker]/TickerSurfaceEventsCard";
import EtfRetryCallout from "@/app/etfs/EtfRetryCallout";
import ExternalSourceLinks from "@/components/ExternalSourceLinks";
import DataProvenanceNote from "@/components/DataProvenanceNote";
import {
  cleanCategory,
  formatAum,
  issuerNameFromEtfName,
  isSingleStockLeveragedEtf,
  type EtfUniverseRecord,
} from "@/app/explore/etfUniverseUtils";
import {
  getEtfPeersForUnderlying,
  getUnderlyingStockForEtf,
  loadStockServicesIndex,
  type StockServicesIndex,
} from "@/lib/data-entity-graph/stock-index";
import { normalizeForEntityKey } from "@/lib/ticker";
import { ROUTES } from "@/lib/routes";

type MaybeNumber = number | null | undefined;

interface EtfHolding {
  rank?: number | null;
  symbol?: string | null;
  name?: string | null;
  weight_pct?: number | null;
  shares?: number | string | null;
}

interface WeightedRow {
  key?: string | null;
  n?: string | null;
  country?: string | null;
  code?: string | null;
  value?: number | null;
  w?: number | null;
  weight?: number | null;
}

interface HistoryPoint {
  t?: string | null;
  date?: string | null;
  o?: number | null;
  h?: number | null;
  l?: number | null;
  c?: number | null;
  close?: number | null;
  v?: number | null;
  ch?: number | null;
}

type HistoryMode = "daily" | "weekly" | "monthly";
type HistoryRange = "1Y" | "3Y" | "5Y";
type HistoryPeriodKey = `${HistoryMode}_${Lowercase<HistoryRange>}`;

interface EtfPerformance {
  tr1m?: number | null;
  trYTD?: number | null;
  tr1y?: number | null;
  cagr3y?: number | null;
  cagr5y?: number | null;
  cagr10y?: number | null;
  cagrMAX?: number | null;
}

interface EtfPayload {
  ticker?: string;
  asset_type?: string;
  fetched_at?: string;
  detail_status?: string;
  normalized?: {
    holdings?: EtfHolding[];
    asset_allocation?: WeightedRow[] | null;
    sectors?: WeightedRow[] | null;
    countries?: WeightedRow[] | null;
    holding_count?: number | null;
    holdings_updated?: string | null;
    overview?: Record<string, unknown> | null;
    performance?: EtfPerformance | null;
    quote?: Record<string, unknown> | null;
    history?: HistoryPoint[];
    history_periods?: Partial<Record<HistoryPeriodKey, HistoryPoint[]>>;
    classification?: EtfClassification | null;
  };
  raw?: {
    overview?: {
      performance?: EtfPerformance | null;
    } | null;
  } | null;
}

interface DetailStatusMeta {
  title: string;
  description: string;
}

interface MarketFact {
  value?: unknown;
  source?: string;
  as_of?: string | null;
  fetched_at?: string | null;
  unit?: string;
}

interface MarketFactsPayload {
  ticker?: string;
  asset_type?: string;
  generated_at?: string;
  identity?: {
    name?: string | null;
    exchange?: string | null;
    currency?: string | null;
    fund_family?: string | null;
    category?: string | null;
  };
  facts?: Record<string, MarketFact>;
  etf?: {
    holdings_count?: number | null;
    holdings_updated?: string | null;
    top_holdings?: EtfHolding[];
    asset_allocation?: WeightedRow[];
    sectors?: WeightedRow[];
    countries?: WeightedRow[];
    classification?: {
      is_leveraged?: boolean;
      leverage_factor?: number | null;
      is_inverse?: boolean;
      is_single_stock?: boolean;
      underlying?: string | null;
    } | null;
  } | null;
}

interface EtfSignalRow {
  ticker?: string;
  company?: string | null;
  category?: string | null;
  scores?: Record<string, number | null | undefined>;
  scored_signal_count?: number | null;
}

interface EtfSignalsPayload {
  generated_at?: string | null;
  formula_version?: string | null;
  caveat?: string | null;
  row?: EtfSignalRow | null;
}

type DetailEtfUniverseRecord = EtfUniverseRecord & {
  provider_page?: string | null;
  source_page?: number | null;
};

interface EtfUniversePayload {
  generated_at?: string | null;
  counts?: {
    records?: number | null;
  } | null;
  records?: DetailEtfUniverseRecord[];
}

interface EtfPeerCollectionsData {
  issuerLabel: string;
  categoryLabel: string;
  universeCount: number | null;
  generatedAt: string | null;
  issuerPeers: DetailEtfUniverseRecord[];
  categoryPeers: DetailEtfUniverseRecord[];
  holdingPeers: DetailEtfUniverseRecord[];
}

type EtfClassification = NonNullable<NonNullable<MarketFactsPayload["etf"]>["classification"]>;
type LoadResult<T> =
  | { kind: "load_result"; status: "ok"; data: T }
  | { kind: "load_result"; status: "missing"; data: null }
  | { kind: "load_result"; status: "failed"; data: null };

const etfCache: Record<string, Promise<LoadResult<EtfPayload>> | EtfPayload | undefined> = {};
const factsCache: Record<string, Promise<LoadResult<MarketFactsPayload>> | MarketFactsPayload | undefined> = {};
const signalsCache: Record<string, Promise<LoadResult<EtfSignalsPayload>> | EtfSignalsPayload | undefined> = {};
let etfUniverseCache: EtfUniversePayload | undefined;
let etfUniversePending: Promise<LoadResult<EtfUniversePayload>> | null = null;

const ETF_SIGNAL_SCORE_FIELDS = [
  { key: "cost_efficiency", label: "비용 효율" },
  { key: "liquidity", label: "유동성" },
  { key: "tracking_quality", label: "추종 품질" },
  { key: "momentum_trend", label: "추세" },
  { key: "risk_adjusted_momentum", label: "위험조정 추세" },
  { key: "income", label: "인컴" },
  { key: "diversification", label: "분산" },
  { key: "classification_risk", label: "분류 안전성" },
] as const;

const ISSUER_SLUG_LABELS: Record<string, string> = {
  "blackrock": "iShares",
  "ishares": "iShares",
  "state-street": "State Street",
  "state street": "State Street",
  "vanguard": "Vanguard",
  "invesco": "Invesco",
  "proshares": "ProShares",
  "direxion": "Direxion",
  "global-x": "Global X",
  "global x": "Global X",
  "jpmorgan": "JPMorgan",
  "fidelity": "Fidelity",
  "schwab": "Schwab",
  "graniteshares": "GraniteShares",
  "rex-shares": "REX Shares",
  "tuttle-capital": "Tuttle Capital",
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function cleanSymbol(value: string) {
  return normalizeForEntityKey(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function missingResult<T>(): LoadResult<T> {
  return { kind: "load_result", status: "missing", data: null };
}

function failedResult<T>(): LoadResult<T> {
  return { kind: "load_result", status: "failed", data: null };
}

function okResult<T>(data: T): LoadResult<T> {
  return { kind: "load_result", status: "ok", data };
}

function isLoadResult<T>(value: unknown): value is LoadResult<T> {
  const record = asRecord(value);
  return record?.kind === "load_result"
    && (record.status === "ok" || record.status === "missing" || record.status === "failed");
}

function clearEtfRuntimeCache(ticker: string) {
  const symbol = cleanSymbol(ticker);
  if (!symbol) return;
  delete etfCache[symbol];
  delete factsCache[symbol];
  delete signalsCache[symbol];
}

function loadEtfPayload(ticker: string): Promise<LoadResult<EtfPayload>> {
  const symbol = cleanSymbol(ticker);
  if (!symbol) return Promise.resolve(missingResult());
  const cached = etfCache[symbol];
  if (cached instanceof Promise) return cached;
  if (cached !== undefined) return Promise.resolve(okResult(cached));

  const request = fetch(`/api/data/stockanalysis/etfs/${encodeURIComponent(symbol)}/`, { cache: "no-store" })
    .then((res) => {
      if (res.ok) return res.json();
      return res.status === 404 ? missingResult<EtfPayload>() : failedResult<EtfPayload>();
    })
    .then((payload) => {
      if (isLoadResult<EtfPayload>(payload)) {
        delete etfCache[symbol];
        return payload;
      }
      const parsed = asRecord(payload) ? payload as EtfPayload : null;
      if (parsed) {
        etfCache[symbol] = parsed;
        return okResult(parsed);
      } else {
        delete etfCache[symbol];
        return missingResult<EtfPayload>();
      }
    })
    .catch(() => {
      delete etfCache[symbol];
      return failedResult<EtfPayload>();
    });
  etfCache[symbol] = request;
  return request;
}

function loadMarketFacts(ticker: string): Promise<LoadResult<MarketFactsPayload>> {
  const symbol = cleanSymbol(ticker);
  if (!symbol) return Promise.resolve(missingResult());
  const cached = factsCache[symbol];
  if (cached instanceof Promise) return cached;
  if (cached !== undefined) return Promise.resolve(okResult(cached));

  const request = fetch(`/data/computed/market_facts/tickers/${encodeURIComponent(symbol)}.json`, { cache: "no-store" })
    .then((res) => {
      if (res.ok) return res.json();
      return res.status === 404 ? missingResult<MarketFactsPayload>() : failedResult<MarketFactsPayload>();
    })
    .then((payload) => {
      if (isLoadResult<MarketFactsPayload>(payload)) {
        delete factsCache[symbol];
        return payload;
      }
      const parsed = asRecord(payload) ? payload as MarketFactsPayload : null;
      if (parsed) {
        factsCache[symbol] = parsed;
        return okResult(parsed);
      } else {
        delete factsCache[symbol];
        return missingResult<MarketFactsPayload>();
      }
    })
    .catch(() => {
      delete factsCache[symbol];
      return failedResult<MarketFactsPayload>();
    });
  factsCache[symbol] = request;
  return request;
}

function loadEtfSignalPayload(ticker: string): Promise<LoadResult<EtfSignalsPayload>> {
  const symbol = cleanSymbol(ticker);
  if (!symbol) return Promise.resolve(missingResult());
  const cached = signalsCache[symbol];
  if (cached instanceof Promise) return cached;
  if (cached !== undefined) return Promise.resolve(okResult(cached));

  const request = fetch(`/api/data/fenok-etf-signals/${encodeURIComponent(symbol)}/`, { cache: "no-store" })
    .then((res) => {
      if (res.ok) return res.json();
      return res.status === 404 ? missingResult<EtfSignalsPayload>() : failedResult<EtfSignalsPayload>();
    })
    .then((payload) => {
      if (isLoadResult<EtfSignalsPayload>(payload)) {
        delete signalsCache[symbol];
        return payload;
      }
      const parsed = asRecord(payload) ? payload as EtfSignalsPayload : null;
      if (parsed) {
        signalsCache[symbol] = parsed;
        return okResult(parsed);
      } else {
        delete signalsCache[symbol];
        return missingResult<EtfSignalsPayload>();
      }
    })
    .catch(() => {
      delete signalsCache[symbol];
      return failedResult<EtfSignalsPayload>();
    });
  signalsCache[symbol] = request;
  return request;
}

function loadEtfUniversePayload(): Promise<LoadResult<EtfUniversePayload>> {
  if (etfUniverseCache) return Promise.resolve(okResult(etfUniverseCache));
  if (etfUniversePending) return etfUniversePending;

  etfUniversePending = fetch("/api/data/stockanalysis/etf-universe", { cache: "no-store" })
    .then((res) => {
      if (res.ok) return res.json();
      return res.status === 404 ? missingResult<EtfUniversePayload>() : failedResult<EtfUniversePayload>();
    })
    .then((payload) => {
      if (isLoadResult<EtfUniversePayload>(payload)) {
        etfUniversePending = null;
        return payload;
      }
      const parsed = asRecord(payload) ? payload as EtfUniversePayload : null;
      if (!parsed) {
        etfUniversePending = null;
        return missingResult<EtfUniversePayload>();
      }
      etfUniverseCache = parsed;
      etfUniversePending = null;
      return okResult(parsed);
    })
    .catch(() => {
      etfUniverseCache = undefined;
      etfUniversePending = null;
      return failedResult<EtfUniversePayload>();
    });
  return etfUniversePending;
}

function factNumber(facts: MarketFactsPayload | null | undefined, key: string): number | null {
  const value = facts?.facts?.[key]?.value;
  return isFiniteNumber(value) ? value : null;
}

function factDate(facts: MarketFactsPayload | null | undefined, key: string): string | null {
  const fact = facts?.facts?.[key];
  return fact?.as_of ?? fact?.fetched_at ?? null;
}

function rawText(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (isFiniteNumber(value)) return value.toLocaleString("ko-KR");
  return "—";
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildHoldingsCsv(symbol: string, holdings: EtfHolding[], holdingsUpdated: string | null | undefined): string {
  const header = ["etf", "rank", "symbol", "name", "weight_pct", "shares", "holdings_as_of"];
  const body = holdings.map((item, index) => [
    symbol,
    item.rank ?? index + 1,
    item.symbol ?? "",
    item.name ?? "",
    isFiniteNumber(item.weight_pct) ? item.weight_pct : "",
    item.shares ?? "",
    holdingsUpdated ?? "",
  ]);
  return [header, ...body].map((row) => row.map(csvCell).join(",")).join("\n");
}

function downloadHoldingsCsv(symbol: string, holdings: EtfHolding[], holdingsUpdated: string | null | undefined) {
  if (typeof window === "undefined" || holdings.length === 0) return;
  const blob = new Blob([buildHoldingsCsv(symbol, holdings, holdingsUpdated)], { type: "text/csv;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `100xfenok-etf-${symbol.toLowerCase()}-holdings-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function fmtDateish(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "—";
  return value.trim();
}

function formatMoney(value: MaybeNumber, currency: string) {
  if (!isFiniteNumber(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
  }).format(value);
}

function formatCompactMoney(value: MaybeNumber, currency: string) {
  if (!isFiniteNumber(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function fmtPercentPoints(value: MaybeNumber) {
  if (!isFiniteNumber(value)) return "—";
  const abs = Math.abs(value);
  return `${value.toFixed(abs >= 100 ? 1 : 2)}%`;
}

function fmtSignedPercentPoints(value: MaybeNumber) {
  return isFiniteNumber(value) ? formatSignedPercent(value, { digits: 2, fraction: false }) : "—";
}

function fmtCompactSignedPercent(value: MaybeNumber) {
  return isFiniteNumber(value) ? formatSignedPercent(value, { digits: Math.abs(value) >= 100 ? 1 : 2, fraction: false }) : "—";
}

function fmtEtfSignalScore(value: MaybeNumber) {
  if (!isFiniteNumber(value)) return "—";
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function fmtShares(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!isFiniteNumber(value)) return "—";
  return value.toLocaleString("ko-KR", { maximumFractionDigits: value >= 1000 ? 0 : 2 });
}

function metricValue(value: unknown, fallback: unknown = null) {
  const primary = rawText(value);
  return primary !== "—" ? primary : rawText(fallback);
}

function weightedRowName(row: WeightedRow): string {
  return row.key ?? row.n ?? row.country ?? row.code ?? "—";
}

function weightedRowValue(row: WeightedRow): number | null {
  if (isFiniteNumber(row.value)) return row.value;
  if (isFiniteNumber(row.w)) return row.w;
  if (isFiniteNumber(row.weight)) return row.weight;
  return null;
}

function hasWeightedRows(rows: WeightedRow[] | null | undefined) {
  return Array.isArray(rows) && rows.some((row) => weightedRowValue(row) !== null);
}

function performanceFromPayload(
  payload: EtfPayload | null | undefined,
  normalized: EtfPayload["normalized"],
  marketFacts: MarketFactsPayload | null | undefined,
): EtfPerformance | null {
  const normalizedPerformance = normalized?.performance;
  const sourcePerformance: EtfPerformance = normalizedPerformance && typeof normalizedPerformance === "object" ? normalizedPerformance : {};
  const rawPerformance = payload?.raw?.overview?.performance;
  const legacyPerformance: EtfPerformance = rawPerformance && typeof rawPerformance === "object" ? rawPerformance : {};
  const derivedPerformance: EtfPerformance = {
    tr1m: factNumber(marketFacts, "return_1m"),
    trYTD: factNumber(marketFacts, "return_ytd"),
    tr1y: factNumber(marketFacts, "return_1y"),
    cagr3y: factNumber(marketFacts, "return_3y_avg"),
    cagr5y: factNumber(marketFacts, "return_5y_avg"),
    cagr10y: factNumber(marketFacts, "return_10y_avg"),
    cagrMAX: factNumber(marketFacts, "return_max_avg"),
  };
  const fields = ["tr1m", "trYTD", "tr1y", "cagr3y", "cagr5y", "cagr10y", "cagrMAX"] as const;
  const merged: EtfPerformance = {};
  fields.forEach((field) => {
    const value = isFiniteNumber(sourcePerformance[field])
      ? sourcePerformance[field]
      : isFiniteNumber(legacyPerformance[field])
        ? legacyPerformance[field]
        : derivedPerformance[field];
    if (isFiniteNumber(value)) merged[field] = value;
  });
  return Object.values(merged).some(isFiniteNumber) ? merged : null;
}

function detailStatusMeta(status: string | null): DetailStatusMeta | null {
  if (status === "surface_only") {
    return {
      title: "기본 가격·변동률 제공 중",
      description: "ETF 목록과 신규 상장 데이터로 요약을 먼저 보여줍니다. 보유 구성과 세부 분석은 수집이 확인된 항목부터 반영합니다.",
    };
  }
  if (status === "universe_only") {
    return {
      title: "ETF 기본 정보만 제공 중",
      description: "ETF 전체 목록 기준의 기본 정보부터 연결했습니다. 보유 구성과 세부 분해는 다음 데이터 갱신 후 보강됩니다.",
    };
  }
  if (status === "yf_fallback") {
    return {
      title: "가격 정보는 연결됐고 보강 중",
      description: "가격과 일부 기본 지표를 먼저 보여줍니다. 보유 구성과 분류 지표는 수집이 확인된 항목부터 반영합니다.",
    };
  }
  return null;
}

function classificationLabels(classification: EtfClassification | null | undefined) {
  if (!classification) return [];
  const labels: string[] = [];
  if (classification.is_leveraged) {
    labels.push(isFiniteNumber(classification.leverage_factor) ? `${classification.leverage_factor}x 레버리지` : "레버리지");
  }
  if (classification.is_inverse) labels.push("인버스");
  if (classification.is_single_stock) {
    labels.push(classification.underlying ? `단일종목 레버리지 ${classification.underlying}` : "단일종목 레버리지");
  } else if (classification.underlying) {
    labels.push(`기초 ${classification.underlying}`);
  }
  return labels;
}

function parsePercentPoints(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function peerExpenseRatioLabel(row: DetailEtfUniverseRecord): string {
  const value = parsePercentPoints(row.expenseRatio) ?? parsePercentPoints(row.expense_ratio);
  return value === null ? "보수 미표시" : `보수 ${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function titleCaseSlug(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part ? `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}` : part)
    .join(" ");
}

function cleanIssuerLabel(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text === "—" || text === "-") return null;
  const normalized = text.toLowerCase();
  return ISSUER_SLUG_LABELS[normalized] ?? titleCaseSlug(text);
}

function issuerLabelForUniverseRow(row: DetailEtfUniverseRecord | null | undefined, fallback?: string | null): string {
  const explicitIssuer = cleanIssuerLabel(row?.issuer);
  if (explicitIssuer) return issuerNameFromEtfName(explicitIssuer);
  const provider = cleanIssuerLabel(row?.provider_page);
  if (provider) return issuerNameFromEtfName(provider);
  const fromName = issuerNameFromEtfName(row?.name ?? fallback);
  return fromName && fromName !== "미분류" ? fromName : "운용사 미분류";
}

function peerIssuerKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function rowTicker(row: DetailEtfUniverseRecord): string {
  return cleanSymbol(String(row.ticker ?? ""));
}

function sortByAum(rows: DetailEtfUniverseRecord[]) {
  return [...rows].sort((a, b) => {
    const aumA = isFiniteNumber(a.aum) ? a.aum : -1;
    const aumB = isFiniteNumber(b.aum) ? b.aum : -1;
    return aumB - aumA || rowTicker(a).localeCompare(rowTicker(b));
  });
}

function normalizeHoldingAlias(value: string): string {
  return value
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function topHoldingAliases(holdings: EtfHolding[]): string[] {
  const aliases = new Set<string>();
  for (const holding of holdings.slice(0, 25)) {
    const symbol = typeof holding.symbol === "string" ? cleanSymbol(holding.symbol) : "";
    if (/^[A-Z][A-Z0-9.-]{0,7}$/.test(symbol)) {
      aliases.add(normalizeHoldingAlias(symbol));
      aliases.add(normalizeHoldingAlias(symbol.replace(".", "-")));
      aliases.add(normalizeHoldingAlias(symbol.replace("-", ".")));
    }
    const name = typeof holding.name === "string" ? normalizeHoldingAlias(holding.name) : "";
    if (name && !name.includes("CASH") && !name.includes("TREASURY")) aliases.add(name);
  }
  return [...aliases].filter((alias) => alias.length >= 2);
}

function holdingAliases(alias: string): string[] {
  const aliases: Record<string, string[]> = {
    AAPL: ["APPLE"],
    AMD: ["ADVANCED MICRO DEVICES"],
    AMZN: ["AMAZON"],
    AVGO: ["BROADCOM"],
    GOOGL: ["ALPHABET", "GOOGLE"],
    GOOG: ["ALPHABET", "GOOGLE"],
    META: ["META"],
    MSFT: ["MICROSOFT"],
    NVDA: ["NVIDIA"],
    TSLA: ["TESLA"],
  };
  return [alias, ...(aliases[alias] ?? [])].map(normalizeHoldingAlias);
}

function holdingPeerMatch(row: DetailEtfUniverseRecord, holdingAliasesForTopHoldings: string[]): boolean {
  if (!isSingleStockLeveragedEtf(row)) return false;
  const classification = row.classification && typeof row.classification === "object" ? row.classification : null;
  const text = normalizeHoldingAlias([
    row.ticker,
    row.name,
    row.underlying,
    classification?.underlying,
  ]
    .filter(Boolean)
    .join(" "));
  return holdingAliasesForTopHoldings.some((alias) => holdingAliases(alias).some((candidate) => text.includes(candidate)));
}

function buildEtfPeerCollections({
  symbol,
  provider,
  category,
  displayName,
  holdings,
  universe,
}: {
  symbol: string;
  provider: string;
  category: string;
  displayName: string;
  holdings: EtfHolding[];
  universe: EtfUniversePayload | null;
}): EtfPeerCollectionsData | null {
  const records = Array.isArray(universe?.records) ? universe.records : [];
  if (!records.length) return null;
  const current = records.find((row) => rowTicker(row) === symbol) ?? null;
  const currentIssuer = issuerLabelForUniverseRow(current, provider !== "—" ? provider : displayName);
  const currentIssuerKey = peerIssuerKey(currentIssuer);
  const currentCategory = cleanCategory(current?.category ?? current?.assetClass ?? (category !== "—" ? category : null));
  const otherRows = records.filter((row) => rowTicker(row) && rowTicker(row) !== symbol);
  const holdingAliasesForTopHoldings = topHoldingAliases(holdings);

  return {
    issuerLabel: currentIssuer,
    categoryLabel: currentCategory,
    universeCount: universe?.counts?.records ?? records.length,
    generatedAt: universe?.generated_at ?? null,
    issuerPeers: sortByAum(otherRows.filter((row) => peerIssuerKey(issuerLabelForUniverseRow(row)) === currentIssuerKey)).slice(0, 6),
    categoryPeers: sortByAum(otherRows.filter((row) => cleanCategory(row.category ?? row.assetClass) === currentCategory)).slice(0, 6),
    holdingPeers: sortByAum(otherRows.filter((row) => holdingPeerMatch(row, holdingAliasesForTopHoldings))).slice(0, 6),
  };
}

function SectionCard({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="panel stock-section">
      <div className="panel-h">
        <h2>{title}</h2>
        {desc ? <span className="desc">{desc}</span> : null}
      </div>
      <div className="panel-b">{children}</div>
    </section>
  );
}

function SkeletonSection() {
  return (
    <div className="panel stock-section">
      <div className="panel-b">
        <div className="h-5 w-1/3 rounded bg-[var(--c-surface-2)]" />
        <div className="mt-3 h-32 rounded bg-[var(--c-surface-2)]" />
      </div>
    </div>
  );
}

function MetricCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)]/70 px-3 py-3">
      <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">{label}</p>
      <p className="orbitron mt-1 min-w-0 break-words text-base font-black tabular-nums text-[var(--c-ink)]">{value}</p>
      {note && note !== "—" ? <p className="mt-1 min-w-0 break-words text-[10px] font-semibold text-[var(--c-ink-3)]">{note}</p> : null}
    </div>
  );
}

function PeerEtfCard({ row, currentSymbol }: { row: DetailEtfUniverseRecord; currentSymbol: string }) {
  const ticker = rowTicker(row);
  const oneYear = row.performance && isFiniteNumber(row.performance.tr1y) ? fmtCompactSignedPercent(row.performance.tr1y) : null;
  const classification = row.classification && typeof row.classification === "object" ? row.classification : null;
  const typeLabels = [
    classification?.is_leveraged ? (isFiniteNumber(classification.leverage_factor) ? `${classification.leverage_factor}x` : "레버리지") : null,
    classification?.is_inverse ? "인버스" : null,
    classification?.is_single_stock ? "단일종목" : null,
  ].filter((label): label is string => Boolean(label));
  const compareHref = `/etfs/compare?tickers=${encodeURIComponent(`${currentSymbol},${ticker}`)}`;

  return (
    <div className="min-w-0 rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)]/70 px-3 py-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <TransitionLink href={`/etfs/${encodeURIComponent(ticker)}`} className="orbitron text-sm font-black text-[var(--c-ink)] hover:text-brand-interactive">
            {ticker}
          </TransitionLink>
          <p className="mt-1 min-w-0 break-words text-xs font-bold leading-snug text-[var(--c-ink)]">{row.name ?? ticker}</p>
        </div>
        <span className="orbitron tabular-nums shrink-0 rounded-full bg-[var(--c-surface-2)] px-2 py-1 text-[10px] font-black text-[var(--c-ink-3)]">
          {formatAum(row)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-black text-[var(--c-ink-3)]">
        <span className="rounded-full border border-[var(--c-line)] bg-white px-2 py-1">{cleanCategory(row.category ?? row.assetClass)}</span>
        <span className="rounded-full border border-[var(--c-line)] bg-white px-2 py-1">{peerExpenseRatioLabel(row)}</span>
        {oneYear ? <span className="rounded-full border border-[var(--c-line)] bg-white px-2 py-1">1년 {oneYear}</span> : null}
        {typeLabels.map((label) => (
          <span key={label} className="rounded-full border border-[var(--c-line)] bg-[var(--c-surface-2)] px-2 py-1">{label}</span>
        ))}
      </div>
      <TransitionLink href={compareHref} className="mt-3 inline-flex min-h-8 items-center rounded-full border border-[var(--c-line)] bg-white px-3 text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-brand)] transition hover:border-brand-interactive">
        겹침 비교
      </TransitionLink>
    </div>
  );
}

function PeerLane({
  title,
  desc,
  rows,
  currentSymbol,
}: {
  title: string;
  desc: string;
  rows: DetailEtfUniverseRecord[];
  currentSymbol: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 min-w-0">
        <p className="text-xs font-black text-[var(--c-ink)]">{title}</p>
        <p className="mt-1 text-[10px] font-semibold leading-relaxed text-[var(--c-ink-3)]">{desc}</p>
      </div>
      {rows.length ? (
        <div className="grid gap-2">
          {rows.map((row) => (
            <PeerEtfCard key={`${title}-${rowTicker(row)}`} row={row} currentSymbol={currentSymbol} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 py-3 text-xs font-semibold text-[var(--c-ink-3)]">
          현재 연결 후보 없음
        </p>
      )}
    </div>
  );
}

function EtfPeerCollectionsSection({
  data,
  loading,
  failed,
  currentSymbol,
}: {
  data: EtfPeerCollectionsData | null;
  loading: boolean;
  failed: boolean;
  currentSymbol: string;
}) {
  if (loading) {
    return (
      <SectionCard title="ETF 연결 지도" desc="운용사·카테고리·보유종목 기준">
        <p className="text-sm font-semibold text-[var(--c-ink-3)]">연결 후보 확인 중</p>
      </SectionCard>
    );
  }

  if (failed || !data) {
    return (
      <SectionCard title="ETF 연결 지도" desc="운용사·카테고리·보유종목 기준">
        <p className="text-sm font-semibold text-[var(--c-ink-3)]">ETF 전체 범위 연결을 확인하지 못했습니다.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="ETF 연결 지도" desc={`${data.universeCount?.toLocaleString("ko-KR") ?? "전체"}개 ETF 범위`}>
      <div className="grid gap-4 xl:grid-cols-3">
        <PeerLane
          title={`같은 운용사 · ${data.issuerLabel}`}
          desc="운용사 식별명과 운용자산을 기준으로 가까운 ETF를 먼저 보여줍니다."
          rows={data.issuerPeers}
          currentSymbol={currentSymbol}
        />
        <PeerLane
          title={`같은 카테고리 · ${data.categoryLabel}`}
          desc="카테고리와 운용자산 기준으로 대체 후보를 묶었습니다."
          rows={data.categoryPeers}
          currentSymbol={currentSymbol}
        />
        <PeerLane
          title="단일종목·레버리지 연결"
          desc="상위 25개 보유 항목의 티커/회사명과 단일종목·레버리지 ETF의 이름/기초자산을 맞춰 찾습니다."
          rows={data.holdingPeers}
          currentSymbol={currentSymbol}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 py-2 text-[10px] font-bold text-[var(--c-ink-3)]">
        <span>단일종목·레버리지 연결과 겹침 비교는 상위 25개 표시 항목 기준입니다.</span>
        <span>업데이트 {fmtDateish(data.generatedAt)}</span>
      </div>
    </SectionCard>
  );
}

function PerformanceView({ performance }: { performance: EtfPerformance | null }) {
  const items = [
    { label: "1개월", value: performance?.tr1m, note: "총수익률" },
    { label: "연초 이후", value: performance?.trYTD, note: "총수익률" },
    { label: "1년", value: performance?.tr1y, note: "총수익률" },
    { label: "3년 CAGR", value: performance?.cagr3y, note: "연환산" },
    { label: "5년 CAGR", value: performance?.cagr5y, note: "연환산" },
    { label: "10년 CAGR", value: performance?.cagr10y, note: "연환산" },
    { label: "상장 이후 CAGR", value: performance?.cagrMAX, note: "연환산" },
  ].filter((item) => isFiniteNumber(item.value));

  if (!items.length) {
    return <p className="text-sm font-semibold text-[var(--c-ink-3)]">기간 수익률 데이터 없음</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const value = item.value ?? 0;
        const tone = value >= 0 ? "text-[var(--c-up)]" : "text-[var(--c-down)]";
        return (
          <div key={item.label} className="rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)]/70 px-3 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">{item.label}</p>
            <p className={`orbitron mt-1 text-lg font-black tabular-nums ${tone}`}>{fmtCompactSignedPercent(value)}</p>
            <p className="mt-1 text-[10px] font-semibold text-[var(--c-ink-3)]">{item.note}</p>
          </div>
        );
      })}
    </div>
  );
}

function DetailAvailabilityCallout({
  meta,
  available,
  pending,
}: {
  meta: DetailStatusMeta;
  available: string[];
  pending: string[];
}) {
  const availableItems = available.length ? available : ["기본 식별 정보"];
  const pendingItems = pending.length ? pending : ["추가 보강 대기 없음"];
  return (
    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black text-amber-900">{meta.title}</p>
          <p className="mt-1 text-[11px] font-semibold leading-relaxed text-amber-800">{meta.description}</p>
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:min-w-[360px]">
          <div className="min-w-0">
            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.08em] text-amber-700">현재 제공</p>
            <div className="flex flex-wrap gap-1">
              {availableItems.map((item) => (
                <span key={`available-${item}`} className="rounded-full border border-amber-200 bg-white px-2 py-1 text-[10px] font-black text-amber-800">{item}</span>
              ))}
            </div>
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.08em] text-amber-700">보강 대기</p>
            <div className="flex flex-wrap gap-1">
              {pendingItems.map((item) => (
                <span key={`pending-${item}`} className="rounded-full border border-amber-200 bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-900">{item}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HoldingsTable({ holdings, currency }: { holdings: EtfHolding[]; currency: string }) {
  if (!holdings.length) {
    return <p className="text-sm font-semibold text-[var(--c-ink-3)]">보유 구성 데이터 없음</p>;
  }
  return (
    <div className="-mx-1 max-h-[560px] overflow-auto px-1" role="region" aria-label="보유 구성 표" tabIndex={0}>
      <table className="w-full min-w-[620px] text-xs">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-[var(--c-line)] text-[10px] font-black uppercase tracking-[0.06em] text-[var(--c-ink-3)]">
            <th scope="col" className="px-2 py-2 text-right">#</th>
            <th scope="col" className="px-2 py-2 text-left">종목/계약</th>
            <th scope="col" className="px-2 py-2 text-right">비중</th>
            <th scope="col" className="px-2 py-2 text-right">수량</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((item, index) => {
            const weight = isFiniteNumber(item.weight_pct) ? item.weight_pct : null;
            const weightClass = weight !== null && weight < 0 ? "text-[var(--c-down)]" : "text-[var(--c-ink)]";
            return (
              <tr key={`${item.rank ?? index}-${item.symbol ?? ""}-${item.name ?? ""}`} className="border-b border-[var(--c-line)] last:border-b-0">
                <td className="px-2 py-2 text-right orbitron tabular-nums text-[11px] font-bold text-[var(--c-ink-3)]">{item.rank ?? index + 1}</td>
                <th scope="row" className="px-2 py-2 text-left min-w-0">
                  {item.symbol ? (
                    <span className="orbitron text-xs font-black text-[var(--c-ink)]">{item.symbol}</span>
                  ) : null}
                  <span className="block truncate max-w-[14rem] text-[11px] font-semibold text-[var(--c-ink-4)]" title={item.name ?? undefined}>
                    {item.name ?? "—"}
                  </span>
                </th>
                <td className={`px-2 py-2 text-right orbitron tabular-nums text-xs font-black ${weightClass}`}>{fmtPercentPoints(weight)}</td>
                <td className="px-2 py-2 text-right orbitron tabular-nums text-[11px] font-semibold text-[var(--c-ink-3)]">{fmtShares(item.shares)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {currency ? <p className="mt-2 text-[10px] font-semibold text-[var(--c-ink-3)]">표시 통화: {currency}</p> : null}
    </div>
  );
}

function WeightedList({ rows, empty }: { rows: WeightedRow[] | null | undefined; empty: string }) {
  const items = Array.isArray(rows) ? rows.filter((row) => weightedRowValue(row) !== null) : [];
  if (!items.length) return <p className="text-sm font-semibold text-[var(--c-ink-3)]">{empty}</p>;
  return (
    <div className="space-y-2">
      {items.map((row, index) => {
        const value = weightedRowValue(row) ?? 0;
        const width = Math.min(100, Math.abs(value));
        return (
          <div key={`${weightedRowName(row)}-${index}`}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate font-bold text-[var(--c-ink)]">{weightedRowName(row)}</span>
              <span className={`orbitron tabular-nums font-black ${value < 0 ? "text-[var(--c-down)]" : "text-[var(--c-ink)]"}`}>{fmtPercentPoints(value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--c-surface-2)]">
              <div className={`h-2 rounded-full ${value < 0 ? "bg-[color:var(--c-down)]" : "bg-brand-interactive"}`} style={{ width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const HISTORY_MODES: HistoryMode[] = ["daily", "weekly", "monthly"];
const HISTORY_RANGES: HistoryRange[] = ["1Y", "3Y", "5Y"];

function historyModeLabel(mode: HistoryMode) {
  if (mode === "daily") return "일간";
  if (mode === "weekly") return "주간";
  return "월간";
}

function historyPointDate(point: HistoryPoint) {
  return point.t ?? point.date ?? null;
}

function historyPointClose(point: HistoryPoint) {
  return isFiniteNumber(point.c) ? point.c : isFiniteNumber(point.close) ? point.close : null;
}

function legacyHistoryMode(history: HistoryPoint[]): HistoryMode {
  if (history.length >= 120) return "daily";
  if (history.length >= 30) return "weekly";
  return "monthly";
}

function historyPeriodKey(mode: HistoryMode, range: HistoryRange): HistoryPeriodKey {
  return `${mode}_${range.toLowerCase()}` as HistoryPeriodKey;
}

function normalizedHistoryRows(rows: HistoryPoint[] | null | undefined) {
  return Array.isArray(rows) ? rows.filter((point) => historyPointClose(point) !== null) : [];
}

function historyRowsForSelection(
  periods: Partial<Record<HistoryPeriodKey, HistoryPoint[]>> | null | undefined,
  legacyHistory: HistoryPoint[],
  mode: HistoryMode,
  range: HistoryRange,
) {
  const direct = normalizedHistoryRows(periods?.[historyPeriodKey(mode, range)]);
  if (direct.length > 0) return direct;
  if (range !== "1Y" || legacyHistory.length === 0) return [];
  return legacyHistoryMode(legacyHistory) === mode ? normalizedHistoryRows(legacyHistory) : [];
}

function firstAvailableHistorySelection(
  periods: Partial<Record<HistoryPeriodKey, HistoryPoint[]>> | null | undefined,
  legacyHistory: HistoryPoint[],
) {
  for (const mode of HISTORY_MODES) {
    for (const range of HISTORY_RANGES) {
      if (historyRowsForSelection(periods, legacyHistory, mode, range).length > 0) {
        return { mode, range };
      }
    }
  }
  return null;
}

function HistoryControls({
  mode,
  onModeChange,
  range,
  onRangeChange,
  isAvailable,
}: {
  mode: HistoryMode;
  onModeChange: (mode: HistoryMode, range: HistoryRange) => void;
  range: HistoryRange;
  onRangeChange: (range: HistoryRange) => void;
  isAvailable: (mode: HistoryMode, range: HistoryRange) => boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="seg" role="group" aria-label="차트 간격">
        {HISTORY_MODES.map((m) => {
          const nextRange = isAvailable(m, range)
            ? range
            : HISTORY_RANGES.find((candidate) => isAvailable(m, candidate));
          return (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              className={mode === m ? "on" : ""}
              disabled={!nextRange}
              onClick={() => nextRange && onModeChange(m, nextRange)}
            >
              {historyModeLabel(m)}
            </button>
          );
        })}
      </div>
      <div className="seg" role="group" aria-label="구간">
        {HISTORY_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={range === r}
            className={range === r ? "on" : ""}
            disabled={!isAvailable(mode, r)}
            onClick={() => onRangeChange(r)}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}

function HistoryView({
  history,
  historyPeriods,
  currency,
  mode,
  onModeChange,
  range,
  onRangeChange,
  loadFailed,
}: {
  history: HistoryPoint[];
  historyPeriods?: Partial<Record<HistoryPeriodKey, HistoryPoint[]>>;
  currency: string;
  mode: HistoryMode;
  onModeChange: (mode: HistoryMode) => void;
  range: HistoryRange;
  onRangeChange: (range: HistoryRange) => void;
  loadFailed?: boolean;
}) {
  const fallback = useMemo(() => firstAvailableHistorySelection(historyPeriods, history), [historyPeriods, history]);
  const requestedRows = useMemo(
    () => historyRowsForSelection(historyPeriods, history, mode, range),
    [historyPeriods, history, mode, range],
  );
  const activeMode = requestedRows.length > 0 ? mode : fallback?.mode ?? mode;
  const activeRange = requestedRows.length > 0 ? range : fallback?.range ?? range;
  const rows = useMemo(
    () => requestedRows.length > 0
      ? requestedRows
      : historyRowsForSelection(historyPeriods, history, activeMode, activeRange),
    [requestedRows, historyPeriods, history, activeMode, activeRange],
  );
  const availableMap = useMemo(() => {
    const next: Partial<Record<HistoryPeriodKey, boolean>> = {};
    for (const candidateMode of HISTORY_MODES) {
      for (const candidateRange of HISTORY_RANGES) {
        next[historyPeriodKey(candidateMode, candidateRange)] =
          historyRowsForSelection(historyPeriods, history, candidateMode, candidateRange).length > 0;
      }
    }
    return next;
  }, [historyPeriods, history]);
  const isAvailable = (candidateMode: HistoryMode, candidateRange: HistoryRange) =>
    Boolean(availableMap[historyPeriodKey(candidateMode, candidateRange)]);
  const pendingMultiYearRanges = useMemo(
    () => loadFailed
      ? []
      : (["3Y", "5Y"] as const).filter((candidateRange) =>
          HISTORY_MODES.every((candidateMode) => !availableMap[historyPeriodKey(candidateMode, candidateRange)])
        ),
    [availableMap, loadFailed],
  );
  const historyStats = useMemo(() => {
    const chronological = [...rows].reverse();
    const closes = chronological.map(historyPointClose).filter(isFiniteNumber);
    if (!closes.length) return null;
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const priceRange = max - min || 1;
    const firstClose = closes[0] ?? null;
    const lastClose = closes[closes.length - 1] ?? null;
    const periodReturn = firstClose && lastClose !== null ? ((lastClose - firstClose) / firstClose) * 100 : null;
    return { chronological, min, max, priceRange, periodReturn };
  }, [rows]);
  if (!rows.length) {
    return (
      <p className="text-sm font-semibold text-[var(--c-ink-3)]">
        {loadFailed ? "가격 히스토리를 불러오지 못했습니다. 다시 시도해 주세요." : "가격 히스토리 없음"}
      </p>
    );
  }
  if (!historyStats) return <p className="text-sm font-semibold text-[var(--c-ink-3)]">가격 히스토리 없음</p>;

  const activeLabel = historyModeLabel(activeMode);
  return (
    <div className="space-y-3">
      <HistoryControls
        mode={activeMode}
        onModeChange={(nextMode, nextRange) => {
          onModeChange(nextMode);
          onRangeChange(nextRange);
        }}
        range={activeRange}
        onRangeChange={onRangeChange}
        isAvailable={isAvailable}
      />
      {pendingMultiYearRanges.length > 0 ? (
        <p className="rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 py-2 text-xs font-semibold text-[var(--c-ink-3)]">
          {pendingMultiYearRanges.join("·")} 히스토리 대기: 해당 구간 데이터가 들어오면 차트와 표에 자동 반영됩니다.
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <MetricCard label={`${activeLabel} 구간 수익률`} value={fmtCompactSignedPercent(historyStats.periodReturn)} note={`${activeRange} ${activeLabel} 종가 기준`} />
        <MetricCard label="구간 고점" value={formatMoney(historyStats.max, currency)} note={`${activeRange} ${activeLabel} 종가 기준`} />
        <MetricCard label="구간 저점" value={formatMoney(historyStats.min, currency)} note={`${activeRange} ${activeLabel} 종가 기준`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <div className="flex h-40 items-end gap-1 overflow-hidden rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 py-3">
          {historyStats.chronological.map((point, index) => {
            const date = historyPointDate(point);
            const close = historyPointClose(point) ?? historyStats.min;
            const height = 10 + ((close - historyStats.min) / historyStats.priceRange) * 90;
            const up = isFiniteNumber(point.ch) ? point.ch >= 0 : true;
            return (
              <div key={`${date ?? "period"}-${index}`} className="flex h-full min-w-[2px] flex-1 flex-col items-center justify-end gap-1" title={`${date ?? "—"}: ${formatMoney(close, currency)}`}>
                <div className={`w-full rounded-t ${up ? "bg-[color:var(--c-up)]" : "bg-[color:var(--c-down)]"}`} style={{ height: `${height}%` }} />
                <span className="hidden max-w-full truncate text-[9px] font-bold text-[var(--c-ink-3)] sm:block">{(date ?? "").slice(5, 7)}</span>
              </div>
            );
          })}
        </div>
        <div className="-mx-1 overflow-x-auto px-1" role="region" aria-label="가격 히스토리 표" tabIndex={0}>
          <table className="w-full min-w-[360px] text-xs">
            <thead>
              <tr className="border-b border-[var(--c-line)] text-[10px] font-black uppercase tracking-[0.06em] text-[var(--c-ink-3)]">
                <th scope="col" className="px-2 py-2 text-left">일자</th>
                <th scope="col" className="px-2 py-2 text-right">종가</th>
                <th scope="col" className="px-2 py-2 text-right">변화</th>
                <th scope="col" className="px-2 py-2 text-right">거래량</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((point, index) => (
                <tr key={`${historyPointDate(point) ?? "row"}-${index}`} className="border-b border-[var(--c-line)] last:border-b-0">
                  <th scope="row" className="px-2 py-2 text-left font-bold text-[var(--c-ink)]">{historyPointDate(point) ?? "—"}</th>
                  <td className="px-2 py-2 text-right orbitron tabular-nums font-black text-[var(--c-ink)]">{formatMoney(historyPointClose(point), currency)}</td>
                  <td className={`px-2 py-2 text-right orbitron tabular-nums font-black ${isFiniteNumber(point.ch) && point.ch < 0 ? "text-[var(--c-down)]" : "text-[var(--c-up)]"}`}>{fmtSignedPercentPoints(point.ch)}</td>
                  <td className="px-2 py-2 text-right orbitron tabular-nums font-semibold text-[var(--c-ink-3)]">{fmtShares(point.v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function EtfDetailClient({ ticker }: { ticker: string }) {
  const symbol = cleanSymbol(ticker);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<{
    symbol: string;
    reloadKey: number;
    etfResult: LoadResult<EtfPayload> | undefined;
    factsResult: LoadResult<MarketFactsPayload> | undefined;
    signalsResult: LoadResult<EtfSignalsPayload> | undefined;
  }>({ symbol, reloadKey: 0, etfResult: undefined, factsResult: undefined, signalsResult: undefined });
  const [universeState, setUniverseState] = useState<{
    loaded: boolean;
    failed: boolean;
    data: EtfUniversePayload | null;
  }>({ loaded: false, failed: false, data: null });
  const [stockServicesIndex, setStockServicesIndex] = useState<StockServicesIndex | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadEtfPayload(symbol), loadMarketFacts(symbol), loadEtfSignalPayload(symbol)]).then(([nextEtf, nextFacts, nextSignals]) => {
      if (!cancelled) {
        setState({ symbol, reloadKey, etfResult: nextEtf, factsResult: nextFacts, signalsResult: nextSignals });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [symbol, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    loadEtfUniversePayload().then((result) => {
      if (cancelled) return;
      setUniverseState({
        loaded: true,
        failed: result.status === "failed",
        data: result.status === "ok" ? result.data : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadStockServicesIndex(controller.signal).then((payload) => {
      if (!controller.signal.aborted) setStockServicesIndex(payload);
    });
    return () => controller.abort();
  }, []);

  const currentState = state.symbol === symbol && state.reloadKey === reloadKey;
  const etfResult = currentState ? state.etfResult : undefined;
  const factsResult = currentState ? state.factsResult : undefined;
  const signalsResult = currentState ? state.signalsResult : undefined;
  const etfData = etfResult?.status === "ok" ? etfResult.data : etfResult === undefined ? undefined : null;
  const marketFacts = factsResult?.status === "ok" ? factsResult.data : factsResult === undefined ? undefined : null;
  const etfSignals = signalsResult?.status === "ok" ? signalsResult.data : signalsResult === undefined ? undefined : null;
  const etfLoadFailed = etfResult?.status === "failed";
  const factsLoadFailed = factsResult?.status === "failed";
  const hasLoadFailure = etfLoadFailed || factsLoadFailed;
  const retryLoads = () => {
    clearEtfRuntimeCache(symbol);
    setReloadKey((value) => value + 1);
  };
  const loading = etfResult === undefined || factsResult === undefined;
  const normalized = etfData?.normalized ?? {};
  const overview = normalized.overview ?? {};
  const quote = normalized.quote ?? {};
  const identity = marketFacts?.identity ?? {};
  const currency = identity.currency ?? "USD";
  const price = factNumber(marketFacts, "price") ?? (isFiniteNumber(quote.p) ? quote.p : null);
  const changePct = factNumber(marketFacts, "change_pct") ?? (isFiniteNumber(quote.cp) ? quote.cp : null);
  const displayName = identity.name && identity.name !== symbol ? identity.name : metricValue(overview.name, symbol);
  const category = identity.category ?? metricValue(overview.category);
  const exchange = identity.exchange ?? metricValue(quote.ex);
  const provider = identity.fund_family ?? metricValue(overview.provider ?? overview.issuer);
  const holdingsFromFacts = Array.isArray(marketFacts?.etf?.top_holdings) ? marketFacts.etf.top_holdings : [];
  const holdings = Array.isArray(normalized.holdings) && normalized.holdings.length > 0 ? normalized.holdings : holdingsFromFacts;
  const holdingCount = isFiniteNumber(normalized.holding_count)
    ? normalized.holding_count
    : isFiniteNumber(marketFacts?.etf?.holdings_count)
      ? marketFacts.etf.holdings_count
      : holdings.length;
  const holdingsUpdated = normalized.holdings_updated ?? marketFacts?.etf?.holdings_updated ?? null;
  const totalWeight = holdings.reduce((sum, item) => sum + (isFiniteNumber(item.weight_pct) ? item.weight_pct : 0), 0);
  const assetAllocation = normalized.asset_allocation ?? marketFacts?.etf?.asset_allocation ?? null;
  const sectors = normalized.sectors ?? marketFacts?.etf?.sectors ?? null;
  const countries = normalized.countries ?? marketFacts?.etf?.countries ?? null;
  const history = Array.isArray(normalized.history) ? normalized.history : [];
  const historyPeriods = normalized.history_periods ?? {};
  const [historyMode, setHistoryMode] = useState<HistoryMode>("monthly");
  const [historyRange, setHistoryRange] = useState<HistoryRange>("1Y");
  const performance = performanceFromPayload(etfData, normalized, marketFacts);
  const statusMeta = detailStatusMeta(etfData?.detail_status ?? null);
  const classification = marketFacts?.etf?.classification ?? normalized.classification ?? null;
  const underlyingService = useMemo(
    () => getUnderlyingStockForEtf(stockServicesIndex, symbol),
    [stockServicesIndex, symbol],
  );
  const sameUnderlyingEtfs = useMemo(
    () => underlyingService ? getEtfPeersForUnderlying(stockServicesIndex, underlyingService.stockTicker, symbol) : [],
    [stockServicesIndex, underlyingService, symbol],
  );
  const sameUnderlyingCompareHref = sameUnderlyingEtfs.length > 0
    ? `/etfs/compare?tickers=${encodeURIComponent([symbol, ...sameUnderlyingEtfs.slice(0, 3).map((link) => link.ticker)].join(","))}`
    : null;
  const labels = classificationLabels(classification);
  const website = typeof overview.etf_website === "string" && overview.etf_website.trim() ? overview.etf_website.trim() : null;
  const inceptionDate = rawText(overview.inception);
  const sharesOutstanding = rawText(overview.sharesOut);
  const quoteDate = fmtDateish(quote.u);
  const updateDate = factDate(marketFacts, "price")
    ?? (quoteDate !== "—" ? quoteDate : null)
    ?? etfData?.fetched_at
    ?? marketFacts?.generated_at
    ?? null;
  const holdingsDate = fmtDateish(holdingsUpdated);
  const externalSourceAsOf = holdingsDate !== "—" ? holdingsDate : fmtDateish(updateDate);
  const singleStockClassificationDetails = classification?.is_single_stock
    ? [
        classification.underlying ? `분류 기초 ${classification.underlying}` : null,
        underlyingService?.stockTicker ? `기초 종목 ${underlyingService.stockTicker}` : null,
        underlyingService?.link.resolution_source ? `해결 출처 ${underlyingService.link.resolution_source}` : null,
        fmtDateish(updateDate) !== "—" ? `기준 ${fmtDateish(updateDate)}` : null,
      ]
    : [];

  const totalAssets = factNumber(marketFacts, "total_assets");
  const expenseRatio = factNumber(marketFacts, "expense_ratio");
  const dividendYield = factNumber(marketFacts, "dividend_yield");
  const beta = factNumber(marketFacts, "beta");
  const trailingPe = factNumber(marketFacts, "trailing_pe");
  const availableDetailItems = [
    price !== null ? "가격" : null,
    changePct !== null ? "당일 변화" : null,
    totalAssets !== null || rawText(overview.aum) !== "—" ? "운용자산" : null,
    expenseRatio !== null || rawText(overview.expenseRatio) !== "—" ? "보수율" : null,
    dividendYield !== null || rawText(overview.dividendYield) !== "—" ? "배당률" : null,
    inceptionDate !== "—" ? "상장일" : null,
    sharesOutstanding !== "—" ? "발행 주식 수" : null,
    category !== "—" ? "카테고리" : null,
    labels.length > 0 ? "분류 태그" : null,
    holdingCount > 0 ? "보유 항목 수" : null,
    performance ? "기간 수익률" : null,
    history.length > 0 ? "가격 히스토리" : null,
  ].filter((item): item is string => Boolean(item));
  const pendingDetailItems = [
    holdings.length === 0 ? "보유·스왑 구성 목록" : null,
    !hasWeightedRows(assetAllocation) ? "자산 분해" : null,
    !hasWeightedRows(sectors) ? "섹터 분해" : null,
    !hasWeightedRows(countries) ? "국가 분해" : null,
    !performance ? "기간 수익률" : null,
    history.length === 0 ? "가격 히스토리" : null,
  ].filter((item): item is string => Boolean(item));
  const metrics = [
    { label: "가격", value: formatMoney(price, currency), note: fmtDateish(updateDate) },
    { label: "당일 변화", value: fmtSignedPercentPoints(changePct), note: metricValue(quote.ex, exchange) },
    { label: "운용자산", value: totalAssets !== null ? formatCompactMoney(totalAssets, currency) : rawText(overview.aum), note: "총 운용자산" },
    { label: "보수율", value: expenseRatio !== null ? fmtPercentPoints(expenseRatio) : rawText(overview.expenseRatio), note: "총보수" },
    { label: "배당률", value: dividendYield !== null ? fmtPercentPoints(dividendYield) : rawText(overview.dividendYield), note: "분배금 기준" },
    { label: "상장일", value: inceptionDate, note: "상장 시작일" },
    { label: "발행 주식 수", value: sharesOutstanding, note: "현재 원장 기준" },
    { label: "베타", value: beta !== null ? beta.toFixed(2) : rawText(overview.beta), note: "시장 민감도" },
    { label: "NAV", value: rawText(overview.nav), note: "순자산가치" },
    { label: "PER", value: trailingPe !== null ? trailingPe.toFixed(1) : rawText(overview.peRatio), note: "최근 실적 기준" },
    { label: "52주 고가", value: isFiniteNumber(quote.h52) ? formatMoney(quote.h52, currency) : "—", note: "최근 52주 고점" },
    { label: "52주 저가", value: isFiniteNumber(quote.l52) ? formatMoney(quote.l52, currency) : "—", note: "최근 52주 저점" },
    { label: "보유 항목", value: `${holdings.length.toLocaleString("ko-KR")} / ${holdingCount.toLocaleString("ko-KR")}`, note: fmtDateish(holdingsUpdated) },
    { label: "표시 비중 합계", value: holdings.length > 0 ? fmtPercentPoints(totalWeight) : "—", note: "표시 항목 기준" },
  ].filter((metric) => metric.value !== "—");
  const etfSignalScores = etfSignals?.row?.scores ?? {};
  const etfSignalCount = etfSignals?.row?.scored_signal_count;
  const etfSignalDetails = [
    etfSignals?.generated_at ? `생성 ${fmtDateish(etfSignals.generated_at)}` : null,
    etfSignals?.formula_version ? `공식 ${etfSignals.formula_version}` : null,
    isFiniteNumber(etfSignalCount) ? `${etfSignalCount}개 항목` : null,
  ].filter((item): item is string => Boolean(item));
  const peerCollections = buildEtfPeerCollections({
    symbol,
    provider,
    category,
    displayName,
    holdings,
    universe: universeState.data,
  });

  if (loading) {
    return (
      <div className="stock-shell">
        <section className="stock-entity panel">
          <div className="stock-entity-in">
            <span className="stock-logo">{symbol.slice(0, 1)}</span>
            <div className="stock-id">
              <div className="stock-name"><h1>{symbol}</h1></div>
              <div className="stock-meta"><span>ETF 정보 확인 중</span></div>
            </div>
          </div>
        </section>
        <SkeletonSection />
        <SkeletonSection />
      </div>
    );
  }

  if (!etfData && !marketFacts) {
    if (hasLoadFailure) {
      return (
        <div className="stock-shell">
          <div className="panel stock-empty">
            <EtfRetryCallout
              title="ETF 데이터를 불러오지 못했습니다"
              desc="일시적인 연결 문제일 수 있습니다. 다시 시도하면 ETF 상세와 가격 정보를 새로 요청합니다."
              onRetry={retryLoads}
            />
            <ExternalSourceLinks ticker={symbol} kind="etf" statusLine="ETF 상세 일시 확인 불가" className="mt-4" />
            <TransitionLink href={ROUTES.etfs} className="mt-4 inline-flex min-h-9 items-center rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] px-4 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink)] transition hover:border-brand-interactive hover:text-brand-interactive">← ETF 목록에서 보기</TransitionLink>
          </div>
        </div>
      );
    }
    return (
      <div className="stock-shell">
        <div className="panel stock-empty">
          <p className="text-lg font-black text-[var(--c-ink)]">ETF 정보 연결 전</p>
          <p className="mt-2 text-sm font-semibold text-[var(--c-ink-3)]">
            {symbol} — 목록에는 잡혔지만 보유 구성과 가격 정보가 아직 충분히 연결되지 않았습니다.
          </p>
          <ExternalSourceLinks ticker={symbol} kind="etf" statusLine="ETF 상세 준비 전" className="mt-4" />
          <TransitionLink href={ROUTES.etfs} className="mt-4 inline-flex min-h-9 items-center rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] px-4 text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink)] transition hover:border-brand-interactive hover:text-brand-interactive">← ETF 목록에서 보기</TransitionLink>
        </div>
      </div>
    );
  }

  return (
    <div className="stock-shell">
      <section className="stock-entity panel">
        <div className="stock-entity-in">
          <span className="stock-logo">{symbol.slice(0, 1)}</span>
          <div className="stock-id">
            <div className="stock-name">
              <h1>{symbol}</h1>
              <WatchStar ticker={symbol} className="stock-star" />
            </div>
            <div className="stock-meta">
              <span className="entity-name truncate" title={displayName}>{displayName}</span>
              <span className="x">·</span>
              <span className="num">{symbol}</span>
              <span className="x">·</span>
              <span>ETF</span>
              {exchange !== "—" ? <><span className="x">·</span><span>{exchange}</span></> : null}
              {category !== "—" ? <><span className="x">·</span><span>{category}</span></> : null}
              {provider !== "—" ? <><span className="x">·</span><span>{provider}</span></> : null}
            </div>
            {labels.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {labels.map((label) => (
                  <span key={label} className="rounded-full border border-[var(--c-line)] bg-[var(--c-surface-2)] px-2.5 py-1 text-[10px] font-black text-[var(--c-ink-3)]">{label}</span>
                ))}
              </div>
            ) : null}
            {classification?.is_single_stock ? (
              <>
                <DataProvenanceNote
                  title="분류 기반 연결"
                  details={singleStockClassificationDetails}
                  className="mt-3 max-w-2xl border-[var(--c-line)] bg-[var(--c-surface-2)] text-[var(--c-ink-3)]"
                >
                  단일종목 분류는 ETF 전체 목록의 분류와 기초자산 표기를 기준으로 표시합니다.
                </DataProvenanceNote>
                {underlyingService ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <TransitionLink
                      href={underlyingService.stockRoute}
                      className="inline-flex min-h-8 items-center rounded-full border border-[var(--c-line)] bg-white px-3 text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-brand)] transition hover:border-brand-interactive hover:text-brand-interactive"
                    >
                      기초 종목 보기
                    </TransitionLink>
                    {sameUnderlyingCompareHref ? (
                      <TransitionLink
                        href={sameUnderlyingCompareHref}
                        className="inline-flex min-h-8 items-center rounded-full border border-[var(--c-line)] bg-white px-3 text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-brand)] transition hover:border-brand-interactive hover:text-brand-interactive"
                      >
                        같은 기초 ETF 비교
                      </TransitionLink>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="stock-price">
            <span className="big num">{formatMoney(price, currency)}</span>
            {changePct !== null ? <span className={`stock-chip num ${changePct >= 0 ? "up" : "down"}`}>{fmtSignedPercentPoints(changePct)}</span> : null}
            <span className="delay">{fmtDateish(updateDate)}</span>
          </div>
        </div>
      </section>

      <div className="stock-body">
        <div className="stock-summary-stack">
          <TickerSurfaceEventsCard ticker={symbol} assetKind="etf" compact />
        </div>

        <div className="stock-main-stack">
          <SectionCard title="ETF 핵심 지표" desc="가격·비용·분류">
            {hasLoadFailure ? (
              <div className="mb-3">
                <EtfRetryCallout
                  title="일부 ETF 데이터를 불러오지 못했습니다"
                  desc="현재 보이는 값은 연결된 데이터만 사용합니다. 누락된 가격·상세 정보는 다시 시도해 확인할 수 있습니다."
                  onRetry={retryLoads}
                  compact
                />
              </div>
            ) : null}
            {statusMeta ? <DetailAvailabilityCallout meta={statusMeta} available={availableDetailItems} pending={pendingDetailItems} /> : null}
            {statusMeta ? (
              <ExternalSourceLinks
                ticker={symbol}
                kind="etf"
                statusLine={statusMeta.title}
                asOf={externalSourceAsOf}
                compact
                className="mb-3"
              />
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => (
                <MetricCard key={`${metric.label}-${metric.value}`} label={metric.label} value={metric.value} note={metric.note} />
              ))}
            </div>
            {website ? (
              <a
                href={website}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex min-h-8 items-center rounded-full border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)] transition hover:border-brand-interactive hover:bg-white hover:text-brand-interactive"
              >
                운용사 웹사이트
              </a>
            ) : null}
          </SectionCard>

          <SectionCard title="Fenok Edge ETF 시그널" desc="별도 ETF 레인 · SCORED, not DAILY/GATED">
            {signalsResult === undefined ? (
              <div className="rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 py-3 text-xs font-semibold text-[var(--c-ink-3)]">
                ETF 전용 시그널 확인 중
              </div>
            ) : etfSignals?.row ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {ETF_SIGNAL_SCORE_FIELDS.map((field) => (
                    <MetricCard
                      key={field.key}
                      label={field.label}
                      value={fmtEtfSignalScore(etfSignalScores[field.key])}
                      note="0-100 · ETF 전용"
                    />
                  ))}
                </div>
                <DataProvenanceNote
                  title="ETF 별도 레인"
                  details={etfSignalDetails}
                  className="mt-3 border-[var(--c-line)] bg-[var(--c-surface-2)] text-[var(--c-ink-3)]"
                >
                  주식 conviction/hexagon과 합산하지 않습니다. 현재 상태는 SCORED이며 PUBLIC/DAILY/GATED 완료 표시는 아닙니다.
                </DataProvenanceNote>
              </>
            ) : (
              <div className="rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 py-3 text-xs font-semibold text-[var(--c-ink-3)]">
                이 ETF의 별도 시그널 행이 아직 없습니다. 주식 점수로 대체하지 않습니다.
              </div>
            )}
          </SectionCard>

          <EtfPeerCollectionsSection
            data={peerCollections}
            loading={!universeState.loaded}
            failed={universeState.failed}
            currentSymbol={symbol}
          />

          <SectionCard title="기간 수익률" desc="총수익률·연환산 수익률">
            <PerformanceView performance={performance} />
          </SectionCard>

          <SectionCard title="보유·스왑 구성" desc={`${symbol} · ${holdings.length.toLocaleString("ko-KR")}개 표시`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--c-ink-3)]">
              <span>{holdingCount.toLocaleString("ko-KR")}개 원장 중 표시 가능한 항목</span>
              <span>{fmtDateish(holdingsUpdated) !== "—" ? `기준 ${fmtDateish(holdingsUpdated)}` : "기준일 미표시"}</span>
              <button
                type="button"
                onClick={() => downloadHoldingsCsv(symbol, holdings, holdingsUpdated)}
                disabled={holdings.length === 0}
                className="inline-flex min-h-8 items-center rounded-full border border-[var(--c-line)] bg-white px-3 text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)] transition hover:border-brand-interactive hover:text-brand-interactive disabled:cursor-not-allowed disabled:bg-[var(--c-surface-2)] disabled:text-[var(--c-ink-4)]"
              >
                CSV 저장
              </button>
            </div>
            <HoldingsTable holdings={holdings} currency={currency} />
          </SectionCard>

          <div className="grid gap-4 lg:grid-cols-3">
            <SectionCard title="자산 분해">
              <WeightedList rows={assetAllocation} empty="자산 분해 데이터 없음" />
            </SectionCard>
            <SectionCard title="섹터 분해">
              <WeightedList rows={sectors} empty="섹터 데이터 없음" />
            </SectionCard>
            <SectionCard title="국가 분해">
              <WeightedList rows={countries} empty="국가 데이터 없음" />
            </SectionCard>
          </div>

          <SectionCard title="가격 히스토리" desc="보유 데이터 기준 종가">
            <HistoryView
              history={history}
              historyPeriods={historyPeriods}
              currency={currency}
              mode={historyMode}
              onModeChange={setHistoryMode}
              range={historyRange}
              onRangeChange={setHistoryRange}
              loadFailed={etfLoadFailed}
            />
          </SectionCard>

          <footer className="stock-footer">
            <TransitionLink href={ROUTES.etfs} className="text-[10px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)] hover:text-brand-interactive">← ETF 목록에서 보기</TransitionLink>
            <TransitionLink href={`/portfolio?ticker=${encodeURIComponent(symbol)}`} className="text-[10px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)] hover:text-brand-interactive">포트폴리오에서 보기</TransitionLink>
          </footer>
        </div>
      </div>
    </div>
  );
}
