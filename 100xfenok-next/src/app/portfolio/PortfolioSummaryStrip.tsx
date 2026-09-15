"use client";

import { useMemo } from "react";
import { DistributionBand, Stat, StatStrip } from "@/components/ui";
import { formatInteger, formatPercent } from "@/lib/format";

interface SummaryRow {
  presentationTicker: string;
  marketValue: number | null;
  weight: number | null;
}

interface Props {
  rows: SummaryRow[];
  totalHoldings: number;
  missingCount: number;
  pricesLoading: boolean;
  onRetry: () => void;
}

export default function PortfolioSummaryStrip({ rows, totalHoldings, missingCount, pricesLoading, onRetry }: Props) {
  const ranked = useMemo(() => {
    const priced = rows.filter((row) => row.marketValue != null && row.weight != null && row.weight > 0);
    return [...priced].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  }, [rows]);

  if (pricesLoading && missingCount > 0) {
    return (
      <section aria-label="포트폴리오 요약" data-portfolio-summary-strip="true" className="pf-sum">
        <p className="pf-sum-note">포트폴리오 요약 확인 중</p>
      </section>
    );
  }

  if (totalHoldings === 0) {
    return (
      <section aria-label="포트폴리오 요약" data-portfolio-summary-strip="true" className="pf-sum">
        <p className="pf-sum-note">보유 종목이 없습니다</p>
      </section>
    );
  }

  const pricedCount = ranked.length;
  const top = ranked.slice(0, 3);
  const topShare = top.reduce((sum, row) => sum + (row.weight ?? 0), 0);
  const restShare = Math.max(0, 1 - topShare);
  const pct = (w: number) => formatPercent(w, { digits: 0 });

  if (pricedCount === 0) {
    return (
      <section aria-label="포트폴리오 요약" data-portfolio-summary-strip="true" className="pf-sum">
        <StatStrip data-portfolio-summary-cells="true">
          <Stat label="평가반영" value={`0/${formatInteger(totalHoldings)}종목`} sub="가격 확인 기준" />
          <Stat label="미확인" value={`${formatInteger(missingCount)}종목`} sub="합계에서 제외" />
          <Stat label="최대 쏠림" value="—" sub="총 평가액 대비" />
          <Stat label="상위3 합산" value="—" sub="총 평가액 대비" />
        </StatStrip>
        <p className="pf-sum-note">
          가격을 확인하지 못했습니다.{" "}
          <button type="button" onClick={onRetry}>
            다시 시도
          </button>
        </p>
      </section>
    );
  }

  const first = top[0];
  const legend = [...top.map((row) => `${row.presentationTicker} ${pct(row.weight ?? 0)}`), ...(restShare > 0 ? [`나머지 ${pct(restShare)}`] : [])].join(" · ");

  return (
    <section aria-label="포트폴리오 요약" data-portfolio-summary-strip="true" className="pf-sum">
      <StatStrip data-portfolio-summary-cells="true">
        <Stat label="평가반영" value={`${formatInteger(pricedCount)}/${formatInteger(totalHoldings)}종목`} sub="가격 확인 기준" />
        <Stat label="미확인" value={missingCount > 0 ? `${formatInteger(missingCount)}종목` : "없음"} sub="합계에서 제외" />
        <Stat label="최대 쏠림" value={first ? `${first.presentationTicker} ${pct(first.weight ?? 0)}` : "—"} sub="총 평가액 대비" />
        <Stat label="상위3 합산" value={pct(topShare)} sub="총 평가액 대비" />
      </StatStrip>
      {/* Concentration band: holdings are kinds, not grades — tones only stripe
       * adjacent ranks apart (neutral/muted carry no judgment); the legend and
       * aria label carry the exact shares. Weights run against the grand total
       * (holdings + cash), so the remainder segment covers the rest. */}
      <DistributionBand
        segments={[
          ...top.map((row, index) => ({
            key: row.presentationTicker,
            count: (row.weight ?? 0) * 100,
            tone: (index % 2 === 0 ? "neutral" : "muted") as "neutral" | "muted",
          })),
          ...(restShare > 0 ? [{ key: "나머지", count: restShare * 100, tone: "muted" as const }] : []),
        ]}
        ariaLabel="보유 상위 3종목 쏠림"
      />
      <p className="pf-sum-legend">{legend}</p>
    </section>
  );
}
