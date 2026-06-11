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
  fmtLarge,
} from "@/app/screener/StockDetailPanel";
import type { F13Entry } from "@/app/screener/StockDetailPanel";
import { renderYfTab, FiftyTwoWeekBar, SummaryScoreCard, ThreeSecondSummary, loadIndustryBenchmarks, resolveIndustryBench } from "./StockTabs";
import type { IndustryBench } from "./StockTabs";
import WatchStar from "@/components/WatchStar";

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
      for (const r of (data as any)?.data ?? []) map[r.symbol] = r;
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
  if (ticker in yfCache) return Promise.resolve(yfCache[ticker] || null);
  if (ticker in yfPending) return yfPending[ticker];
  const p = fetch(`/data/yf/finance/${ticker.toUpperCase()}.json`)
    .then((res) => (res.ok ? res.json() : null))
    .then((d) => {
      yfCache[ticker] = d?.data ?? null;
      delete yfPending[ticker];
      return yfCache[ticker];
    })
    .catch(() => { delete yfPending[ticker]; return null; });
  yfPending[ticker] = p;
  return p;
}

// ---------------------------------------------------------------------------
// trades_ranking cache
// ---------------------------------------------------------------------------

let tradesCache: { bought: any[]; sold: any[]; metadata: any } | null = null;
let tradesPromise: Promise<typeof tradesCache> | null = null;

function loadTradesRanking(): Promise<typeof tradesCache> {
  if (tradesCache) return Promise.resolve(tradesCache);
  if (tradesPromise) return tradesPromise;
  tradesPromise = fetch("/data/sec-13f/analytics/trades_ranking.json")
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => { tradesCache = data; return data; })
    .catch(() => { tradesPromise = null; return null; });
  return tradesPromise;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

type MaybeNumber = number | null | undefined;
type NumberSeries = MaybeNumber[];

function isFiniteNumber(value: MaybeNumber): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteValues(data: NumberSeries | null | undefined): number[] {
  return (data ?? []).filter(isFiniteNumber);
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
  const pct = n * 100;
  return pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
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
  actuals, estimates, years, color,
}: {
  actuals: NumberSeries;
  estimates: Record<string, MaybeNumber> | null;
  years: string[];
  color: string;
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
      label: key.toUpperCase(),
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
    if (!isFiniteNumber(value) || value === 0) return null;
    const y = yPct(value);
    const height = Math.max(2, Math.abs(y - zeroPct));
    const top = value > 0 ? Math.min(y, 100 - height) : Math.min(zeroPct, 100 - height);
    return { top: clampPct(top), height: clampPct(height) };
  };

  return (
    <div className="space-y-1">
      <div className="relative flex gap-[2px]" style={{ height: 72 }}>
        <span
          className="pointer-events-none absolute left-0 right-0 border-t border-slate-300/80"
          style={{ top: `${zeroPct}%` }}
        />
        {bars.map((bar) => {
          const s = shape(bar.value);
          const barColor = isFiniteNumber(bar.value) && bar.value < 0 ? "#f43f5e" : color;
          return (
            <div key={bar.key} className="relative h-full flex-1">
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
    { label: "매출", actuals: detail.income_statement?.revenue ?? null, estimates: detail.income_statement_estimates?.revenue ?? null, fmt: s },
    { label: "영업이익", actuals: detail.income_statement?.operating_income ?? null, estimates: detail.income_statement_estimates?.operating_income ?? null, fmt: s },
    { label: "순이익", actuals: detail.income_statement?.net_income ?? null, estimates: detail.income_statement_estimates?.net_income ?? null, fmt: s },
    { label: "EPS", actuals: detail.per_share?.eps ?? null, estimates: detail.per_share_estimates?.eps ?? null, fmt: usd },
    { label: "FCF", actuals: detail.cash_flow?.fcf ?? null, estimates: detail.cash_flow_estimates?.fcf ?? null, fmt: s },
    { label: "DPS", actuals: detail.dividend?.dps ?? null, estimates: detail.dividend_estimates?.dps ?? null, fmt: usd },
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
            {estKeys.map((k) => <th key={k} className="px-2 py-1.5 text-right bg-slate-50 text-slate-400">{k.toUpperCase()}E</th>)}
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
      const b = (data.bought as any[]).find((r: any) => r.ticker === upper);
      const s = (data.sold as any[]).find((r: any) => r.ticker === upper);
      setTradesChip({ bought: b, sold: s });
    });
    return () => { cancelled = true; };
  }, [ticker]);

  const holders = useMemo(() => {
    if (!f13Entries || f13Entries.length === 0) return [];
    const byInv = new Map<string, { shares: number; weight: number }>();
    for (const e of f13Entries) {
      const cur = byInv.get(e.investor);
      if (cur) { cur.shares += (e.shares || 0); cur.weight += (e.weight || 0); }
      else { byInv.set(e.investor, { shares: e.shares ?? 0, weight: e.weight ?? 0 }); }
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
                    {h.shares ? h.shares.toLocaleString() : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs font-semibold text-slate-700">
                    {(h.weight * 100).toFixed(2)}%
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

function MetricWithSpark({ label, value, data, color }: {
  label: string; value: string; data: NumberSeries; color: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-500">{label}</span>
        <span className="orbitron tabular-nums text-sm font-black text-slate-900">{value}</span>
      </div>
      {finiteValues(data).length >= 2 ? <div className="mt-1"><Sparkline data={data} color={color} /></div> : null}
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
  const [row, setRow] = useState<AnalyzerRow | null | undefined>(undefined);
  const canLoadStockData = row !== undefined && row !== null;
  const { detail, loading: detailLoading } = useStockDetail(ticker, canLoadStockData);
  const f13Entries = use13FData(ticker);
  const canonical = row ? resolveSector(null, row.sector) : null;
  const years: string[] = detail?.years ?? [];
  const rowPerBand = validAnalyzerPerBand(row);
  const detailPerBands = validDetailPerBands(detail?.per_bands);

  useEffect(() => {
    let cancelled = false;
    loadAnalyzer().then((map) => { if (!cancelled) setRow(map?.[ticker] ?? null); });
    return () => { cancelled = true; };
  }, [ticker]);

  const rowLoading = row === undefined;
  const [yfData, setYfData] = useState<any | undefined>(undefined);
  const [stockTab, setStockTab] = useState<"overview" | "financials" | "statistics" | "ownership" | "estimates">("overview");

  useEffect(() => {
    let cancelled = false;
    if (!canLoadStockData) {
      setYfData(row === null ? null : undefined);
      return () => { cancelled = true; };
    }
    loadYfFinance(ticker.toUpperCase()).then((d) => { if (!cancelled) setYfData(d ?? null); });
    return () => { cancelled = true; };
  }, [ticker, canLoadStockData, row]);

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
          <p className="mt-2 text-sm font-semibold text-slate-500">{ticker.toUpperCase()} — stocks_analyzer.json에 존재하지 않는 티커입니다.</p>
          <TransitionLink href="/screener" className="mt-4 inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive">← 스크리너에서 보기</TransitionLink>
        </div>
      </div>
    );
  }

  const symbol = ticker.toUpperCase();
  const displayName = row?.companyName ?? symbol;
  const priceText = row?.price != null ? fmtPrice(row.price) : "—";
  const returnText = row?.return12m != null ? fmtPct(row.return12m) : null;
  const returnUp = (row?.return12m ?? 0) >= 0;

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

      {/* YF tabs (non-overview) */}
      {stockTab !== "overview" && yfAvailable ? (
        <section className="panel stock-tab-panel">
          <div className="panel-b">{renderYfTab(stockTab, yfData, industryBench)}</div>
        </section>
      ) : (
      <div className="stock-overview-grid">
        {/* LEFT RAIL (280px sticky) */}
        <aside className="stock-side">
          <div className="panel stock-side-panel">
            <div className="panel-b">
            <div className="mb-3">
              <h1 className="text-lg font-black tracking-tight text-slate-950">{row ? row.companyName : "..."}</h1>
              <p className="orbitron text-sm font-black text-slate-400">{ticker.toUpperCase()}</p>
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
              <SkeletonSection />
            </div>
          ) : detail ? (
            <>
              {/* 1. 밸류에이션 */}
              <SectionCard title="밸류에이션">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <h4 className="mb-2 text-[11px] font-black tracking-[0.08em] text-slate-500">PER 밴드 (8Y)</h4>
                    {finiteValues(detail.valuation?.per).length >= 2 ? (
                      <PerBandChart years={detail.years} per={detail.valuation?.per ?? []} perBands={detail.per_bands} estimates={detail.valuation_estimates?.per} />
                    ) : <span className="text-xs text-slate-300">—</span>}
                  </div>
                  {detailPerBands ? (
                    <div>
                      <h4 className="mb-2 text-[11px] font-black tracking-[0.08em] text-slate-500">PER 밴드 위치</h4>
                      <div className="space-y-2">
                        {[{ label: "최고", v: detailPerBands.max_8y }, { label: "평균", v: detailPerBands.avg_8y }, { label: "현재", v: detailPerBands.current, highlight: true }, { label: "최저", v: detailPerBands.min_8y }].map(({ label, v, highlight }) => {
                          const range = detailPerBands.max_8y - detailPerBands.min_8y || 1;
                          const pct = ((v - detailPerBands.min_8y) / range) * 100;
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

              {/* 2. 재무 추이 */}
              <SectionCard title="재무 추이">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {([
                    ["매출", detail.income_statement?.revenue, detail.income_statement_estimates?.revenue, "#10b981"],
                    ["영업이익", detail.income_statement?.operating_income, detail.income_statement_estimates?.operating_income, "#06b6d4"],
                    ["순이익", detail.income_statement?.net_income, detail.income_statement_estimates?.net_income, "#8b5cf6"],
                    ["FCF", detail.cash_flow?.fcf, detail.cash_flow_estimates?.fcf, "#f59e0b"],
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
              </SectionCard>

              {/* 3. 수익성·성장 */}
              <SectionCard title="수익성·성장">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <h4 className="mb-2 text-[11px] font-black tracking-[0.08em] text-slate-500">수익성</h4>
                    <div className="space-y-3">
                      <MetricWithSpark label="ROE" value={fmtWholePct(lastFinite((detail.profitability as any)?.roe))} data={(detail.profitability as any)?.roe ?? []} color="#8b5cf6" />
                      <MetricWithSpark label="영업이익률" value={fmtWholePct(lastFinite((detail.profitability as any)?.operating_margin))} data={(detail.profitability as any)?.operating_margin ?? []} color="#06b6d4" />
                    </div>
                  </div>
                  <div>
                    <h4 className="mb-2 text-[11px] font-black tracking-[0.08em] text-slate-500">성장률 (YoY)</h4>
                    <div className="space-y-3">
                      <MetricWithSpark label="매출 성장률" value={fmtWholeSignedPct(lastFinite((detail.growth as any)?.revenue_growth))} data={toFractionSeries((detail.growth as any)?.revenue_growth)} color="#10b981" />
                      <MetricWithSpark label="EPS 성장률" value={fmtWholeSignedPct(lastFinite((detail.growth as any)?.eps_growth))} data={toFractionSeries((detail.growth as any)?.eps_growth)} color="#f59e0b" />
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* 4. 구루 동향 */}
              <div id="guru-section">
                <SectionCard>
                  <GuruSection f13Entries={f13Entries} ticker={ticker} />
                </SectionCard>
              </div>
            </>
          ) : (
            <SectionCard>
              <div className="py-8 text-center">
                <p className="text-sm font-black text-slate-700">상세 데이터를 불러올 수 없습니다</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">/data/global-scouter/stocks/detail/{ticker}.json 을 확인해 주세요.</p>
              </div>
            </SectionCard>
          )}

          {/* Footer */}
          <footer className="stock-footer">
            <TransitionLink href={`/screener?ticker=${encodeURIComponent(ticker)}`} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">← 스크리너에서 보기</TransitionLink>
            <TransitionLink href="/superinvestors" className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">구루 보유 보기</TransitionLink>
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
