"use client";

import { useEffect, useState, type ReactNode } from "react";
import TransitionLink from "@/components/TransitionLink";
import MarketThermometer from "@/components/market/MarketThermometer";
import { useMarketValuation } from "@/hooks/useMarketValuation";
import type {
  MarketBondPulse,
  MarketEventRisk,
  MarketIndexTrend,
  MarketMacroPulse,
  MarketSentimentPulse,
  MarketSignalPulse,
  MarketStructurePulse,
  MarketTone,
  ValuationBand,
} from "@/lib/market-valuation/types";
import {
  AnnualReturnsChartPanel,
  ErpHistoryPanel,
  PmiActivityChartPanel,
  YardeniOverlayChartPanel,
} from "@/lib/market-valuation/charts/ledgerChartPanels";
import { formatPercent } from "@/lib/dashboard/formatters";

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Map a history percentile to a rich/cheap verdict. */
function valuationMeta(pct: number | null): { label: string; tone: string; dot: string } {
  if (pct === null) return { label: "—", tone: "text-slate-400", dot: "bg-slate-300" };
  if (pct >= 80) return { label: "고평가", tone: "text-rose-600", dot: "bg-rose-500" };
  if (pct >= 60) return { label: "다소 높음", tone: "text-amber-600", dot: "bg-amber-500" };
  if (pct >= 40) return { label: "역사적 중립", tone: "text-slate-600", dot: "bg-slate-400" };
  if (pct >= 20) return { label: "다소 낮음", tone: "text-sky-600", dot: "bg-sky-500" };
  return { label: "저평가", tone: "text-emerald-600", dot: "bg-emerald-500" };
}

function positionPct(value: number | null, min: number | null, max: number | null): number | null {
  if (value === null || min === null || max === null || max === min) return null;
  return Math.min(100, Math.max(0, Math.round(((value - min) / (max - min)) * 100)));
}

function fmt(value: number | null, digits: number): string {
  return value === null ? "—" : value.toFixed(digits);
}

function fmtSignedPct(value: number | null, digits = 1): string {
  if (value === null) return "—";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)}%`;
}

function fmtSignedPoint(value: number | null, digits = 1): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function fmtPercentDecimal(value: number | null, digits = 1): string {
  return value === null ? "—" : formatPercent(value * 100, digits);
}

function toneClass(tone: MarketTone): string {
  if (tone === "emerald") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-700";
  if (tone === "rose") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function toneDotClass(tone: MarketTone): string {
  if (tone === "emerald") return "bg-emerald-500";
  if (tone === "amber") return "bg-amber-500";
  if (tone === "rose") return "bg-rose-500";
  return "bg-slate-400";
}

function fmtIndex(value: number | null): string {
  return value === null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function EmptyPanel({ label }: { label: string }) {
  return <div className="px-4 py-5 text-sm font-semibold text-slate-400">{label}</div>;
}

function MiniTrend({
  points,
  label,
  formatValue = (value) => fmt(value, 1),
  tone = "slate",
}: {
  points?: CompactTrendPoint[];
  label: string;
  formatValue?: (value: number) => string;
  tone?: MarketTone;
}) {
  const rows = (points ?? []).filter((point) => Number.isFinite(point.value));
  if (rows.length < 2) return null;
  const values = rows.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 240;
  const h = 72;
  const pad = 10;
  const x = (index: number) => pad + (index / Math.max(1, rows.length - 1)) * (w - pad * 2);
  const y = (value: number) => h - pad - ((value - min) / range) * (h - pad * 2);
  const path = rows.map((point, index) => `${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const latest = rows[rows.length - 1];
  const stroke = tone === "rose" ? "#f43f5e" : tone === "amber" ? "#f59e0b" : tone === "emerald" ? "#10b981" : "#1B73D3";
  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[72px] w-full" preserveAspectRatio="none" role="img" aria-label={`${label} 추이 · 최신 ${latest.date} ${formatValue(latest.value)} · 범위 ${formatValue(min)}~${formatValue(max)}`}>
        <line x1={pad} y1={y(min)} x2={w - pad} y2={y(min)} stroke="#e2e8f0" strokeDasharray="2,2" />
        <line x1={pad} y1={y(max)} x2={w - pad} y2={y(max)} stroke="#e2e8f0" strokeDasharray="2,2" />
        {min < 0 && max > 0 ? <line x1={pad} y1={y(0)} x2={w - pad} y2={y(0)} stroke="#cbd5e1" /> : null}
        <polyline points={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <circle cx={x(rows.length - 1)} cy={y(latest.value)} r="3" fill={stroke} stroke="white" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex min-w-0 justify-between gap-2 text-[9px] font-black tabular-nums text-slate-400">
        <span>min {formatValue(min)}</span>
        <span className="text-slate-600">현재 {formatValue(latest.value)}</span>
        <span>max {formatValue(max)}</span>
      </div>
    </div>
  );
}

function PanelShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[1.2rem] border border-slate-200 bg-white shadow-[0_10px_36px_-18px_rgba(15,23,42,0.18)]">
      <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="min-w-0 text-sm font-black tracking-tight text-slate-950">{title}</h2>
        <span className="min-w-0 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">{subtitle}</span>
      </header>
      {children}
    </section>
  );
}

function MarketSection({
  index,
  title,
  summary,
  children,
  muted = false,
}: {
  index: string;
  title: string;
  summary: string;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <section className={cx("grid gap-3", muted && "opacity-60")}>
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-brand-interactive">{index}</p>
          <h2 className="mt-1 text-xl font-black text-slate-950">{title}</h2>
        </div>
        <p className="max-w-xl text-sm font-semibold leading-6 text-slate-500">{summary}</p>
      </header>
      {children}
    </section>
  );
}

function StructureDetailEntry() {
  return (
    <TransitionLink
      href="/market-valuation/structure"
      className="group flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-[1.2rem] border border-slate-200 bg-[linear-gradient(135deg,#f8fbff_0%,#ffffff_58%,#eef6ff_100%)] px-4 py-3 shadow-[0_10px_36px_-20px_rgba(15,23,42,0.28)] transition hover:border-brand-interactive hover:shadow-[0_14px_42px_-24px_rgba(27,115,211,0.42)]"
    >
      <span className="min-w-0">
        <span className="block text-[11px] font-black uppercase tracking-[0.12em] text-brand-interactive">Market Structure Detail</span>
        <span className="mt-1 block text-base font-black text-slate-950">시장구조 상세로 이동</span>
        <span className="mt-1 block text-xs font-semibold leading-5 text-slate-500">집중도, 벤치마크 매트릭스, 유동성, 심리 하위 지표를 더 크게 확인합니다.</span>
      </span>
      <span className="shrink-0 rounded-full border border-brand-interactive/30 bg-white px-3 py-2 text-xs font-black text-brand-interactive transition group-hover:bg-brand-interactive group-hover:text-white">
        상세 보기
      </span>
    </TransitionLink>
  );
}

interface MarketStructureIndexDoc {
  generated_at?: string;
  concentration?: Array<{ id: string; label: string; top3Weight?: number | null; top10Weight?: number | null }>;
  benchmarkMatrix?: { generated?: string | null; rows?: BenchmarkMatrixRow[] };
  liquidity?: Array<{ id: string; label: string; date?: string | null; value?: number | null; delta7d?: number | null; delta30d?: number | null; trend?: CompactTrendPoint[] }>;
  sentimentComponents?: { latestDate?: string | null; components?: Array<{ id: string; value?: number | null; delta7d?: number | null; trend?: CompactTrendPoint[] }> };
  aaii?: { latestDate?: string | null; points?: number; bullish?: number | null; neutral?: number | null; bearish?: number | null; spread?: number | null; trend?: CompactTrendPoint[] };
  creditRatings?: { sourceDate?: string | null; tableCount?: number; tables?: Array<{ id: string; rows?: number; medianSpread?: number | null }> };
  component_as_of?: Array<{ id: string; asOf?: string | null; status?: string | null }>;
}

interface CompactTrendPoint {
  date: string;
  value: number;
}

interface BenchmarkMatrixRow {
  id: string;
  label: string;
  price?: Record<string, number | null>;
  eps?: Record<string, number | null>;
  pe?: Record<string, number | null>;
}

let marketStructureIndexCache: MarketStructureIndexDoc | null = null;
let marketStructureIndexPending: Promise<MarketStructureIndexDoc | null> | null = null;

function loadMarketStructureIndex(): Promise<MarketStructureIndexDoc | null> {
  if (marketStructureIndexCache) return Promise.resolve(marketStructureIndexCache);
  if (marketStructureIndexPending) return marketStructureIndexPending;
  marketStructureIndexPending = fetch("/data/computed/market_structure_index.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((doc) => {
      marketStructureIndexCache = doc;
      return doc;
    })
    .catch(() => {
      marketStructureIndexPending = null;
      return null;
    });
  return marketStructureIndexPending;
}

function MacroPulsePanel({ items }: { items: MarketMacroPulse[] }) {
  return (
    <PanelShell title="경기 펄스" subtitle="PMI · ISM · OECD CLI">
      {items.length === 0 ? (
        <EmptyPanel label="경기 데이터 없음" />
      ) : (
        <div className="grid min-w-0 sm:grid-cols-2 xl:grid-cols-5">
          {items.map((item) => (
            <div key={item.id} className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 sm:[&:nth-child(-n+2)]:border-t-0 xl:border-t-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className={cx("h-2 w-2 shrink-0 rounded-full", toneDotClass(item.tone))} />
                <p className="min-w-0 truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{item.label}</p>
              </div>
              <div className="mt-2 flex min-w-0 items-end gap-1">
                <span className="orbitron min-w-0 text-2xl font-black tabular-nums text-slate-950">{fmt(item.value, 1)}</span>
                <span className="pb-1 text-[10px] font-bold uppercase text-slate-400">{item.unit}</span>
              </div>
              <p className="mt-1 text-[11px] font-semibold text-slate-400">{item.period ?? item.releaseDate ?? "—"}</p>
              <p className="mt-2 min-w-0 break-words text-[11px] font-semibold leading-5 text-slate-500">{item.detail}</p>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function SignalPulsePanel({ items }: { items: MarketSignalPulse[] }) {
  return (
    <PanelShell title="유동성·리스크 신호" subtitle="computed signals">
      {items.length === 0 ? (
        <EmptyPanel label="가공 신호 없음" />
      ) : (
        <div className="grid min-w-0 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.id} className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 sm:[&:nth-child(-n+2)]:border-t-0">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{item.label}</p>
                  <p className="mt-1 min-w-0 break-words text-xs font-semibold leading-5 text-slate-500">{item.detail}</p>
                </div>
                <span className={cx("shrink-0 rounded-full border px-2 py-1 text-[10px] font-black", toneClass(item.tone))}>{item.statusLabel}</span>
              </div>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300">{item.asOf ?? "—"}</p>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function BondPulsePanel({ items }: { items: MarketBondPulse[] }) {
  return (
    <PanelShell title="채권 시그널" subtitle="HY · curve · BEI">
      {items.length === 0 ? (
        <EmptyPanel label="채권 신호 데이터 없음" />
      ) : (
        <div className="grid min-w-0 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((item) => (
            <div key={item.id} className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 sm:[&:nth-child(-n+2)]:border-t-0 xl:border-t-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className={cx("h-2 w-2 shrink-0 rounded-full", toneDotClass(item.tone))} />
                <p className="min-w-0 truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{item.label}</p>
              </div>
              <p className="orbitron mt-2 text-2xl font-black tabular-nums text-slate-950">{item.valueLabel}</p>
              <p className="mt-1 min-w-0 break-words text-[11px] font-semibold leading-5 text-slate-500">{item.detail}</p>
              <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-black text-slate-600">{item.changeLabel}</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300">{item.date ?? "—"}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function SentimentPulsePanel({ items }: { items: MarketSentimentPulse[] }) {
  return (
    <PanelShell title="센티먼트" subtitle="VIX · AAII · MOVE">
      {items.length === 0 ? (
        <EmptyPanel label="센티먼트 데이터 없음" />
      ) : (
        <div className="grid min-w-0 sm:grid-cols-2 lg:grid-cols-5">
          {items.map((item) => (
            <div key={item.id} className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 sm:[&:nth-child(-n+2)]:border-t-0 lg:border-t-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className={cx("h-2 w-2 shrink-0 rounded-full", toneDotClass(item.tone))} />
                <p className="min-w-0 truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{item.label}</p>
              </div>
              <p className="orbitron mt-2 text-2xl font-black tabular-nums text-slate-950">{item.valueLabel}</p>
              <p className="mt-1 min-w-0 break-words text-[11px] font-semibold leading-5 text-slate-500">{item.detail}</p>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300">{item.date ?? "—"}</p>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function MarketStructurePanel({ trends, structures }: { trends: MarketIndexTrend[]; structures: MarketStructurePulse[] }) {
  const [doc, setDoc] = useState<MarketStructureIndexDoc | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMarketStructureIndex().then((next) => {
      if (!cancelled) setDoc(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const concentration = doc?.concentration?.slice(0, 3) ?? [];
  const benchmarkRows = doc?.benchmarkMatrix?.rows?.slice(0, 7) ?? [];
  const liquidity = doc?.liquidity ?? [];
  const aaii = doc?.aaii ?? null;
  const weakSentiment = [...(doc?.sentimentComponents?.components ?? [])]
    .sort((a, b) => (a.value ?? 100) - (b.value ?? 100))
    .slice(0, 4);
  const signalDates = doc?.component_as_of ?? [];
  const credit = doc?.creditRatings?.tables?.[0] ?? null;
  const isEmpty = trends.length === 0 && structures.length === 0 && !doc;

  return (
    <PanelShell title="시장 구조" subtitle="indices · slickcharts">
      {isEmpty ? (
        <EmptyPanel label="시장 구조 데이터 없음" />
      ) : (
        <>
          {trends.length > 0 ? (
            <div className="grid min-w-0 md:grid-cols-2">
              {trends.map((trend) => (
                <div key={trend.id} className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 md:border-t-0">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{trend.label}</p>
                      <p className="orbitron mt-1 text-2xl font-black tabular-nums text-slate-950">{fmtIndex(trend.latestValue)}</p>
                    </div>
                    <span className="shrink-0 text-right text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300">{trend.latestDate ?? "—"}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <MomentumCell label="1Y" value={trend.oneYearReturn} />
                    <MomentumCell label="5Y" value={trend.fiveYearReturn} />
                    <MomentumCell label="DD" value={trend.drawdownFromHigh} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {structures.length > 0 ? (
            <div className="grid min-w-0 border-t border-slate-100 sm:grid-cols-2 lg:grid-cols-3">
              {structures.map((item) => (
                <div key={item.id} className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 sm:[&:nth-child(-n+2)]:border-t-0 lg:[&:nth-child(-n+3)]:border-t-0">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{item.label}</p>
                      <p className="mt-1 min-w-0 break-words text-[11px] font-semibold leading-5 text-slate-500">{item.detail}</p>
                    </div>
                    <span className={cx("shrink-0 rounded-full border px-2 py-1 text-[10px] font-black tabular-nums", toneClass(item.tone))}>{item.valueLabel}</span>
                  </div>
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300">{item.updated ?? "—"}</p>
                </div>
              ))}
            </div>
          ) : null}
          {doc ? (
            <>
              <div className="grid min-w-0 border-t border-slate-100 lg:grid-cols-4">
                {concentration.map((item) => (
                  <div key={item.id} className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 lg:border-t-0">
                    <p className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{item.label} 집중도</p>
                    <p className="orbitron mt-2 text-2xl font-black tabular-nums text-slate-950">{fmt(item.top10Weight ?? null, 1)}%</p>
                    <p className="mt-1 text-[11px] font-semibold text-slate-500">Top3 {fmt(item.top3Weight ?? null, 1)}%</p>
                  </div>
                ))}
                {credit ? (
                  <div className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 lg:border-t-0">
                    <p className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">Credit lookup</p>
                    <p className="orbitron mt-2 text-2xl font-black tabular-nums text-slate-950">{fmtPercentDecimal(credit.medianSpread ?? null, 2)}</p>
                    <p className="mt-1 text-[11px] font-semibold text-slate-500">{doc.creditRatings?.sourceDate ?? "—"} · {doc.creditRatings?.tableCount ?? 0} tables</p>
                  </div>
                ) : null}
              </div>
              {benchmarkRows.length > 0 ? (
                <div className="border-t border-slate-100 px-4 py-3">
                  <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">이익 × 멀티플 매트릭스</p>
                    <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300">{doc.benchmarkMatrix?.generated ?? "—"}</span>
                  </div>
                  <div className="mt-2 grid min-w-0 gap-1">
                    {benchmarkRows.map((row) => (
                      <div key={row.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 py-1.5 first:border-t-0">
                        <span className="min-w-[96px] flex-1 truncate text-[11px] font-black text-slate-700">{row.label}</span>
                        <span className="text-right text-[10px] font-black tabular-nums text-slate-500">1M {fmtSignedPct(row.price?.["1m"] ?? null, 1)}</span>
                        <span className="text-right text-[10px] font-black tabular-nums text-slate-900">YTD {fmtSignedPct(row.price?.ytd ?? null, 1)}</span>
                        <span className="text-right text-[10px] font-black tabular-nums text-emerald-600">EPS {fmtSignedPct(row.eps?.ytd ?? null, 1)}</span>
                        <span className="text-right text-[10px] font-black tabular-nums text-slate-500">PE {fmtSignedPct(row.pe?.ytd ?? null, 1)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="grid min-w-0 border-t border-slate-100 md:grid-cols-2">
                {liquidity.map((item) => (
                  <div key={item.id} className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 md:border-t-0">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{item.label}</p>
                        <p className="mt-1 min-w-0 break-words text-[11px] font-semibold leading-5 text-slate-500">{item.date ?? "—"}</p>
                      </div>
                      <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-black tabular-nums text-slate-600">
                        7D {fmtSignedPoint(item.delta7d ?? null, 1)}
                      </span>
                    </div>
                    <div className="mt-2 flex min-w-0 items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300">
                      <span>30D {fmtSignedPoint(item.delta30d ?? null, 1)}</span>
                      <span className="orbitron tabular-nums text-slate-500">{fmt(item.value ?? null, 1)}</span>
                    </div>
                    <MiniTrend points={item.trend} label={item.label} formatValue={(value) => fmt(value, 1)} />
                  </div>
                ))}
              </div>
              <div className="grid min-w-0 border-t border-slate-100 md:grid-cols-2">
                <div className="min-w-0 px-4 py-3">
                  <p className="text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">CNN 하위 심리</p>
                  <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">
                    {weakSentiment.map((item) => (
                      <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-[10px] font-black text-slate-600">{item.id.replace(/_/g, " ")}</span>
                          <span className="orbitron shrink-0 text-[10px] font-black tabular-nums text-slate-900">{fmt(item.value ?? null, 1)}</span>
                        </div>
                        <MiniTrend points={item.trend} label={item.id.replace(/_/g, " ")} formatValue={(value) => fmt(value, 1)} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="min-w-0 border-t border-slate-100 px-4 py-3 md:border-t-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">AAII 개인투자자 심리</p>
                  {aaii ? (
                    <>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <MomentumCell label="Bull" value={aaii.bullish !== null && aaii.bullish !== undefined ? aaii.bullish / 100 : null} />
                        <MomentumCell label="Bear" value={aaii.bearish !== null && aaii.bearish !== undefined ? aaii.bearish / 100 : null} />
                        <MomentumCell label="Spread" value={aaii.spread !== null && aaii.spread !== undefined ? aaii.spread / 100 : null} />
                      </div>
                      <MiniTrend points={aaii.trend} label="AAII bull-bear spread" formatValue={(value) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%p`} tone={(aaii.spread ?? 0) < 0 ? "amber" : "slate"} />
                      <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300">{aaii.latestDate ?? "—"} · {aaii.points ?? 0} points</p>
                    </>
                  ) : (
                    <EmptyPanel label="AAII 데이터 없음" />
                  )}
                  <div className="mt-3 flex min-w-0 flex-wrap gap-2 border-t border-slate-100 pt-3">
                    {signalDates.map((item) => (
                      <span key={item.id} className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-500">
                        {item.id} · {item.asOf ?? "—"}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </>
      )}
    </PanelShell>
  );
}

function EventRiskPanel({ items }: { items: MarketEventRisk[] }) {
  return (
    <PanelShell title="이벤트 리스크" subtitle="USD calendar">
      {items.length === 0 ? (
        <EmptyPanel label="다가오는 주요 이벤트 없음" />
      ) : (
        <div className="grid min-w-0 lg:grid-cols-2">
          {items.map((item) => {
            const tone: MarketTone = item.importance === "H" ? "rose" : "amber";
            return (
              <div key={item.id} className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 lg:[&:nth-child(-n+2)]:border-t-0">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] font-black tabular-nums text-slate-950">{item.dateKst.slice(5)}</p>
                    <p className="text-[10px] font-bold tabular-nums text-slate-400">{item.timeKst}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className={cx("rounded-full border px-2 py-0.5 text-[10px] font-black", toneClass(tone))}>{item.importance}</span>
                      <span className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">{item.category}</span>
                    </div>
                    <p className="mt-1 min-w-0 break-words text-sm font-bold leading-5 text-slate-800">{item.titleKo}</p>
                    {item.titleEn ? <p className="mt-1 min-w-0 break-words text-[11px] font-semibold leading-5 text-slate-400">{item.titleEn}</p> : null}
                    {item.previousValue ? (
                      <p className="mt-2 inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-black tabular-nums text-slate-600">
                        직전 {item.previousValue} · {item.previousAsOf ?? item.previousSeries ?? "prev"}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PanelShell>
  );
}

function MomentumCell({ label, value }: { label: string; value: number | null }) {
  const positive = value !== null && value >= 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-400">{label}</p>
      <p className={cx("orbitron mt-1 text-sm font-black tabular-nums", value === null ? "text-slate-300" : positive ? "text-emerald-600" : "text-rose-600")}>
        {fmtSignedPct(value)}
      </p>
    </div>
  );
}

function ValuationRow({ label, band, digits }: { label: string; band: ValuationBand; digits: number }) {
  const meta = valuationMeta(band.percentile);
  const curPos = positionPct(band.current, band.min, band.max);
  const avgPos = positionPct(band.avg, band.min, band.max);
  return (
    <div className="rounded-[1rem] border border-slate-200 bg-white/70 px-3 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">{label}</span>
        <span className="orbitron text-xl font-black text-slate-950">{fmt(band.current, digits)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] font-bold">
        <span className={cx("inline-flex items-center gap-1", meta.tone)}>
          <span className={cx("h-1.5 w-1.5 rounded-full", meta.dot)} />
          {meta.label}
          {band.percentile !== null ? <span className="text-slate-400">· 역사 {band.percentile}%</span> : null}
        </span>
        <span className="tabular-nums text-slate-400">
          {fmt(band.min, digits)} ~ {fmt(band.max, digits)}
        </span>
      </div>
      {/* 16-year band gauge: min ── avg ── max, with current marker */}
      <div className="relative mt-2 h-2 rounded-full bg-gradient-to-r from-emerald-200 via-slate-200 to-rose-200">
        {avgPos !== null ? (
          <span className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-slate-400" style={{ left: `${avgPos}%` }} aria-hidden="true" />
        ) : null}
        {curPos !== null ? (
          <span
            className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow"
            style={{ left: `${curPos}%` }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="mt-1 flex justify-between text-[9px] font-bold uppercase tracking-wider text-slate-300">
        <span>저평가</span>
        <span>avg {fmt(band.avg, digits)}</span>
        <span>고평가</span>
      </div>
    </div>
  );
}

export default function MarketValuationClient() {
  const {
    indices,
    macroPulses,
    signalPulses,
    sentimentPulses,
    eventRisks,
    indexTrends,
    structurePulses,
    bondPulses,
    dataReady,
    failed,
    sourceDate,
  } = useMarketValuation();

  return (
    <div className="data-shell-page">
      <section className="panel data-shell-header">
        <div className="data-shell-head-main">
          <p className="data-shell-kicker">Market Valuation</p>
          <h1 className="data-shell-title">시장 밸류에이션</h1>
          <p className="data-shell-desc">
            주요 미국 지수가 <strong className="text-slate-800">역사적으로 비싼지/싼지</strong>. Fwd P/E·P/B를 16년 밴드와 대조합니다.
          </p>
        </div>
        <div className="data-shell-head-actions">
          {sourceDate ? (
            <span className="data-shell-pill ok">
              <span />
              {sourceDate}
            </span>
          ) : null}
          <TransitionLink href="/explore" className="data-shell-link">
            Explore
          </TransitionLink>
        </div>
      </section>

      {failed ? (
        <div className="rounded-[1.2rem] border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
          지수 밸류에이션 데이터를 불러오지 못했습니다.
        </div>
      ) : null}

      <MarketSection index="01 Overview" title="개요" summary="시장 체온과 가공 신호를 먼저 보고 오늘의 방향성을 잡습니다." muted={!dataReady}>
        <MarketThermometer />
        <SignalPulsePanel items={signalPulses} />
      </MarketSection>

      <MarketSection index="02 Macro" title="매크로" summary="PMI, 경기 펄스, 채권 신호를 한 흐름으로 묶어 확인합니다." muted={!dataReady}>
        <PmiActivityChartPanel />
        <MacroPulsePanel items={macroPulses} />
        <BondPulsePanel items={bondPulses} />
      </MarketSection>

      <MarketSection index="03 Valuation" title="밸류에이션" summary="ERP, Yardeni 모델, 지수별 멀티플 밴드를 한곳에 모았습니다." muted={!dataReady}>
        <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <ErpHistoryPanel />
          <YardeniOverlayChartPanel />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {indices.map((index) => (
            <section
              key={index.id}
              className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-5"
            >
              <header className="flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">{index.nameEn}</p>
                  <h2 className="truncate text-lg font-black text-slate-950">{index.name}</h2>
                </div>
                <div className="text-right">
                  <p className="orbitron text-lg font-black tabular-nums text-slate-900">
                    {index.price === null ? "—" : index.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{index.date ?? "—"}</p>
                </div>
              </header>

              <div className="mt-3 grid gap-2">
                <ValuationRow label="Fwd P/E" band={index.pe} digits={1} />
                <ValuationRow label="P/B" band={index.pb} digits={2} />
                <div className="flex items-center justify-between rounded-[1rem] border border-slate-200 bg-white/70 px-3 py-2">
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">ROE</span>
                  <span className="orbitron text-lg font-black tabular-nums text-slate-900">
                    {index.roe === null ? "—" : formatPercent(index.roe * 100, 1)}
                  </span>
                </div>
              </div>
            </section>
          ))}
        </div>
      </MarketSection>

      <MarketSection index="04 Structure & Sentiment" title="구조·심리" summary="시장 내부 구조와 투자 심리의 압력을 함께 봅니다." muted={!dataReady}>
        <MarketStructurePanel trends={indexTrends} structures={structurePulses} />
        <StructureDetailEntry />
        <SentimentPulsePanel items={sentimentPulses} />
      </MarketSection>

      <MarketSection index="05 Context" title="맥락" summary="연도별 수익률과 예정 이벤트로 현재 위치를 보정합니다." muted={!dataReady}>
        <AnnualReturnsChartPanel />
        <EventRiskPanel items={eventRisks} />
      </MarketSection>

      <p className="px-1 text-[11px] text-slate-400">
        역사 밴드 = 2010년 이후 weekly 시계열의 min/avg/max. percentile은 현재값의 역사적 위치(높을수록 고평가). YTD 분해는 가격 변화가 EPS 개선인지 멀티플 확장/축소인지 보기 위한 가공 신호입니다.
      </p>
    </div>
  );
}
