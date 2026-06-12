"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { resolveSector, sectorColor, sectorLabelKo } from "@/lib/design/sectorMap";
import { bandPct, bandClass } from "@/lib/screener/bands";
import {
  useStockDetail,
  use13FData,
  Sparkline,
  PerBandChart,
  RevisionPulse,
  RawFinancialDepth,
  SlickChartsDepth,
  fmtLarge,
} from "@/app/screener/StockDetailPanel";
import type { F13Entry } from "@/app/screener/StockDetailPanel";
import { renderYfTab, FiftyTwoWeekBar, SummaryScoreCard, ThreeSecondSummary, loadIndustryBenchmarks, resolveIndustryBench } from "./StockTabs";
import type { IndustryBench } from "./StockTabs";
import WatchStar from "@/components/WatchStar";
import { formatSignedPercent } from "@/lib/format";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// stocks_analyzer.json module-level cache
// ---------------------------------------------------------------------------

interface AnalyzerRow {
  symbol: string;
  companyName: string;
  sector: string;
  price: number | null;
  marketCap: number | null;
  per: number | null;
  pbr: number | null;
  dividendYield: number | null;
  return12m: number | null;
  perBandCurrent: number | null;
  perBandMin: number | null;
  perBandAvg: number | null;
  perBandMax: number | null;
}

let analyzerCache: Record<string, AnalyzerRow> | null = null;
let analyzerPromise: Promise<Record<string, AnalyzerRow> | null> | null = null;

function loadAnalyzer(): Promise<Record<string, AnalyzerRow> | null> {
  if (analyzerCache) return Promise.resolve(analyzerCache);
  if (analyzerPromise) return analyzerPromise;
  analyzerPromise = fetch("/data/global-scouter/core/stocks_analyzer.json")
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const map: Record<string, AnalyzerRow> = {};
      const rows = Array.isArray((data as any)?.data) ? (data as any).data : [];
      for (const r of rows) {
        if (typeof r?.symbol === "string" && r.symbol.trim()) {
          map[r.symbol.trim().toUpperCase()] = r;
        }
      }
      analyzerCache = map;
      return map;
    })
    .catch(() => { analyzerPromise = null; return null; });
  return analyzerPromise;
}

// ---------------------------------------------------------------------------
// yf finance data module-level cache
// ---------------------------------------------------------------------------

const yfCache: Record<string, any> = {};
const yfPending: Record<string, Promise<any | null>> = {};

function loadYfFinance(ticker: string): Promise<any | null> {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) return Promise.resolve(null);
  if (symbol in yfCache) return Promise.resolve(yfCache[symbol] || null);
  if (symbol in yfPending) return yfPending[symbol];
  const p = fetch(`/data/yf/finance/${encodeURIComponent(symbol)}.json`)
    .then((res) => (res.ok ? res.json() : null))
    .then((d) => {
      yfCache[symbol] = d && typeof d === "object" && !Array.isArray(d) ? d.data ?? null : null;
      delete yfPending[symbol];
      return yfCache[symbol];
    })
    .catch(() => { delete yfPending[symbol]; return null; });
  yfPending[symbol] = p;
  return p;
}

// ---------------------------------------------------------------------------
// trades_ranking cache
// ---------------------------------------------------------------------------

type TradesCache = { bought: any[]; sold: any[]; metadata: any };

let tradesCache: TradesCache | null = null;
let tradesPromise: Promise<TradesCache | null> | null = null;

function loadTradesRanking(): Promise<TradesCache | null> {
  if (tradesCache) return Promise.resolve(tradesCache);
  if (tradesPromise) return tradesPromise;
  tradesPromise = fetch("/data/sec-13f/analytics/trades_ranking.json")
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      tradesCache = {
        bought: Array.isArray(data?.bought) ? data.bought : [],
        sold: Array.isArray(data?.sold) ? data.sold : [],
        metadata: data?.metadata ?? null,
      };
      return tradesCache;
    })
    .catch(() => { tradesPromise = null; return null; });
  return tradesPromise;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

type MaybeNumber = number | null | undefined;
type NumberSeries = MaybeNumber[];
const ESTIMATE_LABELS: Record<string, string> = { fy1: "FY+1", fy2: "FY+2", fy3: "FY+3" };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteValues(data: unknown): number[] {
  return Array.isArray(data) ? data.filter(isFiniteNumber) : [];
}

function numberSeries(data: unknown): NumberSeries {
  return Array.isArray(data) ? data.map((value) => (isFiniteNumber(value) ? value : null)) : [];
}

function lastFinite(data: NumberSeries | null | undefined): number | null {
  const values = finiteValues(data);
  return values.length > 0 ? values[values.length - 1] : null;
}

function fmtPrice(n: number): string { return `$${n.toFixed(2)}`; }
function fmtMcap(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}T`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}B`;
  return `$${n.toFixed(0)}M`;
}
function fmtPct(n: number): string {
  return formatSignedPercent(n, { digits: 1 });
}
function fmtDivYield(n: number): string { return `${(n * 100).toFixed(2)}%`; }
function fmtWholePct(n: MaybeNumber): string { return isFiniteNumber(n) ? `${n.toFixed(1)}%` : "—"; }
function fmtWholeSignedPct(n: MaybeNumber): string { return isFiniteNumber(n) ? fmtPct(n / 100) : "—"; }

function toFractionSeries(data: NumberSeries | null | undefined): NumberSeries {
  return (data ?? []).map((value) => (isFiniteNumber(value) ? value / 100 : null));
}

function validAnalyzerPerBand(row: AnalyzerRow | null | undefined) {
  if (
    !row ||
    !isFiniteNumber(row.perBandCurrent) ||
    !isFiniteNumber(row.perBandMin) ||
    !isFiniteNumber(row.perBandMax) ||
    row.perBandMin >= row.perBandMax
  ) {
    return null;
  }
  return { current: row.perBandCurrent, min: row.perBandMin, max: row.perBandMax };
}

function validDetailPerBands(perBands: any) {
  if (
    !perBands ||
    !isFiniteNumber(perBands.current) ||
    !isFiniteNumber(perBands.min_8y) ||
    !isFiniteNumber(perBands.avg_8y) ||
    !isFiniteNumber(perBands.max_8y) ||
    perBands.min_8y >= perBands.max_8y
  ) {
    return null;
  }
  return perBands as { current: number; min_8y: number; avg_8y: number; max_8y: number };
}

function perBandPositionText(current: number, min: number, max: number): string {
  const pct = bandPct(current, min, max);
  const cls = bandClass(pct);
  const verdict = cls === "emerald" ? "역사적 저평가" : cls === "rose" ? "역사적 고평가" : "적정 범위";
  return `${(pct * 100).toFixed(0)}% · ${verdict}`;
}
function perBandPositionColor(current: number, min: number, max: number): string {
  const cls = bandClass(bandPct(current, min, max));
  return cls === "emerald" ? "text-emerald-700 bg-emerald-50"
    : cls === "rose" ? "text-rose-700 bg-rose-50"
    : "text-slate-700 bg-slate-50";
}

// ---------------------------------------------------------------------------
// MiniBarChart — HTML/CSS bar chart for 재무 추이
// ---------------------------------------------------------------------------

function MiniBarChart({
  actuals, estimates, years, color, formatValue = fmtLarge,
}: {
  actuals: NumberSeries;
  estimates: Record<string, MaybeNumber> | null;
  years: string[];
  color: string;
  formatValue?: (value: number) => string;
}) {
  const estKeys: string[] = [];
  if (estimates) for (const k of ["fy1", "fy2", "fy3"]) {
    if (isFiniteNumber(estimates[k])) estKeys.push(k);
  }
  const bars = [
    ...actuals.map((value, i) => ({
      key: `actual-${i}`,
      label: (years[years.length - actuals.length + i] ?? years[i] ?? "").replace("FY", ""),
      value,
      estimate: false,
    })),
    ...estKeys.map((key) => ({
      key,
      label: ESTIMATE_LABELS[key] ?? key.toUpperCase(),
      value: estimates?.[key] ?? null,
      estimate: true,
    })),
  ];
  const allVals = finiteValues(bars.map((b) => b.value));
  if (allVals.length === 0) return <span className="text-xs text-slate-300">—</span>;
  const minVal = Math.min(...allVals, 0);
  const maxVal = Math.max(...allVals, 0);
  const range = maxVal - minVal || 1;
  const clampPct = (v: number) => Math.max(0, Math.min(100, v));
  const yPct = (v: number) => clampPct(((maxVal - v) / range) * 100);
  const zeroPct = yPct(0);
  const shape = (value: MaybeNumber) => {
    if (!isFiniteNumber(value)) return null;
    if (value === 0) return { top: clampPct(Math.min(zeroPct, 98)), height: 2 };
    const y = yPct(value);
    const height = Math.max(2, Math.abs(y - zeroPct));
    const top = value > 0 ? Math.min(y, 100 - height) : Math.min(zeroPct, 100 - height);
    return { top: clampPct(top), height: clampPct(height) };
  };
  const latestActual = [...bars].reverse().find((bar) => !bar.estimate && isFiniteNumber(bar.value));
  const nextEstimate = bars.find((bar) => bar.estimate && isFiniteNumber(bar.value));
  const axisLabel = `범위 ${formatValue(minVal)}~${formatValue(maxVal)} · 0선 ${formatValue(0)}`;

  return (
    <div className="space-y-1">
      <div className="truncate text-[8px] font-bold tabular-nums text-slate-400" title={axisLabel}>
        {axisLabel}
      </div>
      <div className="relative flex gap-[2px]" style={{ height: 72 }}>
        <span
          className="pointer-events-none absolute left-0 right-0 border-t border-slate-300/80"
          style={{ top: `${zeroPct}%` }}
        />
        {bars.map((bar) => {
          const s = shape(bar.value);
          const barColor = isFiniteNumber(bar.value) && bar.value < 0 ? "#f43f5e" : color;
          const label = `${bar.label}${bar.estimate ? " 추정" : ""} ${isFiniteNumber(bar.value) ? formatValue(bar.value) : "—"}`;
          return (
            <div key={bar.key} className="relative h-full flex-1" title={label} aria-label={label}>
              {s ? (
                <div
                  className="absolute left-0 right-0 rounded-sm"
                  style={{
                    top: `${s.top}%`,
                    height: `${s.height}%`,
                    backgroundColor: bar.estimate ? `${barColor}40` : barColor,
                    border: bar.estimate ? `2px dashed ${barColor}` : undefined,
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="flex text-[8px] font-bold text-slate-400">
        {bars.map((bar) => (
          <span key={bar.key} className={`flex-1 text-center ${bar.estimate ? "text-slate-400" : ""}`}>
            {bar.label}
          </span>
        ))}
      </div>
      <div className="flex text-[8px] font-black tabular-nums text-slate-500">
        {bars.map((bar) => (
          <span key={`${bar.key}-value`} className={`min-w-0 flex-1 truncate text-center ${bar.estimate ? "text-slate-400" : ""}`}>
            {isFiniteNumber(bar.value) ? formatValue(bar.value) : "—"}
          </span>
        ))}
      </div>
      <div className="flex min-w-0 justify-between gap-2 text-[9px] font-black tabular-nums text-slate-500">
        <span className="min-w-0 truncate">
          최신 {latestActual ? `${latestActual.label} ${formatValue(latestActual.value as number)}` : "—"}
        </span>
        <span className="min-w-0 truncate text-slate-400">
          추정 {nextEstimate ? `${nextEstimate.label} ${formatValue(nextEstimate.value as number)}` : "—"}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompactFinancialTable
// ---------------------------------------------------------------------------

function CompactFinancialTable({ detail, years }: { detail: any; years: string[] }) {
  const estKeys = ["fy1", "fy2", "fy3"];
  const s = (n: number) => n >= 1000 ? fmtLarge(n) : `${n.toFixed(1)}`;
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const rows: Array<{ label: string; actuals: NumberSeries | null; estimates: Record<string, MaybeNumber> | null; fmt: (v: number) => string }> = [
    { label: "매출", actuals: numberSeries(detail.income_statement?.revenue), estimates: detail.income_statement_estimates?.revenue ?? null, fmt: s },
    { label: "영업이익", actuals: numberSeries(detail.income_statement?.operating_income), estimates: detail.income_statement_estimates?.operating_income ?? null, fmt: s },
    { label: "순이익", actuals: numberSeries(detail.income_statement?.net_income), estimates: detail.income_statement_estimates?.net_income ?? null, fmt: s },
    { label: "EPS", actuals: numberSeries(detail.per_share?.eps), estimates: detail.per_share_estimates?.eps ?? null, fmt: usd },
    { label: "FCF", actuals: numberSeries(detail.cash_flow?.fcf), estimates: detail.cash_flow_estimates?.fcf ?? null, fmt: s },
    { label: "DPS", actuals: numberSeries(detail.dividend?.dps), estimates: detail.dividend_estimates?.dps ?? null, fmt: usd },
  ];
  const validRows = rows.filter((r) => finiteValues(r.actuals).length > 0);
  if (validRows.length === 0) return null;

  return (
    <div className="-mx-1 mt-3 overflow-x-auto px-1">
      <table className="w-full min-w-[500px] text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
            <th className="px-2 py-1.5 text-left" />
            {years.map((y) => <th key={y} className="px-2 py-1.5 text-right">{y}</th>)}
            {estKeys.map((k) => <th key={k} className="px-2 py-1.5 text-right bg-slate-50 text-slate-400">{ESTIMATE_LABELS[k] ?? k.toUpperCase()}</th>)}
          </tr>
        </thead>
        <tbody>
          {validRows.map((row) => (
            <tr key={row.label} className="border-b border-slate-100 last:border-b-0">
              <td className="px-2 py-1.5 text-[10px] font-bold text-slate-700">{row.label}</td>
              {row.actuals!.map((v, i) => (
                <td key={i} className="px-2 py-1.5 text-right orbitron tabular-nums font-semibold text-slate-900">{isFiniteNumber(v) ? row.fmt(v) : "—"}</td>
              ))}
              {estKeys.map((k) => (
                <td key={k} className="px-2 py-1.5 text-right bg-slate-50 orbitron tabular-nums font-semibold text-slate-500">
                  {isFiniteNumber(row.estimates?.[k]) ? row.fmt(row.estimates![k] as number) : "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[9px] font-semibold text-slate-400">E = 추정 (컨센서스)</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GuruSection
// ---------------------------------------------------------------------------

function GuruSection({ f13Entries, ticker }: { f13Entries: F13Entry[] | null; ticker: string }) {
  const [tradesChip, setTradesChip] = useState<{ bought?: any; sold?: any } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTradesRanking().then((data) => {
      if (cancelled || !data) return;
      const upper = ticker.toUpperCase();
      const b = data.bought.find((r: any) => r?.ticker === upper);
      const s = data.sold.find((r: any) => r?.ticker === upper);
      setTradesChip({ bought: b, sold: s });
    });
    return () => { cancelled = true; };
  }, [ticker]);

  const holders = useMemo(() => {
    if (!f13Entries || f13Entries.length === 0) return [];
    const byInv = new Map<string, { shares: number; weight: number }>();
    for (const e of f13Entries) {
      if (typeof e.investor !== "string" || e.investor.trim() === "") continue;
      const cur = byInv.get(e.investor);
      const shares = isFiniteNumber(e.shares) ? e.shares : 0;
      const weight = isFiniteNumber(e.weight) ? e.weight : 0;
      if (cur) { cur.shares += shares; cur.weight += weight; }
      else { byInv.set(e.investor, { shares, weight }); }
    }
    return [...byInv.entries()].map(([investor, v]) => ({ investor, ...v }))
      .sort((a, b) => b.weight - a.weight).slice(0, 10);
  }, [f13Entries]);

  if ((!f13Entries || f13Entries.length === 0) && !tradesChip?.bought && !tradesChip?.sold) return null;

  return (
    <section>
      <h2 className="mb-3 text-[13px] font-black uppercase tracking-[0.12em] text-slate-500">구루 동향</h2>
      <div className="mb-3 flex flex-wrap gap-2">
        {tradesChip?.bought ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.06em] text-emerald-700">
            최근 분기 구루 순매수 {fmtLarge(tradesChip.bought.amount)} ({tradesChip.bought.investors_count}명)
            {tradesChip.bought.new_count > 0 ? ` · 신규 ${tradesChip.bought.new_count}명` : ""}
          </span>
        ) : tradesChip?.sold ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.06em] text-rose-700">
            최근 분기 구루 순매도 {fmtLarge(tradesChip.sold.amount)} ({tradesChip.sold.investors_count}명)
            {tradesChip.sold.exit_count > 0 ? ` · 청산 ${tradesChip.sold.exit_count}명` : ""}
          </span>
        ) : null}
      </div>
      {holders.length > 0 ? (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[320px] text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
                <th className="px-2 py-1.5 text-left">구루</th>
                <th className="px-2 py-1.5 text-right">주식수</th>
                <th className="px-2 py-1.5 text-right">비중</th>
              </tr>
            </thead>
            <tbody>
              {holders.map((h) => (
                <tr key={h.investor} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-2 py-1.5">
                    <TransitionLink href="/superinvestors" className="text-[10px] font-black text-brand-interactive hover:underline">
                      {h.investor}
                    </TransitionLink>
                  </td>
                  <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs font-semibold text-slate-900">
                    {h.shares > 0 ? h.shares.toLocaleString() : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs font-semibold text-slate-700">
                    {h.weight > 0 ? `${(h.weight * 100).toFixed(2)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// MetricWithSpark
// ---------------------------------------------------------------------------

function MetricWithSpark({ label, value, data, color, years, formatValue = (n) => n.toFixed(1) }: {
  label: string; value: string; data: NumberSeries; color: string; years: string[]; formatValue?: (n: number) => string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-500">{label}</span>
        <span className="orbitron tabular-nums text-sm font-black text-slate-900">{value}</span>
      </div>
      {finiteValues(data).length >= 2 ? <div className="mt-1"><Sparkline data={data} color={color} years={years} formatValue={formatValue} /></div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KV
// ---------------------------------------------------------------------------

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-slate-500">{label}</span>
      <span className="orbitron tabular-nums text-xs font-black text-slate-900">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StockDetailClient main
// ---------------------------------------------------------------------------

export default function StockDetailClient({ ticker }: { ticker: string }) {
  const symbol = ticker.trim().toUpperCase();
  const [row, setRow] = useState<AnalyzerRow | null | undefined>(undefined);
  const canLoadStockData = row !== undefined && row !== null;
  const { detail, loading: detailLoading } = useStockDetail(symbol, canLoadStockData);
  const f13Entries = use13FData(symbol);
  const canonical = row ? resolveSector(null, row.sector) : null;
  const years: string[] = Array.isArray(detail?.years) ? detail.years : [];
  const rowPerBand = validAnalyzerPerBand(row);
  const detailPerBands = validDetailPerBands(detail?.per_bands);

  useEffect(() => {
    let cancelled = false;
    loadAnalyzer().then((map) => { if (!cancelled) setRow(map?.[symbol] ?? null); });
    return () => { cancelled = true; };
  }, [symbol]);

  const rowLoading = row === undefined;
  const [yfData, setYfData] = useState<any | undefined>(undefined);
  const [stockTab, setStockTab] = useState<"overview" | "financials" | "statistics" | "ownership" | "estimates">("overview");

  useEffect(() => {
    let cancelled = false;
    if (!canLoadStockData) {
      Promise.resolve().then(() => {
        if (!cancelled) setYfData(row === null ? null : undefined);
      });
      return () => { cancelled = true; };
    }
    loadYfFinance(symbol).then((d) => { if (!cancelled) setYfData(d ?? null); });
    return () => { cancelled = true; };
  }, [symbol, canLoadStockData, row]);

  const [benchDoc, setBenchDoc] = useState<Awaited<ReturnType<typeof loadIndustryBenchmarks>>>(null);
  useEffect(() => {
    let cancelled = false;
    loadIndustryBenchmarks().then((doc) => { if (!cancelled) setBenchDoc(doc); });
    return () => { cancelled = true; };
  }, []);
  const industryBench: IndustryBench | null = useMemo(
    () => resolveIndustryBench(benchDoc, yfData?.info?.industry),
    [benchDoc, yfData],
  );

  const yfLoaded = yfData !== undefined;
  const yfAvailable = yfData != null;
  const yfTabs: Array<{ id: typeof stockTab; label: string }> = yfAvailable
    ? [
        { id: "overview", label: "요약" },
        { id: "financials", label: "재무" },
        { id: "statistics", label: "통계" },
        { id: "ownership", label: "보유기관" },
        { id: "estimates", label: "추정치" },
      ]
    : [{ id: "overview" as const, label: "요약" }];

  // Unknown ticker
  if (!rowLoading && !row) {
    return (
      <div className="stock-shell">
        <div className="panel stock-empty">
          <p className="text-lg font-black text-slate-700">해당 티커를 찾을 수 없습니다</p>
          <p className="mt-2 text-sm font-semibold text-slate-500">{symbol} — stocks_analyzer.json에 존재하지 않는 티커입니다.</p>
          <TransitionLink href="/screener" className="mt-4 inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive">← 스크리너에서 보기</TransitionLink>
        </div>
      </div>
    );
  }

  const displayName = row?.companyName ?? symbol;
  const priceText = isFiniteNumber(row?.price) ? fmtPrice(row.price) : "—";
  const returnText = isFiniteNumber(row?.return12m) ? fmtPct(row.return12m) : null;
  const returnUp = (row?.return12m ?? 0) >= 0;

  function renderStockDataTab() {
    if (stockTab === "overview") return null;
    return (
      <div className="grid gap-4">
        {yfAvailable ? (
          <section className="panel stock-tab-panel">
            <div className="panel-b">{renderYfTab(stockTab, yfData, industryBench)}</div>
          </section>
        ) : null}
        {detailLoading ? (
          <div className="space-y-4">
            <SkeletonSection />
            <SkeletonSection />
          </div>
        ) : detail ? (
          <>
            {stockTab === "financials" ? (
              <SectionCard title="재무 추이">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {([
                    ["매출", numberSeries(detail.income_statement?.revenue), detail.income_statement_estimates?.revenue, "#10b981"],
                    ["영업이익", numberSeries(detail.income_statement?.operating_income), detail.income_statement_estimates?.operating_income, "#06b6d4"],
                    ["순이익", numberSeries(detail.income_statement?.net_income), detail.income_statement_estimates?.net_income, "#8b5cf6"],
                    ["FCF", numberSeries(detail.cash_flow?.fcf), detail.cash_flow_estimates?.fcf, "#f59e0b"],
                  ] as Array<[string, NumberSeries | undefined, Record<string, MaybeNumber> | undefined, string]>).map(([label, actuals, estimates, color]) => (
                    <div key={label}>
                      <p className="mb-1 text-[10px] font-bold text-slate-500">{label}</p>
                      <MiniBarChart actuals={actuals ?? []} estimates={estimates ?? null} years={years} color={color} />
                    </div>
                  ))}
                </div>
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <h4 className="mb-2 text-[11px] font-black tracking-[0.08em] text-slate-500">실적 추이 · 추정</h4>
                  <CompactFinancialTable detail={detail} years={years} />
                </div>
                <RawFinancialDepth detail={detail} />
              </SectionCard>
            ) : null}

            {stockTab === "statistics" ? (
              <>
                <SectionCard title="밸류에이션">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <h4 className="mb-2 text-[11px] font-black tracking-[0.08em] text-slate-500">PER 밴드 (8Y)</h4>
                      {finiteValues(detail.valuation?.per).length >= 2 ? (
                        <PerBandChart years={detail.years} per={numberSeries(detail.valuation?.per)} perBands={detail.per_bands} estimates={detail.valuation_estimates?.per} />
                      ) : <span className="text-xs text-slate-300">—</span>}
                    </div>
                    {detailPerBands ? (
                      <div>
                        <h4 className="mb-2 text-[11px] font-black tracking-[0.08em] text-slate-500">PER 밴드 위치</h4>
                        <div className="space-y-2">
                          {[{ label: "최고", v: detailPerBands.max_8y }, { label: "평균", v: detailPerBands.avg_8y }, { label: "현재", v: detailPerBands.current, highlight: true }, { label: "최저", v: detailPerBands.min_8y }].map(({ label, v, highlight }) => {
                            const range = detailPerBands.max_8y - detailPerBands.min_8y || 1;
                            const pct = Math.min(100, Math.max(0, ((v - detailPerBands.min_8y) / range) * 100));
                            const barColor = highlight ? "bg-brand-interactive" : "bg-slate-300";
                            const textColor = highlight ? "text-slate-900" : "text-slate-500";
                            return (
                              <div key={label} className="flex items-center gap-2">
                                <span className={`w-10 text-right text-[10px] font-semibold ${highlight ? "font-black text-brand-interactive" : "text-slate-500"}`}>{label}</span>
                                <div className="relative h-3 flex-1 rounded-full bg-slate-100">
                                  <div className={`absolute top-0 h-3 rounded-full ${barColor}`} style={{ left: `${pct}%`, width: "3px", transform: "translateX(-1.5px)" }} />
                                </div>
                                <span className={`w-14 text-xs orbitron tabular-nums font-bold ${textColor}`}>{v.toFixed(1)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </SectionCard>
                <SectionCard title="수익성·성장">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <h4 className="mb-2 text-[11px] font-black tracking-[0.08em] text-slate-500">수익성</h4>
                      <div className="space-y-3">
                        <MetricWithSpark label="매출총이익률" value={fmtWholePct(lastFinite((detail.profitability as any)?.gross_margin))} data={(detail.profitability as any)?.gross_margin ?? []} color="#14b8a6" years={years} formatValue={fmtWholePct} />
                        <MetricWithSpark label="영업이익률" value={fmtWholePct(lastFinite((detail.profitability as any)?.operating_margin))} data={(detail.profitability as any)?.operating_margin ?? []} color="#06b6d4" years={years} formatValue={fmtWholePct} />
                        <MetricWithSpark label="순이익률" value={fmtWholePct(lastFinite((detail.profitability as any)?.net_margin))} data={(detail.profitability as any)?.net_margin ?? []} color="#6366f1" years={years} formatValue={fmtWholePct} />
                        <MetricWithSpark label="ROE" value={fmtWholePct(lastFinite((detail.profitability as any)?.roe))} data={(detail.profitability as any)?.roe ?? []} color="#8b5cf6" years={years} formatValue={fmtWholePct} />
                        <MetricWithSpark label="ROA" value={fmtWholePct(lastFinite((detail.profitability as any)?.roa))} data={(detail.profitability as any)?.roa ?? []} color="#0ea5e9" years={years} formatValue={fmtWholePct} />
                      </div>
                    </div>
                    <div>
                      <h4 className="mb-2 text-[11px] font-black tracking-[0.08em] text-slate-500">성장률 (YoY)</h4>
                      <div className="space-y-3">
                        <MetricWithSpark label="매출 성장률" value={fmtWholeSignedPct(lastFinite((detail.growth as any)?.revenue_growth))} data={toFractionSeries((detail.growth as any)?.revenue_growth)} color="#10b981" years={years} formatValue={fmtPct} />
                        <MetricWithSpark label="EPS 성장률" value={fmtWholeSignedPct(lastFinite((detail.growth as any)?.eps_growth))} data={toFractionSeries((detail.growth as any)?.eps_growth)} color="#f59e0b" years={years} formatValue={fmtPct} />
                      </div>
                    </div>
                  </div>
                </SectionCard>
                <SectionCard title="가격·수익률·배당">
                  <SlickChartsDepth ticker={symbol} showUnavailable />
                </SectionCard>
              </>
            ) : null}

            {stockTab === "estimates" ? (
              <SectionCard title="리비전·추정치">
                <RevisionPulse detail={detail} />
                <CompactFinancialTable detail={detail} years={years} />
              </SectionCard>
            ) : null}

            {stockTab === "ownership" ? (
              <div id="guru-section">
                <SectionCard>
                  <GuruSection f13Entries={f13Entries} ticker={symbol} />
                </SectionCard>
              </div>
            ) : null}
          </>
        ) : (
          <SectionCard>
            <div className="py-8 text-center">
              <p className="text-sm font-black text-slate-700">상세 데이터를 불러올 수 없습니다</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">/data/global-scouter/stocks/detail/{symbol}.json 을 확인해 주세요.</p>
            </div>
          </SectionCard>
        )}
        <footer className="stock-footer">
          <TransitionLink href={`/screener?ticker=${encodeURIComponent(symbol)}`} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">← 스크리너에서 보기</TransitionLink>
          <TransitionLink href={`/superinvestors?tab=by-ticker&ticker=${encodeURIComponent(symbol)}`} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">구루 보유 보기</TransitionLink>
        </footer>
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
              {canonical ? (
                <>
                  <span className="x">·</span>
                  <span>{sectorLabelKo(canonical)}</span>
                </>
              ) : null}
              {row?.sector ? (
                <>
                  <span className="x">·</span>
                  <span>{row.sector}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="stock-price">
            <span className="big num">{priceText}</span>
            {returnText ? <span className={`stock-chip num ${returnUp ? "up" : "down"}`}>12M {returnText}</span> : null}
            <span className="delay">데이터 지연 가능</span>
          </div>
        </div>
        <div className="stock-tabs" role="tablist" aria-label={`${symbol} 상세 탭`}>
          {yfTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setStockTab(t.id)}
              className={`stock-tab ${stockTab === t.id ? "on" : ""}`}
              aria-current={stockTab === t.id ? "page" : undefined}
            >
              {t.label}
            </button>
          ))}
          {!yfLoaded ? <span className="stock-tab-note">yf 데이터 로딩 중...</span> : !yfAvailable ? <span className="stock-tab-note">yf 데이터 수집 전</span> : null}
        </div>
      </section>

      <div className="stock-body">
        <div className="stock-summary-stack">
          {yfAvailable ? (
            <ThreeSecondSummary
              data={yfData}
              perBand={rowPerBand}
              guruCount={f13Entries ? new Set(f13Entries.map((e) => e.investor)).size : 0}
              industry={industryBench}
            />
          ) : null}
          {yfAvailable ? <FiftyTwoWeekBar info={yfData.info} /> : null}
          {yfAvailable ? (
            <SummaryScoreCard
              data={yfData}
              perBand={rowPerBand}
              industry={industryBench}
            />
          ) : null}
      </div>

      {stockTab !== "overview" ? renderStockDataTab() : (
      <div className="stock-overview-grid">
        {/* LEFT RAIL (280px sticky) */}
        <aside className="stock-side">
          <div className="panel stock-side-panel">
            <div className="panel-b">
            <div className="mb-3">
              <h1 className="text-lg font-black tracking-tight text-slate-950">{row ? row.companyName : "..."}</h1>
              <p className="orbitron text-sm font-black text-slate-400">{symbol}</p>
            </div>
            {canonical ? (
              <div className="mb-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-700">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: sectorColor(canonical) }} />
                  {sectorLabelKo(canonical)}
                </span>
              </div>
            ) : null}
            {row && !rowLoading ? (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                {/* scouter rows carry null price/ratios for non-US listings */}
                <KV label="현재가" value={row.price != null ? fmtPrice(row.price) : "—"} />
                <KV label="시가총액" value={row.marketCap != null ? fmtMcap(row.marketCap) : "—"} />
                <KV label="PER" value={isFiniteNumber(row.per) ? row.per.toFixed(1) : "—"} />
                <KV label="PBR" value={isFiniteNumber(row.pbr) ? row.pbr.toFixed(2) : "—"} />
                <KV label="배당률" value={isFiniteNumber(row.dividendYield) ? fmtDivYield(row.dividendYield) : "—"} />
                <KV label="12개월 수익률" value={isFiniteNumber(row.return12m) ? fmtPct(row.return12m) : "—"} />
                {rowPerBand ? (
                  <div className={`rounded-lg px-2.5 py-1.5 ${perBandPositionColor(rowPerBand.current, rowPerBand.min, rowPerBand.max)}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.05em] opacity-70">PER 밴드 위치</p>
                    <p className="orbitron tabular-nums text-sm font-black">{perBandPositionText(rowPerBand.current, rowPerBand.min, rowPerBand.max)}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">{[1,2,3,4,5,6].map((i) => <div key={i} className="h-5 w-full rounded bg-slate-200" />)}</div>
            )}
            {f13Entries && f13Entries.length > 0 ? (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <a href="#guru-section" className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.06em] text-amber-700 transition hover:bg-amber-100">
                  구루 {new Set(f13Entries.map((e) => e.investor)).size}명 보유
                </a>
              </div>
            ) : null}
            </div>
          </div>
        </aside>

        {/* MAIN CONTENT */}
        <div className="stock-main-stack">
          {detailLoading ? (
            <div className="space-y-8">
              <SkeletonSection />
            </div>
          ) : detail ? (
            <>
              <SectionCard title="핵심 스냅샷">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {[
                    { label: "PER 밴드", value: detailPerBands ? perBandPositionText(detailPerBands.current, detailPerBands.min_8y, detailPerBands.max_8y) : "—" },
                    { label: "FY+1 PER", value: isFiniteNumber(detail.valuation_estimates?.per?.fy1) ? `${detail.valuation_estimates.per.fy1.toFixed(1)}x` : "—" },
                    { label: "FY+1 매출 성장", value: fmtWholeSignedPct(detail.growth_estimates?.revenue_growth?.fy1) },
                    { label: "FY+1 EPS 성장", value: fmtWholeSignedPct(detail.growth_estimates?.eps_growth?.fy1) },
                    { label: "최근 매출", value: fmtLarge(lastFinite(numberSeries(detail.income_statement?.revenue))) },
                    { label: "최근 EPS", value: isFiniteNumber(lastFinite(numberSeries(detail.per_share?.eps))) ? `$${(lastFinite(numberSeries(detail.per_share?.eps)) as number).toFixed(2)}` : "—" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-slate-200 bg-white/70 px-3 py-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">{item.label}</p>
                      <p className="orbitron mt-1 min-w-0 break-words text-base font-black tabular-nums text-slate-950">{item.value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-4">
                  {[
                    ["재무", "매출·FCF·원재무"],
                    ["통계", "밸류·수익성"],
                    ["추정치", "FY+1~3·리비전"],
                    ["보유기관", "13F 구루"],
                  ].map(([label, desc]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setStockTab(label === "재무" ? "financials" : label === "통계" ? "statistics" : label === "추정치" ? "estimates" : "ownership")}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left transition hover:border-brand-interactive hover:bg-white"
                    >
                      <span className="block text-[11px] font-black text-slate-800">{label}</span>
                      <span className="mt-0.5 block text-[10px] font-semibold text-slate-400">{desc}</span>
                    </button>
                  ))}
                </div>
              </SectionCard>
            </>
          ) : (
            <SectionCard>
              <div className="py-8 text-center">
                <p className="text-sm font-black text-slate-700">상세 데이터를 불러올 수 없습니다</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">/data/global-scouter/stocks/detail/{symbol}.json 을 확인해 주세요.</p>
              </div>
            </SectionCard>
          )}

          <footer className="stock-footer">
            <TransitionLink href={`/screener?ticker=${encodeURIComponent(symbol)}`} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">← 스크리너에서 보기</TransitionLink>
            <TransitionLink href={`/superinvestors?tab=by-ticker&ticker=${encodeURIComponent(symbol)}`} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">구루 보유 보기</TransitionLink>
          </footer>
        </div>
      </div>
      )}
      </div>
    </div>
  );
}

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="panel stock-section">
      {title ? <div className="panel-h"><h2>{title}</h2></div> : null}
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
