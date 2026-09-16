"use client";

import { Pill, Skeleton, StaleState } from "@/components/ui";
import { formatAsOf } from "@/lib/data-state";
import { formatInteger } from "@/lib/format";
import {
  computeEtfInsights,
  etfSurfacePublishedFloor,
  isEtfClockStale,
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
  const published = etfSurfacePublishedFloor(surface.universe, snapshot);
  const stale = loaded && !!insights && isEtfClockStale(insights.asOf ?? published);

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
      </div>
    );
  }

  const { dominantBucket, leverageInversePct, newCount, topMoversCount, topMoversLeverageInverseCount, totalCount, asOf } = insights;
  // New-listings feed is a trailing watchlist window (fh-380 item 2): label the
  // real inception span + collection date, never "today".
  const newRecords = snapshot?.newEtfs?.records ?? [];
  const inceptionSpan = newRecords
    .map((row) => (typeof row.inceptionDate === "string" && row.inceptionDate.length >= 10 ? row.inceptionDate.slice(0, 10) : null))
    .filter((value): value is string => value !== null)
    .sort();
  const newSpanLabel = inceptionSpan.length > 0 ? `${inceptionSpan[0]}~${inceptionSpan[inceptionSpan.length - 1]}` : null;
  const newCollectedLabel = formatAsOf(snapshot?.newEtfs?.fetched_at);
  const newWindowLabel = [newSpanLabel ? `상장일 ${newSpanLabel}` : null, newCollectedLabel ? `${newCollectedLabel} 수집분` : null]
    .filter((value): value is string => value !== null)
    .join(" · ");
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
          {/* B2 (B5 §6): H1 is one line — the listing-window detail lives in
              the sub line, not the headline. */}
          <h1 className="etf-title">
            신규 상장 <b className="tabular-nums">{formatInteger(newCount)}</b>개 · {dominantBucket?.label ?? "주식형"} 비중{" "}
            <b className="tabular-nums">{dominantBucket?.pct ?? 0}%</b> 중심 · 레버리지·인버스 비중{" "}
            <b className="tabular-nums">{leverageInversePct}%</b>
          </h1>
          <span className="etf-sub">
            {newWindowLabel ? `${newWindowLabel} · ` : null}오늘 상위 거래량·변동률 종목 {formatInteger(topMoversCount)}개 중{" "}
            <b className="tabular-nums">{formatInteger(topMoversLeverageInverseCount)}개</b>가 레버리지·인버스입니다. 관심·거래 쏠림
            기준이며 자금 유입·유출액은 포함하지 않습니다.
          </span>
        </div>
        <Pill>{pillLabel}</Pill>
      </div>
      {/* B2 (B4): single source strip lives with the list — the hero keeps its
          stale banner + inline retry, no per-panel rail. */}
    </div>
  );
}
