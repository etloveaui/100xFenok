"use client";

import { useDashboardData } from "@/hooks/useDashboardData";
import { clamp, getRegimeLabel, getRegimeClass } from "@/lib/dashboard/formatters";
import HomeBentoGrid from "@/components/dashboard/HomeBentoGrid";
import TickerTypeahead from "@/components/TickerTypeahead";
import TransitionLink from "@/components/TransitionLink";
import { ROUTES } from "@/lib/routes";

const HOME_PRO_TILES = [
  { label: "스크리너", href: ROUTES.screener, meta: "조건 검색" },
  { label: "13F", href: ROUTES.superinvestors, meta: "투자 대가" },
  { label: "섹터", href: ROUTES.sectors, meta: "모멘텀" },
  { label: "밸류", href: ROUTES.market, meta: "지수 밴드" },
] as const;

/**
 * V1 dashboard (existing, Playwright 66/66 + a11y 33/0 PASS).
 * Identical to the prior `page.tsx` body — preserved as-is so the default
 * route never regresses.
 */
export default function HomeV1Client() {
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
      contribution: sentimentContribution,
      value: Math.round((sentimentContribution / contributionTotal) * 100),
      detail: `F&G ${Math.round(dashboard.fearGreedScore)} · ${dashboard.fearGreedLabel}`,
    },
    {
      label: "확산",
      contribution: breadthContribution,
      value: Math.round((breadthContribution / contributionTotal) * 100),
      detail: `${dashboard.sectorRows.length}개 중 ${dashboard.sectorUp}개 상승`,
    },
    {
      label: "안정",
      contribution: stabilityContribution,
      value: Math.round((stabilityContribution / contributionTotal) * 100),
      detail: `스트레스 ${dashboard.stressScore.toFixed(2)} · ${dashboard.stressLabel}`,
    },
  ];

  return (
    <div className="container mx-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4">
      <section
        data-home-search-first
        className="mb-3 rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)] p-3 shadow-[var(--sh-sm)] sm:mb-4 sm:p-4"
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[var(--c-ink-3)]">100xFenok PRO</p>
            <div className="mt-2 rounded-full border border-[var(--c-line)] bg-[var(--c-surface-2)] px-4 py-3 transition focus-within:border-brand-interactive focus-within:bg-white focus-within:shadow-[var(--sh-focus)]">
              <TickerTypeahead
                placeholder="티커, 기업명, 투자자 검색"
                className="min-h-9 w-full min-w-0 bg-transparent text-[15px] font-semibold text-[var(--c-ink)] outline-none placeholder:text-[var(--c-ink-3)]"
                formClass="flex w-full items-center"
              />
            </div>
          </div>
          <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[420px]" aria-label="홈 핵심 화면">
            {HOME_PRO_TILES.map((tile) => (
              <TransitionLink
                key={tile.href}
                href={tile.href}
                data-home-feature-tile
                className="min-h-14 rounded-lg border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 py-2 transition hover:border-brand-interactive hover:bg-white"
              >
                <span className="block text-sm font-black text-[var(--c-ink)]">{tile.label}</span>
                <span className="mt-0.5 block text-[10px] font-semibold text-[var(--c-ink-3)]">{tile.meta}</span>
              </TransitionLink>
            ))}
          </nav>
        </div>
      </section>
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
