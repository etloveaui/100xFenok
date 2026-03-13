import Link from 'next/link';
import type { LiquidityBar } from '@/lib/dashboard/types';
import { formatSignedBillions, formatPercent } from '@/lib/dashboard/formatters';

type LiquidityCardProps = {
  liquidityFlow: number;
  liquidityFlowLabel: string;
  liquidityBars: LiquidityBar[];
  loanDepositRatio: number;
};

export default function LiquidityCard({ liquidityFlow, liquidityFlowLabel, liquidityBars, loanDepositRatio }: LiquidityCardProps) {
  const liquidityPillClass = liquidityFlow >= 0 ? 'is-positive' : 'is-negative';
  const liquidityPillLabel = liquidityFlow >= 0 ? '개선' : '둔화';

  return (
    <article className="overview-widget-card overview-widget-card--liquidity">
      <header className="overview-widget-head">
        <div>
          <p className="overview-widget-kicker orbitron">유동성</p>
          <h3 className="overview-widget-subtitle">Funding Pulse</h3>
          <p className="overview-source-meta">대출과 예금 흐름으로 유동성 방향을 봅니다.</p>
        </div>
        <span className={`overview-status-pill ${liquidityPillClass}`}>{liquidityPillLabel}</span>
      </header>
      <div className="overview-metric-stack">
        <p className="overview-metric-main orbitron">{formatSignedBillions(liquidityFlow)}</p>
        <p className="overview-metric-sub">{liquidityFlowLabel}</p>
      </div>
      <div className="overview-mini-bars" aria-hidden="true">
        {liquidityBars.map((bar, index) => (
          <span
            key={`${bar.delta}-${index}`}
            className={bar.delta >= 0 ? 'is-up' : 'is-down'}
            style={{ height: `${bar.height}%` }}
          />
        ))}
      </div>
      <p className="overview-metric-sub mt-3">예대율 {formatPercent(loanDepositRatio)}</p>
      <Link href="/radar?path=tools%2Fmacro-monitor%2Fdetails%2Fliquidity-flow.html" className="overview-widget-link">
        상세 분석
      </Link>
    </article>
  );
}
