"use client";

import { useDashboardData } from "@/hooks/useDashboardData";
import {
  clamp,
  getRegimeLabel,
  getRegimeClass,
} from "@/lib/dashboard/formatters";
import HomeBentoGridV2 from "@/components/dashboard/v2/HomeBentoGridV2";
import NavbarV2 from "@/components/chrome/v2/NavbarV2";
import FooterTickerV2 from "@/components/chrome/v2/FooterTickerV2";

/**
 * V2 dashboard composer (Claude Design handoff implementation).
 * Renders its own NavbarV2 + FooterTickerV2; root V1 chrome is hidden by
 * `body.design-v2` CSS rule driven by DesignVersionToggle.
 *
 * Gated behind `?v2=1` query param (or NEXT_PUBLIC_DESIGN_V2=1 env override).
 */
export default function HomeV2Client() {
  const { dashboard, dataReady, failedSources, freshness } = useDashboardData();

  const breadthTotal = Math.max(dashboard.sectorRows.length, 1);
  const breadthRatio = dashboard.sectorUp / breadthTotal;
  const sentimentContribution = (dashboard.fearGreedScore / 100) * 0.45;
  const breadthContribution = breadthRatio * 0.35;
  const stabilityContribution = (1 - dashboard.stressScore) * 0.2;
  const regimeScore = clamp(
    sentimentContribution + breadthContribution + stabilityContribution,
    0,
    1,
  );
  const contributionTotal = Math.max(
    sentimentContribution + breadthContribution + stabilityContribution,
    0.0001,
  );
  const regimeLabel = getRegimeLabel(regimeScore);
  const regimeClass = getRegimeClass(regimeScore);
  const regimeConfidence = Math.round(regimeScore * 100);
  const regimeAxes = [
    {
      label: "심리",
      tone: "up" as const,
      value: Math.round((sentimentContribution / contributionTotal) * 100),
      detail: `F&G ${Math.round(dashboard.fearGreedScore)} · ${dashboard.fearGreedLabel}`,
    },
    {
      label: "확산",
      tone: regimeClass === "is-risk-off" ? ("down" as const) : ("up" as const),
      value: Math.round((breadthContribution / contributionTotal) * 100),
      detail: `${dashboard.sectorRows.length}개 중 ${dashboard.sectorUp}개 상승`,
    },
    {
      label: "금리·유동성",
      tone: "neutral" as const,
      value: Math.round((stabilityContribution / contributionTotal) * 100),
      detail: `스트레스 ${dashboard.stressScore.toFixed(2)} · ${dashboard.stressLabel}`,
    },
  ];

  return (
    <>
      <NavbarV2 />
      <main className="hp-page">
        <HomeBentoGridV2
          dashboard={dashboard}
          regimeLabel={regimeLabel}
          regimeClass={regimeClass}
          regimeConfidence={regimeConfidence}
          regimeAxes={regimeAxes}
          dataReady={dataReady}
          failedSources={failedSources}
          freshness={freshness}
        />
      </main>
      <FooterTickerV2 dashboard={dashboard} />
    </>
  );
}
