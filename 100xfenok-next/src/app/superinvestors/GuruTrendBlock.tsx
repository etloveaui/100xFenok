"use client";

import { useEffect, useMemo, useState } from "react";
import TickerChip from "@/components/TickerChip";
import { useMarketChartTheme } from "@/lib/market-valuation/charts/chartTheme";

interface TrendDoc {
  metadata?: { global_latest_quarter?: string };
  by_investor?: Record<
    string,
    {
      quarterly_snapshots?: Array<{
        quarter: string;
        aum: number;
        holdings_count: number;
        top_10_weight: number;
      }>;
      streaks?: Array<{
        ticker: string;
        direction: "buy" | "sell";
        streak_quarters: number;
        start_quarter: string;
        end_quarter: string;
      }>;
      is_stale?: boolean;
    }
  >;
}

interface HedgeDoc {
  by_investor?: Record<
    string,
    {
      call_count: number;
      call_value: number;
      put_count: number;
      put_value: number;
      hedge_ratio: number;
    } | null
  >;
}

let trendCache: TrendDoc | null = null;
let trendPending: Promise<TrendDoc | null> | null = null;
function loadTrends(): Promise<TrendDoc | null> {
  if (trendCache) return Promise.resolve(trendCache);
  if (trendPending) return trendPending;
  trendPending = fetch("/data/sec-13f/analytics/multi_quarter_trends.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      trendCache = d;
      return d;
    })
    .catch(() => {
      trendPending = null;
      return null;
    });
  return trendPending;
}

let hedgeCache: HedgeDoc | null = null;
let hedgePending: Promise<HedgeDoc | null> | null = null;
function loadHedge(): Promise<HedgeDoc | null> {
  if (hedgeCache) return Promise.resolve(hedgeCache);
  if (hedgePending) return hedgePending;
  hedgePending = fetch("/data/sec-13f/analytics/options_hedge.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      hedgeCache = d;
      return d;
    })
    .catch(() => {
      hedgePending = null;
      return null;
    });
  return hedgePending;
}

function fmtAum(value: number): string {
  if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(1)}T`;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(0)}B`;
  return `$${(value / 1_000_000).toFixed(0)}M`;
}

const SPARK_W = 120;
const SPARK_H = 32;
const SPARK_PAD = 2;

export default function GuruTrendBlock({ investorId }: { investorId: string }) {
  const [trend, setTrend] = useState<TrendDoc | null>(null);
  const [hedge, setHedge] = useState<HedgeDoc | null>(null);
  const chartTheme = useMarketChartTheme();

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadTrends(), loadHedge()]).then(([t, h]) => {
      if (!cancelled) {
        setTrend(t);
        setHedge(h);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const investor = trend?.by_investor?.[investorId];
  const globalQ = trend?.metadata?.global_latest_quarter;
  const hedgeData = hedge?.by_investor?.[investorId];

  const sparkline = useMemo(() => {
    if (!investor?.quarterly_snapshots?.length) return null;
    const snaps = investor.quarterly_snapshots.slice(-12);
    if (snaps.length < 2) return null;
    const vals = snaps.map((s) => s.aum);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const range = maxV - minV || 1;
    const pts = vals
      .map((v, i) => {
        const x = SPARK_PAD + (i / (vals.length - 1)) * (SPARK_W - 2 * SPARK_PAD);
        const y = SPARK_H - SPARK_PAD - ((v - minV) / range) * (SPARK_H - 2 * SPARK_PAD);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    return { pts, lastX: SPARK_W - SPARK_PAD, lastY: SPARK_H - SPARK_PAD - ((vals[vals.length - 1] - minV) / range) * (SPARK_H - 2 * SPARK_PAD) };
  }, [investor]);

  const latestSnap = investor?.quarterly_snapshots?.[investor.quarterly_snapshots.length - 1];
  const isStale = investor?.is_stale || (latestSnap && globalQ && latestSnap.quarter < globalQ);

  const topStreaks = useMemo(() => {
    if (!investor?.streaks) return [];
    return investor.streaks
      .filter((s) => s.streak_quarters >= 3)
      .slice(0, 4);
  }, [investor]);

  const hedgeLabel = useMemo(() => {
    if (!hedgeData) return null;
    const { put_value, call_value, put_count, call_count, hedge_ratio } = hedgeData;
    if (put_value > call_value * 1.5) return { text: "풋 헤지 성향", tone: "bg-amber-100 text-amber-700", sub: `풋 ${put_count}건 · 콜 ${call_count}건` };
    if (call_value > put_value * 1.5) return { text: "콜 베팅 성향", tone: "bg-sky-100 text-sky-700", sub: `풋 ${put_count}건 · 콜 ${call_count}건` };
    return { text: "중립", tone: "bg-slate-100 text-slate-600", sub: `풋 ${put_count}건 · 콜 ${call_count}건`, ratio: hedge_ratio };
  }, [hedgeData]);

  if (!investor || !latestSnap) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      {/* Section 1: AUM trajectory */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">
            운용 추이
            {isStale ? (
              <span className="ml-1 font-semibold normal-case text-amber-600">(이전 분기 기준)</span>
            ) : null}
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="orbitron text-sm font-black text-slate-900">{fmtAum(latestSnap.aum)}</span>
            <span className="text-[10px] font-bold text-slate-500">{latestSnap.quarter}</span>
          </div>
          <div className="mt-0.5 flex gap-3 text-[10px] font-bold text-slate-500">
            <span>{latestSnap.holdings_count}종목</span>
            <span>TOP10 {(latestSnap.top_10_weight * 100).toFixed(1)}%</span>
          </div>
        </div>
        {sparkline ? (
          <svg
            viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
            className="w-[120px] shrink-0"
            aria-label="AUM 추이 스파크라인"
          >
            <polyline
              points={sparkline.pts}
              fill="none"
              stroke={chartTheme.token("brand")}
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <circle
              cx={sparkline.lastX}
              cy={sparkline.lastY}
              r="2.5"
              fill={chartTheme.token("brand")}
              stroke={chartTheme.token("panel")}
              strokeWidth="1"
            />
          </svg>
        ) : null}
      </div>

      {/* Section 2: Streaks */}
      {topStreaks.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {topStreaks.map((s) => {
            const isBuy = s.direction === "buy";
            return (
              <span
                key={s.ticker}
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black transition hover:opacity-80 ${
                  isBuy
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-rose-100 text-rose-700"
                }`}
              >
                <TickerChip ticker={s.ticker} variant="inline" /> {s.streak_quarters}분기 연속 {isBuy ? "매수" : "매도"}
              </span>
            );
          })}
        </div>
      ) : null}

      {/* Section 3: Options stance */}
      {hedgeLabel ? (
        <div className="mt-2">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black ${hedgeLabel.tone}`}
          >
            {hedgeLabel.text}
          </span>
          <p className="mt-0.5 text-[9px] font-semibold text-[var(--c-ink-3)]">{hedgeLabel.sub}</p>
        </div>
      ) : null}
    </div>
  );
}
