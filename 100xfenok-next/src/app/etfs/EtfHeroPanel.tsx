"use client";

import { Pill } from "@/components/ui";
import { formatAsOf } from "@/lib/data-state";
import { formatInteger } from "@/lib/format";
import { computeEtfInsights, useEtfSurfaceData } from "./etfSurfaceData";

export default function EtfHeroPanel() {
  const { loaded, failed, rows, snapshot, reload } = useEtfSurfaceData();
  const insights = loaded && !failed ? computeEtfInsights(rows, snapshot, null) : null;

  if (!loaded) {
    return (
      <div className="etf-hero" aria-busy="true">
        <span className="etf-eyebrow">ETF · 시장 스냅샷</span>
        <p className="etf-hero-loading">ETF 시장 현황을 계산하는 중입니다.</p>
      </div>
    );
  }

  if (failed || !insights) {
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

  const { dominantBucket, leverageInversePct, newCount, topMoversCount, topMoversLeverageInverseCount, totalCount, asOf, asOfReason } = insights;

  return (
    <div className="etf-hero">
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
        <Pill>기준일 {formatAsOf(asOf) ?? (asOfReason ? "제공자 미공개" : "미확인")}</Pill>
      </div>
    </div>
  );
}
