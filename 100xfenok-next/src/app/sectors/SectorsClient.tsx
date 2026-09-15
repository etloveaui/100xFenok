"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import SmartMoneyPanel from "./SmartMoneyPanel";
import RotationMapPanel from "./RotationMapPanel";
import RotationStripPanel from "./RotationStripPanel";
import ValuationBandPanel from "./ValuationBandPanel";
import { Bar, Button, EvidenceRail, Panel, PanelHeader, Pill, Stat, StatStrip } from "@/components/ui";
import MarketSectionNav from "@/components/market/MarketSectionNav";
import TransitionLink from "@/components/TransitionLink";
import { ROUTES, withQuery } from "@/lib/routes";
import { PE_BAND_WINDOW_LABEL, useSectorData } from "@/hooks/useSectorData";
import {
  MOMENTUM_WINDOWS,
  type MomentumWindow,
  type SectorRow,
} from "@/lib/sectors/types";
import {
  ROTATION_WINDOWS,
  bandPosition,
  rotationPoints,
  rotationRead,
  type RotationPoint,
  type RotationWindow,
} from "@/lib/sectors/rotation";
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

/** Spread magnitude between the two ends of the strip: 1 decimal, no sign. */
function gapPp(value: number): string {
  return `${formatDecimal(value, { digits: 1 })}%p`;
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

type AccordionSection = "bars" | "etf" | "valuation" | "smart";

function CollapsedBar({
  section,
  eyebrow,
  title,
  meta,
  onOpen,
}: {
  section: AccordionSection;
  eyebrow: string;
  title: string;
  meta: ReactNode;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="sec-acc-closed"
      aria-expanded={false}
      onClick={onOpen}
      data-sectors-accordion={section}
      data-sectors-accordion-toggle={section}
    >
      <svg className="sec-acc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      <span className="sec-acc-titles">
        <span className="sec-eyebrow">{eyebrow}</span>
        <span className="sec-acc-title">{title}</span>
      </span>
      <span className="sec-head-note">{meta}</span>
    </button>
  );
}

function CollapsedSection({
  section,
  eyebrow,
  title,
  meta,
  onOpen,
  freshness,
  source,
  asOf,
  coverage,
  next,
  onEvidence,
}: {
  section: AccordionSection;
  eyebrow: string;
  title: string;
  meta: ReactNode;
  onOpen: () => void;
  freshness: "fresh" | "stale" | "fixed" | "pending" | "error" | "partial";
  source: string;
  asOf: string;
  coverage: string;
  next?: string;
  onEvidence?: () => void;
}) {
  // Collapsed accordions keep a compact one-line EvidenceRail (source ·
  // 기준 · 커버리지) so the closed state still carries provenance.
  return (
    <div className="sec-acc-wrap">
      <CollapsedBar
        section={section}
        eyebrow={eyebrow}
        title={title}
        meta={meta}
        onOpen={onOpen}
      />
      <EvidenceRail
        freshness={freshness}
        source={source}
        asOf={asOf}
        coverage={coverage}
        next={next}
        onEvidence={onEvidence}
      />
    </div>
  );
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
  onCollapse,
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
  onCollapse: () => void;
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
              <>
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
                <Button type="button" data-sectors-collapse="bars" onClick={onCollapse}>접기</Button>
              </>
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
  onCollapse,
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
  onCollapse: () => void;
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
            right={(
              <>
                <span className="sec-head-note">{coverage} 섹터 ETF 상세{missingNote ? ` · ${missingNote} 없음` : ""}</span>
                <Button type="button" data-sectors-collapse="etf" onClick={onCollapse}>접기</Button>
              </>
            )}
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
          <div className="sec-etf-mobile-list" data-sectors-etf-cards aria-label="섹터 ETF 비교 목록">
            {etfRows.map((row) => {
              const oneMonth = row.etfInfo?.returns["1m"];
              const oneMonthTone = toneOf(oneMonth);
              return (
                <article key={row.key} className="sec-etf-card" data-sectors-etf-card={row.etf}>
                  <div className="sec-etf-card__head">
                    <span className="sec-ticker sec-ticker-strong">{row.etf}</span>
                    <span className="sec-etf-sector">{row.name}</span>
                  </div>
                  <dl className="sec-etf-card__stats">
                    <div>
                      <dt>1M</dt>
                      <dd className={oneMonthTone === "positive" ? "sec-up tabular-nums" : oneMonthTone === "negative" ? "sec-down tabular-nums" : "tabular-nums"}>{pct(oneMonth, 1)}</dd>
                    </div>
                    <div>
                      <dt>YTD</dt>
                      <dd className="tabular-nums">{pct(row.etfInfo?.returns.ytd, 1)}</dd>
                    </div>
                    <div>
                      <dt>1Y</dt>
                      <dd className="tabular-nums">{pct(row.etfInfo?.returns["1y"], 1)}</dd>
                    </div>
                    <div>
                      <dt>3Y CAGR</dt>
                      <dd className="tabular-nums">{pct(row.etfInfo?.cagr["3y"], 1)}</dd>
                    </div>
                    <div>
                      <dt>5Y CAGR</dt>
                      <dd className="tabular-nums">{pct(row.etfInfo?.cagr["5y"], 1)}</dd>
                    </div>
                    <div>
                      <dt>Beta</dt>
                      <dd className="tabular-nums">{formatDecimal(row.etfInfo?.beta, { digits: 2 })}</dd>
                    </div>
                    <div>
                      <dt>보수율</dt>
                      <dd className="tabular-nums">{typeof row.etfInfo?.expenseRatio === "number" ? formatPercent(row.etfInfo.expenseRatio * 100, 2) : "—"}</dd>
                    </div>
                  </dl>
                </article>
              );
            })}
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

/* Above/below-benchmark spread (study P1+P2): the same relative momentum the
 * rotation map plots, read as a 0-centered 1D strip plus the four counts. Dot
 * fill follows the map (relative >= 0 is this route's gain side); the above
 * count follows rotationRead's beat rule (relative > 0). A sector leaves the
 * domain only when it has no measured value — a bandless sector keeps its
 * position and is named in the note instead. */
const SPREAD_PAD_RATIO = 0.08;

function spreadPlot(points: RotationPoint[]) {
  const relatives = points.map((point) => point.relative);
  const lo = Math.min(0, ...relatives);
  const hi = Math.max(0, ...relatives);
  const span = Math.max(0.5, hi - lo);
  const pad = span * SPREAD_PAD_RATIO;
  const dLo = lo - pad;
  const dHi = hi + pad;
  const caps = points
    .map((point) => point.row.etfInfo?.marketCap)
    .filter((cap): cap is number => typeof cap === "number" && cap > 0);
  const maxCap = Math.max(...caps, 1);
  return {
    /** axis ends, printed under the track */
    dLo,
    dHi,
    /** dot centre as a share of the track width */
    leftPct: (value: number) => ((value - dLo) / (dHi - dLo)) * 100,
    /** the rotation map's bubble diameter (16–56px) halved for the strip */
    diameterPx: (point: RotationPoint) => {
      const cap = point.row.etfInfo?.marketCap;
      if (typeof cap !== "number" || cap <= 0) return 12;
      return 8 + 20 * Math.sqrt(cap / maxCap);
    },
  };
}

function SectorsSpreadStrip({
  rows,
  points,
  bandless,
  bandHighCount,
  bandReady,
  windowLabel,
  loading,
  failed,
  onRetry,
}: {
  rows: SectorRow[];
  points: RotationPoint[];
  bandless: RotationPoint[];
  bandHighCount: number;
  bandReady: boolean;
  windowLabel: string;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const ready = points.length > 0;
  const plot = spreadPlot(points);
  const strongest = points[0] ?? null;
  const weakest = points.length > 1 ? points[points.length - 1] : null;
  const aboveCount = points.filter((point) => point.relative > 0).length;
  const missingCount = rows.length - points.length;
  const zeroPct = plot.leftPct(0);
  // The 0 tick needs room beside the end labels; the hairline always prints.
  const showZeroLabel = zeroPct >= 12 && zeroPct <= 88;
  const ariaLabel = ready
    ? `${windowLabel} S&P 500 대비 상대 모멘텀 분포 · ${points.map((point) => `${point.row.name} ${pp(point.relative)}`).join(" · ")}`
    : "S&P 500 대비 상대 모멘텀 분포";
  const readLine = strongest === null
    ? null
    : weakest === null
      ? `${windowLabel} 기준 ${strongest.row.name} ${pp(strongest.relative)} 한 곳만 값이 확보됐습니다.`
      : `${windowLabel} 기준 최강 ${strongest.row.name} ${pp(strongest.relative)} · 최약 ${weakest.row.name} ${pp(weakest.relative)} · 격차 ${gapPp(strongest.relative - weakest.relative)}입니다.`;
  const noteParts = ["점 크기 = 시가총액"];
  if (missingCount > 0) noteParts.push(`값 미확보 ${missingCount}개 업종 제외`);
  if (bandless.length > 0) noteParts.push(`밴드 미확보 ${bandless.length}개는 지도 밖`);

  return (
    <Panel
      loading={loading}
      empty={!loading && !ready}
      emptyReason={failed ? "S&P 500 대비 섹터 분포를 불러오지 못했습니다" : "표시할 상대 모멘텀 자료가 없습니다"}
      emptyNextRefresh="다음 마감 후 갱신"
      emptyActionLabel={failed ? "다시 시도" : undefined}
      onEmptyAction={failed ? onRetry : undefined}
    >
      <PanelHeader eyebrow="Spread" title="S&P 500 대비 상회·하회 분포" />
      {ready ? (
        <div className="sec-spread" data-sectors-spread="true">
          <div className="sec-spread-main">
            <div className="sec-spread-head">
              <span className="sec-spread-side">하회</span>
              <span className="sec-spread-measure">S&amp;P 500 대비 상대 모멘텀 (%p)</span>
              <span className="sec-spread-side">상회</span>
            </div>
            <div className="sec-spread-track" data-sectors-spread-track="true" role="img" aria-label={ariaLabel}>
              <span className="sec-spread-axis" aria-hidden="true" />
              <span className="sec-spread-zero" aria-hidden="true" style={{ left: `${zeroPct}%` }} />
              {points.map((point) => {
                const size = plot.diameterPx(point);
                const up = point.relative >= 0;
                return (
                  <span
                    key={point.row.key}
                    className={up ? "sec-spread-dot sec-spread-dot-up" : "sec-spread-dot sec-spread-dot-down"}
                    data-sectors-spread-dot={point.row.etf}
                    style={{ left: `${plot.leftPct(point.relative)}%`, width: `${size}px`, height: `${size}px` }}
                    title={`${point.row.name} ${pp(point.relative)} · S&P 500 ${up ? "상회" : "하회"}`}
                  />
                );
              })}
            </div>
            <div className="sec-spread-scale">
              <span className="sec-spread-end tabular-nums">{pp(plot.dLo)}</span>
              {showZeroLabel && (
                <span className="sec-spread-zero-label tabular-nums" style={{ left: `${zeroPct}%` }}>0</span>
              )}
              <span className="sec-spread-end tabular-nums">{pp(plot.dHi)}</span>
            </div>
            <p className="sec-spread-count">{`${points.length}개 업종 중 ${aboveCount}개가 S&P 500 상회`}</p>
            {readLine && <p className="sec-spread-read">{readLine}</p>}
            <p className="sec-spread-note">{noteParts.join(" · ")}</p>
          </div>
          <div className="sec-spread-stats" data-sectors-spread-stats="true">
            <StatStrip className="sec-stat-strip">
              <Stat
                className="sec-stat"
                label="S&P 상회"
                value={`${aboveCount}/${points.length}`}
                sub={`${windowLabel} 기준`}
              />
              <Stat
                className="sec-stat"
                label="최강"
                value={strongest ? <span className={strongest.relative >= 0 ? "sec-up" : "sec-down"}>{pp(strongest.relative)}</span> : "—"}
                sub={strongest ? `${strongest.row.name} ${strongest.row.etf}` : undefined}
              />
              <Stat
                className="sec-stat"
                label="최약"
                value={weakest ? <span className={weakest.relative >= 0 ? "sec-up" : "sec-down"}>{pp(weakest.relative)}</span> : "—"}
                sub={weakest ? `${weakest.row.name} ${weakest.row.etf}` : undefined}
              />
              <Stat
                className="sec-stat"
                label="밴드 상단"
                value={bandReady ? `${bandHighCount}개` : "—"}
                sub="Fwd P/E 5년 밴드 상위 절반"
              />
            </StatStrip>
          </div>
        </div>
      ) : (
        <div className="sec-spread" data-sectors-spread="true">
          <p className="sec-spread-read sec-spread-pending">
            {loading ? "상대 모멘텀 분포를 불러오는 중입니다" : "표시할 상대 모멘텀 자료가 없습니다"}
          </p>
        </div>
      )}
    </Panel>
  );
}

export default function SectorsClient() {
  const router = useRouter();
  const {
    rows,
    benchmarkMomentum,
    prevSnapshot,
    loaded,
    dataReady,
    benchmarksReady,
    etfsReady,
    valuationReady,
    smartMoneyReady,
    failedSources,
    staleSources,
    sourceMeta,
    refresh,
  } = useSectorData();
  const [sortWindow, setSortWindow] = useState<MomentumWindow>("1m");
  const [rotationWindow, setRotationWindow] = useState<RotationWindow>("1m");
  const [openSections, setOpenSections] = useState<ReadonlySet<AccordionSection>>(
    () => new Set<AccordionSection>(["bars", "etf"]),
  );

  // Multi-open accordion: each toggle copies the set so React sees a new
  // reference and the previously open layers stay open.
  const toggleSection = (section: AccordionSection) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const loading = !loaded;
  const failed = loaded && !dataReady;
  const rotationLabel = ROTATION_WINDOWS.find((w) => w.key === rotationWindow)?.label ?? rotationWindow;
  const rotationBenchmark = benchmarkMomentum?.[rotationWindow] ?? null;
  const rotationPts = benchmarksReady ? rotationPoints(rows, rotationWindow, rotationBenchmark) : [];
  const rotationBandless = rotationPts.filter((point) => point.quadrant === null);
  const rotationBandCount = rotationPts.filter((point) => point.band !== null).length;
  const rotationTop = rotationPts[0] ?? null;
  const rotationValued = rows.filter((row) => typeof row.momentum[rotationWindow] === "number").length;
  const rotationIncomplete = benchmarksReady && rotationValued < rows.length;
  const activeBenchmark = benchmarkMomentum?.[sortWindow] ?? null;

  const flowValuedCount = benchmarksReady
    ? rows.filter((row) => typeof row.momentum[sortWindow] === "number").length
    : 0;
  const flowIncomplete = benchmarksReady && flowValuedCount < rows.length;
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

  const valuationFailed = loaded && !valuationReady;
  const valuationStale = valuationReady && (staleSources.includes("us_sectors") || isStaleAsOf(sourceMeta.valuationLatestDate));
  const bandCount = valuationReady ? rows.filter((row) => bandPosition(row) !== null).length : 0;
  const bandHighCount = valuationReady
    ? rows.filter((row) => {
        const band = bandPosition(row);
        return band !== null && band >= 50;
      }).length
    : 0;
  const valuationCoverage = valuationReady ? `${bandCount}/${rows.length} 섹터 · ${PE_BAND_WINDOW_LABEL}` : "—";

  const heroFailed = loaded && !benchmarksReady;
  const heroEmpty = !loading && (!benchmarksReady || rotationPts.length === 0);
  const heroAsOfLabel = formatAsOf(sourceMeta.benchmarksSourceDate) ?? "—";

  const missingLabels = Array.from(new Set(failedSources.map(failedSourceLabel).filter((label): label is string => Boolean(label))));
  const quoteLabel = formatAsOf(sourceMeta.tickerSourceDate) ?? "확인 중";

  let headline: ReactNode;
  if (loading) {
    headline = "섹터 데이터를 불러오는 중입니다.";
  } else if (failed) {
    headline = "섹터 데이터를 불러오지 못했습니다. 다시 시도해 주세요.";
  } else if (benchmarksReady) {
    headline = rotationRead(rows, rotationWindow, rotationLabel, benchmarkMomentum, rows.length, prevSnapshot);
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

      <SectorsSpreadStrip
        rows={rows}
        points={rotationPts}
        bandless={rotationBandless}
        bandHighCount={bandHighCount}
        bandReady={valuationReady}
        windowLabel={rotationLabel}
        loading={loading}
        failed={heroFailed}
        onRetry={refresh}
      />

      <Panel
        loading={loading}
        empty={heroEmpty}
        emptyReason={heroFailed ? "로테이션 지도 자료를 불러오지 못했습니다" : "표시할 로테이션 자료가 없습니다"}
        emptyNextRefresh="다음 마감 후 갱신"
        emptyActionLabel={heroFailed ? "다시 시도" : undefined}
        onEmptyAction={heroFailed ? refresh : undefined}
        stale={flowStale}
        asOf={sourceMeta.benchmarksSourceDate ?? undefined}
        onRetry={flowStale ? refresh : undefined}
      >
        {benchmarksReady && rotationPts.length > 0 && (
          <div data-sectors-rotation-hero="true">
            <PanelHeader
              eyebrow="Rotation Map"
              title="로테이션 지도 — 모멘텀 × 밸류 밴드"
              right={<Pill>{rotationLabel} 기준</Pill>}
            />
            <RotationMapPanel
              points={rotationPts}
              bandless={rotationBandless}
              windowKey={rotationWindow}
              windowLabel={rotationLabel}
              onWindowChange={setRotationWindow}
            />
          </div>
        )}
        <EvidenceRail
          freshness={loading ? "pending" : heroFailed ? "error" : flowStale ? "stale" : rotationIncomplete || rotationBandless.length > 0 ? "partial" : sourceMeta.benchmarksSourceDate ? "fresh" : "fixed"}
          source="SlickCharts · Yahoo · 밸류 밴드"
          asOf={heroAsOfLabel}
          coverage={benchmarksReady ? `${rotationPts.length}/${rows.length} · 밴드 ${rotationBandCount}/${rows.length}` : "—"}
          lkgAsOf={flowStale && sourceMeta.benchmarksSourceDate ? (formatAsOf(sourceMeta.benchmarksSourceDate) ?? sourceMeta.benchmarksSourceDate) : undefined}
          onRetry={heroFailed || flowStale || rotationIncomplete || rotationBandless.length > 0 ? refresh : undefined}
          onEvidence={benchmarksReady && !heroFailed ? () => openEvidence(ROUTES.sectorMomentumJson) : undefined}
        />
      </Panel>

      <RotationStripPanel
        rows={rows}
        benchmarkMomentum={benchmarkMomentum}
        loading={loading}
        ready={benchmarksReady}
        failed={flowFailed}
        stale={flowStale}
        clock={sourceMeta.benchmarksSourceDate}
        lkgClock={sourceMeta.benchmarksSourceDate}
        onRetry={refresh}
      />

      <div data-sectors-accordion="bars">
        {openSections.has("bars") ? (
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
            onCollapse={() => toggleSection("bars")}
          />
        ) : (
          <CollapsedSection
            section="bars"
            eyebrow="Sector Flow"
            title="상대성과 바"
            meta={`${rows.length}개 업종 전체`}
            onOpen={() => toggleSection("bars")}
            freshness={loading ? "pending" : flowFailed ? "error" : flowIncomplete ? "partial" : flowStale ? "stale" : sourceMeta.benchmarksSourceDate ? "fresh" : "fixed"}
            source="SlickCharts · Yahoo"
            asOf={formatAsOf(sourceMeta.benchmarksSourceDate) ?? "—"}
            coverage={flowCoverage}
            onEvidence={benchmarksReady && !flowFailed ? () => openEvidence(ROUTES.sectorMomentumJson) : undefined}
          />
        )}
      </div>

      <div data-sectors-accordion="etf">
        {openSections.has("etf") ? (
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
            onCollapse={() => toggleSection("etf")}
          />
        ) : (
          <CollapsedSection
            section="etf"
            eyebrow="ETF"
            title="섹터 ETF 비교"
            meta={`${etfCoverage} 섹터 ETF 상세`}
            onOpen={() => toggleSection("etf")}
            freshness={loading ? "pending" : etfFailed ? "error" : etfsReady && etfRows.length < rows.length ? "partial" : etfStale ? "stale" : sourceMeta.etfSourceDate ? "fresh" : "fixed"}
            source="ETF 운용사 공시"
            asOf={formatAsOf(sourceMeta.etfSourceDate) ?? "—"}
            coverage={etfCoverage}
            onEvidence={etfsReady && !etfFailed ? () => openEvidence("/data/global-scouter/etfs/index.json") : undefined}
          />
        )}
      </div>

      <div data-sectors-accordion="valuation">
        {openSections.has("valuation") ? (
          <ValuationBandPanel
            rows={rows}
            loading={loading}
            ready={valuationReady}
            failed={valuationFailed}
            stale={valuationStale}
            clock={sourceMeta.valuationLatestDate}
            source={sourceMeta.valuationSource}
            coverage={valuationCoverage}
            lkgClock={sourceMeta.valuationLatestDate}
            onRetry={refresh}
            onCollapse={() => toggleSection("valuation")}
          />
        ) : (
          <CollapsedSection
            section="valuation"
            eyebrow="Valuation"
            title="밸류에이션 밴드"
            meta={valuationReady ? `밴드 확보 ${bandCount}/${rows.length} · 고평가권 ${bandHighCount}개` : "확인 중"}
            onOpen={() => toggleSection("valuation")}
            freshness={loading ? "pending" : valuationFailed ? "error" : valuationStale ? "stale" : valuationReady && bandCount < rows.length ? "partial" : "fixed"}
            source={sourceMeta.valuationSource ?? "밸류에이션 자료"}
            asOf={formatAsOf(sourceMeta.valuationLatestDate) ?? "—"}
            coverage={valuationCoverage}
            onEvidence={valuationReady && !valuationFailed ? () => openEvidence("/data/benchmarks/us_sectors.json") : undefined}
          />
        )}
      </div>

      <div data-sectors-accordion="smart">
        {openSections.has("smart") ? (
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
            onCollapse={() => toggleSection("smart")}
          />
        ) : (
          <CollapsedSection
            section="smart"
            eyebrow="13F · 기관 보유"
            title="13F 섹터 흐름"
            meta={smartMoneyReady ? (
              <Pill tone="warn">부분 반영 · {smartCoverage}</Pill>
            ) : (
              "확인 중"
            )}
            onOpen={() => toggleSection("smart")}
            freshness={loading ? "pending" : smartFailed ? "error" : "stale"}
            source="SEC EDGAR 13F"
            asOf={formatAsOf(smartAsOf) ?? "—"}
            coverage={smartCoverage}
            next="분기 종료 후 최대 45일"
            onEvidence={smartMoneyReady && !smartFailed ? () => openEvidence("/data/sec-13f/analytics/portfolio_views.json") : undefined}
          />
        )}
      </div>

      <Panel>
        <div data-sectors-actions="true">
          <PanelHeader
            eyebrow="Action"
            title="행동"
          />
          <div className="sec-action-buttons">
            <Button
              variant="primary"
              onClick={() => router.push(rotationTop ? screenerSectorHref(rotationTop.row.key) : ROUTES.screener)}
            >
              {rotationTop ? `스크리너로 보내기 · ${rotationTop.row.name} 사전 필터` : "스크리너로 보내기"}
            </Button>
            <Button variant="secondary" onClick={() => router.push(ROUTES.marketEvents)}>
              업종 이벤트 보기
            </Button>
          </div>
        </div>
        <div className="sec-action-rail">
          <span>연결 <b>스크리너 · 이벤트 캘린더</b></span>
          <span className="sec-cta-note">투자 조언 아님 · 데이터 지연 가능</span>
        </div>
      </Panel>
    </div>
  );
}
