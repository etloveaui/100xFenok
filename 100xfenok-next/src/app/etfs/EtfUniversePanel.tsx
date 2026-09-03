"use client";

import { Bar, EvidenceRail, Panel, PanelHeader, Pill } from "@/components/ui";
import { formatInteger } from "@/lib/format";
import {
  computeEtfInsights,
  etfClockKind,
  etfRailClockDate,
  etfUniverseAsOf,
  etfUniversePublishedAt,
  isEtfClockStale,
  openEtfEvidence,
  type EtfSurfaceData,
} from "./etfSurfaceData";

export default function EtfUniversePanel({ surface }: { surface: EtfSurfaceData }) {
  const { loaded, universeOk, rows, snapshot, reload } = surface;
  // Universe composition is universe-feed truth: a failed universe feed empties
  // the panel even when the snapshot feed is fine (fh-681 P1).
  const insights = loaded && universeOk ? computeEtfInsights(rows, snapshot, null) : null;
  const loading = !loaded;
  const empty = loaded && !insights;
  const feedFailed = loaded && !universeOk;
  const clock = etfUniverseAsOf(surface.universe);
  const published = etfUniversePublishedAt(surface.universe);
  const stale = loaded && !!insights && isEtfClockStale(clock ?? published);

  const compositionSummary = (insights?.compositionBuckets ?? [])
    .filter((bucket) => bucket.count > 0)
    .map((bucket) => `${bucket.label} ${bucket.pct}%`)
    .join(" · ");
  const asOfLabel = etfRailClockDate(clock, published);
  const asOfKind = etfClockKind(clock, published);

  return (
    <Panel
      loading={loading}
      empty={empty}
      emptyReason={feedFailed ? "ETF 시장 개요를 불러오지 못했습니다" : "표시할 ETF 시장 데이터가 없습니다"}
      emptyNextRefresh="다음 마감 후 갱신"
      emptyActionLabel={feedFailed ? "다시 시도" : undefined}
      onEmptyAction={feedFailed ? reload : undefined}
      stale={stale}
      asOf={clock ?? undefined}
      onRetry={stale ? reload : undefined}
    >
      <PanelHeader
        eyebrow="Universe"
        title="ETF 시장 개요"
        right={<span className="etf-head-note">전체 {formatInteger(insights?.totalCount ?? 0)}개 기준</span>}
      />
      {insights ? (
        <div className="etf-uni-grid">
          <div className="etf-uni-cell">
            <div className="etf-uni-label-row">
              <span className="etf-uni-label">자산군 구성비 · 최대 비중</span>
              <Pill>
                {insights.dominantBucket?.label ?? "—"} {insights.dominantBucket?.pct ?? 0}%
              </Pill>
            </div>
            <Bar value={insights.dominantBucket?.pct ?? 0} aria-label={`자산군 최대 비중 ${insights.dominantBucket?.label ?? ""} ${insights.dominantBucket?.pct ?? 0}%`} />
            <span className="etf-uni-summary">{compositionSummary || "—"}</span>
          </div>
          <div className="etf-uni-cell">
            <div className="etf-uni-label-row">
              <span className="etf-uni-label">레버리지·인버스</span>
              <span className="tabular-nums etf-uni-pct">{insights.leverageInversePct}%</span>
            </div>
            <Bar
              className="etf-bar-warn"
              value={insights.leverageInversePct}
              aria-label={`레버리지·인버스 비중 ${insights.leverageInversePct}%`}
            />
            <span className="etf-uni-summary">
              전체 {formatInteger(insights.totalCount)}개 중{" "}
              <b className="tabular-nums etf-strong">{formatInteger(insights.leverageInverseCount)}개</b>가 레버리지 또는 인버스
            </span>
          </div>
        </div>
      ) : null}
      <EvidenceRail
        freshness={loading ? "pending" : feedFailed ? "error" : stale ? "stale" : (clock ?? published) ? "fresh" : "fixed"}
        source="ETF 발행사 목록"
        asOf={asOfLabel}
        asOfKind={asOfKind === "published" ? "published" : undefined}
        coverage={insights ? `${formatInteger(insights.totalCount)}개 전량` : "—"}
        lkgAsOf={stale && clock ? clock : undefined}
        onRetry={feedFailed || stale ? reload : undefined}
        onEvidence={feedFailed ? undefined : () => openEtfEvidence("/api/data/stockanalysis/etf-universe")}
      />
    </Panel>
  );
}
