"use client";

import { useMemo } from "react";
import { DistributionBand, Stat, StatStrip } from "@/components/ui";
import { formatInteger } from "@/lib/format";
import type { ConsensusTicker, SummaryInvestor } from "@/lib/superinvestors/types";

/* Style-bucket Korean labels: raw group keys are engine codes, never shown. */
const GROUP_LABELS: Record<string, string> = {
  value: "가치",
  growth: "성장",
  hedge: "헤지",
  passive: "패시브",
  quant: "퀀트",
  macro: "매크로",
  institutional: "기관",
  activist: "행동주의",
  event: "이벤트",
  tiger: "타이거",
};

interface Props {
  investors: [string, SummaryInvestor][];
  overlapRows: ConsensusTicker[];
  dataReady: boolean;
  failed: boolean;
  loading: boolean;
  onRetry: () => void;
}

export default function SuperinvestorsSummaryStrip({ investors, overlapRows, dataReady, failed, loading, onRetry }: Props) {
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [, inv] of investors) {
      if (!inv || typeof inv.group !== "string" || inv.group.length === 0) continue;
      counts.set(inv.group, (counts.get(inv.group) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a, ca], [b, cb]) => (cb !== ca ? cb - ca : a.localeCompare(b)))
      .slice(0, 4);
  }, [investors]);

  if (loading || (!dataReady && !failed)) {
    return (
      <section aria-label="투자자 요약" data-superinvestors-summary-strip="true" className="sup-sum">
        <p className="sup-sum-note">투자자 요약 확인 중</p>
      </section>
    );
  }

  if (failed || !dataReady || groups.length === 0) {
    return (
      <section aria-label="투자자 요약" data-superinvestors-summary-strip="true" className="sup-sum">
        <p className="sup-sum-note">
          투자자 요약을 불러오지 못했습니다.{" "}
          <button type="button" onClick={onRetry}>
            다시 시도
          </button>
        </p>
      </section>
    );
  }

  const total = investors.length;
  const legend =
    overlapRows.length > 0
      ? overlapRows.map((row) => `${row.ticker} ${formatInteger(row.holders_count)}명`).join(" · ")
      : null;

  return (
    <section aria-label="투자자 요약" data-superinvestors-summary-strip="true" className="sup-sum">
      <StatStrip data-superinvestors-summary-cells="true">
        {groups.map(([group, count]) => (
          <Stat
            key={group}
            label={GROUP_LABELS[group] ?? group}
            value={`${formatInteger(count)}명`}
            sub={total > 0 ? `코호트 ${Math.round((count / total) * 100)}%` : "당분기 코호트"}
          />
        ))}
      </StatStrip>
      {/* Overlap band: tickers are kinds, not grades — tones only stripe adjacent
       * ranks apart (neutral/muted carry no judgment); the legend and aria
       * label carry the exact holder counts. */}
      {legend ? (
        <>
          <DistributionBand
            segments={overlapRows.map((row, index) => ({
              key: row.ticker,
              count: row.holders_count,
              tone: index % 2 === 0 ? "neutral" : "muted",
            }))}
            ariaLabel="공통 보유 상위 4종목"
          />
          <p className="sup-sum-legend">{legend}</p>
        </>
      ) : (
        <p className="sup-sum-note">공통 보유 요약 확인 불가</p>
      )}
    </section>
  );
}
