"use client";

import { useEffect, useState } from "react";
import { EmptyState, EvidenceRail, Panel, PanelHeader, Stat } from "@/components/ui";
import { fetchJsonOrNull } from "@/lib/client/data-fetch";
import { MarketChartFrame } from "@/lib/market-valuation/charts/MarketChartFrame";
import type { MarketChartPoint } from "@/lib/market-valuation/charts/types";

interface CrashDoc { prices?: { date: string; close: number }[] }
interface CurrentDoc { updated?: string; current?: { drawdown?: string } }
interface Comparison {
  points: MarketChartPoint[];
  peakDate: string;
  troughDate: string;
  worst: number;
  current: number | null;
  collectedAt: string | null;
}

const percent = (value: number | null) => value === null ? "—" : `${value.toFixed(2)}%`;

export default function CrashDrawdownComparison() {
  const [data, setData] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchJsonOrNull<CrashDoc>("/data/slickcharts/1929crash.json"),
      fetchJsonOrNull<CurrentDoc>("/data/slickcharts/sp500-drawdown.json"),
    ]).then(([crash, current]) => {
      if (cancelled) return;
      const rows = Array.isArray(crash?.prices) ? crash.prices.filter(row =>
        /^\d{4}-\d{2}-\d{2}$/.test(row?.date) && Number.isFinite(Date.parse(row.date))
        && Number.isFinite(row.close) && row.close > 0).sort((a, b) => a.date.localeCompare(b.date)) : [];
      if (rows.length < 2) { setData(null); return; }
      const peak = rows.reduce((best, row) => row.close > best.close ? row : best);
      const afterPeak = rows.filter(row => row.date >= peak.date);
      const trough = afterPeak.reduce((worst, row) => row.close < worst.close ? row : worst);
      const raw = current?.current?.drawdown?.trim();
      const value = raw && /^-?\d+(?:\.\d+)?%$/.test(raw) ? Number(raw.slice(0, -1)) : NaN;
      setData({
        points: afterPeak.map(row => ({ label: row.date, value: (row.close / peak.close - 1) * 100 })),
        peakDate: peak.date, troughDate: trough.date, worst: (trough.close / peak.close - 1) * 100,
        current: Number.isFinite(value) && value <= 0 && value >= -100 ? value : null,
        collectedAt: typeof current?.updated === "string" && Number.isFinite(Date.parse(current.updated)) ? current.updated.slice(0, 10) : null,
      });
    }).catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  return <section className="mt-6" data-crash-drawdown-comparison aria-label="최근 시장과 1929년 낙폭 비교">
    <Panel loading={loading}>
      <PanelHeader eyebrow="고점 대비 가격 하락률" title="최근 시장 vs 1929년 대공황" />
      {!loading && data ? <>
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <Stat label="최근 S&P500 · 사상 최고점 대비" value={percent(data.current)}
            sub={data.collectedAt ? `자료 수집 ${data.collectedAt} · 가격 관측일 미제공` : "최근 자료 확인 불가"} />
          <Stat label="1929년 다우 · 이후 최대 낙폭" value={percent(data.worst)}
            sub={`${data.peakDate} 고점 → ${data.troughDate} 저점`} />
        </div>
        <p className="px-4 py-3 text-sm text-[var(--c-ink-3)]">
          서로 다른 지수의 고점 대비 하락 규모를 비교합니다. S&P500은 최근 수집값이며 오늘의 종가를 뜻하지 않습니다.
          다우는 1929년 고점 이후의 실제 경로로, 향후 시장 경로를 예측하지 않습니다.
        </p>
        <MarketChartFrame title="1929년 다우 고점 이후 낙폭" ariaLabel="1929년 다우 고점 대비 하락률 이력"
          series={[{ id: "dow-1929", label: "다우 · 1929년 고점 대비", points: data.points, colorToken: "down" }]}
          ranges={[{ id: "MAX", label: "전체" }]} defaultRangeId="MAX" yAxisTitle="고점 대비 (%)"
          formatValue={percent} sortLabels bare />
        <EvidenceRail freshness="fixed" stateLabel="역사 비교" source="SlickCharts · 다우 역사 가격 / S&P500 drawdown"
          asOf={`${data.peakDate}–${data.points.at(-1)?.label}`} coverage="지수·기준 시점이 다른 가격 하락률 비교" />
      </> : !loading ? <EmptyState reason="1929년 가격 자료를 불러오지 못했습니다." actionLabel="다시 불러오기"
        onAction={() => setAttempt(value => value + 1)} /> : null}
    </Panel>
  </section>;
}
