"use client";

import { DistributionBand, Stat, StatStrip } from "@/components/ui";
import { formatInteger } from "@/lib/format";
import {
  computeEtfInsights,
  type EtfCompositionBucketKey,
  type EtfSurfaceData,
} from "./etfSurfaceData";

/* Categorical tones for the asset-class band: buckets are kinds, not grades —
 * the legend and aria label carry the exact counts, so no tone implies a
 * judgment. Tones are keyed by bucket (not rank), so colors stay stable. */
const BUCKET_TONES: Record<EtfCompositionBucketKey, "gain" | "muted" | "neutral" | "warn"> = {
  equity: "neutral",
  fixedIncome: "muted",
  commodity: "warn",
  digital: "gain",
  other: "muted",
};

export default function EtfSummaryStrip({ surface }: { surface: EtfSurfaceData }) {
  const { loaded, universeOk, snapshotOk, rows, snapshot, reload } = surface;
  // Same readiness as the hero: a partial feed pair never renders numbers.
  const ready = loaded && universeOk && snapshotOk;
  const insights = ready ? computeEtfInsights(rows, snapshot, null) : null;

  if (!loaded) {
    return (
      <section aria-label="ETF 요약" data-etfs-summary-strip="true" className="etf-sum">
        <p className="etf-sum-note">ETF 요약 확인 중</p>
      </section>
    );
  }

  if (!insights) {
    return (
      <section aria-label="ETF 요약" data-etfs-summary-strip="true" className="etf-sum">
        <p className="etf-sum-note">
          ETF 요약을 불러오지 못했습니다.{" "}
          <button type="button" className="etf-retry" onClick={reload}>
            다시 시도
          </button>
        </p>
      </section>
    );
  }

  const digital = insights.compositionBuckets.find((bucket) => bucket.key === "digital");
  const legend = insights.compositionBuckets
    .filter((bucket) => bucket.count > 0)
    .map((bucket) => `${bucket.label} ${formatInteger(bucket.count)}개(${bucket.pct}%)`)
    .join(" · ");

  return (
    <section aria-label="ETF 요약" data-etfs-summary-strip="true" className="etf-sum">
      <StatStrip data-etfs-summary-cells="true">
        <Stat label="전체" value={`${formatInteger(insights.totalCount)}개`} sub="발행사 목록 전량" />
        <Stat label="신규" value={`${formatInteger(insights.newCount)}개`} sub="신규 상장 수집분" />
        <Stat
          label="레버리지·인버스"
          value={`${insights.leverageInversePct}%`}
          sub={`${formatInteger(insights.leverageInverseCount)}개`}
        />
        <Stat
          label="디지털자산"
          value={digital && digital.count > 0 ? `${formatInteger(digital.count)}개` : "—"}
          sub={digital && digital.count > 0 ? `${digital.pct}%` : "확인된 종목 없음"}
        />
      </StatStrip>
      <DistributionBand
        segments={insights.compositionBuckets.map((bucket) => ({
          key: bucket.label,
          count: bucket.count,
          tone: BUCKET_TONES[bucket.key],
        }))}
        ariaLabel="ETF 자산군 구성"
      />
      <p className="etf-sum-legend">{legend || "—"}</p>
    </section>
  );
}
