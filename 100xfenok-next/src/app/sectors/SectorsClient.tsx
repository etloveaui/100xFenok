"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import IndustryMapPanel from "./IndustryMapPanel";
import SmartMoneyPanel from "./SmartMoneyPanel";
import MarketSectionNav from "@/components/market/MarketSectionNav";
import { useSectorData } from "@/hooks/useSectorData";
import { MOMENTUM_WINDOWS, type MomentumWindow, type SectorRow, type SectorSourceMeta, type SectorValuationBand } from "@/lib/sectors/types";
import { formatPercent, formatSignedPercentDecimal, getMarketStateMeta } from "@/lib/dashboard/formatters";
import { useMarketChartTheme, type MarketChartTheme } from "@/lib/market-valuation/charts/chartTheme";

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function pct(value: number | null | undefined, digits = 1): string {
  return typeof value !== "number" || !Number.isFinite(value) ? "—" : formatSignedPercentDecimal(value, digits);
}

function pp(value: number | null | undefined, digits = 1): string {
  const formatted = pct(value, digits);
  return formatted === "—" ? formatted : formatted.replace("%", "%p");
}

type MobileView = "heatmap" | "etf" | "valuation" | "guru";

const MOBILE_VIEWS: ReadonlyArray<{ key: MobileView; label: string }> = [
  { key: "heatmap", label: "흐름" },
  { key: "etf", label: "ETF" },
  { key: "valuation", label: "가치" },
  { key: "guru", label: "기관 보유" },
];

function dateOnly(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

function metricTone(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "text-[var(--c-ink-3)]";
  return value >= 0 ? "text-[var(--c-up)]" : "text-[var(--c-down)]";
}

function mobilePanelClass(active: boolean, display = "block"): string {
  if (display === "grid") return active ? "grid" : "hidden md:grid";
  return active ? "block" : "hidden md:block";
}

/** Continuous green/red heat scale over a momentum fraction. */
function heatStyle(value: number | null | undefined, theme: MarketChartTheme): CSSProperties {
  return theme.heatStyle(value);
}

function SectionCard({
  kicker,
  title,
  children,
  className,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-sm sm:p-6",
        className,
      )}
    >
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[var(--c-ink-3)]">{kicker}</p>
      <h2 className="mt-1 text-lg font-black tracking-tight text-[var(--c-ink)] sm:text-xl">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function LoadingSkeleton() {
  return (
    <div className="rounded-[1.2rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-sm">
      <div className="h-3 w-32 animate-pulse rounded-full bg-[var(--c-surface-2)]" />
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            className="h-10 animate-pulse rounded-lg bg-[var(--c-surface-2)]"
            style={{ animationDelay: `${index * 70}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

const valuationHelp = {
  pe: "Fwd P/E: 향후 12개월 예상 이익 대비 주가 배수",
  pb: "P/B: 장부가 대비 주가 배수",
  roe: "ROE: 자기자본이익률",
} as const;

function valuationTone(percentile: number | null | undefined): { label: string; className: string } {
  if (typeof percentile !== "number" || !Number.isFinite(percentile)) {
    return { label: "범위 없음", className: "bg-[var(--c-surface-2)] text-[var(--c-ink-3)]" };
  }
  if (percentile <= 0.25) return { label: "저평가권", className: "bg-[var(--c-up-soft)] text-[var(--c-up)]" };
  if (percentile >= 0.75) return { label: "고평가권", className: "bg-[var(--c-down-soft)] text-[var(--c-down)]" };
  return { label: "평균권", className: "bg-[var(--c-surface-2)] text-[var(--c-ink-2)]" };
}

function PeBandGauge({ value, band }: { value: number | null; band: SectorValuationBand | null }) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return <span className="orbitron text-sm font-bold text-[var(--c-ink-3)]">—</span>;
  }
  if (!band) {
    return <span className="orbitron text-sm font-bold text-[var(--c-ink)]">{value.toFixed(1)}</span>;
  }
  const span = band.max - band.min;
  const position = span > 0 ? Math.min(100, Math.max(0, ((value - band.min) / span) * 100)) : 50;
  const percentile = Math.round(band.percentile * 100);
  const tone = valuationTone(band.percentile);
  return (
    <div
      className="ml-auto w-full max-w-[190px]"
      title={`역사적 Fwd P/E 백분위 ${percentile}% · ${tone.label} · 범위 ${band.min.toFixed(1)}~${band.max.toFixed(1)}`}
      aria-label={`역사적 Fwd P/E 백분위 ${percentile}% · ${tone.label} · 범위 ${band.min.toFixed(1)}~${band.max.toFixed(1)}`}
    >
      <div className="mb-1 flex items-center justify-end gap-2">
        <span className="orbitron text-sm font-black tabular-nums text-[var(--c-ink)]">{value.toFixed(1)}</span>
        <span className={cx("rounded-full px-2 py-0.5 text-[10px] font-black", tone.className)}>{tone.label}</span>
      </div>
      <div className="relative h-2 rounded-full bg-gradient-to-r from-[var(--c-up-soft)] via-[var(--c-line-2)] to-[var(--c-down-soft)]">
        <span
          className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--c-brand)] shadow"
          style={{ left: `${position}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[9px] font-bold text-[var(--c-ink-3)]">
        <span>{band.min.toFixed(1)}</span>
        <span>{percentile}%</span>
        <span>{band.max.toFixed(1)}</span>
      </div>
    </div>
  );
}

function failedSourceLabel(source: string): string | null {
  if (source === "benchmarks") return "모멘텀";
  if (source === "etfs") return "ETF";
  if (source === "us_sectors") return "가치";
  if (source === "portfolio_views" || source === "by_sector") return "기관 보유";
  if (source === "ticker") return "실시간 가격";
  return null;
}

function SourceLine({ sourceMeta, failedSources = [] }: { sourceMeta: SectorSourceMeta; failedSources?: string[] }) {
  const parts = [
    sourceMeta.benchmarksGenerated ? `모멘텀 ${dateOnly(sourceMeta.benchmarksGenerated)}` : null,
    sourceMeta.valuationLatestDate ? `가치 ${sourceMeta.valuationLatestDate}` : null,
    sourceMeta.smartMoneyQuarter ? `기관 보유 ${sourceMeta.smartMoneyQuarter}` : null,
  ].filter(Boolean);
  const missing = Array.from(new Set(failedSources.map(failedSourceLabel).filter((label): label is string => Boolean(label))));
  if (parts.length > 0) {
    return <>{missing.length > 0 ? `${parts.join(" · ")} · 확인 불가 ${missing.join("/")}` : parts.join(" · ")}</>;
  }
  return <>{missing.length > 0 ? `데이터 없음: ${missing.join(" · ")}` : "기준일 확인 중"}</>;
}

function valuationSourceLine(sourceMeta: SectorSourceMeta): string {
  return `가치 기준 ${sourceMeta.valuationLatestDate ?? sourceMeta.valuationVersion ?? "확인 중"}`;
}

function MobileViewSwitch({
  value,
  onChange,
}: {
  value: MobileView;
  onChange: (next: MobileView) => void;
}) {
  return (
    <div className="md:hidden">
      <div className="grid grid-cols-4 gap-1 rounded-2xl border border-[var(--c-line)] bg-[var(--c-panel)] p-1 shadow-sm">
        {MOBILE_VIEWS.map((view) => {
          const active = view.key === value;
          return (
            <button
              key={view.key}
              type="button"
              onClick={() => onChange(view.key)}
              aria-pressed={active}
              className={cx(
                "min-h-10 rounded-xl px-2 text-[11px] font-black transition",
                active ? "bg-[var(--c-brand)] text-white" : "text-[var(--c-ink-3)] hover:bg-[var(--c-surface-2)]",
              )}
            >
              {view.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SectorPulse({
  leader,
  laggard,
  beatCount,
  totalCount,
  activeWindowLabel,
  activeWindowKey,
  cheapest,
  richest,
  smartLeader,
  smartDeltaLeader,
  sourceMeta,
  failedSources,
}: {
  leader: SectorRow | undefined;
  laggard: SectorRow | undefined;
  beatCount: number | null;
  totalCount: number;
  activeWindowLabel: string;
  activeWindowKey: MomentumWindow;
  cheapest: SectorRow | null;
  richest: SectorRow | null;
  smartLeader: SectorRow | null;
  smartDeltaLeader: SectorRow | null;
  sourceMeta: SectorSourceMeta;
  failedSources: string[];
}) {
  const leaderValue = leader?.momentum ? leader.momentum[activeWindowKey] : null;
  const laggardValue = laggard?.momentum ? laggard.momentum[activeWindowKey] : null;
  return (
    <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-[1.25rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-3 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--c-ink-3)]">{activeWindowLabel} 주도</p>
        <p className="mt-1 text-sm font-black text-[var(--c-ink)]">
          {leader ? `${leader.name} ${pct(leaderValue, 1)}` : "데이터 없음"}
        </p>
        <p className="mt-0.5 text-[11px] font-bold text-[var(--c-ink-2)]">
          약세 {laggard ? `${laggard.name} ${pct(laggardValue, 1)}` : "—"}
        </p>
      </div>
      <div className="rounded-[1.25rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-3 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--c-ink-3)]">시장 대비</p>
        <p className="mt-1 text-sm font-black text-[var(--c-ink)]">
          {beatCount === null ? "S&P 기준 없음" : `${beatCount}/${totalCount}개 섹터가 S&P 상회`}
        </p>
        <p className="mt-0.5 text-[11px] font-bold text-[var(--c-ink-2)]"><SourceLine sourceMeta={sourceMeta} failedSources={failedSources} /></p>
      </div>
      <div className="rounded-[1.25rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-3 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--c-ink-3)]">가치 위치</p>
        <p className="mt-1 text-sm font-black text-[var(--c-ink)]">
          저평가 {cheapest ? cheapest.name : "—"} · 고평가 {richest ? richest.name : "—"}
        </p>
        <p className="mt-0.5 text-[11px] font-bold text-[var(--c-ink-2)]">
          {valuationSourceLine(sourceMeta)}
        </p>
      </div>
      <div className="rounded-[1.25rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-3 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--c-ink-3)]">기관 보유</p>
        <p className="mt-1 text-sm font-black text-[var(--c-ink)]">
          {smartLeader?.smartMoney ? `${smartLeader.name} ${pct(smartLeader.smartMoney.weight, 1)}` : "기관 보유 없음"}
        </p>
        <p className="mt-0.5 text-[11px] font-bold text-[var(--c-ink-2)]">
          증가 {smartDeltaLeader?.smartMoney ? `${smartDeltaLeader.name} ${pp(smartDeltaLeader.smartMoney.delta4q, 1)}` : "—"}
        </p>
      </div>
    </section>
  );
}

function SectorMomentumCard({
  row,
  windowKey,
  benchmarkValue,
}: {
  row: SectorRow;
  windowKey: MomentumWindow;
  benchmarkValue: number | null;
}) {
  const value = row.momentum[windowKey];
  const relative = typeof value === "number" && typeof benchmarkValue === "number" ? value - benchmarkValue : null;
  const tone = valuationTone(row.valuation?.peBand?.percentile);
  return (
    <article className="rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 py-2">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-[var(--c-ink)]">{row.name}</p>
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">{row.etf}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cx("orbitron text-base font-black tabular-nums", metricTone(value))}>{pct(value, 1)}</p>
          <p className={cx("orbitron text-[10px] font-bold tabular-nums", metricTone(relative))}>S&P {pp(relative, 1)}</p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] font-bold text-[var(--c-ink-2)]">
        <span className="rounded-lg bg-white px-2 py-1">당일 {pct(row.dayChange, 2)}</span>
        <span className="rounded-lg bg-white px-2 py-1">{tone.label}</span>
        <span className="rounded-lg bg-white px-2 py-1">기관 {pct(row.smartMoney?.weight, 1)}</span>
      </div>
    </article>
  );
}

function EtfMobileCard({ row }: { row: SectorRow }) {
  const etf = row.etfInfo;
  return (
    <article className="rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 py-2">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-[var(--c-ink)]">{row.etf}</p>
          <p className="truncate text-[11px] font-bold text-[var(--c-ink-2)]">{row.name}</p>
        </div>
        <p className={cx("orbitron shrink-0 text-base font-black tabular-nums", metricTone(etf?.returns["1m"]))}>
          {pct(etf?.returns["1m"], 1)}
        </p>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] font-bold text-[var(--c-ink-2)]">
        <span className="rounded-lg bg-white px-2 py-1">YTD {pct(etf?.returns.ytd, 1)}</span>
        <span className="rounded-lg bg-white px-2 py-1">1Y {pct(etf?.returns["1y"], 1)}</span>
        <span className="rounded-lg bg-white px-2 py-1">3Y {pct(etf?.cagr["3y"], 1)}</span>
        <span className="rounded-lg bg-white px-2 py-1">Beta {typeof etf?.beta === "number" ? etf.beta.toFixed(2) : "—"}</span>
        <span className="rounded-lg bg-white px-2 py-1">보수 {typeof etf?.expenseRatio === "number" ? formatPercent(etf.expenseRatio * 100, 2) : "—"}</span>
        <span className="rounded-lg bg-white px-2 py-1">{etf ? "추적 중" : "ETF 없음"}</span>
      </div>
    </article>
  );
}

function ValuationMobileCard({ row }: { row: SectorRow }) {
  const value = row.valuation;
  const tone = valuationTone(value?.peBand?.percentile);
  return (
    <article className="rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 py-2">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-[var(--c-ink)]">{row.name}</p>
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">{row.etf}</p>
        </div>
        <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black", tone.className)}>{tone.label}</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] font-bold text-[var(--c-ink-2)]">
        <span className="rounded-lg bg-white px-2 py-1">Fwd P/E {typeof value?.pe === "number" ? value.pe.toFixed(1) : "—"}</span>
        <span className="rounded-lg bg-white px-2 py-1">P/B {typeof value?.pb === "number" ? value.pb.toFixed(2) : "—"}</span>
        <span className="rounded-lg bg-white px-2 py-1">ROE {typeof value?.roe === "number" ? formatPercent(value.roe * 100, 1) : "—"}</span>
      </div>
    </article>
  );
}

export default function SectorsClient() {
  const {
    rows,
    benchmarkMomentum,
    dataReady,
    benchmarksReady,
    etfsReady,
    valuationReady,
    failedSources,
    updatedAt,
    sourceMeta,
  } = useSectorData();
  const [sortWindow, setSortWindow] = useState<MomentumWindow>("1m");
  const [mobileView, setMobileView] = useState<MobileView>("heatmap");
  const chartTheme = useMarketChartTheme();

  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) => (b.momentum[sortWindow] ?? -Infinity) - (a.momentum[sortWindow] ?? -Infinity),
      ),
    [rows, sortWindow],
  );
  const leaders = sorted.slice(0, 3);
  const laggards = sorted.filter((row) => row.momentum[sortWindow] !== null).slice(-3).reverse();
  const etfRows = useMemo(() => rows.filter((row) => row.etfInfo), [rows]);
  const valuationRows = useMemo(() => rows.filter((row) => row.valuation), [rows]);
  const activeWindowLabel = MOMENTUM_WINDOWS.find((w) => w.key === sortWindow)?.label ?? sortWindow;

  const isMuted = !(benchmarksReady || etfsReady || valuationReady);
  const benchmarksFailed = failedSources.includes("benchmarks");
  const dateLabel = updatedAt ? updatedAt.slice(0, 10) : null;
  const activeBenchmark = benchmarkMomentum?.[sortWindow] ?? null;
  const marketThreeMonth = benchmarkMomentum?.["3m"] ?? null;
  const beatCount =
    typeof activeBenchmark === "number"
      ? rows.filter((row) => typeof row.momentum[sortWindow] === "number" && (row.momentum[sortWindow] ?? -Infinity) > activeBenchmark).length
      : null;
  const valuationWithBands = valuationRows.filter((row) => typeof row.valuation?.peBand?.percentile === "number");
  const cheapest = valuationWithBands.length > 0 ? [...valuationWithBands].sort((a, b) => (a.valuation!.peBand!.percentile - b.valuation!.peBand!.percentile))[0] : null;
  const richest = valuationWithBands.length > 0 ? [...valuationWithBands].sort((a, b) => (b.valuation!.peBand!.percentile - a.valuation!.peBand!.percentile))[0] : null;
  const smartRows = rows.filter((row) => row.smartMoney);
  const smartLeader = smartRows.length > 0 ? [...smartRows].sort((a, b) => (b.smartMoney?.weight ?? -Infinity) - (a.smartMoney?.weight ?? -Infinity))[0] : null;
  const smartDeltaLeader = smartRows.length > 0 ? [...smartRows].sort((a, b) => (b.smartMoney?.delta4q ?? -Infinity) - (a.smartMoney?.delta4q ?? -Infinity))[0] : null;
  const headerDesc =
    benchmarksReady && leaders[0] && laggards[0]
      ? `${dateLabel ?? "최신"} 기준 ${activeWindowLabel} 리더는 ${leaders[0].name} ${pct(leaders[0].momentum[sortWindow], 1)}, 약세는 ${laggards[0].name} ${pct(laggards[0].momentum[sortWindow], 1)}입니다.`
      : dataReady
        ? "섹터 자료 일부를 불러왔지만 모멘텀 기준선은 없습니다."
        : failedSources.length > 0
          ? "섹터 데이터를 불러오지 못했습니다."
          : "섹터 데이터를 불러오는 중입니다.";
  const etfCoverageText =
    sourceMeta.etfMissing.length > 0
      ? `ETF 상세 미수록: ${sourceMeta.etfMissing.join(", ")}`
      : `${etfRows.length}개 섹터 ETF 상세 추적 중`;

  return (
    <div className="data-shell-page">
      <section className="panel data-shell-header">
        <div className="data-shell-head-main">
          <p className="data-shell-kicker">섹터 흐름</p>
          <h1 className="data-shell-title">섹터 히트맵</h1>
          <p className="data-shell-desc">
            {headerDesc}
          </p>
        </div>
        <div className="data-shell-head-actions">
          {dateLabel ? (
            <span
              className={cx(
                "data-shell-pill",
                benchmarksFailed ? "warn" : "ok",
              )}
            >
              <span />
              {dateLabel}
            </span>
          ) : null}
          <span className="hidden sm:inline-flex">
            <span className="data-shell-pill">
              <span />
              <SourceLine sourceMeta={sourceMeta} failedSources={failedSources} />
            </span>
          </span>
          <MarketSectionNav active="sectors" />
        </div>
      </section>

      {isMuted ? (
        <LoadingSkeleton />
      ) : null}

      <MobileViewSwitch value={mobileView} onChange={setMobileView} />

      <SectorPulse
        leader={leaders[0]}
        laggard={laggards[0]}
        beatCount={beatCount}
        totalCount={rows.length}
        activeWindowLabel={activeWindowLabel}
        activeWindowKey={sortWindow}
        cheapest={cheapest}
        richest={richest}
        smartLeader={smartLeader}
        smartDeltaLeader={smartDeltaLeader}
        sourceMeta={sourceMeta}
        failedSources={failedSources}
      />

      {/* Heatmap */}
      <div className={mobilePanelClass(mobileView === "heatmap")}>
        <SectionCard kicker="모멘텀 히트맵" title="업종 × 기간 성과">
        <p className="mb-3 text-xs text-[var(--c-ink-2)]">
          {beatCount === null
            ? benchmarksFailed
              ? "S&P 500 기준선 데이터가 없습니다."
              : "S&P 500 기준선을 불러오는 중입니다."
            : `${activeWindowLabel} 기준 ${beatCount}/${rows.length}개 섹터가 S&P 500을 앞섭니다.`}
        </p>
        <div className="grid gap-2 md:hidden">
          {sorted.map((row) => (
            <SectorMomentumCard key={row.key} row={row} windowKey={sortWindow} benchmarkValue={activeBenchmark} />
          ))}
        </div>
        <div className="hidden -mx-1 overflow-x-auto px-1 md:block">
          <table className="w-full min-w-[640px] border-separate border-spacing-1 text-sm">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-[var(--c-panel)] px-2 py-2 text-left text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)] shadow-sm">
                  업종
                </th>
                <th scope="col" className="px-2 py-2 text-right text-[11px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">당일</th>
                {MOMENTUM_WINDOWS.map((window) => {
                  const active = window.key === sortWindow;
                  return (
                    <th
                      key={window.key}
                      scope="col"
                      aria-sort={active ? "descending" : "none"}
                      className="px-1 py-2 text-center"
                    >
                      <button
                        type="button"
                        onClick={() => setSortWindow(window.key)}
                        aria-pressed={active}
                        className={cx(
                          "inline-flex min-h-11 w-full items-center justify-center rounded-md px-2 text-[11px] font-black uppercase tracking-[0.08em] transition",
                          active
                            ? "bg-[var(--c-brand)] text-white"
                            : "text-[var(--c-ink-3)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-ink-2)]",
                        )}
                      >
                        {window.label}
                        {active ? " ↓" : ""}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--c-line)]">
                <th scope="row" className="sticky left-0 z-10 bg-[var(--c-panel)] px-2 py-1.5 text-left shadow-sm">
                  <span className="block text-sm font-black text-[var(--c-ink)]">S&amp;P 500</span>
                  <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--c-ink-3)]">
                    {benchmarksReady ? "시장 기준선" : benchmarksFailed ? "데이터 없음" : "확인 중"}
                  </span>
                </th>
                <td className="px-2 py-1.5 text-right text-xs font-black text-[var(--c-ink-3)]">
                  {benchmarksReady ? "기준" : "—"}
                </td>
                {MOMENTUM_WINDOWS.map((window) => {
                  const value = benchmarkMomentum?.[window.key] ?? null;
                  return (
                    <td key={window.key} className="px-1 py-1.5">
                      <div
                        className="orbitron flex min-h-9 items-center justify-center rounded-md px-1 text-[13px] font-black tabular-nums"
                        style={heatStyle(value, chartTheme)}
                      >
                        {pct(value, 1)}
                      </div>
                    </td>
                  );
                })}
              </tr>
              {sorted.map((row) => {
                const state = getMarketStateMeta(row.marketState);
                const relativeThreeMonth =
                  typeof row.momentum["3m"] === "number" && typeof marketThreeMonth === "number"
                    ? row.momentum["3m"] - marketThreeMonth
                    : null;
                return (
                  <tr key={row.key}>
                    <th scope="row" className="sticky left-0 z-10 bg-[var(--c-panel)] px-2 py-1.5 text-left shadow-sm">
                      <span className="block text-sm font-black text-[var(--c-ink)]">{row.name}</span>
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--c-ink-3)]">{row.etf}</span>
                      {relativeThreeMonth !== null ? (
                        <span
                          className={cx(
                            "ml-2 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-black",
                            relativeThreeMonth >= 0 ? "bg-[var(--c-up-soft)] text-[var(--c-up)]" : "bg-[var(--c-down-soft)] text-[var(--c-down)]",
                          )}
                          title="3개월 S&P 500 대비 성과"
                        >
                          S&amp;P {pp(relativeThreeMonth, 1)}
                        </span>
                      ) : null}
                    </th>
                    <td className="px-2 py-1.5 text-right">
                      {row.dayChange === null ? (
                        <span className="text-xs font-semibold text-[var(--c-line-2)]">—</span>
                      ) : (
                        <span
                          className={cx(
                            "orbitron text-sm font-black",
                            row.dayChange >= 0 ? "text-[var(--c-up)]" : "text-[var(--c-down)]",
                          )}
                        >
                          {pct(row.dayChange, 2)}
                        </span>
                      )}
                      {state ? <span className={cx("market-state-badge ml-1 align-middle", state.className)}>{state.label}</span> : null}
                    </td>
                    {MOMENTUM_WINDOWS.map((window) => {
                      const value = row.momentum[window.key];
                      return (
                        <td key={window.key} className="px-1 py-1.5">
                          <div
                            className="orbitron flex min-h-9 items-center justify-center rounded-md px-1 text-[13px] font-black tabular-nums"
                            style={heatStyle(value, chartTheme)}
                          >
                            {pct(value, 1)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
      </div>

      {/* Leaders / Laggards */}
      <div className={cx(mobilePanelClass(mobileView === "heatmap", "grid"), "gap-4 sm:grid-cols-2")}>
        <SectionCard kicker="강세 리더" title={`강세 업종 · ${MOMENTUM_WINDOWS.find((w) => w.key === sortWindow)?.label}`}>
          <RankList rows={leaders} window={sortWindow} tone="up" />
        </SectionCard>
        <SectionCard kicker="약세 업종" title={`약세 업종 · ${MOMENTUM_WINDOWS.find((w) => w.key === sortWindow)?.label}`}>
          <RankList rows={laggards} window={sortWindow} tone="down" />
        </SectionCard>
      </div>

      {/* ETF comparison */}
      <div className={mobilePanelClass(mobileView === "etf")}>
      <SectionCard kicker="섹터 ETF" title="섹터 ETF 비교">
        {etfRows.length === 0 ? (
          <p className="text-sm text-[var(--c-ink-2)]">ETF 데이터를 불러오지 못했습니다.</p>
        ) : (
          <>
          <div className="grid gap-2 md:hidden">
            {rows.map((row) => (
              <EtfMobileCard key={row.key} row={row} />
            ))}
          </div>
          <div className="hidden -mx-1 overflow-x-auto px-1 md:block">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-[var(--c-line)] text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">
                  <th scope="col" className="sticky left-0 z-10 bg-[var(--c-panel)] px-2 py-2 text-left shadow-sm">ETF</th>
                  <th scope="col" className="px-2 py-2 text-right">1M</th>
                  <th scope="col" className="px-2 py-2 text-right">YTD</th>
                  <th scope="col" className="px-2 py-2 text-right">1Y</th>
                  <th scope="col" className="px-2 py-2 text-right">3Y CAGR</th>
                  <th scope="col" className="px-2 py-2 text-right">5Y CAGR</th>
                  <th scope="col" className="px-2 py-2 text-right">Beta</th>
                  <th scope="col" className="px-2 py-2 text-right">보수율</th>
                </tr>
              </thead>
              <tbody>
                {etfRows.map((row) => {
                  const etf = row.etfInfo!;
                  return (
                    <tr key={row.key} className="border-b border-[var(--c-line-2)] last:border-0">
                      <th scope="row" className="sticky left-0 z-10 bg-[var(--c-panel)] px-2 py-2 text-left shadow-sm">
                        <span className="text-sm font-black text-[var(--c-ink)]">{row.etf}</span>
                        <span className="ml-2 text-xs font-semibold text-[var(--c-ink-2)]">{row.name}</span>
                      </th>
                      <td className="orbitron px-2 py-2 text-right tabular-nums">{pct(etf.returns["1m"], 1)}</td>
                      <td className="orbitron px-2 py-2 text-right tabular-nums">{pct(etf.returns.ytd, 1)}</td>
                      <td className="orbitron px-2 py-2 text-right tabular-nums">{pct(etf.returns["1y"], 1)}</td>
                      <td className="orbitron px-2 py-2 text-right tabular-nums">{pct(etf.cagr["3y"], 1)}</td>
                      <td className="orbitron px-2 py-2 text-right tabular-nums">{pct(etf.cagr["5y"], 1)}</td>
                      <td className="orbitron px-2 py-2 text-right tabular-nums text-[var(--c-ink-2)]">
                        {typeof etf.beta === "number" && Number.isFinite(etf.beta) ? etf.beta.toFixed(2) : "—"}
                      </td>
                      <td className="orbitron px-2 py-2 text-right tabular-nums text-[var(--c-ink-2)]">
                        {typeof etf.expenseRatio === "number" && Number.isFinite(etf.expenseRatio) ? formatPercent(etf.expenseRatio * 100, 2) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
        <p className="mt-3 text-[11px] text-[var(--c-ink-3)]">
          {etfCoverageText}
        </p>
      </SectionCard>
      </div>

      {/* Sector valuation */}
      <div className={mobilePanelClass(mobileView === "valuation")}>
      <SectionCard kicker="밸류에이션" title="섹터 밸류에이션">
        <div className="grid gap-2 md:hidden">
          {valuationRows.map((row) => (
            <ValuationMobileCard key={row.key} row={row} />
          ))}
        </div>
        <div className="hidden -mx-1 overflow-x-auto px-1 md:block">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-[var(--c-line)] text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-3)]">
                <th scope="col" className="px-2 py-2 text-left">업종</th>
                <th scope="col" className="px-2 py-2 text-right">
                  <abbr title={valuationHelp.pe} className="cursor-help no-underline">Fwd P/E</abbr>
                </th>
                <th scope="col" className="px-2 py-2 text-right">
                  <abbr title={valuationHelp.pb} className="cursor-help no-underline">P/B</abbr>
                </th>
                <th scope="col" className="px-2 py-2 text-right">
                  <abbr title={valuationHelp.roe} className="cursor-help no-underline">ROE</abbr>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((row) => row.valuation)
                .map((row) => {
                  const v = row.valuation;
                  if (!v) return null;
                  return (
                    <tr key={row.key} className="border-b border-[var(--c-line-2)] last:border-0">
                      <th scope="row" className="px-2 py-2 text-left">
                        <span className="text-sm font-bold text-[var(--c-ink)]">{row.name}</span>
                        <span className="ml-2 text-xs font-semibold text-[var(--c-ink-3)]">{row.etf}</span>
                      </th>
                      <td className="px-2 py-2 text-right">
                        <PeBandGauge value={v.pe} band={v.peBand} />
                      </td>
                      <td className="orbitron px-2 py-2 text-right tabular-nums text-[var(--c-ink-2)]">{typeof v.pb === "number" && Number.isFinite(v.pb) ? v.pb.toFixed(2) : "—"}</td>
                      <td className="orbitron px-2 py-2 text-right tabular-nums text-[var(--c-ink-2)]">{typeof v.roe === "number" && Number.isFinite(v.roe) ? formatPercent(v.roe * 100, 1) : "—"}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-[var(--c-ink-3)]">
          {valuationSourceLine(sourceMeta)}
        </p>
      </SectionCard>
      </div>
      <div className={mobilePanelClass(mobileView === "guru")}>
        <SmartMoneyPanel rows={rows} sourceMeta={sourceMeta} />
      </div>

      <IndustryMapPanel />

    </div>
  );
}

function RankList({ rows, window, tone }: { rows: SectorRow[]; window: MomentumWindow; tone: "up" | "down" }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--c-ink-3)]">데이터 없음</p>;
  }
  return (
    <ol className="space-y-2">
      {rows.map((row, index) => {
        const value = row.momentum[window];
        return (
          <li key={row.key} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--c-line-2)] bg-[var(--c-surface-2)] px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
              <span
                className={cx(
                  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black",
                  tone === "up" ? "bg-[var(--c-up-soft)] text-[var(--c-up)]" : "bg-[var(--c-down-soft)] text-[var(--c-down)]",
                )}
              >
                {index + 1}
              </span>
              <span className="truncate text-sm font-bold text-[var(--c-ink)]">{row.name}</span>
              <span className="shrink-0 text-[11px] font-bold uppercase text-[var(--c-ink-3)]">{row.etf}</span>
            </span>
              <span className={cx("orbitron shrink-0 text-sm font-black tabular-nums", tone === "up" ? "text-[var(--c-up)]" : "text-[var(--c-down)]")}>
              {pct(value, 1)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
