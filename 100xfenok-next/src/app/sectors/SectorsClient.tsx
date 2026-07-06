"use client";

import { useMemo, useState, type ReactNode } from "react";
import IndustryMapPanel from "./IndustryMapPanel";
import SmartMoneyPanel from "./SmartMoneyPanel";
import {
  CpAccordion,
  CpCTARow,
  CpDataTable,
  CpSectionCard,
  CpStatChipRow,
  CpVerdictHero,
  type CpDataTableColumn,
  type CpVerdictHeroTrustChip,
} from "@/components/canvas-plus/kit";
import MarketSectionNav from "@/components/market/MarketSectionNav";
import TransitionLink from "@/components/TransitionLink";
import { ROUTES, withQuery } from "@/lib/routes";
import { useSectorData } from "@/hooks/useSectorData";
import {
  MOMENTUM_WINDOWS,
  type MomentumWindow,
  type SectorRow,
  type SectorValuationBand,
} from "@/lib/sectors/types";
import { formatPercent, formatSignedPercentDecimal, getMarketStateMeta } from "@/lib/dashboard/formatters";
import { useMarketChartTheme } from "@/lib/market-valuation/charts/chartTheme";
import { DATA_STATE_LABELS, formatAsOf } from "@/lib/data-state";

function pct(value: number | null | undefined, digits = 1): string {
  return typeof value !== "number" || !Number.isFinite(value) ? "—" : formatSignedPercentDecimal(value, digits);
}

function pp(value: number | null | undefined, digits = 1): string {
  const formatted = pct(value, digits);
  return formatted === "—" ? formatted : formatted.replace("%", "%p");
}

function dateOnly(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

function toneOf(value: number | null | undefined): "positive" | "negative" | "neutral" {
  if (typeof value !== "number" || !Number.isFinite(value)) return "neutral";
  return value >= 0 ? "positive" : "negative";
}

/**
 * SECTOR_DEFINITIONS.key (snake_case, e.g. "information_technology") ->
 * CANONICAL_SECTORS id used by the screener's sector filter (Title Case,
 * e.g. "Technology"). Exhaustive 11-entry map — see
 * src/lib/design/sector-map.json `canonical` for the source list. Passing
 * the Korean label here would silently no-op the screener filter
 * (service-map.md section B gap #6).
 */
const SECTOR_KEY_TO_SCREENER_SECTOR: Record<string, string> = {
  information_technology: "Technology",
  financials: "Financials",
  health_care: "Healthcare",
  energy: "Energy",
  industrials: "Industrials",
  communication_services: "Communication Services",
  consumer_discretionary: "Consumer Discretionary",
  consumer_staples: "Consumer Staples",
  real_estate: "Real Estate",
  materials: "Materials",
  utilities: "Utilities",
};

function screenerSectorHref(key: string): string {
  const canonical = SECTOR_KEY_TO_SCREENER_SECTOR[key];
  return canonical ? withQuery(ROUTES.screener, { sector: canonical }) : ROUTES.screener;
}

function failedSourceLabel(source: string): string | null {
  if (source === "benchmarks") return "모멘텀";
  if (source === "etfs") return "ETF";
  if (source === "us_sectors") return "가치";
  if (source === "portfolio_views" || source === "by_sector") return "기관 보유";
  if (source === "ticker") return "실시간 가격";
  return null;
}

function valuationTone(percentile: number | null | undefined): { label: string; tone: "positive" | "negative" | "neutral" } {
  if (typeof percentile !== "number" || !Number.isFinite(percentile)) return { label: "범위 없음", tone: "neutral" };
  if (percentile <= 0.25) return { label: "저평가권", tone: "positive" };
  if (percentile >= 0.75) return { label: "고평가권", tone: "negative" };
  return { label: "평균권", tone: "neutral" };
}

function PeBandGauge({ value, band }: { value: number | null; band: SectorValuationBand | null }) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return <span className="text-sm font-bold text-[var(--cp-text-soft)]">—</span>;
  }
  if (!band) {
    return <span className="text-sm font-bold text-[var(--cp-text-strong)]">{value.toFixed(1)}</span>;
  }
  const span = band.max - band.min;
  const position = span > 0 ? Math.min(100, Math.max(0, ((value - band.min) / span) * 100)) : 50;
  const percentile = Math.round(band.percentile * 100);
  const tone = valuationTone(band.percentile);
  return (
    <div
      className="ml-auto w-full max-w-[190px]"
      title={`역사적 Fwd P/E 백분위 ${percentile}% · ${tone.label} · 범위 ${band.min.toFixed(1)}~${band.max.toFixed(1)}`}
    >
      <div className="mb-1 flex items-center justify-end gap-2">
        <span className="text-sm font-black tabular-nums text-[var(--cp-text-strong)]">{value.toFixed(1)}</span>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-black"
          style={{
            background: tone.tone === "positive" ? "var(--cp-positive-soft)" : tone.tone === "negative" ? "var(--cp-negative-soft)" : "var(--cp-surface-strong)",
            color: tone.tone === "positive" ? "var(--cp-positive)" : tone.tone === "negative" ? "var(--cp-negative)" : "var(--cp-text-muted)",
          }}
        >
          {tone.label}
        </span>
      </div>
      <div
        className="relative h-2 rounded-full"
        style={{ background: "linear-gradient(90deg, var(--cp-positive-soft), var(--cp-surface-strong), var(--cp-negative-soft))" }}
      >
        <span
          className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${position}%`, background: "var(--cp-accent-strong)" }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[9px] font-bold text-[var(--cp-text-soft)]">
        <span>{band.min.toFixed(1)}</span>
        <span>{percentile}%</span>
        <span>{band.max.toFixed(1)}</span>
      </div>
    </div>
  );
}

function SectorHeroBars({
  rows,
  windowKey,
  benchmarkValue,
}: {
  rows: SectorRow[];
  windowKey: MomentumWindow;
  benchmarkValue: number | null;
}) {
  const items = rows
    .map((row) => {
      const value = row.momentum[windowKey];
      const relative = typeof value === "number" && typeof benchmarkValue === "number" ? value - benchmarkValue : null;
      return { row, value, relative };
    })
    .filter((item): item is { row: SectorRow; value: number; relative: number } =>
      typeof item.value === "number" && typeof item.relative === "number" && Number.isFinite(item.value) && Number.isFinite(item.relative),
    );

  if (items.length === 0) {
    return <p className="cpw5-sectors-hero-chart__empty">S&amp;P 500 기준선 또는 섹터 성과 데이터가 아직 없습니다.</p>;
  }

  const sorted = [...items].sort((a, b) => b.relative - a.relative);
  const maxAbs = Math.max(0.01, ...sorted.map((item) => Math.abs(item.relative)));
  const maxMarketCap = Math.max(1, ...sorted.map((item) => item.row.etfInfo?.marketCap ?? 0));

  return (
    <div className="cpw5-sectors-bar-list" data-sector-relative-bars data-sector-relative-window={windowKey} data-sector-relative-count={sorted.length}>
      {sorted.map(({ row, value, relative }) => {
        const width = Math.max(3, Math.min(50, (Math.abs(relative) / maxAbs) * 50));
        const positive = relative >= 0;
        const marketCap = row.etfInfo?.marketCap ?? null;
        const weightPct = marketCap !== null ? Math.max(8, Math.min(100, (marketCap / maxMarketCap) * 100)) : 0;
        return (
          <div key={row.key} className="cpw5-sectors-bar-row" data-sector-relative-bar data-sector-relative-side={positive ? "up" : "down"}>
            <div className="min-w-0">
              <TransitionLink href={screenerSectorHref(row.key)} className="cpw5-sectors-bar-name" title={`${row.name} 종목을 스크리너에서 보기`}>
                {row.name}
              </TransitionLink>
              <span className="cpw5-sectors-bar-etf">{row.etf}</span>
            </div>
            <div className="cpw5-sectors-bar-track" title={marketCap !== null ? `ETF 시가총액 비중 참고선` : undefined}>
              {marketCap !== null ? <span className="cpw5-sectors-bar-weight" style={{ width: `${weightPct}%` }} aria-hidden="true" /> : null}
              <span className="cpw5-sectors-bar-mid" aria-hidden="true" />
              <span
                className="cpw5-sectors-bar-fill"
                data-side={positive ? "up" : "down"}
                style={{ width: `${width}%` }}
                aria-hidden="true"
              />
            </div>
            <div className="cpw5-sectors-bar-values">
              <span className="cpw5-sectors-bar-relative" data-tone={toneOf(relative)}>{pp(relative, 1)}</span>
              <span className="cpw5-sectors-bar-absolute">{pct(value, 1)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EtfCard({ row }: { row: SectorRow }) {
  const etf = row.etfInfo;
  const oneMonthTone = toneOf(etf?.returns["1m"]);
  return (
    <article className="cpw5-sectors-card">
      <div className="cpw5-sectors-card__head">
        <div className="min-w-0">
          <p className="cpw5-sectors-card__name">{row.etf}</p>
          <span className="cpw5-sectors-card__etf">{row.name}</span>
        </div>
        <span className="cpw5-sectors-card__value" data-tone={oneMonthTone}>{pct(etf?.returns["1m"], 1)}</span>
      </div>
      <div className="cpw5-sectors-card__grid">
        <span className="cpw5-sectors-card__cell">YTD {pct(etf?.returns.ytd, 1)}</span>
        <span className="cpw5-sectors-card__cell">1Y {pct(etf?.returns["1y"], 1)}</span>
        <span className="cpw5-sectors-card__cell">3Y {pct(etf?.cagr["3y"], 1)}</span>
        <span className="cpw5-sectors-card__cell">Beta {typeof etf?.beta === "number" ? etf.beta.toFixed(2) : "—"}</span>
        <span className="cpw5-sectors-card__cell">보수 {typeof etf?.expenseRatio === "number" ? formatPercent(etf.expenseRatio * 100, 2) : "—"}</span>
        <span className="cpw5-sectors-card__cell">{etf ? "추적 중" : "ETF 없음"}</span>
      </div>
    </article>
  );
}

function ValuationCard({ row }: { row: SectorRow }) {
  const value = row.valuation;
  const tone = valuationTone(value?.peBand?.percentile);
  return (
    <article className="cpw5-sectors-card">
      <div className="cpw5-sectors-card__head">
        <div className="min-w-0">
          <p className="cpw5-sectors-card__name">{row.name}</p>
          <span className="cpw5-sectors-card__etf">{row.etf}</span>
        </div>
        <span className="cpw5-sectors-card__badge" data-tone={tone.tone}>{tone.label}</span>
      </div>
      <div className="cpw5-sectors-card__grid">
        <span className="cpw5-sectors-card__cell">Fwd P/E {typeof value?.pe === "number" ? value.pe.toFixed(1) : "—"}</span>
        <span className="cpw5-sectors-card__cell">P/B {typeof value?.pb === "number" ? value.pb.toFixed(2) : "—"}</span>
        <span className="cpw5-sectors-card__cell">ROE {typeof value?.roe === "number" ? formatPercent(value.roe * 100, 1) : "—"}</span>
      </div>
    </article>
  );
}

type MatrixRow = {
  rowKey: string;
  name: string;
  etf: string;
  benchmark: boolean;
  dayChange: number | null;
  marketState: string | null;
  momentum: Partial<Record<MomentumWindow, number | null>>;
  [key: string]: unknown;
};

/** CpDataTable requires `T extends Record<string, unknown>`; SectorRow has no
 * index signature, so widen it locally for the two tables that render it
 * directly (kit is read-only — see FILES YOU OWN in the task brief). */
type SectorTableRow = SectorRow & Record<string, unknown>;

function HeatCell({ value }: { value: number | null | undefined }) {
  const theme = useMarketChartTheme();
  return (
    <div className="cpw5-sectors-heat-cell" style={theme.heatStyle(value)}>
      {pct(value, 1)}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="cpw5-sectors-skeleton">
      <div className="cpw5-sectors-skeleton__bar" style={{ width: 160 }} />
      <div className="cpw5-sectors-skeleton__grid">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="cpw5-sectors-skeleton__bar" style={{ height: 36, animationDelay: `${index * 70}ms` }} />
        ))}
      </div>
    </div>
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

  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.momentum[sortWindow] ?? -Infinity) - (a.momentum[sortWindow] ?? -Infinity)),
    [rows, sortWindow],
  );
  const leaders = sorted.slice(0, 3);
  const laggards = sorted.filter((row) => row.momentum[sortWindow] !== null).slice(-3).reverse();
  const etfRows = useMemo(() => rows.filter((row) => row.etfInfo), [rows]);
  const valuationRows = useMemo(() => rows.filter((row) => row.valuation), [rows]);
  const activeWindowLabel = MOMENTUM_WINDOWS.find((w) => w.key === sortWindow)?.label ?? sortWindow;

  const isMuted = !(benchmarksReady || etfsReady || valuationReady);
  const dateLabel = formatAsOf(updatedAt) ?? dateOnly(updatedAt);
  const activeBenchmark = benchmarkMomentum?.[sortWindow] ?? null;
  const beatCount =
    typeof activeBenchmark === "number"
      ? rows.filter((row) => typeof row.momentum[sortWindow] === "number" && (row.momentum[sortWindow] ?? -Infinity) > activeBenchmark).length
      : null;

  const valuationWithBands = valuationRows.filter((row) => typeof row.valuation?.peBand?.percentile === "number");
  const cheapest = valuationWithBands.length > 0 ? [...valuationWithBands].sort((a, b) => a.valuation!.peBand!.percentile - b.valuation!.peBand!.percentile)[0] : null;
  const richest = valuationWithBands.length > 0 ? [...valuationWithBands].sort((a, b) => b.valuation!.peBand!.percentile - a.valuation!.peBand!.percentile)[0] : null;
  const smartRows = rows.filter((row) => row.smartMoney);
  const smartLeader = smartRows.length > 0 ? [...smartRows].sort((a, b) => (b.smartMoney?.weight ?? -Infinity) - (a.smartMoney?.weight ?? -Infinity))[0] : null;
  const smartDeltaLeader = smartRows.length > 0 ? [...smartRows].sort((a, b) => (b.smartMoney?.delta4q ?? -Infinity) - (a.smartMoney?.delta4q ?? -Infinity))[0] : null;

  const missingLabels = Array.from(new Set(failedSources.map(failedSourceLabel).filter((label): label is string => Boolean(label))));

  const verdict: ReactNode = !dataReady
    ? failedSources.length > 0
      ? "섹터 데이터를 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요."
      : "섹터 데이터를 불러오는 중입니다."
    : benchmarksReady && leaders[0] && laggards[0]
      ? (
          <>
            {dateLabel ?? "최신"} 기준 {activeWindowLabel}에는{" "}
            <b className="up">{leaders[0].name} {pct(leaders[0].momentum[sortWindow], 1)}</b>가 시장을 주도하고,{" "}
            <b className="down">{laggards[0].name} {pct(laggards[0].momentum[sortWindow], 1)}</b>가 가장 약합니다. S&amp;P 500 대비{" "}
            <b>{beatCount ?? 0}/{rows.length}개</b> 섹터가 상회 중입니다.
          </>
        )
      : "섹터 자료 일부를 불러왔지만 기간별 모멘텀 기준선은 아직 없습니다.";

  const trustChips: CpVerdictHeroTrustChip[] = [
    { id: "asof", label: "기준일", value: dateLabel ?? DATA_STATE_LABELS.pending, freshness: true, tone: dataReady ? "neutral" : "warning" },
    { id: "count", label: "섹터", value: `${rows.length}개` },
    ...(missingLabels.length > 0
      ? [{ id: "missing", label: DATA_STATE_LABELS.unavailable, value: missingLabels.join(" · "), tone: "warning" as const }]
      : []),
  ];

  const matrixRows: MatrixRow[] = [
    {
      rowKey: "sp500",
      name: "S&P 500",
      etf: benchmarksReady ? "시장 기준선" : failedSources.includes("benchmarks") ? DATA_STATE_LABELS.unavailable : DATA_STATE_LABELS.pending,
      benchmark: true,
      dayChange: null,
      marketState: null,
      momentum: benchmarkMomentum ?? {},
    },
    ...sorted.map((row) => ({
      rowKey: row.key,
      name: row.name,
      etf: row.etf,
      benchmark: false,
      dayChange: row.dayChange,
      marketState: row.marketState,
      momentum: row.momentum,
    })),
  ];

  const matrixColumns: CpDataTableColumn<MatrixRow>[] = [
    {
      key: "name",
      header: "업종",
      align: "left",
      render: (row) => (
        <>
          <span className="block text-[13px] font-black text-[var(--cp-text-strong)]">{row.name}</span>
          <span className="block text-[10.5px] font-bold uppercase tracking-[0.06em] text-[var(--cp-text-soft)]">{row.etf}</span>
        </>
      ),
    },
    {
      key: "day",
      header: "당일",
      render: (row) => {
        if (row.benchmark) return <span className="text-xs font-black text-[var(--cp-text-soft)]">기준</span>;
        const state = getMarketStateMeta(row.marketState);
        return (
          <>
            <span className="text-sm font-black tabular-nums" style={{ color: row.dayChange === null ? "var(--cp-text-soft)" : row.dayChange >= 0 ? "var(--cp-positive)" : "var(--cp-negative)" }}>
              {pct(row.dayChange, 2)}
            </span>
            {state ? <span className="market-state-badge ml-1 align-middle">{state.label}</span> : null}
          </>
        );
      },
    },
    ...MOMENTUM_WINDOWS.map((window) => ({
      key: window.key,
      header: window.label,
      render: (row: MatrixRow) => <HeatCell value={row.momentum[window.key]} />,
    })),
  ];

  const dayCoverageText = `${etfRows.length}/${rows.length}개 섹터 ETF 상세 확인`;
  const valuationSourceLine = `가치 기준 ${sourceMeta.valuationLatestDate ?? sourceMeta.valuationVersion ?? DATA_STATE_LABELS.pending}`;

  return (
    <div className="canvas-plus cpw5-sectors-page" data-canvas-plus data-canvas-plus-sectors>
      <div className="cpw5-sectors-topbar">
        <MarketSectionNav active="sectors" />
      </div>

      <CpVerdictHero
        eyebrow="SECTORS · GICS 기준 11개 업종 흐름"
        verdict={verdict}
        sub="S&amp;P 500 대비 초과 성과와 밸류에이션, 기관 보유 방향이 같은 편인지 한 화면에서 확인합니다."
        trustChips={trustChips}
      />

      {isMuted ? <LoadingSkeleton /> : null}

      <section className="cpw5-sectors-hero-chart" aria-label="섹터 성과 랭킹 (S&P 500 대비)">
        <div className="cpw5-sectors-hero-chart__head">
          <h2 className="cpw5-sectors-hero-chart__title">S&amp;P 500 대비 {activeWindowLabel} 초과 성과 · 트랙 굵기는 ETF 시가총액 비중</h2>
          <span className="cpw5-sectors-hero-chart__baseline">기준 {pct(activeBenchmark, 1)}</span>
        </div>
        <div className="cpw5-sectors-period-toggle" role="group" aria-label="기간 선택">
          {MOMENTUM_WINDOWS.map((window) => (
            <button
              key={window.key}
              type="button"
              data-active={window.key === sortWindow ? "true" : "false"}
              className="cpw5-sectors-period-btn"
              onClick={() => setSortWindow(window.key)}
              aria-pressed={window.key === sortWindow}
            >
              {window.label}
            </button>
          ))}
        </div>
        <SectorHeroBars rows={sorted} windowKey={sortWindow} benchmarkValue={activeBenchmark} />
      </section>

      <CpStatChipRow
        items={[
          {
            id: "valuation",
            label: "가치 위치 (저평가 · 고평가)",
            value: `${cheapest?.name ?? "—"} · ${richest?.name ?? "—"}`,
          },
          {
            id: "smart-leader",
            label: "기관 보유 리더",
            value: smartLeader?.smartMoney ? `${smartLeader.name} ${pct(smartLeader.smartMoney.weight, 1)}` : "—",
          },
          {
            id: "smart-delta",
            label: "기관 보유 증가",
            value: smartDeltaLeader?.smartMoney ? `${smartDeltaLeader.name} ${pp(smartDeltaLeader.smartMoney.delta4q, 1)}` : "—",
            tone: smartDeltaLeader?.smartMoney && (smartDeltaLeader.smartMoney.delta4q ?? 0) >= 0 ? "positive" : "negative",
          },
        ]}
      />

      <CpAccordion title="전체 업종 × 기간 성과표 보기" meta={`${rows.length}개 업종 · 당일 포함 ${MOMENTUM_WINDOWS.length + 1}개 구간`}>
        <CpDataTable
          columns={matrixColumns}
          rows={matrixRows}
          getRowKey={(row) => row.rowKey}
          emphRowKeys={new Set(["sp500"])}
        />
      </CpAccordion>

      <CpSectionCard eyebrow="ETF" title="섹터 ETF 비교" footnote={dayCoverageText}>
        {etfRows.length === 0 ? (
          <p className="text-sm text-[var(--cp-text-muted)]">ETF 데이터를 불러오지 못했습니다.</p>
        ) : (
          <>
            <div className="cpw5-sectors-card-grid md:hidden" data-cols="1">
              {rows.map((row) => (
                <EtfCard key={row.key} row={row} />
              ))}
            </div>
            <div className="hidden md:block">
              <CpDataTable<SectorTableRow>
                columns={[
                  {
                    key: "etf",
                    header: "ETF",
                    align: "left",
                    render: (row: SectorRow) => (
                      <>
                        <span className="text-sm font-black text-[var(--cp-text-strong)]">{row.etf}</span>
                        <span className="ml-2 text-xs font-semibold text-[var(--cp-text-muted)]">{row.name}</span>
                      </>
                    ),
                  },
                  { key: "1m", header: "1M", render: (row: SectorRow) => pct(row.etfInfo?.returns["1m"], 1) },
                  { key: "ytd", header: "YTD", render: (row: SectorRow) => pct(row.etfInfo?.returns.ytd, 1) },
                  { key: "1y", header: "1Y", render: (row: SectorRow) => pct(row.etfInfo?.returns["1y"], 1) },
                  { key: "3y", header: "3Y CAGR", render: (row: SectorRow) => pct(row.etfInfo?.cagr["3y"], 1) },
                  { key: "5y", header: "5Y CAGR", render: (row: SectorRow) => pct(row.etfInfo?.cagr["5y"], 1) },
                  {
                    key: "beta",
                    header: "Beta",
                    render: (row: SectorRow) => (typeof row.etfInfo?.beta === "number" ? row.etfInfo.beta.toFixed(2) : "—"),
                  },
                  {
                    key: "expense",
                    header: "보수율",
                    render: (row: SectorRow) => (typeof row.etfInfo?.expenseRatio === "number" ? formatPercent(row.etfInfo.expenseRatio * 100, 2) : "—"),
                  },
                ]}
                rows={etfRows as SectorTableRow[]}
                getRowKey={(row: SectorRow) => row.key}
              />
            </div>
          </>
        )}
      </CpSectionCard>

      <CpSectionCard eyebrow="VALUATION" title="섹터 밸류에이션" footnote={valuationSourceLine}>
        <div className="cpw5-sectors-card-grid md:hidden" data-cols="1">
          {valuationRows.map((row) => (
            <ValuationCard key={row.key} row={row} />
          ))}
        </div>
        <div className="hidden md:block">
          <CpDataTable<SectorTableRow>
            columns={[
              {
                key: "name",
                header: "업종",
                align: "left",
                render: (row: SectorRow) => (
                  <>
                    <span className="text-sm font-bold text-[var(--cp-text-strong)]">{row.name}</span>
                    <span className="ml-2 text-xs font-semibold text-[var(--cp-text-soft)]">{row.etf}</span>
                  </>
                ),
              },
              {
                key: "pe",
                header: (
                  <abbr title="Fwd P/E: 향후 12개월 예상 이익 대비 주가 배수" className="cursor-help no-underline">
                    Fwd P/E
                  </abbr>
                ),
                render: (row: SectorRow) => <PeBandGauge value={row.valuation?.pe ?? null} band={row.valuation?.peBand ?? null} />,
              },
              {
                key: "pb",
                header: (
                  <abbr title="P/B: 장부가 대비 주가 배수" className="cursor-help no-underline">
                    P/B
                  </abbr>
                ),
                render: (row: SectorRow) => (typeof row.valuation?.pb === "number" ? row.valuation.pb.toFixed(2) : "—"),
              },
              {
                key: "roe",
                header: (
                  <abbr title="ROE: 자기자본이익률" className="cursor-help no-underline">
                    ROE
                  </abbr>
                ),
                render: (row: SectorRow) => (typeof row.valuation?.roe === "number" ? formatPercent(row.valuation.roe * 100, 1) : "—"),
              },
            ]}
            rows={valuationRows as SectorTableRow[]}
            getRowKey={(row: SectorRow) => row.key}
          />
        </div>
      </CpSectionCard>

      <SmartMoneyPanel rows={rows} sourceMeta={sourceMeta} />

      <CpAccordion title="업종 세부 지도 보기" meta="산업 단위 드릴다운">
        <IndustryMapPanel
          bridgeText={
            leaders[0]
              ? `${leaders[0].name} 섹터 내 세부 산업(기술 섹터/반도체 등)은 아래에서 이어서 확인합니다.`
              : null
          }
        />
      </CpAccordion>

      <CpCTARow
        primary={{ label: "업종 이벤트 보기", href: ROUTES.marketEvents }}
        secondary={{ label: "투자 대가 보유 보기", href: ROUTES.superinvestors }}
        note="투자 조언 아님 · 데이터 지연 가능"
      />
    </div>
  );
}
