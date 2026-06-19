"use client";

import { useEffect, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import WatchStar from "@/components/WatchStar";
import { formatSignedPercent } from "@/lib/format";
import TickerSurfaceEventsCard from "@/app/stock/[ticker]/TickerSurfaceEventsCard";

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

type EtfClassification = NonNullable<NonNullable<MarketFactsPayload["etf"]>["classification"]>;

const etfCache: Record<string, Promise<EtfPayload | null> | EtfPayload | null> = {};
const factsCache: Record<string, Promise<MarketFactsPayload | null> | MarketFactsPayload | null> = {};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function cleanSymbol(value: string) {
  return value.trim().toUpperCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function loadEtfPayload(ticker: string): Promise<EtfPayload | null> {
  const symbol = cleanSymbol(ticker);
  if (!symbol) return Promise.resolve(null);
  const cached = etfCache[symbol];
  if (cached instanceof Promise) return cached;
  if (cached !== undefined) return Promise.resolve(cached);

  const request = fetch(`/api/data/stockanalysis/etfs/${encodeURIComponent(symbol)}/`, { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((payload) => {
      const parsed = asRecord(payload) ? payload as EtfPayload : null;
      etfCache[symbol] = parsed;
      return parsed;
    })
    .catch(() => {
      etfCache[symbol] = null;
      return null;
    });
  etfCache[symbol] = request;
  return request;
}

function loadMarketFacts(ticker: string): Promise<MarketFactsPayload | null> {
  const symbol = cleanSymbol(ticker);
  if (!symbol) return Promise.resolve(null);
  const cached = factsCache[symbol];
  if (cached instanceof Promise) return cached;
  if (cached !== undefined) return Promise.resolve(cached);

  const request = fetch(`/data/computed/market_facts/tickers/${encodeURIComponent(symbol)}.json`, { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((payload) => {
      const parsed = asRecord(payload) ? payload as MarketFactsPayload : null;
      factsCache[symbol] = parsed;
      return parsed;
    })
    .catch(() => {
      factsCache[symbol] = null;
      return null;
    });
  factsCache[symbol] = request;
  return request;
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
      description: "ETF 목록과 신규 상장 데이터로 요약을 먼저 보여줍니다. 상세 보유 구성과 분석은 데이터 갱신 후 자동으로 추가됩니다.",
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
      description: "가격과 일부 기본 지표를 먼저 보여줍니다. 보유 구성과 분류 지표는 데이터 갱신 시 자동으로 보강됩니다.",
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
  if (classification.is_single_stock) labels.push("단일종목");
  if (classification.underlying) labels.push(`기초 ${classification.underlying}`);
  return labels;
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
        <div className="h-5 w-1/3 rounded bg-slate-200" />
        <div className="mt-3 h-32 rounded bg-slate-200" />
      </div>
    </div>
  );
}

function MetricCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/70 px-3 py-3">
      <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="orbitron mt-1 min-w-0 break-words text-base font-black tabular-nums text-slate-950">{value}</p>
      {note && note !== "—" ? <p className="mt-1 min-w-0 break-words text-[10px] font-semibold text-slate-500">{note}</p> : null}
    </div>
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
    return <p className="text-sm font-semibold text-slate-500">기간 수익률 데이터 없음</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const value = item.value ?? 0;
        const tone = value >= 0 ? "text-emerald-600" : "text-rose-600";
        return (
          <div key={item.label} className="rounded-xl border border-slate-200 bg-white/70 px-3 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">{item.label}</p>
            <p className={`orbitron mt-1 text-lg font-black tabular-nums ${tone}`}>{fmtCompactSignedPercent(value)}</p>
            <p className="mt-1 text-[10px] font-semibold text-slate-500">{item.note}</p>
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
    return <p className="text-sm font-semibold text-slate-500">보유 구성 데이터 없음</p>;
  }
  return (
    <div className="-mx-1 max-h-[560px] overflow-auto px-1" role="region" aria-label="보유 구성 표" tabIndex={0}>
      <table className="w-full min-w-[620px] text-xs">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
            <th className="px-2 py-2 text-right">#</th>
            <th className="px-2 py-2 text-left">종목/계약</th>
            <th className="px-2 py-2 text-left">티커</th>
            <th className="px-2 py-2 text-right">비중</th>
            <th className="px-2 py-2 text-right">수량</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((item, index) => {
            const weight = isFiniteNumber(item.weight_pct) ? item.weight_pct : null;
            const weightClass = weight !== null && weight < 0 ? "text-rose-600" : "text-slate-900";
            return (
              <tr key={`${item.rank ?? index}-${item.symbol ?? ""}-${item.name ?? ""}`} className="border-b border-slate-100 last:border-b-0">
                <td className="px-2 py-2 text-right orbitron tabular-nums text-[11px] font-bold text-slate-500">{item.rank ?? index + 1}</td>
                <td className="px-2 py-2 font-bold text-slate-800">{item.name ?? "—"}</td>
                <td className="px-2 py-2 orbitron tabular-nums text-[11px] font-black text-slate-500">{item.symbol ?? "—"}</td>
                <td className={`px-2 py-2 text-right orbitron tabular-nums text-xs font-black ${weightClass}`}>{fmtPercentPoints(weight)}</td>
                <td className="px-2 py-2 text-right orbitron tabular-nums text-[11px] font-semibold text-slate-600">{fmtShares(item.shares)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {currency ? <p className="mt-2 text-[10px] font-semibold text-slate-500">표시 통화: {currency}</p> : null}
    </div>
  );
}

function WeightedList({ rows, empty }: { rows: WeightedRow[] | null | undefined; empty: string }) {
  const items = Array.isArray(rows) ? rows.filter((row) => weightedRowValue(row) !== null) : [];
  if (!items.length) return <p className="text-sm font-semibold text-slate-500">{empty}</p>;
  return (
    <div className="space-y-2">
      {items.map((row, index) => {
        const value = weightedRowValue(row) ?? 0;
        const width = Math.min(100, Math.abs(value));
        return (
          <div key={`${weightedRowName(row)}-${index}`}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate font-bold text-slate-700">{weightedRowName(row)}</span>
              <span className={`orbitron tabular-nums font-black ${value < 0 ? "text-rose-600" : "text-slate-900"}`}>{fmtPercentPoints(value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-2 rounded-full ${value < 0 ? "bg-rose-400" : "bg-brand-interactive"}`} style={{ width: `${width}%` }} />
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
}: {
  history: HistoryPoint[];
  historyPeriods?: Partial<Record<HistoryPeriodKey, HistoryPoint[]>>;
  currency: string;
  mode: HistoryMode;
  onModeChange: (mode: HistoryMode) => void;
  range: HistoryRange;
  onRangeChange: (range: HistoryRange) => void;
}) {
  const fallback = firstAvailableHistorySelection(historyPeriods, history);
  const requestedRows = historyRowsForSelection(historyPeriods, history, mode, range);
  const activeMode = requestedRows.length > 0 ? mode : fallback?.mode ?? mode;
  const activeRange = requestedRows.length > 0 ? range : fallback?.range ?? range;
  const rows = requestedRows.length > 0
    ? requestedRows
    : historyRowsForSelection(historyPeriods, history, activeMode, activeRange);
  const isAvailable = (candidateMode: HistoryMode, candidateRange: HistoryRange) =>
    historyRowsForSelection(historyPeriods, history, candidateMode, candidateRange).length > 0;
  if (!rows.length) return <p className="text-sm font-semibold text-slate-500">가격 히스토리 없음</p>;

  const chronological = [...rows].reverse();
  const closes = chronological.map(historyPointClose).filter(isFiniteNumber);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const priceRange = max - min || 1;
  const firstClose = closes[0] ?? null;
  const lastClose = closes[closes.length - 1] ?? null;
  const periodReturn = firstClose && lastClose !== null ? ((lastClose - firstClose) / firstClose) * 100 : null;
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
      <div className="grid gap-2 sm:grid-cols-3">
        <MetricCard label={`${activeLabel} 구간 수익률`} value={fmtCompactSignedPercent(periodReturn)} note={`${activeRange} ${activeLabel} 종가 기준`} />
        <MetricCard label="구간 고점" value={formatMoney(max, currency)} note={`${activeRange} ${activeLabel} 종가 기준`} />
        <MetricCard label="구간 저점" value={formatMoney(min, currency)} note={`${activeRange} ${activeLabel} 종가 기준`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <div className="flex h-40 items-end gap-1 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          {chronological.map((point, index) => {
            const date = historyPointDate(point);
            const close = historyPointClose(point) ?? min;
            const height = 10 + ((close - min) / priceRange) * 90;
            const up = isFiniteNumber(point.ch) ? point.ch >= 0 : true;
            return (
              <div key={`${date ?? "period"}-${index}`} className="flex h-full min-w-[2px] flex-1 flex-col items-center justify-end gap-1" title={`${date ?? "—"}: ${formatMoney(close, currency)}`}>
                <div className={`w-full rounded-t ${up ? "bg-emerald-400" : "bg-rose-400"}`} style={{ height: `${height}%` }} />
                <span className="hidden max-w-full truncate text-[9px] font-bold text-slate-500 sm:block">{(date ?? "").slice(5, 7)}</span>
              </div>
            );
          })}
        </div>
        <div className="-mx-1 overflow-x-auto px-1" role="region" aria-label="가격 히스토리 표" tabIndex={0}>
          <table className="w-full min-w-[360px] text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
                <th className="px-2 py-2 text-left">일자</th>
                <th className="px-2 py-2 text-right">종가</th>
                <th className="px-2 py-2 text-right">변화</th>
                <th className="px-2 py-2 text-right">거래량</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((point, index) => (
                <tr key={`${historyPointDate(point) ?? "row"}-${index}`} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-2 py-2 font-bold text-slate-700">{historyPointDate(point) ?? "—"}</td>
                  <td className="px-2 py-2 text-right orbitron tabular-nums font-black text-slate-900">{formatMoney(historyPointClose(point), currency)}</td>
                  <td className={`px-2 py-2 text-right orbitron tabular-nums font-black ${isFiniteNumber(point.ch) && point.ch < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmtSignedPercentPoints(point.ch)}</td>
                  <td className="px-2 py-2 text-right orbitron tabular-nums font-semibold text-slate-500">{fmtShares(point.v)}</td>
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
  const [state, setState] = useState<{
    symbol: string;
    etfData: EtfPayload | null | undefined;
    marketFacts: MarketFactsPayload | null | undefined;
  }>({ symbol, etfData: undefined, marketFacts: undefined });

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadEtfPayload(symbol), loadMarketFacts(symbol)]).then(([nextEtf, nextFacts]) => {
      if (!cancelled) {
        setState({ symbol, etfData: nextEtf, marketFacts: nextFacts });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const etfData = state.symbol === symbol ? state.etfData : undefined;
  const marketFacts = state.symbol === symbol ? state.marketFacts : undefined;
  const loading = etfData === undefined || marketFacts === undefined;
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
  const labels = classificationLabels(classification);
  const website = typeof overview.etf_website === "string" && overview.etf_website.trim() ? overview.etf_website.trim() : null;
  const inceptionDate = rawText(overview.inception);
  const sharesOutstanding = rawText(overview.sharesOut);
  const updateDate = factDate(marketFacts, "price") ?? rawText(quote.u) ?? etfData?.fetched_at ?? marketFacts?.generated_at;

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
    return (
      <div className="stock-shell">
        <div className="panel stock-empty">
          <p className="text-lg font-black text-slate-700">ETF 정보 연결 전</p>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            {symbol} — 목록에는 잡혔지만 보유 구성과 가격 정보가 아직 충분히 연결되지 않았습니다.
          </p>
          <TransitionLink href="/etfs" className="mt-4 inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive">← ETF 목록에서 보기</TransitionLink>
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
              <h1>{displayName}</h1>
              <WatchStar ticker={symbol} className="stock-star" />
            </div>
            <div className="stock-meta">
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
                  <span key={label} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-600">{label}</span>
                ))}
              </div>
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
            {statusMeta ? <DetailAvailabilityCallout meta={statusMeta} available={availableDetailItems} pending={pendingDetailItems} /> : null}
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
                className="mt-3 inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-slate-50 px-3 text-[10px] font-black uppercase tracking-[0.08em] text-slate-600 transition hover:border-brand-interactive hover:bg-white hover:text-brand-interactive"
              >
                운용사 웹사이트
              </a>
            ) : null}
          </SectionCard>

          <SectionCard title="기간 수익률" desc="총수익률·연환산 수익률">
            <PerformanceView performance={performance} />
          </SectionCard>

          <SectionCard title="보유·스왑 구성" desc={`${symbol} · ${holdings.length.toLocaleString("ko-KR")}개 표시`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
              <span>{holdingCount.toLocaleString("ko-KR")}개 원장 중 표시 가능한 항목</span>
              <span>{fmtDateish(holdingsUpdated) !== "—" ? `기준 ${fmtDateish(holdingsUpdated)}` : "기준일 미표시"}</span>
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
            />
          </SectionCard>

          <footer className="stock-footer">
            <TransitionLink href="/etfs" className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">← ETF 목록에서 보기</TransitionLink>
            <TransitionLink href={`/portfolio?ticker=${encodeURIComponent(symbol)}`} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">포트폴리오에서 보기</TransitionLink>
          </footer>
        </div>
      </div>
    </div>
  );
}
