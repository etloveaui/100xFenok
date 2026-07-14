"use client";

import { useEffect, useState, type ReactNode } from "react";
import TransitionLink from "@/components/TransitionLink";
import { DataStateBadge } from "@/components/DataStateNotice";
import MarketSectionNav from "@/components/market/MarketSectionNav";
import MarketThermometer from "@/components/market/MarketThermometer";
import { useMarketValuation } from "@/hooks/useMarketValuation";
import type {
  MarketBondPulse,
  MarketEventRisk,
  MarketIndexValuation,
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
import {
  formatDecimal,
  formatInteger,
  formatSignedDecimal,
  formatSignedPercent,
} from "@/lib/format";
import { formatPercent } from "@/lib/dashboard/formatters";
import { formatAsOf, latestAsOf } from "@/lib/market-valuation/freshness";
import { formatAsOf as formatDataAsOf, freshnessDataState, DATA_STATE_LABELS } from "@/lib/data-state";
import { ROUTES } from "@/lib/routes";

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Map a history percentile to a rich/cheap verdict. */
function valuationMeta(pct: number | null): { label: string; tone: string; dot: string } {
  if (pct === null) return { label: "—", tone: "text-[var(--c-ink-4)]", dot: "bg-[var(--c-line)]" };
  if (pct >= 80) return { label: "고평가", tone: "text-[var(--c-down)]", dot: "bg-[var(--c-down)]" };
  if (pct >= 60) return { label: "다소 높음", tone: "text-[var(--c-warn)]", dot: "bg-[var(--c-warn)]" };
  if (pct >= 40) return { label: "역사적 중립", tone: "text-[var(--c-ink-2)]", dot: "bg-[var(--c-line)]" };
  if (pct >= 20) return { label: "다소 낮음", tone: "text-[var(--c-info)]", dot: "bg-[var(--c-info)]" };
  return { label: "저평가", tone: "text-[var(--c-up)]", dot: "bg-[var(--c-up)]" };
}

function positionPct(value: number | null, min: number | null, max: number | null): number | null {
  if (value === null || min === null || max === null || max === min) return null;
  return Math.min(100, Math.max(0, Math.round(((value - min) / (max - min)) * 100)));
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

function EmptyPanel({ label }: { label: string }) {
  return <div className="px-[var(--panel-pad)] py-5 text-sm font-semibold text-[var(--c-ink-4)]">{label}</div>;
}

function AsOfBadge({ value, prefix = "기준" }: { value: string | null | undefined; prefix?: string }) {
  return <DataStateBadge state={freshnessDataState({ asOf: value })} prefix={prefix} />;
}

function PanelShell({
  title,
  subtitle,
  asOf,
  asOfPrefix,
  children,
}: {
  title: string;
  subtitle: string;
  asOf?: string | null;
  asOfPrefix?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[1.2rem] border border-[var(--c-line)] bg-[var(--c-panel)] shadow-[var(--sh-sm)]">
      <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 border-b border-[var(--c-line-2)] px-4 py-3">
        <h2 className="min-w-0 text-sm font-black tracking-tight text-[var(--c-ink)]">{title}</h2>
        {asOf ? (
          <span className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <span className="min-w-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--c-ink-4)]">{subtitle}</span>
            <AsOfBadge value={asOf} prefix={asOfPrefix} />
          </span>
        ) : (
          <span className="min-w-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--c-ink-4)]">{subtitle}</span>
        )}
      </header>
      {children}
    </section>
  );
}

function MarketSection({
  sectionKey,
  index,
  title,
  summary,
  children,
  muted = false,
}: {
  sectionKey: string;
  index: string;
  title: string;
  summary: string;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <section className="grid gap-3" data-market-section={sectionKey} data-loading={muted ? "true" : undefined}>
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[var(--c-brand)]">{index}</p>
          <h2 className="mt-1 text-xl font-black text-[var(--c-ink)]">{title}</h2>
        </div>
        <p className="max-w-xl text-sm font-semibold leading-6 text-[var(--c-ink-3)]">{summary}</p>
      </header>
      {children}
    </section>
  );
}

function StructureDetailEntry() {
  return (
    <TransitionLink
      href={ROUTES.marketStructure}
      className="group flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-[1.2rem] border border-[var(--c-line)] bg-[var(--c-panel)] px-4 py-3 shadow-[var(--sh-sm)] transition hover:border-brand-interactive hover:shadow-[var(--sh-sm)]"
    >
      <span className="min-w-0">
        <span className="block text-[11px] font-black uppercase tracking-[0.12em] text-[var(--c-brand)]">시장 구조 상세</span>
        <span className="mt-1 block text-base font-black text-[var(--c-ink)]">시장 구조 자세히 보기</span>
        <span className="mt-1 block text-xs font-semibold leading-5 text-[var(--c-ink-3)]">집중도, 벤치마크 매트릭스, 유동성, 심리 하위 지표를 더 크게 확인합니다.</span>
      </span>
      <span className="shrink-0 rounded-full border border-[var(--c-brand)]/30 bg-[var(--c-panel)] px-3 py-2 text-xs font-black text-[var(--c-brand)] transition group-hover:bg-brand-interactive group-hover:text-white">
        열기
      </span>
    </TransitionLink>
  );
}

interface MarketStructureIndexDoc {
  generated_at?: string;
  concentration?: Array<{ id: string; label: string; top3Weight?: number | null; top10Weight?: number | null }>;
  benchmarkMatrix?: {
    generated?: string | null;
    sourceAsOf?: string | null;
    sourceAsOfReason?: string | null;
    rows?: BenchmarkMatrixRow[];
  };
  creditRatings?: { sourceDate?: string | null; tableCount?: number; tables?: Array<{ id: string; rows?: number; medianSpread?: number | null }> };
}

interface BenchmarkMatrixRow {
  id: string;
  label: string;
  sourceAsOf?: string | null;
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

interface RimIndexEntry {
  public_status?: string;
  blockers?: Array<{ code?: string; severity?: string }>;
  observed?: {
    price?: {
      as_of?: string | null;
    } | null;
  } | null;
}

interface RimInputsDoc {
  generated_at?: string;
  indices?: Record<string, RimIndexEntry>;
}

let rimInputsCache: RimInputsDoc | null = null;
let rimInputsPending: Promise<RimInputsDoc | null> | null = null;

function loadRimInputs(): Promise<RimInputsDoc | null> {
  if (rimInputsCache) return Promise.resolve(rimInputsCache);
  if (rimInputsPending) return rimInputsPending;
  rimInputsPending = fetch("/data/computed/rim-index/inputs.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((doc) => {
      rimInputsCache = doc;
      return doc;
    })
    .catch(() => {
      rimInputsPending = null;
      return null;
    });
  return rimInputsPending;
}

// §H rule 2: no raw index ids leak to users; missing lookup renders an honest generic label.
const RIM_INDEX_LABELS_KO: Record<string, string> = {
  SPX: "S&P 500",
  NDX: "나스닥 100",
  KOSPI: "코스피",
  SOX: "필라델피아 반도체",
  CCMP: "나스닥 종합",
};

// No public fair-value card exists anywhere: the payload is globally
// output_scope=inputs_only_no_fair_value with policy.no_public_single_target=true
// (public/data/computed/rim-index/inputs.json). Tiers describe input readiness only.
type RimReadinessTier = "input_ready" | "input_only" | "pending";

interface RimReadinessMeta {
  rank: number;
  badge: string;
  tone: MarketTone;
  detail: (blockerCount: number) => string;
}

const RIM_READINESS_META: Record<RimReadinessTier, RimReadinessMeta> = {
  input_ready: {
    rank: 0,
    badge: "입력 준비",
    tone: "amber",
    detail: () => "입력 데이터와 예측 그리드가 준비되었습니다. 공개 적정가 카드는 제공하지 않습니다.",
  },
  input_only: {
    rank: 1,
    badge: "입력 전용",
    tone: "slate",
    detail: (blockerCount) =>
      blockerCount > 0
        ? `공개 적정가 카드 제공을 막는 항목이 ${blockerCount}건 남아 입력 데이터만 제공합니다.`
        : "공개 적정가 카드는 제공하지 않고 입력 데이터만 제공합니다.",
  },
  pending: {
    rank: 2,
    // Per-index state label sourced from data-state.ts (§H-5): "확인 중".
    badge: DATA_STATE_LABELS.pending,
    tone: "slate",
    detail: () => "준비 상태를 확인하고 있습니다.",
  },
};

function classifyRimReadiness(publicStatus: string | undefined, blockerCount: number): RimReadinessTier {
  if (publicStatus === "blocked_or_input_only" || blockerCount > 0) return "input_only";
  if (publicStatus === "ready_inputs_and_forecast_grid") return "input_ready";
  return "pending";
}

function rimPriceSourceClock(indices: RimInputsDoc["indices"]): { asOf: string | null; reason: string | null } {
  const required = ["KOSPI", "SOX"] as const;
  const dates = required.map((id) => {
    const value = indices?.[id]?.observed?.price?.as_of;
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
  });
  if (dates.some((value) => value === null)) {
    return { asOf: null, reason: "KOSPI·SOX 관측 가격 기준일 미확인" };
  }
  return { asOf: [...dates].sort()[0] ?? null, reason: null };
}

function RimReadinessPanel() {
  const [doc, setDoc] = useState<RimInputsDoc | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadRimInputs().then((next) => {
      if (cancelled) return;
      setDoc(next);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = Object.entries(doc?.indices ?? {})
    .map(([id, entry]) => {
      const safe = entry ?? {};
      const blockerCount = Array.isArray(safe.blockers) ? safe.blockers.length : 0;
      const meta = RIM_READINESS_META[classifyRimReadiness(safe.public_status, blockerCount)];
      return {
        id,
        name: RIM_INDEX_LABELS_KO[id] ?? "지수",
        meta,
        detail: meta.detail(blockerCount),
      };
    })
    .sort((a, b) => a.meta.rank - b.meta.rank || a.id.localeCompare(b.id));

  // Fallback copy comes only from DATA_STATE_LABELS (§H-5): loading vs. unavailable are distinct.
  const fallbackLabel = !loaded ? DATA_STATE_LABELS.pending : rows.length === 0 ? DATA_STATE_LABELS.unavailable : null;
  const sourceClock = rimPriceSourceClock(doc?.indices);

  return (
    <PanelShell
      title="잔여이익모델(RIM) 지수 준비 상태"
      subtitle={sourceClock.reason ?? "지수별 입력 준비 현황"}
      asOf={sourceClock.asOf}
    >
      {fallbackLabel ? (
        <EmptyPanel label={fallbackLabel} />
      ) : (
        <div className="grid min-w-0 sm:grid-cols-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="min-w-0 border-t border-[var(--c-line-2)] px-[var(--panel-pad)] py-3 first:border-t-0 sm:[&:nth-child(-n+2)]:border-t-0"
            >
              <div className="flex min-w-0 items-start justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-black text-[var(--c-ink)]">{row.name}</p>
                <span className={cx("shrink-0 rounded-full border px-2 py-1 text-[10px] font-black", toneClass(row.meta.tone))}>
                  {row.meta.badge}
                </span>
              </div>
              <p className="mt-2 min-w-0 break-words text-[11px] font-semibold leading-5 text-[var(--c-ink-3)]">{row.detail}</p>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function MacroPulsePanel({ items, fallbackAsOf }: { items: MarketMacroPulse[]; fallbackAsOf?: string | null }) {
  const panelAsOf = latestAsOf(items.flatMap((item) => [item.releaseDate, item.period])) ?? fallbackAsOf ?? null;
  return (
    <PanelShell title="경기 펄스" subtitle="PMI · ISM · OECD CLI" asOf={panelAsOf}>
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
                <span className="orbitron min-w-0 text-2xl font-black tabular-nums text-[var(--c-ink)]">{formatDecimal(item.value, { digits: 1 })}</span>
                <span className="pb-1 text-[10px] font-bold uppercase text-[var(--c-ink-4)]">{item.unit}</span>
              </div>
              <p className="mt-1 text-[11px] font-semibold text-[var(--c-ink-4)]">{formatAsOf(item.releaseDate ?? item.period) ?? "—"}</p>
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
                  <p className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">{item.label}</p>
                  <p className="mt-1 min-w-0 break-words text-xs font-semibold leading-5 text-[var(--c-ink-3)]">{item.detail}</p>
                </div>
                <span className={cx("shrink-0 rounded-full border px-2 py-1 text-[10px] font-black", toneClass(item.tone))}>{item.statusLabel}</span>
              </div>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--c-ink-4)]">{item.asOf ?? "—"}</p>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function BondPulsePanel({ items, fallbackAsOf }: { items: MarketBondPulse[]; fallbackAsOf?: string | null }) {
  const panelAsOf = latestAsOf(items.map((item) => item.date)) ?? fallbackAsOf ?? null;
  return (
    <PanelShell title="채권 시그널" subtitle="HY · curve · BEI" asOf={panelAsOf}>
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
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--c-ink-2)]">{formatAsOf(item.date) ?? "—"}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function SentimentPulsePanel({ items, fallbackAsOf }: { items: MarketSentimentPulse[]; fallbackAsOf?: string | null }) {
  const panelAsOf = latestAsOf(items.map((item) => item.date)) ?? fallbackAsOf ?? null;
  return (
    <PanelShell title="센티먼트" subtitle="VIX · AAII · MOVE" asOf={panelAsOf}>
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
              <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--c-ink-2)]">{formatAsOf(item.date) ?? "—"}</p>
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
                      <p className="orbitron mt-1 text-2xl font-black tabular-nums text-slate-950">{formatInteger(trend.latestValue)}</p>
                    </div>
                    <span className="shrink-0 text-right text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--c-ink-2)]">{trend.latestDate ?? "—"}</span>
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
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--c-ink-2)]">{item.updated ?? "—"}</p>
                </div>
              ))}
            </div>
          ) : null}
          {doc ? (
            <div className="grid min-w-0 border-t border-slate-100 lg:grid-cols-4">
              {concentration.map((item) => (
                <div key={item.id} className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 lg:border-t-0">
                  <p className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{item.label} 집중도</p>
                  <p className="orbitron mt-2 text-2xl font-black tabular-nums text-slate-950">{formatDecimal(item.top10Weight ?? null, { digits: 1 })}%</p>
                  <p className="mt-1 text-[11px] font-semibold text-slate-500">상위 3개 {formatDecimal(item.top3Weight ?? null, { digits: 1 })}%</p>
                </div>
              ))}
              {credit ? (
                <div className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 lg:border-t-0">
                  <p className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">신용 스프레드</p>
                  <p className="orbitron mt-2 text-2xl font-black tabular-nums text-slate-950">{formatSignedPercent(credit.medianSpread ?? null, { digits: 2 })}</p>
                  <p className="mt-1 text-[11px] font-semibold text-slate-500">{doc.creditRatings?.sourceDate ?? "—"} · 표 {doc.creditRatings?.tableCount ?? 0}개</p>
                </div>
              ) : null}
              {benchmarkRows.length > 0 ? (
                <div className="min-w-0 border-t border-slate-100 px-4 py-3 first:border-t-0 lg:border-t-0">
                  <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                    <p className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">이익과 멀티플</p>
                    <span
                      className="text-right text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--c-ink-2)]"
                      title={doc.benchmarkMatrix?.sourceAsOf ? undefined : doc.benchmarkMatrix?.sourceAsOfReason ?? undefined}
                    >
                      {doc.benchmarkMatrix?.sourceAsOf ? `기준 ${doc.benchmarkMatrix.sourceAsOf}` : "기준일 미확인"}
                      {doc.benchmarkMatrix?.generated ? ` · 생성 ${doc.benchmarkMatrix.generated.slice(0, 10)}` : ""}
                    </span>
                  </div>
                  <div className="mt-2 grid min-w-0 gap-1">
                    {benchmarkRows.map((row) => (
                      <div key={row.id} className="flex min-w-0 items-center justify-between gap-2 border-t border-slate-100 py-1 first:border-t-0">
                        <span className="min-w-0 truncate text-[11px] font-black text-slate-700">{row.label}</span>
                        <span className="shrink-0 text-[10px] font-black tabular-nums text-slate-500">
                          YTD {formatSignedPercent(row.price?.ytd ?? null, { digits: 1 })} · EPS {formatSignedPercent(row.eps?.ytd ?? null, { digits: 1 })}
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

function EventRiskPanel({ items, fallbackAsOf }: { items: MarketEventRisk[]; fallbackAsOf?: string | null }) {
  const nextEvent = items[0];
  const nextEventAsOf = nextEvent
    ? `${nextEvent.dateKst}${nextEvent.timeKst && nextEvent.timeKst !== "—" ? ` ${nextEvent.timeKst}` : ""}`
    : fallbackAsOf ?? null;
  return (
    <PanelShell title="이벤트 리스크" subtitle="미국 경제일정" asOf={nextEventAsOf} asOfPrefix="다음">
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
                    <p className="text-[10px] font-bold tabular-nums text-[var(--c-ink-2)]">{item.timeKst}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className={cx("rounded-full border px-2 py-0.5 text-[10px] font-black", toneClass(tone))}>{item.importance}</span>
                      {item.isToday ? (
                        <span className="rounded-full border border-[var(--c-down)] bg-[var(--c-down-soft)] px-2 py-0.5 text-[10px] font-black text-[var(--c-down)]">TODAY</span>
                      ) : item.daysUntil !== null ? (
                        <span className="rounded-full border border-[var(--c-line)] bg-[var(--c-surface-2)] px-2 py-0.5 text-[10px] font-black text-[var(--c-ink-3)]">D-{item.daysUntil}</span>
                      ) : null}
                      <span className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--c-ink-2)]">{item.category}</span>
                    </div>
                    <p className="mt-1 min-w-0 break-words text-sm font-bold leading-5 text-slate-800">{item.titleKo}</p>
                    {item.titleEn ? <p className="mt-1 min-w-0 break-words text-[11px] font-semibold leading-5 text-[var(--c-ink-2)]">{item.titleEn}</p> : null}
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
        {formatSignedPercent(value)}
      </p>
    </div>
  );
}

function ValuationRow({ label, metric, band, digits }: { label: string; metric: string; band: ValuationBand; digits: number }) {
  const meta = valuationMeta(band.percentile);
  const curPos = positionPct(band.current, band.min, band.max);
  const avgPos = positionPct(band.avg, band.min, band.max);
  return (
    <div className="rounded-[1rem] border border-[var(--c-line)] bg-white/70 px-3 py-3" data-market-valuation-row={metric}>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">{label}</span>
        <span className="orbitron text-xl font-black text-[var(--c-ink)]">{formatDecimal(band.current, { digits })}</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] font-bold">
        <span className={cx("inline-flex items-center gap-1", meta.tone)} data-market-valuation-verdict>
          <span className={cx("h-1.5 w-1.5 rounded-full", meta.dot)} />
          {meta.label}
          {band.percentile !== null ? <span className="text-[var(--c-ink-4)]">· 역사 {band.percentile}%</span> : null}
        </span>
        <span className="tabular-nums text-[var(--c-ink-4)]">
          {formatDecimal(band.min, { digits })} ~ {formatDecimal(band.max, { digits })}
        </span>
      </div>
      {/* 16-year band gauge: min ── avg ── max, with current marker */}
      <div className="relative mt-2 h-2 rounded-full bg-gradient-to-r from-emerald-200 via-slate-200 to-rose-200" data-market-valuation-gauge>
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
      <div className="mt-1 flex justify-between text-[9px] font-bold uppercase tracking-wider text-[var(--c-ink-2)]">
        <span>저평가</span>
        <span>avg {formatDecimal(band.avg, { digits })}</span>
        <span>고평가</span>
      </div>
    </div>
  );
}

function averagePremiumPct(band: ValuationBand): number | null {
  if (band.current === null || band.avg === null || band.avg === 0) return null;
  return (band.current / band.avg - 1) * 100;
}

function buildVerdict(index: MarketIndexValuation | undefined): { headline: string; support: string; metaLabel: string; premium: number | null } {
  if (!index) {
    return {
      headline: "S&P 500 밸류에이션 데이터를 불러오는 중입니다.",
      support: "데이터가 준비되면 16년 밴드 기준의 현재 위치와 이익/멀티플 기여도를 함께 표시합니다.",
      metaLabel: "대기",
      premium: null,
    };
  }

  const percentile = index.pe.percentile;
  const meta = valuationMeta(percentile);
  const premium = averagePremiumPct(index.pe);
  const percentileText = percentile === null ? "위치 확인 중" : `16년 역사 ${percentile}%ile`;
  const driverText = index.driver?.detail ?? "이익과 멀티플 기여도는 보조 지표로 확인 중입니다.";
  const premiumText = premium === null ? "평균 대비 거리는 계산 중" : `평균 대비 ${formatSignedDecimal(premium)}%`;

  return {
    headline: `${index.name} Fwd P/E는 ${percentileText} - ${meta.label} 구간입니다.`,
    support: `${premiumText}. ${driverText}`,
    metaLabel: meta.label,
    premium,
  };
}

function HeroBandGauge({ index }: { index: MarketIndexValuation | undefined }) {
  if (!index) return <EmptyPanel label="S&P 500 밴드 데이터 없음" />;

  const premium = averagePremiumPct(index.pe);
  const erpText = index.driver?.label ?? "이익/멀티플 확인";

  return (
    <div className="cpw5-mv-hero-visual">
      <ValuationRow label="S&P 500 Fwd P/E" metric="sp500-pe" band={index.pe} digits={1} />
      <div className="cpw5-mv-hero-metrics">
        <span>
          평균 대비 <strong>{premium === null ? "—" : `${formatSignedDecimal(premium)}%`}</strong>
        </span>
        <span>
          ROE <strong>{index.roe === null ? "—" : formatPercent(index.roe * 100, 1)}</strong>
        </span>
        <span>
          현재가 <strong>{index.price === null ? "—" : formatInteger(index.price)}</strong>
        </span>
        <span>
          드라이버 <strong>{erpText}</strong>
        </span>
      </div>
    </div>
  );
}

function MarketHero({
  sp500,
  sourceDate,
  erpValue,
}: {
  sp500: MarketIndexValuation | undefined;
  sourceDate: string | null;
  erpValue: number | null;
}) {
  const verdict = buildVerdict(sp500);
  const erpLabel = erpValue === null ? "ERP 확인 중" : `미국 ERP ${formatPercent(erpValue * 100, 1)}`;

  return (
    <section className="cpw5-mv-hero" data-market-valuation-hero>
      <div className="cpw5-mv-hero-copy">
        <div className="cpw5-mv-eyebrow-row">
          <p className="cpw5-mv-eyebrow">오늘의 밸류에이션 판정</p>
          {sourceDate ? <DataStateBadge state={freshnessDataState({ asOf: sourceDate })} prefix="기준" /> : null}
        </div>
        <h2>{verdict.headline}</h2>
        <p>{verdict.support}</p>
        <div className="cpw5-mv-chip-row" aria-label="핵심 보조 지표">
          <span>{verdict.metaLabel}</span>
          <span>{erpLabel}</span>
          <span>Yardeni 차트 아래 확인</span>
        </div>
        <div className="cpw5-mv-cta-row" aria-label="연결 화면">
          <TransitionLink href={ROUTES.marketStructure}>구조 상세</TransitionLink>
          <TransitionLink href={ROUTES.macroChartQuery("macro=activity&preset=activity&range=MAX")}>경기 차트</TransitionLink>
          <TransitionLink href={`${ROUTES.screener}?macro=activity&preset=estimate&action=value_momentum`}>추정치 스크리너</TransitionLink>
        </div>
      </div>
      <HeroBandGauge index={sp500} />
    </section>
  );
}

// §H rule 2: vendor payload labels (typos like "Ressell 2000") must not leak; route through a label table.
const SECONDARY_INDEX_LABELS_KO: Record<string, string> = {
  nasdaq100: "나스닥 100",
  nasdaq_composite: "나스닥 종합",
  russell2000: "러셀 2000",
};

function SecondaryIndexTable({ indices }: { indices: MarketIndexValuation[] }) {
  const secondary = indices.filter((index) => index.id !== "sp500");

  if (secondary.length === 0) {
    return <EmptyPanel label="보조 지수 데이터 없음" />;
  }

  return (
    <section className="cpw5-mv-secondary" data-market-valuation-secondary>
      <header>
        <p className="cpw5-mv-eyebrow">보조 지수 비교</p>
        <h2>나머지 지수는 한 화면에서 압축 비교합니다.</h2>
      </header>
      <div className="cpw5-mv-index-table" role="table" aria-label="보조 지수 밸류에이션">
        <div className="cpw5-mv-index-row cpw5-mv-index-head" role="row">
          <span role="columnheader">지수</span>
          <span role="columnheader">Fwd P/E</span>
          <span role="columnheader">P/B</span>
          <span role="columnheader">ROE</span>
          <span role="columnheader">구간</span>
        </div>
        {secondary.map((index) => {
          const meta = valuationMeta(index.pe.percentile);
          return (
            <div key={index.id} className="cpw5-mv-index-row" role="row">
              <span role="cell">
                <strong>{SECONDARY_INDEX_LABELS_KO[index.id] ?? "지수"}</strong>
                <small>{index.nameEn}</small>
              </span>
              <span role="cell" className="tabular-nums">
                {formatDecimal(index.pe.current, { digits: 1 })}
              </span>
              <span role="cell" className="tabular-nums">
                {formatDecimal(index.pb.current, { digits: 2 })}
              </span>
              <span role="cell" className="tabular-nums">
                {index.roe === null ? "—" : formatPercent(index.roe * 100, 1)}
              </span>
              <span role="cell">
                <em>{meta.label}</em>
                {index.pe.percentile !== null ? <small>{index.pe.percentile}%ile</small> : null}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ContextAccordion({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="cpw5-mv-accordion">
      <summary>
        <span>
          <strong>{title}</strong>
          <small>{summary}</small>
        </span>
      </summary>
      <div className="cpw5-mv-accordion-body">{children}</div>
    </details>
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
    damodaranUsErp,
    dataReady,
    failed,
    sourceDate,
  } = useMarketValuation();
  const sp500 = indices.find((index) => index.id === "sp500") ?? indices[0];
  const headerVerdict = buildVerdict(sp500);

  return (
    <div className="data-shell-page canvas-plus cpw5-market-valuation" data-market-valuation-surface>
      <section className="panel data-shell-header">
        <div className="data-shell-head-main">
          <p className="data-shell-kicker">시장 밸류에이션</p>
          <h1 className="data-shell-title">시장 밸류에이션</h1>
          <p className="data-shell-desc">
            <strong>{headerVerdict.headline}</strong> {headerVerdict.support}
          </p>
        </div>
        <div className="data-shell-head-actions">
          {sourceDate ? (
            <span className="data-shell-pill ok">
              <span />
              {formatDataAsOf(sourceDate) ?? sourceDate}
            </span>
          ) : null}
          <MarketSectionNav active="valuation" />
        </div>
      </section>

      {failed ? (
        <div className="rounded-[1.2rem] border border-[var(--c-line)] bg-[var(--c-surface-2)] px-4 py-3 text-sm font-semibold text-[var(--c-ink)]">
          지수 밸류에이션 데이터를 불러오지 못했습니다.
        </div>
      ) : null}

      <MarketHero sp500={sp500} sourceDate={sourceDate} erpValue={damodaranUsErp} />

      <SecondaryIndexTable indices={indices} />

      <RimReadinessPanel />

      <MarketSection sectionKey="valuation" index="01 근거" title="이익과 멀티플이 만든 현재 위치" summary="S&P 500 판정의 배경을 시장 체온, ERP, Yardeni 모델로 확인합니다." muted={!dataReady}>
        <MarketThermometer />
        <SignalPulsePanel items={signalPulses} />
        <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]" data-market-valuation-chart-grid>
          <ErpHistoryPanel />
          <YardeniOverlayChartPanel />
        </div>
      </MarketSection>

      <div className="cpw5-mv-context-stack" data-market-valuation-context>
        <ContextAccordion title="매크로" summary="PMI, 경기 펄스, 채권 신호는 판정 이후 확인합니다.">
          <PmiActivityChartPanel />
          <MacroPulsePanel items={macroPulses} fallbackAsOf={sourceDate} />
          <BondPulsePanel items={bondPulses} fallbackAsOf={sourceDate} />
        </ContextAccordion>
        <ContextAccordion title="구조·심리" summary="시장 내부 구조와 센티먼트 압력을 접어서 봅니다.">
          <MarketStructurePanel trends={indexTrends} structures={structurePulses} />
          <StructureDetailEntry />
          <SentimentPulsePanel items={sentimentPulses} fallbackAsOf={sourceDate} />
        </ContextAccordion>
        <ContextAccordion title="맥락" summary="연도별 수익률과 예정 이벤트로 현재 위치를 보정합니다.">
          <AnnualReturnsChartPanel />
          <EventRiskPanel items={eventRisks} fallbackAsOf={sourceDate} />
        </ContextAccordion>
      </div>

      <p className="px-1 text-[11px] text-[var(--c-ink-2)]">
        역사 밴드 = 2010년 이후 주간 시계열의 최저·평균·최고 범위입니다. 백분위는 현재값의 역사적 위치이며, 높을수록 고평가 구간에 가깝습니다. 연초 이후 분해는 가격 변화가 EPS 개선에서 왔는지 평가배수 확장/축소에서 왔는지 보기 위한 보조 지표입니다.
      </p>
    </div>
  );
}
