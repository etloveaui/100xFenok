import Link from 'next/link';
import type { StressTone } from '@/lib/dashboard/types';
import { formatPercent } from '@/lib/dashboard/formatters';

type StressMonitorCardProps = {
  stressScore: number;
  stressTone: StressTone;
  stressLabel: string;
  hySpread: number;
  tenYearYield: number;
};

export default function StressMonitorCard({ stressScore, stressTone, stressLabel, hySpread, tenYearYield }: StressMonitorCardProps) {
  const stressPillClass = stressTone === 'low'
    ? 'is-positive'
    : stressTone === 'medium'
      ? 'is-warning'
      : 'is-negative';

  return (
    <article className="overview-widget-card overview-widget-card--stress">
      <header className="overview-widget-head">
        <div>
          <p className="overview-widget-kicker orbitron">시장 스트레스</p>
          <h3 className="overview-widget-subtitle">Stress Monitor</h3>
          <p className="overview-source-meta">금리와 하이일드 스프레드로 위험 강도를 봅니다.</p>
        </div>
        <span className={`overview-status-pill ${stressPillClass}`}>{stressLabel}</span>
      </header>
      <div className="overview-health-row">
        <strong className="overview-metric-main orbitron">{stressScore.toFixed(2)}</strong>
      </div>
      <p className="overview-metric-sub">HY {formatPercent(hySpread, 2)} · UST10Y {formatPercent(tenYearYield, 2)}</p>
      <Link href="/radar?path=tools%2Fmacro-monitor%2Fdetails%2Fliquidity-stress.html" className="overview-widget-link">
        상세 분석
      </Link>
    </article>
  );
}
