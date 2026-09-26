"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BENCHMARK_ORDINAL_GROUPS,
  readBenchmarkOrdinals,
  type BenchmarkGroupId,
  type BenchmarkOrdinalsView,
} from "@/lib/market-valuation/benchmarkOrdinals";
import { fetchJsonOrNull } from "@/lib/client/data-fetch";

const FETCH_TIMEOUT_MS = 4000;

async function fetchJson<T>(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<T | null> {
  return fetchJsonOrNull<T>(url, { timeoutMs });
}

export type BenchmarkOrdinalsHookState = "pending" | "ready" | "refused" | "failed";

export interface UseBenchmarkOrdinalsResult {
  state: BenchmarkOrdinalsHookState;
  view: BenchmarkOrdinalsView | null;
  /** Re-runs the six-payload load for this hook instance only. */
  refetch: () => void;
}

/**
 * Loads the six benchmark payloads and reads them through the ordinal reading
 * rule. Per-group refusals live INSIDE the view (one broken source must not
 * blank the others); the hook state only distinguishes loading, success,
 * gate refusal, and total transport loss (every fetch came back null).
 *
 * `refetch` bumps an attempt token inside the effect deps: the previous run's
 * cancellation flag runs first (its cleanup), so a slow response from an
 * earlier attempt can never overwrite the newer one, and the existing load and
 * state semantics are untouched.
 */
export function useBenchmarkOrdinals(): UseBenchmarkOrdinalsResult {
  const [state, setState] = useState<BenchmarkOrdinalsHookState>("pending");
  const [view, setView] = useState<BenchmarkOrdinalsView | null>(null);
  const [attempt, setAttempt] = useState(0);
  const refetch = useCallback(() => setAttempt((value) => value + 1), []);

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
  }, [attempt]);

  return { state, view, refetch };
}
