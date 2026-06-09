"use client";

import { useEffect, useState } from "react";

interface DetailData {
  years: string[];
  valuation: { per: number[] };
  income_statement: { revenue: number[] };
  per_share: { eps: number[] };
}

interface F13Entry {
  investor: string;
  shares?: number;
  weight?: number;
}

function useStockDetail(ticker: string) {
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

function use13FData(ticker: string) {
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

function Sparkline({ data, color }: { data: number[]; color: string }) {
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

function PerMiniChart({ years, per }: { years: string[]; per: number[] }) {
  if (!per || per.length < 2) return <span className="text-xs text-slate-300">—</span>;
  const min = Math.min(...per);
  const max = Math.max(...per);
  const range = max - min || 1;
  const w = 240;
  const h = 80;
  const pad = 20;

  const points = per
    .map((v, i) => {
      const x = pad + (i / (per.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((v - min) / range) * (h - 2 * pad);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div>
      <svg width={w} height={h} className="overflow-visible">
        {[0, 0.5, 1].map((t) => {
          const y = h - pad - t * (h - 2 * pad);
          return (
            <line
              key={t}
              x1={pad}
              y1={y}
              x2={w - pad}
              y2={y}
              stroke="#e2e8f0"
              strokeWidth={1}
              strokeDasharray={t === 0.5 ? undefined : "2,2"}
            />
          );
        })}
        <polyline
          points={points}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {per.map((v, i) => {
          const x = pad + (i / (per.length - 1)) * (w - 2 * pad);
          const y = h - pad - ((v - min) / range) * (h - 2 * pad);
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={4} fill="#3b82f6" stroke="white" strokeWidth={2} />
              <text
                x={x}
                y={y - 8}
                textAnchor="middle"
                className="text-[9px] font-black fill-slate-600"
              >
                {v.toFixed(1)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between px-5 text-[10px] font-bold text-slate-400">
        {years.map((y) => (
          <span key={y}>{y}</span>
        ))}
      </div>
    </div>
  );
}

function fmtLarge(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}T`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}B`;
  return `${n}M`;
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

  const hasRevenue =
    detail.income_statement?.revenue && detail.income_statement.revenue.length >= 2;
  const hasEps = detail.per_share?.eps && detail.per_share.eps.length >= 2;
  const hasPer = detail.valuation?.per && detail.valuation.per.length >= 2;

  return (
    <div className="col-span-full border-t border-slate-100 bg-slate-50/50 p-4">
      <div className="grid gap-5 sm:grid-cols-3">
        {/* PER Mini Chart */}
        <div>
          <h4 className="mb-2 text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">
            PER 추이
          </h4>
          {hasPer ? (
            <PerMiniChart years={detail.years} per={detail.valuation.per} />
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
    </div>
  );
}
