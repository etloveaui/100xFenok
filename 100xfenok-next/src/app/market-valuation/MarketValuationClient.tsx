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
  if (pct === null) return { label: "—", tone: "text-[var(--c-ink-4)]", dot: "bg-[var(--c-line)]" };
  if (pct >= 80) return { label: "고평가", tone: "text-[var(--c-down)]", dot: "bg-[var(--c-down)]" };
  if (pct >= 60) return { label: "다소 높음", tone: "text-[var(--c-warn)]", dot: "bg-[var(--c-warn)]" };
  if (pct >= 40) return { label: "역사적 중립", tone: "text-[var(--c-ink-2)]", dot: "bg-[var(--c-line)]" };
  if (pct >= 20) return { label: "다소 낮음", tone: "text-sky-600", dot: "bg-sky-500" };
  return { label: "저평가", tone: "text-[var(--c-up)]", dot: "bg-[var(--c-up)]" };
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

function toneClass(tone: MarketTone): string {
  if (tone === "emerald") return "border-[var(--c-up)] bg-[var(--c-up-soft)] text-[var(--c-up)]";
  if (tone === "amber") return "border-[var(--c-warn)] bg-[var(--c-warn-soft)] text-[var(--c-warn)]";
  if (tone === "rose") return "border-[var(--c-down)] bg-[var(--c-down-soft)] text-[var(--c-down)]";
  return "border-[var(--c-line)] bg-[var(--c-surface-2)] text-[var(--c-ink-2)]";
}

function toneDotClass(tone: MarketTone): string {
  if (tone === "emerald") return "bg-[var(--c-up)]";
  if (tone === "amber") return "bg-[var(--c-warn)]";
  if (tone === "rose") return "bg-[var(--c-down)]";
  return "bg-[var(--c-line)]";
}

function fmtIndex(value: number | null): string {
  return value === null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function EmptyPanel({ label }: { label: string }) {
  return <div className="px-[var(--panel-pad)] py-5 text-sm font-semibold text-[var(--c-ink-4)]">{label}</div>;
}

function PanelShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[1.2rem] border border-[var(--c-line)] bg-[var(--c-panel)] shadow-[var(--sh-sm)]">
      <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 border-b border-[var(--c-line-2)] px-4 py-3">
        <h2 className="min-w-0 text-sm font-black tracking-tight text-[var(--c-ink)]">{title}</h2>
        <span className="min-w-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--c-ink-4)]">{subtitle}</span>
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
        <span className="block text-[11px] font-black uppercase tracking-[0.12em] text-brand-interactive">시장 구조 상세</span>
        <span className="mt-1 block text-base font-black text-slate-950">시장 구조 자세히 보기</span>
        <span className="mt-1 block text-xs font-semibold leading-5 text-slate-500">집중도, 벤치마크 매트릭스, 유동성, 심리 하위 지표를 더 크게 확인합니다.</span>
      </span>
      <span className="shrink-0 rounded-full border border-brand-interactive/30 bg-white px-3 py-2 text-xs font-black text-brand-interactive transition group-hover:bg-brand-interactive group-hover:text-white">
        열기
      </span>
    </TransitionLink>
  );
}

interface MarketStructureIndexDoc {
  generated_at?: string;
  concentration?: Array<{ id: string; label: string; top3Weight?: number | null; top10Weight?: number | null }>;
  benchmarkMatrix?: { generated?: string | null; rows?: BenchmarkMatrixRow[] };
  creditRatings?: { sourceDate?: string | null; tableCount?: number; tables?: Array<{ id: string; rows?: number; medianSpread?: number | null }> };
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
            <div key={item.id} className="min-w-0 border-t border-[var(--c-line-2)] px-[var(--panel-pad)] py-3 first:border-t-0 sm:[&:nth-child(-n+2)]:border-t-0 xl:border-t-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className={cx("h-2 w-2 shrink-0 rounded-full", toneDotClass(item.tone))} />
                <p className="min-w-0 truncate text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">{item.label}</p>
              </div>
              <div className="mt-2 flex min-w-0 items-end gap-1">
                <span className="orbitron min-w-0 text-2xl font-black tabular-nums text-[var(--c-ink)]">{fmt(item.value, 1)}</span>
                <span className="pb-1 text-[10px] font-bold uppercase text-[var(--c-ink-4)]">{item.unit}</span>
              </div>
              <p className="mt-1 text-[11px] font-semibold text-[var(--c-ink-4)]">{item.period ?? item.releaseDate ?? "—"}</p>
              <p className="mt-2 min-w-0 break-words text-[11px] font-semibold leading-5 text-[var(--c-ink-3)]">{item.detail}</p>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function SignalPulsePanel({ items }: { items: MarketSignalPulse[] }) {
  return (
    <PanelShell title="유동성·리스크 신호" subtitle="종합 신호">
      {items.length === 0 ? (
        <EmptyPanel label="시장 신호 없음" />
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
                <span className="rounded-full border border-[var(--c-line)] bg-[var(--c-surface-2)] px-2 py-1 text-[10px] font-black text-[var(--c-ink-2)]">{item.changeLabel}</span>
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

  const concentration = doc?.concentration?.slice(0, 2) ?? [];
  const benchmarkRows = doc?.benchmarkMatrix?.rows?.slice(0, 3) ?? [];
  const credit = doc?.creditRatings?.tables?.[0] ?? null;
  const isEmpty = trends.length === 0 && structures.length === 0 && !doc;

  return (
    <PanelShell title="시장 구조" subtitle="지수·보유비중">
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
            <div className="grid min-w-0 border-t border-slate-100 lg:grid-cols-4">
              {concentration.map((item) => (
                <div key={item.id} className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 lg:border-t-0">
                  <p className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{item.label} 집중도</p>
                  <p className="orbitron mt-2 text-2xl font-black tabular-nums text-slate-950">{fmt(item.top10Weight ?? null, 1)}%</p>
                  <p className="mt-1 text-[11px] font-semibold text-slate-500">상위 3개 {fmt(item.top3Weight ?? null, 1)}%</p>
                </div>
              ))}
              {credit ? (
                <div className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 lg:border-t-0">
                  <p className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">신용 스프레드</p>
                  <p className="orbitron mt-2 text-2xl font-black tabular-nums text-slate-950">{fmtSignedPct(credit.medianSpread ?? null, 2)}</p>
                  <p className="mt-1 text-[11px] font-semibold text-slate-500">{doc.creditRatings?.sourceDate ?? "—"} · 표 {doc.creditRatings?.tableCount ?? 0}개</p>
                </div>
              ) : null}
              {benchmarkRows.length > 0 ? (
                <div className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 lg:border-t-0">
                  <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                    <p className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">이익과 멀티플</p>
                    <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300">{doc.benchmarkMatrix?.generated ?? "—"}</span>
                  </div>
                  <div className="mt-2 grid min-w-0 gap-1">
                    {benchmarkRows.map((row) => (
                      <div key={row.id} className="flex min-w-0 items-center justify-between gap-2 border-t border-slate-100 py-1 first:border-t-0">
                        <span className="min-w-0 truncate text-[11px] font-black text-slate-700">{row.label}</span>
                        <span className="shrink-0 text-[10px] font-black tabular-nums text-slate-500">
                          YTD {fmtSignedPct(row.price?.ytd ?? null, 1)} · EPS {fmtSignedPct(row.eps?.ytd ?? null, 1)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </PanelShell>
  );
}

function EventRiskPanel({ items }: { items: MarketEventRisk[] }) {
  return (
    <PanelShell title="이벤트 리스크" subtitle="미국 경제일정">
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
    <div className="rounded-xl border border-[var(--c-line)] bg-white/70 px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-4)]">{label}</p>
      <p className={cx("orbitron mt-1 text-sm font-black tabular-nums", value === null ? "text-[var(--c-line-2)]" : positive ? "text-[var(--c-up)]" : "text-[var(--c-down)]")}>
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
    <div className="rounded-[1rem] border border-[var(--c-line)] bg-white/70 px-3 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">{label}</span>
        <span className="orbitron text-xl font-black text-[var(--c-ink)]">{fmt(band.current, digits)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] font-bold">
        <span className={cx("inline-flex items-center gap-1", meta.tone)}>
          <span className={cx("h-1.5 w-1.5 rounded-full", meta.dot)} />
          {meta.label}
          {band.percentile !== null ? <span className="text-[var(--c-ink-4)]">· 역사 {band.percentile}%</span> : null}
        </span>
        <span className="tabular-nums text-[var(--c-ink-4)]">
          {fmt(band.min, digits)} ~ {fmt(band.max, digits)}
        </span>
      </div>
      {/* 16-year band gauge: min ── avg ── max, with current marker */}
      <div className="relative mt-2 h-2 rounded-full bg-gradient-to-r from-emerald-200 via-slate-200 to-rose-200">
        {avgPos !== null ? (
          <span className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-[var(--c-line)]" style={{ left: `${avgPos}%` }} aria-hidden="true" />
        ) : null}
        {curPos !== null ? (
          <span
            className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--c-panel)] bg-[var(--c-ink)] shadow"
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
          <p className="data-shell-kicker">시장 밸류에이션</p>
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
          <TransitionLink href="/market/events" className="data-shell-link">
            이벤트
          </TransitionLink>
          <TransitionLink href="/explore" className="data-shell-link">
            탐색
          </TransitionLink>
        </div>
      </section>

      {failed ? (
        <div className="rounded-[1.2rem] border border-[var(--c-line)] bg-[var(--c-surface-2)] px-4 py-3 text-sm font-semibold text-[var(--c-ink)]">
          지수 밸류에이션 데이터를 불러오지 못했습니다.
        </div>
      ) : null}

      <MarketSection index="01 개요" title="개요" summary="시장 체온과 주요 신호를 먼저 보고 오늘의 방향성을 잡습니다." muted={!dataReady}>
        <MarketThermometer />
        <SignalPulsePanel items={signalPulses} />
      </MarketSection>

      <MarketSection index="02 매크로" title="매크로" summary="PMI, 경기 펄스, 채권 신호를 한 흐름으로 묶어 확인합니다." muted={!dataReady}>
        <PmiActivityChartPanel />
        <MacroPulsePanel items={macroPulses} />
        <BondPulsePanel items={bondPulses} />
      </MarketSection>

      <MarketSection index="03 밸류에이션" title="밸류에이션" summary="ERP, 야데니 모델, 지수별 평가 밴드를 한곳에 모았습니다." muted={!dataReady}>
        <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <ErpHistoryPanel />
          <YardeniOverlayChartPanel />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {indices.map((index) => (
            <section
              key={index.id}
              className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-5"
            >
              <header className="flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[var(--c-ink-4)]">{index.nameEn}</p>
                  <h2 className="truncate text-lg font-black text-[var(--c-ink)]">{index.name}</h2>
                </div>
                <div className="text-right">
                  <p className="orbitron text-lg font-black tabular-nums text-[var(--c-ink)]">
                    {index.price === null ? "—" : index.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--c-ink-4)]">{index.date ?? "—"}</p>
                </div>
              </header>

              <div className="mt-3 grid gap-2">
                <ValuationRow label="Fwd P/E" band={index.pe} digits={1} />
                <ValuationRow label="P/B" band={index.pb} digits={2} />
                <div className="flex items-center justify-between rounded-[1rem] border border-[var(--c-line)] bg-white/70 px-3 py-2">
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">ROE</span>
                  <span className="orbitron text-lg font-black tabular-nums text-[var(--c-ink)]">
                    {index.roe === null ? "—" : formatPercent(index.roe * 100, 1)}
                  </span>
                </div>
              </div>
            </section>
          ))}
        </div>
      </MarketSection>

      <MarketSection index="04 구조·심리" title="구조·심리" summary="시장 내부 구조와 투자 심리의 압력을 함께 봅니다." muted={!dataReady}>
        <MarketStructurePanel trends={indexTrends} structures={structurePulses} />
        <StructureDetailEntry />
        <SentimentPulsePanel items={sentimentPulses} />
      </MarketSection>

      <MarketSection index="05 맥락" title="맥락" summary="연도별 수익률과 예정 이벤트로 현재 위치를 보정합니다." muted={!dataReady}>
        <AnnualReturnsChartPanel />
        <EventRiskPanel items={eventRisks} />
      </MarketSection>

      <p className="px-1 text-[11px] text-slate-400">
        역사 밴드 = 2010년 이후 주간 시계열의 최저·평균·최고 범위입니다. 백분위는 현재값의 역사적 위치이며, 높을수록 고평가 구간에 가깝습니다. 연초 이후 분해는 가격 변화가 EPS 개선에서 왔는지 평가배수 확장/축소에서 왔는지 보기 위한 보조 지표입니다.
      </p>
    </div>
  );
}
