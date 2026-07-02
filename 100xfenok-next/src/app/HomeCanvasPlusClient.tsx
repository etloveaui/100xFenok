"use client";

import { useMemo } from "react";
import AppShell from "@/components/shell/AppShell";
import TickerTypeahead from "@/components/TickerTypeahead";
import TransitionLink from "@/components/TransitionLink";
import CpBadge from "@/components/canvas-plus/CpBadge";
import CpFeatureTile from "@/components/canvas-plus/CpFeatureTile";
import CpInsightCard from "@/components/canvas-plus/CpInsightCard";
import { useDashboardData } from "@/hooks/useDashboardData";
import { clamp, getRegimeClass, getRegimeLabel } from "@/lib/dashboard/formatters";
import { EXPLORE_PRODUCT_TITLE } from "@/lib/product-nav";
import { ROUTES } from "@/lib/routes";

const GATEWAY_TILES = [
  {
    label: "Stock",
    title: "Stock report",
    value: "Search first",
    detail: "Open a ticker report from the global search, or start with NVDA as the sample route.",
    href: ROUTES.stock("NVDA"),
    tone: "accent",
  },
  {
    label: "Screener",
    title: "Condition search",
    value: "Filter",
    detail: "Move from market state to names using valuation, growth, revision, and quality filters.",
    href: ROUTES.screener,
    tone: "positive",
  },
  {
    label: "ETF",
    title: "ETF center",
    value: "Universe",
    detail: "Check ETF families, categories, segments, and comparison workflows.",
    href: ROUTES.etfs,
    tone: "neutral",
  },
  {
    label: "Portfolio",
    title: "Review queue",
    value: "Holdings",
    detail: "Jump to portfolio review after search, screen, and market context checks.",
    href: ROUTES.portfolio,
    tone: "warning",
  },
] as const;

function formatDatePart(value: string | null | undefined): string {
  if (!value) return "대기";
  return value.slice(0, 10);
}

function pct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function CpHomeHero({
  regimeLabel,
  regimeTone,
  dataReady,
  failedCount,
  updatedAt,
}: {
  regimeLabel: string;
  regimeTone: "positive" | "negative" | "warning" | "neutral";
  dataReady: boolean;
  failedCount: number;
  updatedAt: string;
}) {
  return (
    <section className="cp-hero-search cp-home-hero" data-canvas-plus-home-hero data-home-search-first>
      <div className="cp-hero-search__copy">
        <p className="cp-lab__eyebrow">CANVAS+ HOME</p>
        <h1 className="cp-hero-search__title">Search first, then decide what deserves attention.</h1>
        <p className="cp-hero-search__summary">
          A light production candidate for ticker lookup, market state scanning, and gateway navigation.
        </p>
      </div>

      <div className="cp-hero-search__form">
        <span className="cp-hero-search__label">
          Ticker, investor, or company
        </span>
        <TickerTypeahead
          placeholder="NVDA, SPY, Buffett..."
          className="cp-hero-search__input"
          formClass="cp-hero-search__control"
          showButton
          buttonLabel="열기"
          buttonClass="cp-home-search-button"
        />
      </div>

      <dl className="cp-hero-search__metrics" aria-label="Home data state">
        <div className="cp-hero-search__metric">
          <dt>Market stance</dt>
          <dd><CpBadge tone={regimeTone}>{regimeLabel}</CpBadge></dd>
        </div>
        <div className="cp-hero-search__metric">
          <dt>Data state</dt>
          <dd>{dataReady ? "Synced" : "Loading"}</dd>
        </div>
        <div className="cp-hero-search__metric">
          <dt>Fallbacks</dt>
          <dd>{failedCount === 0 ? "0" : `${failedCount}`}</dd>
        </div>
        <div className="cp-hero-search__metric">
          <dt>Updated</dt>
          <dd>{updatedAt}</dd>
        </div>
      </dl>
    </section>
  );
}

export default function HomeCanvasPlusClient() {
  const { dashboard, dataReady, failedSources } = useDashboardData();
  const regime = useMemo(() => {
    const breadthTotal = Math.max(dashboard.sectorRows.length, 1);
    const breadthRatio = dashboard.sectorUp / breadthTotal;
    const score = clamp(
      (dashboard.fearGreedScore / 100) * 0.45 +
        breadthRatio * 0.35 +
        (1 - dashboard.stressScore) * 0.2,
      0,
      1,
    );
    const className = getRegimeClass(score);
    return {
      label: getRegimeLabel(score),
      className,
      confidence: Math.round(score * 100),
      breadth: Math.round(breadthRatio * 100),
      tone: className === "is-risk-on" ? "positive" : className === "is-risk-off" ? "negative" : "warning",
    } as const;
  }, [dashboard]);

  const strongestSector = dashboard.sectorRows
    .slice()
    .sort((a, b) => b.displayChange - a.displayChange)[0];
  const weakestSector = dashboard.sectorRows
    .slice()
    .sort((a, b) => a.displayChange - b.displayChange)[0];

  return (
    <div className="fnk-shell cp-home-shell">
      <AppShell active="explore" title={EXPLORE_PRODUCT_TITLE}>
        <div className="canvas-plus" data-canvas-plus data-canvas-plus-home-production>
          <div className="cp-lab cp-poc cp-home-production">
            <CpHomeHero
              regimeLabel={regime.label}
              regimeTone={regime.tone}
              dataReady={dataReady}
              failedCount={failedSources.length}
              updatedAt={formatDatePart(dashboard.tickerFetchedAt)}
            />

            <section className="cp-poc__feature-grid" aria-label="CANVAS+ production gateways">
              {GATEWAY_TILES.map((tile) => (
                <TransitionLink
                  key={tile.label}
                  href={tile.href}
                  className="cp-home-gateway-link"
                  data-home-feature-tile
                >
                  <CpFeatureTile
                    label={tile.label}
                    title={tile.title}
                    value={tile.value}
                    detail={tile.detail}
                    tone={tile.tone}
                  />
                </TransitionLink>
              ))}
            </section>

            <section className="cp-poc__insight-grid" aria-label="CANVAS+ production brief">
              <CpInsightCard
                title="Today brief"
                meta="Live dashboard snapshot"
                badge={`${regime.confidence}/100`}
                tone={regime.tone}
                rows={[
                  { label: "Regime", value: regime.label, tone: regime.tone },
                  { label: "Breadth", value: `${regime.breadth}% up`, tone: regime.breadth >= 55 ? "positive" : "warning" },
                  { label: "Fear & Greed", value: `${dashboard.fearGreedScore}`, tone: dashboard.fearGreedScore >= 65 ? "warning" : "neutral" },
                ]}
              />
              <CpInsightCard
                title="Action queue"
                meta="Route-one compact scope"
                badge={failedSources.length === 0 ? "Ready" : "Check"}
                tone={failedSources.length === 0 ? "positive" : "warning"}
                rows={[
                  { label: "Strong sector", value: strongestSector ? `${strongestSector.name} ${pct(strongestSector.displayChange)}` : "Loading", tone: "positive" },
                  { label: "Weak sector", value: weakestSector ? `${weakestSector.name} ${pct(weakestSector.displayChange)}` : "Loading", tone: "warning" },
                  { label: "Market mode", value: dashboard.sectorMode, tone: dataReady ? "positive" : "neutral" },
                ]}
              />
            </section>
          </div>
        </div>
      </AppShell>
    </div>
  );
}
