"use client";

import { fetch13FJson } from "@/hooks/use13FData";
import type {
  BuyingPressureData,
  ConvictionData,
  NewPositionsData,
} from "@/lib/superinvestors/types";

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

export function loadSignalConviction(): Promise<ConvictionData | null> {
  if (cvCache) return Promise.resolve(cvCache);
  if (cvPromise) return cvPromise;
  cvPromise = fetch13FJson<ConvictionData>("/data/sec-13f/analytics/conviction.json")
    .then((d) => { if (!d) { cvPromise = null; return null; } cvCache = d; return d; })
    .catch(() => { cvPromise = null; return null; });
  return cvPromise;
}
