"use client";

import TransitionLink from "@/components/TransitionLink";
import { EvidenceRail, Panel, PanelHeader } from "@/components/ui";
import { formatInteger } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import {
  computeEtfInsights,
  etfClockKind,
  etfInlineClockLabel,
  etfRailClockDate,
  etfSnapshotPublishedClocks,
  etfSnapshotSubfeedClocks,
  fmtSignedPct,
  fmtVolumeCompact,
  isEtfClockStale,
  openEtfEvidence,
  type EtfSurfaceData,
} from "./etfSurfaceData";

function TodayMoverLink({ ticker, valueLabel, valueClassName }: { ticker?: string; valueLabel: string; valueClassName?: string }) {
  if (!ticker) return null;
  return (
    <TransitionLink href={ROUTES.etf(ticker)} className="etf-today-row">
      <span className="etf-ticker">{ticker}</span>
      <span className={`tabular-nums etf-today-value ${valueClassName ?? ""}`}>{valueLabel}</span>
    </TransitionLink>
  );
}

export default function EtfTodayPanel({ surface }: { surface: EtfSurfaceData }) {
  const { loaded, snapshotOk, rows, snapshot, reload } = surface;
  // Today leaders + new listings are snapshot-feed truth: a failed snapshot
  // feed empties the panel even when the universe feed is fine, so a blank
  // leader board is never promoted to full fresh (fh-681 P1).
  const insights = loaded && snapshotOk ? computeEtfInsights(rows, snapshot, null) : null;
  const loading = !loaded;
  const empty = loaded && !insights;
  const feedFailed = loaded && !snapshotOk;
  // Per-subfeed clocks: the new-listings block reads the new-ETFs feed while
  // both leader boards read the screener feed, so each block shows its own
  // date — the masked snapshot latest could hide a stale displayed sibling.
  const clocks = etfSnapshotSubfeedClocks(snapshot);
  const newClock = clocks.newEtfs;
  const screenerClock = clocks.screener;
  // Publication fallback per displayed block (fh-349): never an observation date.
  const publishedClocks = etfSnapshotPublishedClocks(snapshot);
  const newPublished = publishedClocks.newEtfs;
  const screenerPublished = publishedClocks.screener;
  const stale = loaded && !!insights && (isEtfClockStale(newClock) || isEtfClockStale(screenerClock));
  // Panel floor is the oldest displayed subfeed clock (completeness floor).
  const floor = [newClock, screenerClock]
    .filter((value): value is string => value !== null)
    .sort()
    .at(0) ?? null;
  const publishedFloor = [newPublished, screenerPublished]
    .filter((value): value is string => value !== null)
    .sort()
    .at(0) ?? null;

  const newPreview = snapshot?.newEtfs?.records?.slice(0, 3) ?? [];
  const volumeLeaders = insights?.volumeLeadersTop3 ?? [];
  const changeLeaders = insights?.changeLeadersTop3 ?? [];
  const asOfLabel = etfRailClockDate(floor, publishedFloor);
  const asOfKind = etfClockKind(floor, publishedFloor);

  return (
    <Panel
      loading={loading}
      empty={empty}
      emptyReason={feedFailed ? "오늘의 ETF 신호를 불러오지 못했습니다" : "표시할 오늘의 ETF 신호가 없습니다"}
      emptyNextRefresh="다음 마감 후 갱신"
      emptyActionLabel={feedFailed ? "다시 시도" : undefined}
      onEmptyAction={feedFailed ? reload : undefined}
      stale={stale}
      asOf={floor ?? undefined}
      onRetry={stale ? reload : undefined}
    >
      <PanelHeader
        eyebrow="Today"
        title="오늘의 ETF 신호"
        right={
          <span className="etf-tabs" role="group" aria-label="ETF 바로가기">
            <TransitionLink href={ROUTES.etfCompare} className="etf-tab" data-active="true">
              ETF 비교
            </TransitionLink>
            <TransitionLink href={ROUTES.etfNew} className="etf-tab">
              신규 ETF
            </TransitionLink>
          </span>
        }
      />
      {insights ? (
        <div className="etf-today-grid">
          <div className="etf-today-stat">
            <span className="etf-today-label">신규 상장 ETF</span>
            <span className="tabular-nums etf-today-big">
              {formatInteger(insights.newCount)}
              <span className="etf-today-unit">개</span>
            </span>
            <span className="etf-today-asof">{etfInlineClockLabel(newClock, newPublished)}</span>
            <div className="etf-today-list">
              {newPreview.length > 0 ? (
                newPreview.map((row) => (
                  <TodayMoverLink key={`new-${row.s}`} ticker={row.s} valueLabel={row.inceptionDate ?? "—"} />
                ))
              ) : (
                <span className="etf-today-empty">신규 상장 없음</span>
              )}
            </div>
          </div>
          <div className="etf-today-stat">
            <span className="etf-today-label">거래량 상위 TOP 3</span>
            <span className="tabular-nums etf-today-big">
              {formatInteger(volumeLeaders.length)}
              <span className="etf-today-unit">종목</span>
            </span>
            <span className="etf-today-asof">{etfInlineClockLabel(screenerClock, screenerPublished)}</span>
            <div className="etf-today-list">
              {volumeLeaders.map((row) => (
                <TodayMoverLink key={`vol-${row.s}`} ticker={row.s} valueLabel={fmtVolumeCompact(row.volume)} />
              ))}
            </div>
          </div>
          <div className="etf-today-stat">
            <span className="etf-today-label">변동률 상위 TOP 3</span>
            <span className="tabular-nums etf-today-big">
              {formatInteger(changeLeaders.length)}
              <span className="etf-today-unit">종목</span>
            </span>
            <span className="etf-today-asof">{etfInlineClockLabel(screenerClock, screenerPublished)}</span>
            <div className="etf-today-list">
              {changeLeaders.map((row) => (
                <TodayMoverLink
                  key={`chg-${row.s}`}
                  ticker={row.s}
                  valueLabel={fmtSignedPct(row.change)}
                  valueClassName={typeof row.change === "number" ? (row.change >= 0 ? "etf-up" : "etf-down") : undefined}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
      <EvidenceRail
        freshness={loading ? "pending" : feedFailed ? "error" : stale ? "stale" : (floor ?? publishedFloor) ? "fresh" : "fixed"}
        source="거래소 · 발행사 공시"
        asOf={asOfLabel}
        asOfKind={asOfKind === "published" ? "published" : undefined}
        coverage={insights ? `${formatInteger(insights.totalCount)}개 전량` : "—"}
        lkgAsOf={stale && floor ? floor : undefined}
        onRetry={feedFailed || stale ? reload : undefined}
        onEvidence={feedFailed ? undefined : () => openEtfEvidence("/api/data/stockanalysis/etf-snapshot")}
      />
    </Panel>
  );
}
