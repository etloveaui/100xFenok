"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import SmartMoneyPanel from "./SmartMoneyPanel";
import { Bar, Button, EvidenceRail, Panel, PanelHeader, Pill } from "@/components/ui";
import MarketSectionNav from "@/components/market/MarketSectionNav";
import TransitionLink from "@/components/TransitionLink";
import { ROUTES, withQuery } from "@/lib/routes";
import { useSectorData } from "@/hooks/useSectorData";
import {
  MOMENTUM_WINDOWS,
  type MomentumWindow,
  type SectorRow,
} from "@/lib/sectors/types";
import { formatPercent, formatSignedPercentDecimal } from "@/lib/dashboard/formatters";
import { formatAsOf, isStaleAsOf } from "@/lib/data-state";
import { formatDecimal } from "@/lib/format";

function pct(value: number | null | undefined, digits = 1): string {
  return typeof value !== "number" || !Number.isFinite(value) ? "—" : formatSignedPercentDecimal(value, digits);
}

function pp(value: number | null | undefined, digits = 1): string {
  const formatted = pct(value, digits);
  return formatted === "—" ? formatted : formatted.replace("%", "%p");
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
  if (source === "source_clock") return "통합 기준일";
  return null;
}

function openEvidence(path: string) {
  window.open(path, "_blank", "noopener");
}

type FlowItem = {
  row: SectorRow;
  value: number;
  relative: number;
};

function flowItems(rows: SectorRow[], windowKey: MomentumWindow, benchmarkValue: number | null): FlowItem[] {
  return rows
    .map((row) => {
      const value = row.momentum[windowKey];
      const relative = typeof value === "number" && typeof benchmarkValue === "number" ? value - benchmarkValue : null;
      return { row, value, relative };
    })
    .filter((item): item is FlowItem =>
      typeof item.value === "number" && typeof item.relative === "number" && Number.isFinite(item.value) && Number.isFinite(item.relative),
    )
    .sort((a, b) => b.relative - a.relative);
}

function SectorFlowPanel({
  rows,
  benchmarkValue,
  windowKey,
  onWindowChange,
  loading,
  ready,
  failed,
  stale,
  clock,
  lkgClock,
  coverage,
  onRetry,
}: {
  rows: SectorRow[];
  benchmarkValue: number | null;
  windowKey: MomentumWindow;
  onWindowChange: (window: MomentumWindow) => void;
  loading: boolean;
  ready: boolean;
  failed: boolean;
  stale: boolean;
  clock: string | null;
  lkgClock: string | null;
  coverage: string;
  onRetry: () => void;
}) {
  const items = ready ? flowItems(rows, windowKey, benchmarkValue) : [];
  const empty = !loading && (!ready || items.length === 0);
  const maxAbs = Math.max(0.01, ...items.map((item) => Math.abs(item.relative)));
  const asOfLabel = formatAsOf(clock) ?? "—";
  // Reduced counts (fewer sectors with a value for this window than rows on
  // screen) are partial coverage — never fresh, even when the clock is new.
  const valuedCount = rows.filter((row) => typeof row.momentum[windowKey] === "number").length;
  const incomplete = ready && valuedCount < rows.length;

  return (
    <Panel
      loading={loading}
      empty={empty}
      emptyReason={failed || !ready ? "S&P 500 대비 섹터 초과 성과를 불러오지 못했습니다" : "표시할 섹터 성과 데이터가 없습니다"}
      emptyNextRefresh="다음 마감 후 갱신"
      emptyActionLabel={failed || !ready ? "다시 시도" : undefined}
      onEmptyAction={failed || !ready ? onRetry : undefined}
      stale={stale}
      asOf={clock ?? undefined}
      onRetry={stale ? onRetry : undefined}
    >
      {ready && items.length > 0 && (
        <div data-sectors-flow-rows data-sectors-flow-window={windowKey} data-sectors-flow-count={items.length}>
          <PanelHeader
            eyebrow="Sector Flow"
            title="S&P 500 대비 초과 성과"
            right={(
              <div className="sec-period-toggle" data-sectors-period-toggle role="group" aria-label="기간 선택">
                {MOMENTUM_WINDOWS.map((window) => (
                  <Button
                    key={window.key}
                    type="button"
                    variant="tab"
                    active={window.key === windowKey}
                    aria-pressed={window.key === windowKey}
                    data-sectors-period={window.key}
                    className="sec-period-btn"
                    onClick={() => onWindowChange(window.key)}
                  >
                    {window.label}
                  </Button>
                ))}
              </div>
            )}
          />
          <div className="sec-flow-head" aria-hidden="true">
            <span>업종</span>
            <span>{MOMENTUM_WINDOWS.find((window) => window.key === windowKey)?.label ?? windowKey} 상대 성과</span>
            <span className="sec-flow-head-num">%p · 실제</span>
          </div>
          {items.map(({ row, value, relative }) => {
            const positive = relative >= 0;
            const width = Math.max(3, Math.min(100, (Math.abs(relative) / maxAbs) * 100));
            return (
              <TransitionLink
                key={row.key}
                href={screenerSectorHref(row.key)}
                className="sec-flow-row"
                data-sectors-flow-row
                data-sectors-flow-side={positive ? "up" : "down"}
                title={`${row.name} 종목을 스크리너에서 보기`}
              >
                <span className="sec-flow-name">
                  {row.name} <span className="sec-ticker">{row.etf}</span>
                </span>
                <Bar
                  value={width}
                  className={positive ? "sec-bar-up" : "sec-bar-down"}
                  aria-label={`${row.name} 상대 성과 ${pp(relative, 1)}`}
                />
                <span className="sec-flow-values">
                  <span className={positive ? "sec-up tabular-nums" : "sec-down tabular-nums"}>{pp(relative, 1)}</span>
                  <span className="sec-abs tabular-nums">{pct(value, 1)}</span>
                </span>
              </TransitionLink>
            );
          })}
        </div>
      )}
      <EvidenceRail
        freshness={loading ? "pending" : failed || !ready ? "error" : incomplete ? "partial" : stale ? "stale" : clock ? "fresh" : "fixed"}
        source="SlickCharts · Yahoo"
        asOf={asOfLabel}
        coverage={coverage}
        lkgAsOf={stale && lkgClock ? (formatAsOf(lkgClock) ?? lkgClock) : undefined}
        onRetry={failed || !ready || stale || incomplete ? onRetry : undefined}
        onEvidence={ready && !failed ? () => openEvidence("/data/benchmarks/summaries.json") : undefined}
      />
    </Panel>
  );
}

function EtfComparePanel({
  rows,
  loading,
  ready,
  failed,
  stale,
  clock,
  lkgClock,
  coverage,
  missingNote,
  onRetry,
}: {
  rows: SectorRow[];
  loading: boolean;
  ready: boolean;
  failed: boolean;
  stale: boolean;
  clock: string | null;
  lkgClock: string | null;
  coverage: string;
  missingNote: string | null;
  onRetry: () => void;
}) {
  const etfRows = rows.filter((row) => row.etfInfo);
  const empty = !loading && (!ready || etfRows.length === 0);
  const asOfLabel = formatAsOf(clock) ?? "—";
  // Missing ETFs (fewer comparable rows than sectors on screen) are partial
  // coverage — never fresh, even when the index clock is new.
  const incomplete = ready && etfRows.length < rows.length;

  return (
    <Panel
      loading={loading}
      empty={empty}
      emptyReason={failed || !ready ? "섹터 ETF 비교 데이터를 불러오지 못했습니다" : "표시할 섹터 ETF 데이터가 없습니다"}
      emptyNextRefresh="다음 마감 후 갱신"
      emptyActionLabel={failed || !ready ? "다시 시도" : undefined}
      onEmptyAction={failed || !ready ? onRetry : undefined}
      stale={stale}
      asOf={clock ?? undefined}
      onRetry={stale ? onRetry : undefined}
    >
      {ready && etfRows.length > 0 && (
        <div data-sectors-etf-compare>
          <PanelHeader
            eyebrow="ETF"
            title="섹터 ETF 비교"
            right={<span className="sec-head-note">{coverage} 섹터 ETF 상세{missingNote ? ` · ${missingNote} 없음` : ""}</span>}
          />
          <div className="sec-etf-scroll">
            <table className="sec-etf-table">
              <thead>
                <tr>
                  <th scope="col" className="sec-etf-th-name">ETF</th>
                  <th scope="col">1M</th>
                  <th scope="col">YTD</th>
                  <th scope="col">1Y</th>
                  <th scope="col">3Y CAGR</th>
                  <th scope="col">5Y CAGR</th>
                  <th scope="col">Beta</th>
                  <th scope="col">보수율</th>
                </tr>
              </thead>
              <tbody>
                {etfRows.map((row) => {
                  const oneMonth = row.etfInfo?.returns["1m"];
                  const oneMonthTone = toneOf(oneMonth);
                  return (
                    <tr key={row.key} className="sec-etf-row" tabIndex={0} data-sectors-etf-row={row.etf}>
                      <th scope="row" className="sec-etf-name">
                        <span className="sec-ticker sec-ticker-strong">{row.etf}</span>
                        <span className="sec-etf-sector">{row.name}</span>
                      </th>
                      <td className={oneMonthTone === "positive" ? "sec-up tabular-nums sec-strong" : oneMonthTone === "negative" ? "sec-down tabular-nums sec-strong" : "tabular-nums"}>{pct(oneMonth, 1)}</td>
                      <td className="tabular-nums">{pct(row.etfInfo?.returns.ytd, 1)}</td>
                      <td className="tabular-nums">{pct(row.etfInfo?.returns["1y"], 1)}</td>
                      <td className="tabular-nums">{pct(row.etfInfo?.cagr["3y"], 1)}</td>
                      <td className="tabular-nums">{pct(row.etfInfo?.cagr["5y"], 1)}</td>
                      <td className="tabular-nums">{formatDecimal(row.etfInfo?.beta, { digits: 2 })}</td>
                      <td className="tabular-nums">{typeof row.etfInfo?.expenseRatio === "number" ? formatPercent(row.etfInfo.expenseRatio * 100, 2) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <EvidenceRail
        freshness={loading ? "pending" : failed || !ready ? "error" : incomplete ? "partial" : stale ? "stale" : clock ? "fresh" : "fixed"}
        source="ETF 운용사 공시"
        asOf={asOfLabel}
        coverage={coverage}
        lkgAsOf={stale && lkgClock ? (formatAsOf(lkgClock) ?? lkgClock) : undefined}
        onRetry={failed || !ready || stale || incomplete ? onRetry : undefined}
        onEvidence={ready && !failed ? () => openEvidence("/data/global-scouter/etfs/index.json") : undefined}
      />
    </Panel>
  );
}

export default function SectorsClient() {
  const router = useRouter();
  const {
    rows,
    benchmarkMomentum,
    loaded,
    dataReady,
    benchmarksReady,
    etfsReady,
    smartMoneyReady,
    failedSources,
    staleSources,
    sourceMeta,
    refresh,
  } = useSectorData();
  const [sortWindow, setSortWindow] = useState<MomentumWindow>("1m");

  const loading = !loaded;
  const failed = loaded && !dataReady;
  const activeWindowLabel = MOMENTUM_WINDOWS.find((w) => w.key === sortWindow)?.label ?? sortWindow;
  const activeBenchmark = benchmarkMomentum?.[sortWindow] ?? null;
  const items = benchmarksReady ? flowItems(rows, sortWindow, activeBenchmark) : [];
  const leaders = items[0] ?? null;
  const laggards = items.length > 0 ? items[items.length - 1] : null;
  const beatCount =
    typeof activeBenchmark === "number"
      ? items.filter((item) => item.relative > 0).length
      : null;

  const flowStale = benchmarksReady && (staleSources.includes("benchmarks") || isStaleAsOf(sourceMeta.benchmarksSourceDate));
  const flowFailed = loaded && !benchmarksReady;
  const flowCoverage = benchmarksReady
    ? `${rows.filter((row) => typeof row.momentum[sortWindow] === "number").length}/${rows.length} 섹터`
    : "—";

  const etfRows = etfsReady ? rows.filter((row) => row.etfInfo) : [];
  const etfStale = etfsReady && (staleSources.includes("etfs") || isStaleAsOf(sourceMeta.etfSourceDate));
  const etfFailed = loaded && !etfsReady;
  const etfCoverage = etfsReady ? `${etfRows.length}/${rows.length}` : "—";
  const etfMissingNote = sourceMeta.etfMissing.length > 0 ? sourceMeta.etfMissing.join("·") : null;

  const smartStale = smartMoneyReady && (staleSources.includes("portfolio_views") || staleSources.includes("by_sector"));
  const smartFailed = loaded && !smartMoneyReady;
  const smartAsOf = sourceMeta.smartMoneyGeneratedAt?.slice(0, 10) ?? sourceMeta.smartMoneySourceDate;
  const smartCoverage = smartMoneyReady
    ? `${rows.filter((row) => row.smartMoney).length}/${rows.length} 섹터`
    : "—";

  const missingLabels = Array.from(new Set(failedSources.map(failedSourceLabel).filter((label): label is string => Boolean(label))));
  const quoteLabel = formatAsOf(sourceMeta.tickerSourceDate) ?? "확인 중";

  let headline: ReactNode;
  if (loading) {
    headline = "섹터 데이터를 불러오는 중입니다.";
  } else if (failed) {
    headline = "섹터 데이터를 불러오지 못했습니다. 다시 시도해 주세요.";
  } else if (benchmarksReady && leaders && laggards && beatCount !== null) {
    headline = (
      <>
        {activeWindowLabel} 기준 <b className={leaders.relative >= 0 ? "sec-up" : "sec-down"}>{leaders.row.name} {pct(leaders.value, 1)}</b>가 시장을 주도하고,{" "}
        <b className={laggards.relative >= 0 ? "sec-up" : "sec-down"}>{laggards.row.name} {pct(laggards.value, 1)}</b>가 가장 약합니다. S&amp;P 500 대비{" "}
        <b className="tabular-nums">{beatCount}/{rows.length}</b>개 섹터가 상회 중입니다.
      </>
    );
  } else {
    headline = "섹터 자료 일부를 불러왔지만 기간별 모멘텀 기준선은 아직 없습니다.";
  }

  return (
    <div className="sec" data-sectors-surface>
      <div className="sec-head">
        <div className="sec-title-block">
          <div className="sec-eyebrow-row">
            <span className="sec-eyebrow">SECTORS · GICS 기준 11개 업종 흐름</span>
            <Pill>섹터 11개</Pill>
          </div>
          <h1 className="sec-title">{headline}</h1>
          <div className="sec-meta-row">
            <Pill tone={sourceMeta.tickerSourceDate ? "neutral" : "warn"}>시세 수집 {quoteLabel}</Pill>
            {failed && (
              <Button variant="secondary" onClick={refresh}>
                다시 시도
              </Button>
            )}
            {missingLabels.length > 0 && (
              <Pill tone="warn">{missingLabels.join(" · ")} 확인 불가</Pill>
            )}
          </div>
        </div>
        <div className="sec-tabs">
          <MarketSectionNav active="sectors" />
        </div>
      </div>

      <SectorFlowPanel
        rows={rows}
        benchmarkValue={activeBenchmark}
        windowKey={sortWindow}
        onWindowChange={setSortWindow}
        loading={loading}
        ready={benchmarksReady}
        failed={flowFailed}
        stale={flowStale}
        clock={sourceMeta.benchmarksSourceDate}
        lkgClock={sourceMeta.benchmarksSourceDate}
        coverage={flowCoverage}
        onRetry={refresh}
      />

      <EtfComparePanel
        rows={rows}
        loading={loading}
        ready={etfsReady}
        failed={etfFailed}
        stale={etfStale}
        clock={sourceMeta.etfSourceDate}
        lkgClock={sourceMeta.etfSourceDate}
        coverage={etfCoverage}
        missingNote={etfMissingNote}
        onRetry={refresh}
      />

      <SmartMoneyPanel
        rows={rows}
        sourceMeta={sourceMeta}
        loading={loading}
        ready={smartMoneyReady}
        failed={smartFailed}
        stale={smartStale}
        asOf={smartAsOf}
        lkgClock={sourceMeta.smartMoneySourceDate}
        coverage={smartCoverage}
        onRetry={refresh}
      />

      <div className="sec-cta">
        <div className="sec-cta-actions">
          <Button variant="primary" onClick={() => router.push(ROUTES.marketEvents)}>
            업종 이벤트 보기
          </Button>
          <Button variant="secondary" onClick={() => router.push(ROUTES.superinvestors)}>
            투자 대가 보유 보기
          </Button>
        </div>
        <span className="sec-cta-note">투자 조언 아님 · 데이터 지연 가능</span>
      </div>
    </div>
  );
}
