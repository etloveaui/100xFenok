"use client";

import { Bar, EvidenceRail, Panel, PanelHeader, Pill } from "@/components/ui";
import { formatAsOf } from "@/lib/data-state";
import { formatInteger } from "@/lib/format";
import { computeEtfInsights, openEtfEvidence, useEtfSurfaceData } from "./etfSurfaceData";

export default function EtfUniversePanel() {
  const { loaded, failed, rows, snapshot, reload } = useEtfSurfaceData();
  const insights = loaded && !failed ? computeEtfInsights(rows, snapshot, null) : null;
  const loading = !loaded;
  const empty = loaded && (failed || !insights);

  const compositionSummary = (insights?.compositionBuckets ?? [])
    .filter((bucket) => bucket.count > 0)
    .map((bucket) => `${bucket.label} ${bucket.pct}%`)
    .join(" · ");
  const asOfLabel = formatAsOf(insights?.asOf ?? null) ?? "제공자 미공개";

  return (
    <Panel
      loading={loading}
      empty={empty}
      emptyReason={failed ? "ETF 시장 개요를 불러오지 못했습니다" : "표시할 ETF 시장 데이터가 없습니다"}
      emptyNextRefresh="다음 마감 후 갱신"
      emptyActionLabel={failed ? "다시 시도" : undefined}
      onEmptyAction={failed ? reload : undefined}
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
        freshness={loading ? "pending" : failed ? "error" : insights?.asOf ? "fresh" : "fixed"}
        source="ETF 발행사 목록"
        asOf={asOfLabel}
        coverage={insights ? `${formatInteger(insights.totalCount)}개 전량` : "—"}
        onRetry={failed ? reload : undefined}
        onEvidence={failed ? undefined : () => openEtfEvidence("/api/data/stockanalysis/etf-universe")}
      />
    </Panel>
  );
}
