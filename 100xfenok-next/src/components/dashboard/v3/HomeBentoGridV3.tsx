"use client";

import { useState } from "react";
import type {
  DashboardFreshnessMap,
  DashboardSourceFreshness,
} from "@/lib/dashboard/types";
import type { WatchableMetric } from "@/lib/watch/types";
import type {
  V2HomeProps,
  V2SegmentFilter,
  V2TileCategory,
} from "@/components/dashboard/v2/types";
import {
  deriveStatus,
  freshnessFromCadence,
} from "@/components/dashboard/v2/types";
import StateBannerV2 from "@/components/dashboard/v2/StateBannerV2";
import PageHeaderV2 from "@/components/dashboard/v2/PageHeaderV2";
import SkeletonGrid from "@/components/dashboard/v2/SkeletonGrid";
import MarketPulseTile from "@/components/dashboard/v2/tiles/MarketPulseTile";
import QuickIndicesTile from "@/components/dashboard/v2/tiles/QuickIndicesTile";
import SentimentGaugeTile from "@/components/dashboard/v2/tiles/SentimentGaugeTile";
import VixTile from "@/components/dashboard/v2/tiles/VixTile";
import CryptoTile from "@/components/dashboard/v2/tiles/CryptoTile";
import BreadthHeatmapTile from "@/components/dashboard/v2/tiles/BreadthHeatmapTile";
import FundingPulseTile from "@/components/dashboard/v2/tiles/FundingPulseTile";
import BankingStressTile from "@/components/dashboard/v2/tiles/BankingStressTile";
import RiskAppetiteTile from "@/components/dashboard/v2/tiles/RiskAppetiteTile";

const TILE_SOURCE_MAP = {
  hero: ["sentiment", "benchmarks", "weeklyBanking", "quarterlyBanking", "dailyBanking"],
  quick: ["ticker:SPY", "ticker:QQQ", "dailyBanking"],
  fearGreed: ["sentiment"],
  breadth: ["benchmarks", "ticker:XLK", "ticker:XLF", "ticker:XLV", "ticker:XLE"],
  vix: ["vix"],
  crypto: ["crypto"],
  liquidity: ["weeklyBanking"],
  riskAppetite: ["putCall"],
  bankingStress: ["weeklyBanking", "quarterlyBanking", "dailyBanking"],
} as const;

const TILE_CATEGORIES: Record<keyof typeof TILE_SOURCE_MAP, V2TileCategory[]> = {
  hero: ["EQUITY", "MACRO", "CRYPTO"],
  quick: ["EQUITY", "MACRO"],
  fearGreed: ["EQUITY", "CRYPTO"],
  vix: ["EQUITY", "MACRO"],
  crypto: ["CRYPTO"],
  breadth: ["EQUITY"],
  liquidity: ["MACRO"],
  bankingStress: ["MACRO"],
  riskAppetite: ["EQUITY"],
};

/** Map tile key to the watchable metric so pin + alert state can sync. */
const TILE_TO_METRIC: Partial<Record<keyof typeof TILE_SOURCE_MAP, WatchableMetric>> = {
  vix: "VIX",
  fearGreed: "FG",
  crypto: "CRYPTOFG",
  quick: "SPY",
  liquidity: "SOFR",
};

function pickFreshness(
  freshness: DashboardFreshnessMap | undefined,
  ...keys: string[]
): DashboardSourceFreshness | undefined {
  if (!freshness) return undefined;
  for (const k of keys) if (freshness[k]) return freshness[k];
  return undefined;
}

type V3GridProps = V2HomeProps & {
  pinnedMetrics: Set<WatchableMetric>;
  alertMetrics: Set<WatchableMetric>;
  onTogglePin: (metric: WatchableMetric) => void;
};

/**
 * V3 home composer. Re-uses every V2 tile and only adds the pin/alert
 * props per tile + the V3 chrome wraps from the parent.
 */
export default function HomeBentoGridV3({
  dashboard,
  regimeLabel,
  regimeClass,
  regimeConfidence,
  regimeAxes,
  dataReady,
  failedSources,
  freshness,
  pinnedMetrics,
  alertMetrics,
  onTogglePin,
}: V3GridProps) {
  const [filter, setFilter] = useState<V2SegmentFilter>("ALL");

  const status = deriveStatus(
    dataReady,
    failedSources,
    Object.values(TILE_SOURCE_MAP).map((s) => Array.from(s)),
  );

  const hasFailure = (sources: readonly string[]) =>
    sources.some((source) => failedSources.includes(source));
  const sectorFailure = failedSources.some((source) =>
    source.startsWith("ticker:XL"),
  );

  const tileFailed = {
    hero: hasFailure(TILE_SOURCE_MAP.hero) || sectorFailure,
    quick: hasFailure(TILE_SOURCE_MAP.quick),
    fearGreed: hasFailure(TILE_SOURCE_MAP.fearGreed),
    breadth: failedSources.includes("benchmarks") || sectorFailure,
    vix: failedSources.includes("vix"),
    crypto: failedSources.includes("crypto"),
    liquidity: failedSources.includes("weeklyBanking"),
    riskAppetite: failedSources.includes("putCall"),
    bankingStress: hasFailure(TILE_SOURCE_MAP.bankingStress),
  };

  const showTile = (tileKey: keyof typeof TILE_CATEGORIES) =>
    filter === "ALL" || TILE_CATEGORIES[tileKey].includes(filter as V2TileCategory);

  const mutedFor = (failed: boolean) =>
    status === "offline" || (status === "partial" && failed);

  /** Build the pin/alert/flash props for a tile from its metric mapping. */
  const tileShellProps = (key: keyof typeof TILE_SOURCE_MAP) => {
    const metric = TILE_TO_METRIC[key];
    if (!metric) {
      return { tileId: `tile-${key}` };
    }
    return {
      pinned: pinnedMetrics.has(metric),
      onPin: () => onTogglePin(metric),
      hasAlert: alertMetrics.has(metric),
      flash: alertMetrics.has(metric),
      tileId: `tile-${key}`,
    };
  };

  const heroFreshness = {
    tone: tileFailed.hero ? ("stale" as const) : ("dated" as const),
    label: "혼합 기준",
  };

  return (
    <>
      <PageHeaderV2 filter={filter} onFilterChange={setFilter} />
      <StateBannerV2 status={status} />
      {status === "loading" ? (
        <SkeletonGrid />
      ) : (
        <div className="hp-bento">
          {showTile("hero") && (
            <MarketPulseTile
              dashboard={dashboard}
              regimeLabel={regimeLabel}
              regimeClass={regimeClass}
              regimeConfidence={regimeConfidence}
              regimeAxes={regimeAxes}
              freshness={heroFreshness}
              muted={mutedFor(tileFailed.hero)}
              {...tileShellProps("hero")}
            />
          )}
          {showTile("quick") && (
            <QuickIndicesTile
              dashboard={dashboard}
              freshness={freshnessFromCadence(
                pickFreshness(freshness, "ticker:SPY", "dailyBanking"),
              )}
              muted={mutedFor(tileFailed.quick)}
              {...tileShellProps("quick")}
            />
          )}
          {showTile("fearGreed") && (
            <SentimentGaugeTile
              dashboard={dashboard}
              freshness={freshnessFromCadence(pickFreshness(freshness, "sentiment"))}
              muted={mutedFor(tileFailed.fearGreed)}
              {...tileShellProps("fearGreed")}
            />
          )}
          {showTile("vix") && (
            <VixTile
              dashboard={dashboard}
              freshness={freshnessFromCadence(pickFreshness(freshness, "vix"))}
              muted={mutedFor(tileFailed.vix)}
              {...tileShellProps("vix")}
            />
          )}
          {showTile("crypto") && (
            <CryptoTile
              dashboard={dashboard}
              freshness={freshnessFromCadence(pickFreshness(freshness, "crypto"))}
              muted={mutedFor(tileFailed.crypto)}
              {...tileShellProps("crypto")}
            />
          )}
          {showTile("breadth") && (
            <BreadthHeatmapTile
              dashboard={dashboard}
              freshness={freshnessFromCadence(
                pickFreshness(freshness, "ticker:XLK", "benchmarks"),
              )}
              muted={mutedFor(tileFailed.breadth)}
              {...tileShellProps("breadth")}
            />
          )}
          {showTile("liquidity") && (
            <FundingPulseTile
              dashboard={dashboard}
              freshness={freshnessFromCadence(pickFreshness(freshness, "weeklyBanking"))}
              muted={mutedFor(tileFailed.liquidity)}
              {...tileShellProps("liquidity")}
            />
          )}
          {showTile("bankingStress") && (
            <BankingStressTile
              dashboard={dashboard}
              freshness={{
                tone: tileFailed.bankingStress ? "stale" : "dated",
                label: "혼합 기준",
              }}
              muted={mutedFor(tileFailed.bankingStress)}
              {...tileShellProps("bankingStress")}
            />
          )}
          {showTile("riskAppetite") && (
            <RiskAppetiteTile
              dashboard={dashboard}
              freshness={freshnessFromCadence(pickFreshness(freshness, "putCall"))}
              muted={mutedFor(tileFailed.riskAppetite)}
              {...tileShellProps("riskAppetite")}
            />
          )}
        </div>
      )}
    </>
  );
}
