'use client';

import { useDashboardData } from '@/hooks/useDashboardData';
import { clamp, getRegimeLabel, getRegimeClass } from '@/lib/dashboard/formatters';
import TariffBanner from '@/components/dashboard/TariffBanner';
import SentimentGauge from '@/components/dashboard/SentimentGauge';
import RegimeSignal from '@/components/dashboard/RegimeSignal';
import QuickIndices from '@/components/dashboard/QuickIndices';
import BreadthCard from '@/components/dashboard/BreadthCard';
import LiquidityCard from '@/components/dashboard/LiquidityCard';
import RiskAppetiteCard from '@/components/dashboard/RiskAppetiteCard';
import BankingHealthCard from '@/components/dashboard/BankingHealthCard';
import StressMonitorCard from '@/components/dashboard/StressMonitorCard';

export default function Home() {
  const { dashboard } = useDashboardData();

  const breadthTotal = Math.max(dashboard.sectorRows.length, 1);
  const breadthRatio = dashboard.sectorUp / breadthTotal;
  const regimeScore = clamp(
    dashboard.fearGreedScore / 100 * 0.45 + breadthRatio * 0.35 + (1 - dashboard.stressScore) * 0.2,
    0,
    1,
  );
  const regimeLabel = getRegimeLabel(regimeScore);
  const regimeClass = getRegimeClass(regimeScore);
  const regimeConfidence = Math.round(regimeScore * 100);

  return (
    <div className="container mx-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4">
      <TariffBanner />

      <section className="mb-4">
        <div className="hero-zone min-w-0">
          <SentimentGauge
            fearGreedScore={dashboard.fearGreedScore}
            fearGreedLabel={dashboard.fearGreedLabel}
          />
          <RegimeSignal
            regimeLabel={regimeLabel}
            regimeClass={regimeClass}
            regimeConfidence={regimeConfidence}
          />
          <QuickIndices
            quickIndices={dashboard.quickIndices}
            tenYearYield={dashboard.tenYearYield}
            hySpread={dashboard.hySpread}
          />
        </div>
      </section>

      <section className="overview-widget-grid mb-4">
        <BreadthCard
          sectorRows={dashboard.sectorRows}
          sectorUp={dashboard.sectorUp}
          sectorDown={dashboard.sectorDown}
        />
        <LiquidityCard
          liquidityFlow={dashboard.liquidityFlow}
          liquidityFlowLabel={dashboard.liquidityFlowLabel}
          liquidityBars={dashboard.liquidityBars}
          loanDepositRatio={dashboard.loanDepositRatio}
        />
        <RiskAppetiteCard
          vixValue={dashboard.vixValue}
          vixLabel={dashboard.vixLabel}
          putCallValue={dashboard.putCallValue}
          putCallLabel={dashboard.putCallLabel}
          cryptoFearGreed={dashboard.cryptoFearGreed}
          cryptoLabel={dashboard.cryptoLabel}
        />
      </section>

      <section className="overview-widget-grid overview-widget-grid--secondary">
        <BankingHealthCard
          bankingTone={dashboard.bankingTone}
          bankingLabel={dashboard.bankingLabel}
          bankingSummary={dashboard.bankingSummary}
        />
        <StressMonitorCard
          stressScore={dashboard.stressScore}
          stressTone={dashboard.stressTone}
          stressLabel={dashboard.stressLabel}
          hySpread={dashboard.hySpread}
          tenYearYield={dashboard.tenYearYield}
        />
      </section>
    </div>
  );
}
