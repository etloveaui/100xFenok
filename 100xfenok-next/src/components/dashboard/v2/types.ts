import type {
  DashboardFreshnessCadence,
  DashboardFreshnessMap,
  DashboardSnapshot,
} from "@/lib/dashboard/types";

export type V2FreshTone = "live" | "dated" | "stale" | "offline";

export type V2Freshness = {
  tone: V2FreshTone;
  label: string;
};

export type V2TileFailedMap = {
  hero: boolean;
  quick: boolean;
  fearGreed: boolean;
  breadth: boolean;
  vix: boolean;
  crypto: boolean;
  liquidity: boolean;
  riskAppetite: boolean;
  bankingStress: boolean;
};

export type V2RegimeAxis = {
  label: string;
  value: number;
  tone: "up" | "down" | "neutral";
  detail: string;
};

export type V2HomeProps = {
  dashboard: DashboardSnapshot;
  regimeLabel: string;
  regimeClass: string;
  regimeConfidence: number;
  regimeAxes: V2RegimeAxis[];
  dataReady: boolean;
  failedSources: string[];
  freshness?: DashboardFreshnessMap;
};

export type V2DataStatus = "live" | "loading" | "partial" | "offline";

export type V2SegmentFilter = "ALL" | "EQUITY" | "MACRO" | "CRYPTO";

export type V2TileCategory = "EQUITY" | "MACRO" | "CRYPTO";

export function v2cx(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}

export function freshnessFromCadence(
  meta: { cadence: DashboardFreshnessCadence; updatedAt: string | null; isFallback: boolean } | undefined,
): V2Freshness {
  if (!meta) return { tone: "dated", label: "데이터 대기" };
  if (meta.isFallback) {
    return {
      tone: meta.cadence === "realtime" ? "stale" : "offline",
      label: meta.cadence === "realtime" ? "Stale" : "Offline",
    };
  }
  if (meta.cadence === "realtime") {
    return { tone: "live", label: "LIVE · 15m" };
  }
  const compact = meta.updatedAt ? meta.updatedAt.slice(0, 10) : "";
  const cadenceLabel =
    meta.cadence === "quarterly"
      ? "분기"
      : meta.cadence === "weekly"
        ? "주간"
        : "일간";
  return {
    tone: "dated",
    label: compact ? `${cadenceLabel} · ${compact}` : cadenceLabel,
  };
}

export function deriveStatus(
  dataReady: boolean,
  failedSources: string[],
  allTileSources: string[][],
): V2DataStatus {
  if (!dataReady && failedSources.length === 0) return "loading";
  const isOffline =
    (!dataReady && failedSources.length > 0) ||
    (dataReady &&
      allTileSources.every((sources) =>
        sources.every((source) => failedSources.includes(source)),
      ));
  if (isOffline) return "offline";
  if (dataReady && failedSources.length > 0) return "partial";
  return "live";
}
