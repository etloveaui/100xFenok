"use client";

import { useEffect, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { bandPct, bandClass } from "@/lib/screener/bands";

export interface DetailData {
  years: string[];
  valuation: { per: number[] };
  income_statement: {
    revenue: number[];
    gross_profit?: number[];
    operating_income?: number[];
    net_income?: number[];
  };
  per_share: { eps: number[] };
  cash_flow?: { cfo?: number[]; capex?: number[]; fcf?: number[] };
  profitability?: { roe?: number[]; operating_margin?: number[] };
  growth?: { revenue_growth?: number[]; eps_growth?: number[] };
  per_bands?: {
    current: number;
    min_8y: number;
    avg_8y: number;
    max_8y: number;
    source: string;
  };
  valuation_estimates?: {
    per?: { fy1?: number | null; fy2?: number | null; fy3?: number | null };
  };
  income_statement_estimates?: Record<string, Record<string, number>>;
  cash_flow_estimates?: Record<string, Record<string, number>>;
  per_share_estimates?: Record<string, Record<string, number>>;
  dividend_estimates?: Record<string, Record<string, number>>;
  dividend?: { dps?: number[] };
}

export interface F13Entry {
  investor: string;
  shares?: number;
  weight?: number;
}

export function useStockDetail(ticker: string) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const r = await fetch(`/data/global-scouter/stocks/detail/${ticker}.json`);
        const d = r.ok ? await r.json() : null;
        if (!cancelled) setDetail(d);
      } catch {
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  return { detail, loading };
}

const F13_CACHE = new Map<string, F13Entry[]>();

export function use13FData(ticker: string) {
  const [entries, setEntries] = useState<F13Entry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const cached = F13_CACHE.get(ticker);
      if (cached !== undefined) {
        setEntries(cached);
        return;
      }
      try {
        const r = await fetch("/data/sec-13f/by_ticker.json");
        const d = r.ok ? await r.json() : null;
        const holders = d?.[ticker]?.holder_details ?? [];
        const seen = new Set<string>();
        const unique = holders.filter((h: { investor: string }) => {
          if (seen.has(h.investor)) return false;
          seen.add(h.investor);
          return true;
        });
        F13_CACHE.set(ticker, unique);
        if (!cancelled) setEntries(unique);
      } catch {
        if (!cancelled) setEntries([]);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  return entries;
}

export function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return <span className="text-xs text-slate-300">—</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 200;
  const height = 60;
  const pad = 4;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - pad - ((v - min) / range) * (height - 2 * pad);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {data.map((v, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - pad - ((v - min) / range) * (height - 2 * pad);
        return <circle key={i} cx={x} cy={y} r={3} fill={color} />;
      })}
    </svg>
  );
}

export function PerBandChart({
  years,
  per,
  perBands,
  estimates,
}: {
  years: string[];
  per: number[];
  perBands?: { current: number; min_8y: number; avg_8y: number; max_8y: number };
  estimates?: { fy1?: number | null };
}) {
  if (!per || per.length < 2) return <span className="text-xs text-slate-300">—</span>;

  const allValues = [...per];
  if (estimates?.fy1 !== undefined && estimates.fy1 !== null) {
    allValues.push(estimates.fy1);
  }

  let yMin = Math.min(...allValues);
  let yMax = Math.max(...allValues);
  if (perBands) {
    yMin = Math.min(yMin, perBands.min_8y);
    yMax = Math.max(yMax, perBands.max_8y);
  }
  const yPad = (yMax - yMin) * 0.1 || 1;
  yMin -= yPad;
  yMax += yPad;

  const w = 280;
  const h = 110;
  const padL = 44;
  const padR = 28;
  const padT = 10;
  const padB = 24;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const toX = (i: number) => padL + (i / (per.length - 1)) * plotW;
  const toY = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const points = per.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");

  const currentIndex = per.length - 1;
  const currentX = toX(currentIndex);
  const currentY = toY(per[currentIndex]);
  const currentPct = perBands ? bandPct(perBands.current, perBands.min_8y, perBands.max_8y) : 0.5;
  const currentCls = bandClass(currentPct);
  const currentColor =
    currentCls === "emerald" ? "#10b981" : currentCls === "rose" ? "#f43f5e" : "#64748b";

  const hasForward = estimates?.fy1 !== undefined && estimates.fy1 !== null;
  const forwardX = padL + plotW + 16;
  const forwardY = hasForward ? toY(estimates.fy1!) : 0;

  return (
    <div>
      <svg width={w} height={h} className="overflow-visible">
        {/* Shaded band */}
        {perBands && (
          <>
            <rect
              x={padL}
              y={toY(perBands.max_8y)}
              width={plotW}
              height={toY(perBands.min_8y) - toY(perBands.max_8y)}
              fill="#f1f5f9"
            />
            <rect
              x={padL}
              y={toY(perBands.max_8y)}
              width={plotW}
              height={toY(perBands.avg_8y) - toY(perBands.max_8y)}
              fill="#fff1f2"
            />
            <rect
              x={padL}
              y={toY(perBands.avg_8y)}
              width={plotW}
              height={toY(perBands.min_8y) - toY(perBands.avg_8y)}
              fill="#ecfdf5"
            />
          </>
        )}

        {/* Avg dashed line + label */}
        {perBands && (
          <>
            <line
              x1={padL}
              y1={toY(perBands.avg_8y)}
              x2={padL + plotW}
              y2={toY(perBands.avg_8y)}
              stroke="#64748b"
              strokeWidth={1}
              strokeDasharray="4,2"
            />
            <text
              x={padL + plotW + 4}
              y={toY(perBands.avg_8y) + 3}
              className="text-[8px] font-black fill-slate-500"
            >
              avg {perBands.avg_8y.toFixed(1)}
            </text>
          </>
        )}

        {/* Grid lines */}
        {[0, 0.5, 1].map((t) => {
          const y = padT + t * plotH;
          return (
            <line
              key={t}
              x1={padL}
              y1={y}
              x2={padL + plotW}
              y2={y}
              stroke="#e2e8f0"
              strokeWidth={1}
              strokeDasharray={t === 0.5 ? undefined : "2,2"}
            />
          );
        })}

        {/* PER line */}
        <polyline
          points={points}
          fill="none"
          stroke="#1B73D3"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Forward extension */}
        {hasForward && (
          <>
            <line
              x1={currentX}
              y1={currentY}
              x2={forwardX}
              y2={forwardY}
              stroke="#1B73D3"
              strokeWidth={2}
              strokeDasharray="4,2"
            />
            <circle cx={forwardX} cy={forwardY} r={3} fill="none" stroke="#1B73D3" strokeWidth={2} />
          </>
        )}

        {/* Data points */}
        {per.map((v, i) => {
          const x = toX(i);
          const y = toY(v);
          const isCurrent = i === currentIndex;
          return (
            <g key={i}>
              <circle
                cx={x}
                cy={y}
                r={isCurrent ? 5 : 3}
                fill={isCurrent ? currentColor : "#1B73D3"}
                stroke="white"
                strokeWidth={2}
              />
              <text
                x={x}
                y={y - 10}
                textAnchor="middle"
                className="text-[9px] font-black fill-slate-600"
              >
                {v.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* Y-axis labels */}
        {perBands && (
          <>
            <text
              x={padL - 4}
              y={toY(perBands.max_8y) + 3}
              textAnchor="end"
              className="text-[8px] font-black fill-slate-400 orbitron tabular-nums"
            >
              {perBands.max_8y.toFixed(0)}
            </text>
            <text
              x={padL - 4}
              y={toY(perBands.avg_8y) + 3}
              textAnchor="end"
              className="text-[8px] font-black fill-slate-500 orbitron tabular-nums"
            >
              {perBands.avg_8y.toFixed(1)}
            </text>
            <text
              x={padL - 4}
              y={toY(perBands.min_8y) + 3}
              textAnchor="end"
              className="text-[8px] font-black fill-slate-400 orbitron tabular-nums"
            >
              {perBands.min_8y.toFixed(0)}
            </text>
          </>
        )}
      </svg>
      <div className="mt-1 flex justify-between px-11 text-[10px] font-bold text-slate-400">
        {years.map((y) => (
          <span key={y}>{y}</span>
        ))}
        {hasForward && <span>FY+1</span>}
      </div>
    </div>
  );
}

export function fmtLarge(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}T`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}B`;
  return `${n}M`;
}

export function StockDetailBody({
  detail,
  f13Entries,
}: {
  detail: DetailData;
  f13Entries: F13Entry[] | null;
}) {
  const hasRevenue =
    detail.income_statement?.revenue && detail.income_statement.revenue.length >= 2;
  const hasEps = detail.per_share?.eps && detail.per_share.eps.length >= 2;
  const hasPer = detail.valuation?.per && detail.valuation.per.length >= 2;

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-3">
        {/* PER Band Chart */}
        <div>
          <h4 className="mb-2 text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">
            PER 밴드
          </h4>
          {hasPer ? (
            <PerBandChart
              years={detail.years}
              per={detail.valuation.per}
              perBands={detail.per_bands}
              estimates={detail.valuation_estimates?.per}
            />
          ) : (
            <span className="text-xs text-slate-300">—</span>
          )}
        </div>

        {/* Revenue Sparkline */}
        <div>
          <h4 className="mb-2 text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">
            매출 추이
          </h4>
          {hasRevenue ? (
            <>
              <Sparkline data={detail.income_statement.revenue} color="#10b981" />
              <div className="mt-1 text-[10px] font-bold text-slate-400">
                {fmtLarge(detail.income_statement.revenue[detail.income_statement.revenue.length - 1])}
                {" (최신)"}
              </div>
            </>
          ) : (
            <span className="text-xs text-slate-300">—</span>
          )}
        </div>

        {/* EPS Sparkline */}
        <div>
          <h4 className="mb-2 text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">
            EPS 추이
          </h4>
          {hasEps ? (
            <>
              <Sparkline data={detail.per_share.eps} color="#8b5cf6" />
              <div className="mt-1 text-[10px] font-bold text-slate-400">
                {`$${detail.per_share.eps[detail.per_share.eps.length - 1].toFixed(2)} (최신)`}
              </div>
            </>
          ) : (
            <span className="text-xs text-slate-300">—</span>
          )}
        </div>
      </div>

      {/* 13F Badges */}
      {f13Entries && f13Entries.length > 0 ? (
        <div className="mt-4">
          <h4 className="mb-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">
            13F 보유 구루
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {f13Entries.map((e) => (
              <span
                key={e.investor}
                className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-700"
              >
                {e.investor}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function StockDetailPanel({ ticker }: { ticker: string }) {
  const { detail, loading } = useStockDetail(ticker);
  const f13Entries = use13FData(ticker);

  if (loading) {
    return (
      <div className="col-span-full border-t border-slate-100 bg-slate-50/50 px-4 py-6 text-sm text-slate-500">
        상세 데이터 로딩 중…
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="col-span-full border-t border-slate-100 bg-slate-50/50 px-4 py-6 text-sm text-slate-500">
        상세 데이터를 불러올 수 없습니다.
      </div>
    );
  }

  return (
    <div className="col-span-full border-t border-slate-100 bg-slate-50/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">
          종목 상세
        </span>
        <TransitionLink
          href={`/stock/${encodeURIComponent(ticker)}`}
          className="text-[10px] font-black text-brand-interactive hover:underline"
        >
          전체 화면 →
        </TransitionLink>
      </div>
      <StockDetailBody detail={detail} f13Entries={f13Entries} />
    </div>
  );
}
