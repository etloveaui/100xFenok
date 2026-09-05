"use client";

import { fetch13FJson } from "@/hooks/use13FData";
import {
  loadFenokSignalsSummaryDocument,
  type FenokSignalsSummaryRecord,
} from "@/features/stock-analyzer/data/fenok-signals-summary-provider";
import type {
  BuyingPressureData,
  ConvictionData,
  NewPositionsData,
} from "@/lib/superinvestors/types";

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
// that hook). Same module-cache pattern as InsightsTab: one fetch per file,
// null on failure so panels render error states instead of hanging.
let npCache: NewPositionsData | null = null;
let npPromise: Promise<NewPositionsData | null> | null = null;

export function loadSignalNewPositions(): Promise<NewPositionsData | null> {
  if (npCache) return Promise.resolve(npCache);
  if (npPromise) return npPromise;
  npPromise = fetch13FJson<NewPositionsData>("/data/sec-13f/analytics/new_positions.json")
    .then((d) => { if (!d) { npPromise = null; return null; } npCache = d; return d; })
    .catch(() => { npPromise = null; return null; });
  return npPromise;
}

let bpCache: BuyingPressureData | null = null;
let bpPromise: Promise<BuyingPressureData | null> | null = null;

export function loadSignalBuyingPressure(): Promise<BuyingPressureData | null> {
  if (bpCache) return Promise.resolve(bpCache);
  if (bpPromise) return bpPromise;
  bpPromise = fetch13FJson<BuyingPressureData>("/data/sec-13f/analytics/buying_pressure.json")
    .then((d) => { if (!d) { bpPromise = null; return null; } bpCache = d; return d; })
    .catch(() => { bpPromise = null; return null; });
  return bpPromise;
}

let cvCache: ConvictionData | null = null;
let cvPromise: Promise<ConvictionData | null> | null = null;

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
  if (cvCache) return Promise.resolve(cvCache);
  if (cvPromise) return cvPromise;
  cvPromise = fetch13FJson<ConvictionData>("/data/sec-13f/analytics/conviction.json")
    .then((d) => { if (!d) { cvPromise = null; return null; } cvCache = d; return d; })
    .catch(() => { cvPromise = null; return null; });
  return cvPromise;
}
