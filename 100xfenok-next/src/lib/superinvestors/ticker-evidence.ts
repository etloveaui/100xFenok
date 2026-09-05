"use client";

import { fetch13FJson } from "@/hooks/use13FData";
import type {
  GuruHoldersIndexData,
  GuruHoldersIndexMetadata,
  HoldingChangeSummary,
} from "./types";

const GURU_HOLDERS_INDEX_PATH = "/data/sec-13f/analytics/guru_holders_index.json";

function finiteCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function finiteDelta(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeMetadata(value: unknown): GuruHoldersIndexMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const coverage = raw.change_coverage;
  const normalizedCoverage = coverage && typeof coverage === "object" && !Array.isArray(coverage)
    ? coverage as GuruHoldersIndexMetadata["change_coverage"]
    : undefined;
  return {
    ...raw,
    ...(nonEmptyString(raw.quarter) ? { quarter: nonEmptyString(raw.quarter)! } : {}),
    ...(finiteCount(raw.tickers) !== null ? { tickers: finiteCount(raw.tickers)! } : {}),
    ...(nonEmptyString(raw.generated_at) ? { generated_at: nonEmptyString(raw.generated_at)! } : {}),
    ...(normalizedCoverage ? { change_coverage: normalizedCoverage } : {}),
  };
}

function normalizeHolders(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, number> = {};
  for (const [ticker, count] of Object.entries(value)) {
    const normalizedTicker = ticker.trim().toUpperCase();
    const normalizedCount = finiteCount(count);
    if (!normalizedTicker || normalizedCount === null) continue;
    output[normalizedTicker] = normalizedCount;
  }
  return output;
}

function normalizeHoldingChange(value: unknown): HoldingChangeSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const heldCount = finiteCount(raw.held_count);
  const newCount = finiteCount(raw.new_count);
  const increasedCount = finiteCount(raw.increased_count);
  const decreasedCount = finiteCount(raw.decreased_count);
  const unchangedCount = finiteCount(raw.unchanged_count);
  const soldCount = finiteCount(raw.sold_count);
  const comparableCount = finiteCount(raw.comparable_count);
  const currentQuarter = nonEmptyString(raw.current_quarter);
  const previousQuarter = nonEmptyString(raw.previous_quarter);
  if (
    heldCount === null || newCount === null || increasedCount === null || decreasedCount === null
    || unchangedCount === null || soldCount === null || comparableCount === null
    || currentQuarter === null || previousQuarter === null
  ) return null;
  return {
    held_count: heldCount,
    new_count: newCount,
    increased_count: increasedCount,
    decreased_count: decreasedCount,
    unchanged_count: unchangedCount,
    sold_count: soldCount,
    comparable_count: comparableCount,
    mean_weight_delta: finiteDelta(raw.mean_weight_delta),
    current_quarter: currentQuarter,
    previous_quarter: previousQuarter,
  };
}

function normalizeDocument(value: unknown): GuruHoldersIndexData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const holders = normalizeHolders(raw.holders);
  const rawChanges = raw.holding_changes;
  const holdingChanges: Record<string, HoldingChangeSummary> = {};
  if (rawChanges && typeof rawChanges === "object" && !Array.isArray(rawChanges)) {
    for (const [ticker, change] of Object.entries(rawChanges)) {
      const normalizedTicker = ticker.trim().toUpperCase();
      const normalizedChange = normalizeHoldingChange(change);
      if (normalizedTicker && normalizedChange) holdingChanges[normalizedTicker] = normalizedChange;
    }
  }
  // The legacy holders map is still useful during producer rollout. A valid
  // holding_changes map may contain tickers whose old holder key was absent.
  if (Object.keys(holders).length === 0 && Object.keys(holdingChanges).length === 0) return null;
  return {
    metadata: normalizeMetadata(raw.metadata),
    holders,
    holding_changes: holdingChanges,
  };
}

let cachedIndex: GuruHoldersIndexData | null = null;
let cachedIndexPromise: Promise<GuruHoldersIndexData | null> | null = null;

/** One bounded public feed shared by screener and superinvestor surfaces. */
export function loadGuruHoldersIndex(): Promise<GuruHoldersIndexData | null> {
  if (cachedIndex) return Promise.resolve(cachedIndex);
  if (cachedIndexPromise) return cachedIndexPromise;
  cachedIndexPromise = fetch13FJson<unknown>(GURU_HOLDERS_INDEX_PATH)
    .then((payload) => {
      const normalized = normalizeDocument(payload);
      if (normalized) cachedIndex = normalized;
      cachedIndexPromise = null;
      return normalized;
    })
    .catch(() => {
      cachedIndexPromise = null;
      return null;
    });
  return cachedIndexPromise;
}

export function holdingChangeFor(
  index: GuruHoldersIndexData | null | undefined,
  ticker: string,
): HoldingChangeSummary | null {
  const normalizedTicker = ticker.trim().toUpperCase();
  return normalizedTicker ? index?.holding_changes?.[normalizedTicker] ?? null : null;
}
