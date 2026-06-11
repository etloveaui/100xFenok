"use client";

import { useEffect, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { bandPct, bandClass } from "@/lib/screener/bands";

type MaybeNumber = number | null | undefined;
type NumberSeries = MaybeNumber[];

export interface DetailData {
  years: string[];
  valuation?: { per?: NumberSeries };
  income_statement: {
    revenue?: NumberSeries;
    gross_profit?: NumberSeries;
    operating_income?: NumberSeries;
    net_income?: NumberSeries;
  };
  per_share?: { eps?: NumberSeries };
  cash_flow?: { cfo?: NumberSeries; capex?: NumberSeries; fcf?: NumberSeries };
  profitability?: { roe?: NumberSeries; operating_margin?: NumberSeries };
  growth?: { revenue_growth?: NumberSeries; eps_growth?: NumberSeries };
  per_bands?: {
    current: MaybeNumber;
    min_8y: MaybeNumber;
    avg_8y: MaybeNumber;
    max_8y: MaybeNumber;
    source: string;
  };
  valuation_estimates?: {
    per?: { fy1?: MaybeNumber; fy2?: MaybeNumber; fy3?: MaybeNumber };
  };
  income_statement_estimates?: Record<string, Record<string, MaybeNumber>>;
  cash_flow_estimates?: Record<string, Record<string, MaybeNumber>>;
  per_share_estimates?: Record<string, Record<string, MaybeNumber>>;
  dividend_estimates?: Record<string, Record<string, MaybeNumber>>;
  dividend?: { dps?: NumberSeries };
}

export interface F13Entry {
  investor: string;
  shares?: number;
  weight?: number;
}

function isFiniteNumber(value: MaybeNumber): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteValues(data: NumberSeries | null | undefined): number[] {
  return (data ?? []).filter(isFiniteNumber);
}

function lastFinite(data: NumberSeries | null | undefined): number | null {
  const values = finiteValues(data);
  return values.length > 0 ? values[values.length - 1] : null;
}

function validPerBands(
  perBands: DetailData["per_bands"],
): perBands is { current: number; min_8y: number; avg_8y: number; max_8y: number; source: string } {
  return Boolean(
    perBands &&
      isFiniteNumber(perBands.current) &&
      isFiniteNumber(perBands.min_8y) &&
      isFiniteNumber(perBands.avg_8y) &&
      isFiniteNumber(perBands.max_8y) &&
      perBands.min_8y < perBands.max_8y,
  );
}

export function useStockDetail(ticker: string, enabled = true) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const symbol = normalizeTicker(ticker);
    if (!enabled || !symbol) {
      setDetail(null);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    const run = async () => {
      setLoading(true);
      try {
        const r = await fetch(`/data/global-scouter/stocks/detail/${encodeURIComponent(symbol)}.json`);
        const d = r.ok ? await r.json() : null;
        if (!cancelled) setDetail(isRecord(d) ? (d as unknown as DetailData) : null);
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
  }, [ticker, enabled]);

  return { detail, loading };
}

const F13_CACHE = new Map<string, F13Entry[]>();

export function use13FData(ticker: string) {
  const [entries, setEntries] = useState<F13Entry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const symbol = normalizeTicker(ticker);
    if (!symbol) {
      setEntries([]);
      return () => {
        cancelled = true;
      };
    }
    const run = async () => {
      const cached = F13_CACHE.get(symbol);
      if (cached !== undefined) {
        setEntries(cached);
        return;
      }
      try {
        const r = await fetch("/data/sec-13f/by_ticker.json");
        const d = r.ok ? await r.json() : null;
        const holders = Array.isArray(d?.[symbol]?.holder_details) ? d[symbol].holder_details : [];
        const seen = new Set<string>();
        const unique = holders.filter((h: { investor?: unknown }) => {
          if (typeof h.investor !== "string" || h.investor.trim() === "") return false;
          if (seen.has(h.investor)) return false;
          seen.add(h.investor);
          return true;
        }) as F13Entry[];
        F13_CACHE.set(symbol, unique);
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

export function Sparkline({ data, color }: { data: NumberSeries; color: string }) {
  const values = finiteValues(data);
  if (values.length < 2) return <span className="text-xs text-slate-300">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 200;
  const height = 60;
  const pad = 4;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
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
      {values.map((v, i) => {
        const x = (i / (values.length - 1)) * width;
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
  per: NumberSeries;
  perBands?: DetailData["per_bands"];
  estimates?: { fy1?: MaybeNumber };
}) {
  const perPoints = (per ?? [])
    .map((value, index) => ({ value, index }))
    .filter((point): point is { value: number; index: number } => isFiniteNumber(point.value));
  if (perPoints.length < 2) return <span className="text-xs text-slate-300">—</span>;

  const allValues = perPoints.map((point) => point.value);
  if (isFiniteNumber(estimates?.fy1)) {
    allValues.push(estimates.fy1);
  }

  const bands = validPerBands(perBands) ? perBands : null;
  let yMin = Math.min(...allValues);
  let yMax = Math.max(...allValues);
  if (bands) {
    yMin = Math.min(yMin, bands.min_8y);
    yMax = Math.max(yMax, bands.max_8y);
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
  const xDenominator = Math.max((per?.length ?? 0) - 1, 1);

  const toX = (i: number) => padL + (i / xDenominator) * plotW;
  const toY = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const points = perPoints.map(({ value, index }) => `${toX(index)},${toY(value)}`).join(" ");

  const currentPoint = perPoints[perPoints.length - 1];
  const currentX = toX(currentPoint.index);
  const currentY = toY(currentPoint.value);
  const currentPct = bands ? bandPct(bands.current, bands.min_8y, bands.max_8y) : 0.5;
  const currentCls = bandClass(currentPct);
  const currentColor =
    currentCls === "emerald" ? "#10b981" : currentCls === "rose" ? "#f43f5e" : "#64748b";

  const hasForward = isFiniteNumber(estimates?.fy1);
  const forwardX = padL + plotW + 16;
  const forwardY = hasForward ? toY(estimates.fy1!) : 0;

  return (
    <div>
      <svg width={w} height={h} className="overflow-visible">
        {/* Shaded band */}
        {bands && (
          <>
            <rect
              x={padL}
              y={toY(bands.max_8y)}
              width={plotW}
              height={toY(bands.min_8y) - toY(bands.max_8y)}
              fill="#f1f5f9"
            />
            <rect
              x={padL}
              y={toY(bands.max_8y)}
              width={plotW}
              height={toY(bands.avg_8y) - toY(bands.max_8y)}
              fill="#fff1f2"
            />
            <rect
              x={padL}
              y={toY(bands.avg_8y)}
              width={plotW}
              height={toY(bands.min_8y) - toY(bands.avg_8y)}
              fill="#ecfdf5"
            />
          </>
        )}

        {/* Avg dashed line + label */}
        {bands && (
          <>
            <line
              x1={padL}
              y1={toY(bands.avg_8y)}
              x2={padL + plotW}
              y2={toY(bands.avg_8y)}
              stroke="#64748b"
              strokeWidth={1}
              strokeDasharray="4,2"
            />
            <text
              x={padL + plotW + 4}
              y={toY(bands.avg_8y) + 3}
              className="text-[8px] font-black fill-slate-500"
            >
              avg {bands.avg_8y.toFixed(1)}
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
        {perPoints.map(({ value, index }) => {
          const x = toX(index);
          const y = toY(value);
          const isCurrent = index === currentPoint.index;
          return (
            <g key={index}>
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
                {value.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* Y-axis labels */}
        {bands && (
          <>
            <text
              x={padL - 4}
              y={toY(bands.max_8y) + 3}
              textAnchor="end"
              className="text-[8px] font-black fill-slate-400 orbitron tabular-nums"
            >
              {bands.max_8y.toFixed(0)}
            </text>
            <text
              x={padL - 4}
              y={toY(bands.avg_8y) + 3}
              textAnchor="end"
              className="text-[8px] font-black fill-slate-500 orbitron tabular-nums"
            >
              {bands.avg_8y.toFixed(1)}
            </text>
            <text
              x={padL - 4}
              y={toY(bands.min_8y) + 3}
              textAnchor="end"
              className="text-[8px] font-black fill-slate-400 orbitron tabular-nums"
            >
              {bands.min_8y.toFixed(0)}
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

export function fmtLarge(n: MaybeNumber): string {
  if (!isFiniteNumber(n)) return "—";
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
  const revenue = detail.income_statement?.revenue ?? [];
  const eps = detail.per_share?.eps ?? [];
  const per = detail.valuation?.per ?? [];
  const hasRevenue = finiteValues(revenue).length >= 2;
  const hasEps = finiteValues(eps).length >= 2;
  const hasPer = finiteValues(per).length >= 2;
  const latestRevenue = lastFinite(revenue);
  const latestEps = lastFinite(eps);

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
              per={per}
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
              <Sparkline data={revenue} color="#10b981" />
              <div className="mt-1 text-[10px] font-bold text-slate-400">
                {fmtLarge(latestRevenue)}
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
              <Sparkline data={eps} color="#8b5cf6" />
              <div className="mt-1 text-[10px] font-bold text-slate-400">
                {latestEps != null ? `$${latestEps.toFixed(2)} (최신)` : "—"}
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
