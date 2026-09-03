"use client";

import { EvidenceRail, Pill, Skeleton, StaleState } from "@/components/ui";
import { formatAsOf } from "@/lib/data-state";
import { formatInteger } from "@/lib/format";
import {
  computeEtfInsights,
  etfClockKind,
  etfRailClockDate,
  etfSurfacePublishedFloor,
  isEtfClockStale,
  openEtfEvidence,
  type EtfSurfaceData,
} from "./etfSurfaceData";

export default function EtfHeroPanel({ surface }: { surface: EtfSurfaceData }) {
  const { loaded, universeOk, snapshotOk, rows, snapshot, reload } = surface;
  // The verdict blends both feeds (universe counts + snapshot leaders), so a
  // partial pair never renders: one failed feed empties the hero (fh-681 P1).
  const ready = loaded && universeOk && snapshotOk;
  const insights = ready ? computeEtfInsights(rows, snapshot, null) : null;
  const loading = !loaded;
  const empty = loaded && !insights;
  const stale = loaded && !!insights && isEtfClockStale(insights.asOf ?? published);
  const published = etfSurfacePublishedFloor(surface.universe, snapshot);
  const asOfLabel = etfRailClockDate(insights?.asOf ?? null, published);
  const asOfKind = etfClockKind(insights?.asOf ?? null, published);

  if (loading) {
    return (
      <div className="etf-hero" aria-busy="true">
        <span className="etf-eyebrow">ETF · 시장 스냅샷</span>
        <Skeleton />
      </div>
    );
  }

  if (empty || !insights) {
    return (
      <div className="etf-hero">
        <span className="etf-eyebrow">ETF · 시장 스냅샷</span>
        <p className="etf-hero-loading">
          ETF 시장 스냅샷을 불러오지 못했습니다.{" "}
          <button type="button" className="etf-retry" onClick={reload}>
            다시 시도
          </button>
        </p>
        <EvidenceRail
          freshness="error"
          source="ETF 발행사 목록 · 거래소"
          asOf="—"
          coverage="—"
          onRetry={reload}
        />
      </div>
    );
  }

  const { dominantBucket, leverageInversePct, newCount, topMoversCount, topMoversLeverageInverseCount, totalCount, asOf } = insights;
  const observedLabel = formatAsOf(asOf);
  const publishedLabel = formatAsOf(published);
  const pillLabel = observedLabel
    ? `기준일 ${observedLabel}`
    : publishedLabel
      ? `게시 ${publishedLabel}`
      : (insights.asOfReason ? "제공자 미공개" : "미확인");

  return (
    <div className="etf-hero">
      {stale ? <StaleState asOf={asOf ?? undefined} onRetry={reload} /> : null}
      <div className="etf-hero-top">
        <div className="etf-hero-title-block">
          <div className="etf-hero-eyebrow-row">
            <span className="etf-eyebrow">ETF · 시장 스냅샷</span>
            <Pill>전체 {formatInteger(totalCount)}개</Pill>
          </div>
          <h1 className="etf-title">
            오늘 신규 상장 <b className="tabular-nums">{formatInteger(newCount)}</b>개 · {dominantBucket?.label ?? "주식형"} 비중{" "}
            <b className="tabular-nums">{dominantBucket?.pct ?? 0}%</b> 중심 · 레버리지·인버스 비중{" "}
            <b className="tabular-nums">{leverageInversePct}%</b>
          </h1>
          <span className="etf-sub">
            오늘 상위 거래량·변동률 종목 {formatInteger(topMoversCount)}개 중{" "}
            <b className="tabular-nums">{formatInteger(topMoversLeverageInverseCount)}개</b>가 레버리지·인버스입니다. 관심·거래 쏠림
            기준이며 자금 유입·유출액은 포함하지 않습니다.
          </span>
        </div>
        <Pill>{pillLabel}</Pill>
      </div>
      <EvidenceRail
        freshness={stale ? "stale" : (insights.asOf ?? published) ? "fresh" : "fixed"}
        source="ETF 발행사 목록 · 거래소"
        asOf={asOfLabel}
        asOfKind={asOfKind === "published" ? "published" : undefined}
        coverage={`${formatInteger(totalCount)}개 전량`}
        lkgAsOf={stale && asOf ? asOf : undefined}
        onRetry={stale ? reload : undefined}
        onEvidence={() => openEtfEvidence("/api/data/stockanalysis/etf-universe")}
      />
    </div>
  );
}
