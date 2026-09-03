"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ConsensusData,
  EnhancedConsensusData,
  SummaryData,
  ByTickerData,
  SectorHoldingsData,
  ConvictionEntriesData,
  InvestorData,
  SuperInvestorsDataResult,
} from "@/lib/superinvestors/types";

export const SEC_13F_FETCH_TIMEOUT_MS = 6000;

export type Fetch13FErrorKind = "status" | "timeout" | "parse";

export class Fetch13FError extends Error {
  readonly url: string;
  readonly kind: Fetch13FErrorKind;
  readonly status: number | null;

  constructor(url: string, kind: Fetch13FErrorKind, status: number | null, message: string) {
    super(message);
    this.name = "Fetch13FError";
    this.url = url;
    this.kind = kind;
    this.status = status;
  }
}

async function request13FOnce<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Fetch13FError(url, "status", response.status, `13F fetch failed with status ${response.status}: ${url}`);
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new Fetch13FError(url, "parse", response.status, `13F fetch returned invalid JSON: ${url}`);
    }
  } catch (error) {
    if (error instanceof Fetch13FError) throw error;
    if (controller.signal.aborted) {
      throw new Fetch13FError(url, "timeout", null, `13F fetch timed out after ${timeoutMs}ms: ${url}`);
    }
    throw new Fetch13FError(url, "timeout", null, `13F fetch failed before response: ${url}`);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function isRetryable13FError(error: unknown): boolean {
  if (!(error instanceof Fetch13FError)) return false;
  if (error.kind === "timeout") return true;
  if (error.kind === "parse") return false;
  return error.status === 429 || (error.status !== null && error.status >= 500);
}

export async function fetch13FJson<T>(url: string, timeoutMs = SEC_13F_FETCH_TIMEOUT_MS): Promise<T> {
  try {
    return await request13FOnce<T>(url, timeoutMs);
  } catch (error) {
    if (!isRetryable13FError(error)) throw error;
    return request13FOnce<T>(url, timeoutMs);
  }
}

const EMPTY: SuperInvestorsDataResult = {
  consensus: null,
  enhancedConsensus: null,
  summary: null,
  byTicker: null,
  bySector: null,
  convictionEntries: null,
  dataReady: false,
  failed: false,
  quarter: null,
  excludedStale: [],
};

async function settle13F<T>(promise: Promise<T>): Promise<{ data: T | null; failed: boolean }> {
  try {
    return { data: await promise, failed: false };
  } catch {
    return { data: null, failed: true };
  }
}

export interface SuperInvestorsDataState extends SuperInvestorsDataResult {
  failedRequests: string[];
  retrying: boolean;
  retry: () => void;
}

export function use13FData(): SuperInvestorsDataState {
  const [result, setResult] = useState<SuperInvestorsDataResult>(EMPTY);
  const [failedRequests, setFailedRequests] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const isMountedRef = useRef(true);

  const retry = () => setAttempt((n) => n + 1);

  useEffect(() => {
    isMountedRef.current = true;
    if (attempt > 0) {
      // Retry keeps last-known-good rows (five-state rule): settled data stays
      // on screen while the refetch is in flight.
      setRetrying(true);
    }

    void (async () => {
      const [consensusRes, summaryRes, byTickerRes, enhancedRes, bySectorRes, convictionRes] = await Promise.all([
        settle13F(fetch13FJson<ConsensusData>("/data/sec-13f/analytics/consensus.json")),
        settle13F(fetch13FJson<SummaryData>("/data/sec-13f/summary.json")),
        settle13F(fetch13FJson<ByTickerData>("/data/sec-13f/by_ticker.json")),
        settle13F(fetch13FJson<EnhancedConsensusData>("/data/sec-13f/analytics/enhanced_consensus.json")),
        settle13F(fetch13FJson<SectorHoldingsData>("/data/sec-13f/by_sector.json")),
        settle13F(fetch13FJson<ConvictionEntriesData>("/data/sec-13f/analytics/conviction_entries.json")),
      ]);

      if (!isMountedRef.current) return;

      const failed: string[] = [];
      if (consensusRes.failed || !consensusRes.data?.consensus) failed.push("consensus");
      if (summaryRes.failed || !summaryRes.data) failed.push("summary");
      if (byTickerRes.failed || !byTickerRes.data) failed.push("by_ticker");
      if (enhancedRes.failed || !enhancedRes.data) failed.push("enhanced_consensus");
      if (bySectorRes.failed || !bySectorRes.data) failed.push("by_sector");
      if (convictionRes.failed || !convictionRes.data) failed.push("conviction_entries");

      const consensus = consensusRes.data;
      const summary = summaryRes.data;
      const byTicker = byTickerRes.data;
      const enhancedConsensus = enhancedRes.data;
      const bySector = bySectorRes.data;
      const convictionEntries = convictionRes.data;

      const anyFailed = !consensus && !summary && !byTicker;
      const consensusFailed = !consensus?.consensus;

      if (anyFailed || consensusFailed) {
        setResult((prev) => ({ ...prev, failed: true }));
        setFailedRequests(failed.length > 0 ? failed : ["consensus"]);
        setRetrying(false);
        return;
      }

      setResult({
        consensus,
        enhancedConsensus,
        summary,
        byTicker,
        bySector,
        convictionEntries,
        dataReady: true,
        failed: false,
        quarter: consensus?.metadata?.quarter ?? null,
        excludedStale: consensus?.metadata?.excluded_stale_investors ?? [],
      });
      setFailedRequests(failed);
      setRetrying(false);
    })();

    return () => {
      isMountedRef.current = false;
    };
  }, [attempt]);

  return { ...result, failedRequests, retrying, retry };
}

const INVESTOR_CACHE = new Map<string, InvestorData>();

// The public route intentionally excludes this payload. Keep the UI contract
// explicit so a policy 404 is not presented as a transient fetch failure.
export const PRIVATE_INVESTOR_IDS = new Set(["griffin"]);

type InvestorDetailStatus = "idle" | "loading" | "ready" | "private" | "error";

export function useInvestorDetail(name: string | null) {
  const [data, setData] = useState<InvestorData | null>(null);
  const [loading, setLoading] = useState(Boolean(name));
  const [status, setStatus] = useState<InvestorDetailStatus>(name ? "loading" : "idle");

  useEffect(() => {
    if (!name) {
      setData(null);
      setLoading(false);
      setStatus("idle");
      return;
    }

    setData(null);
    setLoading(true);
    setStatus("loading");

    let cancelled = false;
    const run = async () => {
      const cached = INVESTOR_CACHE.get(name);
      if (cached !== undefined) {
        setData(cached);
        setLoading(false);
        setStatus("ready");
        return;
      }

      setLoading(true);
      setStatus("loading");
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), SEC_13F_FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(`/data/sec-13f/investors/${name}.json`, { signal: controller.signal });
        if (!response.ok) {
          if (!cancelled) {
            setData(null);
            setStatus(response.status === 404 && PRIVATE_INVESTOR_IDS.has(name) ? "private" : "error");
          }
          return;
        }
        const investor = (await response.json()) as InvestorData;
        INVESTOR_CACHE.set(name, investor);
        if (!cancelled) {
          setData(investor);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setData(null);
          setStatus("error");
        }
      } finally {
        window.clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [name]);

  return { data, loading, status };
}
