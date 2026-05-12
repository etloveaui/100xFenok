"use client";

import { useState } from "react";
import type {
  DashboardFreshnessMap,
  DashboardSourceFreshness,
} from "@/lib/dashboard/types";
import type {
  V2HomeProps,
  V2SegmentFilter,
  V2TileCategory,
} from "./types";
import { deriveStatus, freshnessFromCadence } from "./types";
import StateBannerV2 from "./StateBannerV2";
import PageHeaderV2 from "./PageHeaderV2";
import SkeletonGrid from "./SkeletonGrid";
import MarketPulseTile from "./tiles/MarketPulseTile";
import QuickIndicesTile from "./tiles/QuickIndicesTile";
import SentimentGaugeTile from "./tiles/SentimentGaugeTile";
import VixTile from "./tiles/VixTile";
import CryptoTile from "./tiles/CryptoTile";
import BreadthHeatmapTile from "./tiles/BreadthHeatmapTile";
import FundingPulseTile from "./tiles/FundingPulseTile";
import BankingStressTile from "./tiles/BankingStressTile";
import RiskAppetiteTile from "./tiles/RiskAppetiteTile";

const TILE_SOURCE_MAP = {
  hero: [
    "sentiment",
    "benchmarks",
    "weeklyBanking",
    "quarterlyBanking",
    "dailyBanking",
  ],
  quick: ["ticker:SPY", "ticker:QQQ", "dailyBanking"],
  fearGreed: ["sentiment"],
  breadth: [
    "benchmarks",
    "ticker:XLK",
    "ticker:XLF",
    "ticker:XLV",
    "ticker:XLE",
  ],
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

function pickFreshness(
  freshness: DashboardFreshnessMap | undefined,
  ...keys: string[]
): DashboardSourceFreshness | undefined {
  if (!freshness) return undefined;
  for (const k of keys) {
    if (freshness[k]) return freshness[k];
  }
  return undefined;
}

/**
 * V2 Bento composer. Mirrors `DashboardPageV2` from the Claude Design
 * handoff but consumes the live `DashboardSnapshot` and `freshness` map
 * instead of static scenario fixtures.
 *
 * - Status derivation matches V1 semantics (loading/partial/offline/live).
 * - Segment filter (ALL/EQUITY/MACRO/CRYPTO) actually hides tiles per AUDIT P2.
 * - Loading status renders SkeletonGrid instead of muted V1 fallback.
 */
export default function HomeBentoGridV2({
  dashboard,
  regimeLabel,
  regimeClass,
  regimeConfidence,
  regimeAxes,
  dataReady,
  failedSources,
  freshness,
}: V2HomeProps) {
  const [filter, setFilter] = useState<V2SegmentFilter>("ALL");

  const status = deriveStatus(dataReady, failedSources, Object.values(TILE_SOURCE_MAP).map((s) => Array.from(s)));

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
            />
          )}
          {showTile("quick") && (
            <QuickIndicesTile
              dashboard={dashboard}
              freshness={freshnessFromCadence(
                pickFreshness(freshness, "ticker:SPY", "dailyBanking"),
              )}
              muted={mutedFor(tileFailed.quick)}
            />
          )}
          {showTile("fearGreed") && (
            <SentimentGaugeTile
              dashboard={dashboard}
              freshness={freshnessFromCadence(pickFreshness(freshness, "sentiment"))}
              muted={mutedFor(tileFailed.fearGreed)}
            />
          )}
          {showTile("vix") && (
            <VixTile
              dashboard={dashboard}
              freshness={freshnessFromCadence(pickFreshness(freshness, "vix"))}
              muted={mutedFor(tileFailed.vix)}
            />
          )}
          {showTile("crypto") && (
            <CryptoTile
              dashboard={dashboard}
              freshness={freshnessFromCadence(pickFreshness(freshness, "crypto"))}
              muted={mutedFor(tileFailed.crypto)}
            />
          )}
          {showTile("breadth") && (
            <BreadthHeatmapTile
              dashboard={dashboard}
              freshness={freshnessFromCadence(
                pickFreshness(freshness, "ticker:XLK", "benchmarks"),
              )}
              muted={mutedFor(tileFailed.breadth)}
            />
          )}
          {showTile("liquidity") && (
            <FundingPulseTile
              dashboard={dashboard}
              freshness={freshnessFromCadence(
                pickFreshness(freshness, "weeklyBanking"),
              )}
              muted={mutedFor(tileFailed.liquidity)}
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
            />
          )}
          {showTile("riskAppetite") && (
            <RiskAppetiteTile
              dashboard={dashboard}
              freshness={freshnessFromCadence(pickFreshness(freshness, "putCall"))}
              muted={mutedFor(tileFailed.riskAppetite)}
            />
          )}
        </div>
      )}
    </>
  );
}
