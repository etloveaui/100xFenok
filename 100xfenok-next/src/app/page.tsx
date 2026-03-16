'use client';

import { useDashboardData } from '@/hooks/useDashboardData';
import { clamp, getRegimeLabel, getRegimeClass } from '@/lib/dashboard/formatters';
import TariffBanner from '@/components/dashboard/TariffBanner';
import HomeBentoGrid from '@/components/dashboard/HomeBentoGrid';

export default function Home() {
  const { dashboard, dataReady, failedSources, freshness } = useDashboardData();

  const breadthTotal = Math.max(dashboard.sectorRows.length, 1);
  const breadthRatio = dashboard.sectorUp / breadthTotal;
  const sentimentContribution = dashboard.fearGreedScore / 100 * 0.45;
  const breadthContribution = breadthRatio * 0.35;
  const stabilityContribution = (1 - dashboard.stressScore) * 0.2;
  const regimeScore = clamp(sentimentContribution + breadthContribution + stabilityContribution, 0, 1);
  const contributionTotal = Math.max(sentimentContribution + breadthContribution + stabilityContribution, 0.0001);
  const regimeLabel = getRegimeLabel(regimeScore);
  const regimeClass = getRegimeClass(regimeScore);
  const regimeConfidence = Math.round(regimeScore * 100);
  const regimeAxes = [
    {
      label: '심리',
      contribution: sentimentContribution,
      value: Math.round(sentimentContribution / contributionTotal * 100),
      detail: `F&G ${Math.round(dashboard.fearGreedScore)} · ${dashboard.fearGreedLabel}`,
    },
    {
      label: '확산',
      contribution: breadthContribution,
      value: Math.round(breadthContribution / contributionTotal * 100),
      detail: `${dashboard.sectorRows.length}개 중 ${dashboard.sectorUp}개 상승`,
    },
    {
      label: '안정',
      contribution: stabilityContribution,
      value: Math.round(stabilityContribution / contributionTotal * 100),
      detail: `스트레스 ${dashboard.stressScore.toFixed(2)} · ${dashboard.stressLabel}`,
    },
  ];

  return (
    <div className="container mx-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4">
      <TariffBanner />
      <HomeBentoGrid
        dashboard={dashboard}
        regimeLabel={regimeLabel}
        regimeClass={regimeClass}
        regimeConfidence={regimeConfidence}
        regimeAxes={regimeAxes}
        dataReady={dataReady}
        failedSources={failedSources}
        freshness={freshness}
      />
    </div>
  );
}
