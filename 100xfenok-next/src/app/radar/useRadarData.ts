"use client";

import { useCallback, useEffect, useState } from "react";
import {
  computeBankingHealthSnapshot,
  computeLiquidityFlowSnapshot,
  computeLiquidityStressSnapshot,
  computeSentimentSignalSnapshot,
} from "../../../public/tools/macro-monitor/shared/signals-core.mjs";
import type {
  BankingSnapshot,
  FlowSnapshot,
  SentimentSnapshot,
  SeriesPoint,
  StressSnapshot,
} from "./signals-core";

export type CardState = "loading" | "ready" | "missing" | "failed";

export type RadarData = {
  flow: { state: CardState; snapshot: FlowSnapshot | null };
  stress: { state: CardState; snapshot: StressSnapshot | null };
  banking: { state: CardState; snapshot: BankingSnapshot | null };
  sentiment: { state: CardState; snapshot: SentimentSnapshot | null };
  retry: () => void;
};

type FredFile = { series?: Record<string, Array<{ date?: string; value?: number | string }>> };
type TgaFile = { series?: Array<{ date?: string; val?: number | string }> };
type FdicFile = { data?: Array<{ date?: string; value?: number | string }> };
type StableFile = { current?: number | string; series?: Array<{ date?: string; val?: number | string }> };

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function fredSeries(file: FredFile | null, id: string, days?: number): SeriesPoint[] {
  const rows = Array.isArray(file?.series?.[id]) ? file.series[id] : [];
  const start = typeof days === "number" ? (() => {
    const cutoff = new Date();
    cutoff.setHours(12, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - days);
    return `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  })() : null;
  return rows
    .map((row) => ({ date: row?.date ?? "", val: Number(row?.value) }))
    .filter((row) => (start === null || row.date >= start) && row.date.length === 10 && Number.isFinite(row.val));
}

function latestValue(rows: Array<Record<string, unknown>>, key: string): number | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const v = Number(rows[rows.length - 1]?.[key]);
  return Number.isFinite(v) ? v : null;
}

export function useRadarData(): RadarData {
  const [nonce, setNonce] = useState(0);
  const [flow, setFlow] = useState<RadarData["flow"]>({ state: "loading", snapshot: null });
  const [stress, setStress] = useState<RadarData["stress"]>({ state: "loading", snapshot: null });
  const [banking, setBanking] = useState<RadarData["banking"]>({ state: "loading", snapshot: null });
  const [sentiment, setSentiment] = useState<RadarData["sentiment"]>({ state: "loading", snapshot: null });

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setFlow({ state: "loading", snapshot: null });
    setStress({ state: "loading", snapshot: null });
    setBanking({ state: "loading", snapshot: null });
    setSentiment({ state: "loading", snapshot: null });

    void (async () => {
      const [fredMacro, fredDaily, fredWeekly, fredQuarterly, tga, fdic, stable] = await Promise.all([
        getJson<FredFile>("/data/macro/fred-macro.json"),
        getJson<FredFile>("/data/macro/fred-banking-daily.json"),
        getJson<FredFile>("/data/macro/fred-banking-weekly.json"),
        getJson<FredFile>("/data/macro/fred-banking-quarterly.json"),
        getJson<TgaFile>("/data/macro/tga.json"),
        getJson<FdicFile>("/data/macro/fdic-tier1.json"),
        getJson<StableFile>("/data/macro/stablecoins.json"),
      ]);
      if (cancelled) return;
      const reached = [fredMacro, fredDaily, fredWeekly, fredQuarterly, tga, fdic, stable].some(Boolean);

      // Keep the full monthly series so calendar-year matching never depends
      // on an arbitrary rolling-day cutoff.
      const m2 = fredSeries(fredMacro, "M2SL");
      const fedBs = fredSeries(fredMacro, "WALCL", 730);
      const rrp = fredSeries(fredMacro, "RRPONTSYD", 730);
      const tgaSeries: SeriesPoint[] = (Array.isArray(tga?.series) ? tga.series : [])
        .map((row) => ({ date: row?.date ?? "", val: Number(row?.val) }))
        .filter((row) => row.date.length === 10 && Number.isFinite(row.val));
      const stableSeries: SeriesPoint[] = (Array.isArray(stable?.series) ? stable.series : [])
        .map((row) => ({ date: row?.date ?? "", val: Number(row.val) }))
        .filter((row) => row.date.length === 10 && Number.isFinite(row.val));
      const stableCurrent = Number(stable?.current);
      if (!m2.length && !fedBs.length && !tgaSeries.length) {
        setFlow({ state: reached ? "missing" : "failed", snapshot: null });
      } else {
        try {
          const snapshot = computeLiquidityFlowSnapshot({
            m2,
            fedBs,
            tga: tgaSeries,
            rrp,
            stablecoin: stableSeries.length || Number.isFinite(stableCurrent) ? { current: stableCurrent || 0, series: stableSeries } : null,
          }) as unknown as FlowSnapshot;
          setFlow({ state: "ready", snapshot });
        } catch {
          setFlow({ state: "failed", snapshot: null });
        }
      }

      const sofr = fredSeries(fredMacro, "SOFR", 365);
      const iorb = fredSeries(fredMacro, "IORB", 365);
      const reserves = fredSeries(fredMacro, "WRESBAL", 365);
      const gdp = fredSeries(fredMacro, "GDP", 1095);
      if (!sofr.length && !iorb.length && !reserves.length) {
        setStress({ state: reached ? "missing" : "failed", snapshot: null });
      } else {
        try {
          setStress({ state: "ready", snapshot: computeLiquidityStressSnapshot({ sofr, iorb, reserves, gdp }) as unknown as StressSnapshot });
        } catch {
          setStress({ state: "failed", snapshot: null });
        }
      }

      const delinquency = fredSeries(fredQuarterly, "DRALACBN", 365 * 6);
      const loans = fredSeries(fredWeekly, "TOTLL", 365 * 3);
      const deposits = fredSeries(fredWeekly, "DPSACBW027SBOG", 365 * 3);
      const fedTier1 = fredSeries(fredQuarterly, "BOGZ1FL010000016Q", 365 * 6);
      const fdicTier1: SeriesPoint[] = (Array.isArray(fdic?.data) ? fdic.data : [])
        .map((row) => ({ date: row?.date ?? "", val: Number(row?.value) }))
        .filter((row) => row.date.length === 10 && Number.isFinite(row.val));
      if (!fdicTier1.length && !fedTier1.length) {
        setBanking({ state: reached ? "missing" : "failed", snapshot: null });
      } else {
        try {
          setBanking({
            state: "ready",
            snapshot: computeBankingHealthSnapshot({ delinquency, loans, deposits, fedTier1, fdicTier1 }) as unknown as BankingSnapshot,
          });
        } catch {
          setBanking({ state: "failed", snapshot: null });
        }
      }

      const base = "/data/sentiment/";
      const [vix, move, cftc, cnn, crypto, aaii, putcall] = await Promise.all([
        getJson<Array<Record<string, unknown>>>(`${base}vix.json`),
        getJson<Array<Record<string, unknown>>>(`${base}move.json`),
        getJson<Array<Record<string, unknown>>>(`${base}cftc-sp500.json`),
        getJson<Array<Record<string, unknown>>>(`${base}cnn-fear-greed.json`),
        getJson<Array<Record<string, unknown>>>(`${base}crypto-fear-greed.json`),
        getJson<Array<Record<string, unknown>>>(`${base}aaii.json`),
        getJson<Array<Record<string, unknown>>>(`${base}cnn-put-call.json`),
      ]);
      if (cancelled) return;
      const sentimentReached = [vix, move, cftc, cnn, crypto, aaii, putcall].some(Boolean);
      if (!vix && !move && !cftc) {
        setSentiment({ state: sentimentReached ? "missing" : "failed", snapshot: null });
      } else {
        const last = aaii && aaii.length ? aaii[aaii.length - 1] : null;
        const bullish = Number(last?.bullish);
        const bearish = Number(last?.bearish);
        const values: Record<string, number | null> = {
          vix: latestValue(vix ?? [], "value"),
          move: latestValue(move ?? [], "value"),
          cnn_fg: latestValue(cnn ?? [], "score"),
          aaii_bearish: last && Number.isFinite(bearish) ? bearish : null,
          aaii_spread: last && Number.isFinite(bullish) && Number.isFinite(bearish) ? bullish - bearish : null,
          cftc_net: latestValue(cftc ?? [], "net"),
          crypto_fg: latestValue(crypto ?? [], "value"),
          putcall_ratio: latestValue(putcall ?? [], "value"),
        };
        try {
          setSentiment({ state: "ready", snapshot: computeSentimentSignalSnapshot(values) as unknown as SentimentSnapshot });
        } catch {
          setSentiment({ state: "failed", snapshot: null });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { flow, stress, banking, sentiment, retry };
}
