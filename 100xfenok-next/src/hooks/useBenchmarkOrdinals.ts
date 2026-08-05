"use client";

import { useEffect, useState } from "react";
import {
  BENCHMARK_ORDINAL_GROUPS,
  readBenchmarkOrdinals,
  type BenchmarkGroupId,
  type BenchmarkOrdinalsView,
} from "@/lib/market-valuation/benchmarkOrdinals";

const FETCH_TIMEOUT_MS = 4000;

async function fetchJson<T>(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export type BenchmarkOrdinalsHookState = "pending" | "ready" | "refused" | "failed";

export interface UseBenchmarkOrdinalsResult {
  state: BenchmarkOrdinalsHookState;
  view: BenchmarkOrdinalsView | null;
}

/**
 * Loads the six benchmark payloads and reads them through the ordinal reading
 * rule. Per-group refusals live INSIDE the view (one broken source must not
 * blank the others); the hook state only distinguishes loading, success,
 * gate refusal, and total transport loss (every fetch came back null).
 */
export function useBenchmarkOrdinals(): UseBenchmarkOrdinalsResult {
  const [state, setState] = useState<BenchmarkOrdinalsHookState>("pending");
  const [view, setView] = useState<BenchmarkOrdinalsView | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settled = await Promise.all(
        BENCHMARK_ORDINAL_GROUPS.map((group) => fetchJson<unknown>(group.file)),
      );
      if (cancelled) return;

      const payloads: Partial<Record<BenchmarkGroupId, unknown>> = {};
      let fetched = 0;
      BENCHMARK_ORDINAL_GROUPS.forEach((group, index) => {
        payloads[group.id] = settled[index];
        if (settled[index] !== null) fetched += 1;
      });

      const next = readBenchmarkOrdinals(payloads);
      setView(next);
      if (fetched === 0) {
        setState("failed");
      } else {
        setState(next.status === "ready" ? "ready" : "refused");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { state, view };
}
