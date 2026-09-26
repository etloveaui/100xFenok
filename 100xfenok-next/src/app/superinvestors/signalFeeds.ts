"use client";

import { fetch13FJson } from "@/hooks/use13FData";
import {
  loadFenokSignalsSummaryDocument,
  type FenokSignalsSummaryRecord,
} from "@/features/stock-analyzer/data/fenok-signals-summary-provider";
import { loadPerBandIndex } from "@/features/stock-analyzer/data/per-band-provider";
import type {
  BuyingPressureData,
  ConvictionData,
  GuruHoldersIndexData,
  NewPositionsData,
} from "@/lib/superinvestors/types";
import { loadGuruHoldersIndex } from "@/lib/superinvestors/ticker-evidence";
import type { PerBandIndex } from "@/features/stock-analyzer/data/per-band-provider";

export interface SignalScoreData {
  shortTermScore: number | null;
  longTermScore: number | null;
  asOf: string | null;
}

function finiteScore(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

/** Keep the stock-detail/screener headline precedence and preserve nulls. */
export function signalScoreDataFromRecord(
  record: Pick<
    FenokSignalsSummaryRecord,
    "shortTermConvictionScore" | "shortTermScore" | "longTermConvictionScore" | "longTermScore" | "asOf"
  >,
): SignalScoreData {
  return {
    shortTermScore: finiteScore(record.shortTermConvictionScore) ?? finiteScore(record.shortTermScore),
    longTermScore: finiteScore(record.longTermConvictionScore) ?? finiteScore(record.longTermScore),
    asOf: nonEmptyString(record.asOf),
  };
}

// Signal-tab feeds live beside the page (never in use13FData — window-2 owns
// that hook). fetch13FJson is layer-backed now: the shared layer owns
// cache/in-flight (one request per URL across tabs), and a failure is never
// cached — null on failure so panels render error states instead of hanging.

export function loadSignalNewPositions(): Promise<NewPositionsData | null> {
  return fetch13FJson<NewPositionsData>("/data/sec-13f/analytics/new_positions.json").catch(() => null);
}

export function loadSignalBuyingPressure(): Promise<BuyingPressureData | null> {
  return fetch13FJson<BuyingPressureData>("/data/sec-13f/analytics/buying_pressure.json").catch(() => null);
}

/** Reuse the shared provider's bounded cache, in-flight dedupe and TTL. */
export async function loadSignalScores(): Promise<Map<string, SignalScoreData> | null> {
  try {
    const document = await loadFenokSignalsSummaryDocument();
    if (!document) return null;
    return new Map(document.rows.map((row) => [row.symbol, signalScoreDataFromRecord(row)]));
  } catch {
    return null;
  }
}

export function loadSignalConviction(): Promise<ConvictionData | null> {
  return fetch13FJson<ConvictionData>("/data/sec-13f/analytics/conviction.json").catch(() => null);
}

/** Optional cross-surface evidence feed; provider owns cache and in-flight dedupe. */
export function loadSignalTickerEvidence(): Promise<GuruHoldersIndexData | null> {
  return loadGuruHoldersIndex();
}

/** Optional bounded PER-band enrichment; provider owns cache and in-flight dedupe. */
export function loadSignalPerBands(): Promise<PerBandIndex | null> {
  return loadPerBandIndex();
}
