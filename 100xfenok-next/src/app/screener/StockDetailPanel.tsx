"use client";

import { useEffect, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { bandPct, bandClass } from "@/lib/screener/bands";

type MaybeNumber = number | null | undefined;
type NumberSeries = MaybeNumber[];

interface WeeklyPoint {
  date?: string;
  value?: MaybeNumber;
}

interface WeeklyConsensusRow {
  date?: string;
  price?: MaybeNumber;
  revenue_consensus?: MaybeNumber;
  revenue_change?: MaybeNumber;
  eps_consensus?: MaybeNumber;
  eps_change?: MaybeNumber;
  per?: MaybeNumber;
  pbr?: MaybeNumber;
}

interface RawFinancials {
  periods?: string[];
  income_statement?: {
    revenue?: NumberSeries;
    gross_profit?: NumberSeries;
    operating_income?: NumberSeries;
    net_income?: NumberSeries;
  };
  per_share?: { eps?: NumberSeries };
  cash_flow?: { fcf?: NumberSeries; cfo?: NumberSeries; capex?: NumberSeries };
  profitability?: {
    gross_margin?: NumberSeries;
    operating_margin?: NumberSeries;
    net_margin?: NumberSeries;
    roe?: NumberSeries;
    roa?: NumberSeries;
  };
  growth?: { revenue_growth?: NumberSeries; eps_growth?: NumberSeries };
  valuation?: { per?: NumberSeries; pbr?: NumberSeries; psr?: NumberSeries };
}

export interface DetailData {
  years: string[];
  raw_periods?: string[];
  raw_financials?: RawFinancials;
  valuation?: { per?: NumberSeries };
  income_statement: {
    revenue?: NumberSeries;
    gross_profit?: NumberSeries;
    operating_income?: NumberSeries;
    net_income?: NumberSeries;
  };
  per_share?: { eps?: NumberSeries };
  cash_flow?: { cfo?: NumberSeries; capex?: NumberSeries; fcf?: NumberSeries };
  profitability?: {
    gross_margin?: NumberSeries;
    operating_margin?: NumberSeries;
    net_margin?: NumberSeries;
    roe?: NumberSeries;
    roa?: NumberSeries;
  };
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
  eps_consensus?: {
    weekly?: {
      fy_plus_1?: WeeklyPoint[];
      fy_plus_2?: WeeklyPoint[];
      fy_plus_3?: WeeklyPoint[];
    };
    weekly_change?: {
      fy_plus_1?: MaybeNumber;
      fy_plus_2?: MaybeNumber;
      fy_plus_3?: MaybeNumber;
    };
  };
  weekly_revision_history?: {
    weekly_consensus_revision?: WeeklyConsensusRow[];
  };
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

type FiscalPoint = { label: string; value: number; index: number; estimate?: boolean };

function buildFiscalPoints(years: string[], data: NumberSeries | null | undefined, fy1?: MaybeNumber) {
  const actualCount = Math.max(years.length, data?.length ?? 0);
  const labels = Array.from({ length: actualCount }, (_, index) => years[index] ?? `P${index + 1}`);
  const points: FiscalPoint[] = (data ?? [])
    .map((value, index) => ({
      label: labels[index] ?? `P${index + 1}`,
      value,
      index,
    }))
    .filter((point): point is FiscalPoint => isFiniteNumber(point.value));
  if (isFiniteNumber(fy1)) {
    points.push({ label: "FY+1", value: fy1, index: actualCount, estimate: true });
  }
  return {
    labels: isFiniteNumber(fy1) ? [...labels, "FY+1"] : labels,
    points,
  };
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

function fmtPlainNumber(value: MaybeNumber, digits = 1): string {
  return isFiniteNumber(value) ? value.toFixed(digits) : "—";
}

function fmtSignedNumber(value: MaybeNumber, digits = 2): string {
  if (!isFiniteNumber(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function fmtSignedPercentPoints(value: MaybeNumber, digits = 1): string {
  if (!isFiniteNumber(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function fmtSignedFractionPercent(value: MaybeNumber, digits = 1): string {
  if (!isFiniteNumber(value)) return "—";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)}%`;
}

function fmtEps(value: MaybeNumber): string {
  return isFiniteNumber(value) ? `$${value.toFixed(2)}` : "—";
}

function toneText(value: MaybeNumber): string {
  if (!isFiniteNumber(value)) return "text-slate-400";
  return value >= 0 ? "text-emerald-600" : "text-rose-600";
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
      Promise.resolve().then(() => {
        if (!cancelled) setEntries([]);
      });
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

export function Sparkline({
  data,
  color,
  years = [],
  estimate,
  formatValue = (value) => value.toFixed(1),
}: {
  data: NumberSeries;
  color: string;
  years?: string[];
  estimate?: MaybeNumber;
  formatValue?: (value: number) => string;
}) {
  const { labels, points } = buildFiscalPoints(years, data, estimate);
  const actualPoints = points.filter((point) => !point.estimate);
  const estimatePoint = points.find((point) => point.estimate);
  if (points.length < 2 || labels.length < 2) return <span className="text-xs text-slate-300">—</span>;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 220;
  const height = 82;
  const padX = 6;
  const padT = 8;
  const padB = 17;
  const plotW = width - padX * 2;
  const plotH = height - padT - padB;
  const xDenominator = Math.max(labels.length - 1, 1);
  const toX = (index: number) => padX + (index / xDenominator) * plotW;
  const toY = (value: number) => padT + plotH - ((value - min) / range) * plotH;

  const actualLine = actualPoints.map((point) => `${toX(point.index)},${toY(point.value)}`).join(" ");
  const currentPoint = actualPoints[actualPoints.length - 1] ?? null;
  const labelPoints = [currentPoint, estimatePoint].filter(Boolean) as FiscalPoint[];

  return (
    <svg width={width} height={height} className="max-w-full overflow-visible" role="img" aria-label="FY별 추이 차트">
      <polyline points={actualLine} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {estimatePoint && currentPoint ? (
        <line
          x1={toX(currentPoint.index)}
          y1={toY(currentPoint.value)}
          x2={toX(estimatePoint.index)}
          y2={toY(estimatePoint.value)}
          stroke={color}
          strokeWidth={2}
          strokeDasharray="4,2"
        />
      ) : null}
      {points.map((point) => {
        const x = toX(point.index);
        const y = toY(point.value);
        return (
          <circle
            key={`${point.label}-${point.index}`}
            cx={x}
            cy={y}
            r={point.estimate ? 3.5 : 3}
            fill={point.estimate ? "white" : color}
            stroke={color}
            strokeWidth={point.estimate ? 2 : 1}
          >
            <title>{`${point.label} ${formatValue(point.value)}`}</title>
          </circle>
        );
      })}
      {labelPoints.map((point) => (
        <text
          key={`label-${point.label}`}
          x={toX(point.index)}
          y={Math.max(9, toY(point.value) - 7)}
          textAnchor="middle"
          className="text-[8px] font-black fill-slate-500"
        >
          {formatValue(point.value)}
        </text>
      ))}
      {labels.map((label, index) => (
        <text key={label} x={toX(index)} y={height - 3} textAnchor="middle" className="text-[8px] font-black fill-slate-400">
          {label}
        </text>
      ))}
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
  const { labels: periodLabels, points: allPerPoints } = buildFiscalPoints(years, per, estimates?.fy1);
  const perPoints = allPerPoints.filter((point) => !point.estimate);
  const forwardPoint = allPerPoints.find((point) => point.estimate);
  if (perPoints.length < 2) return <span className="text-xs text-slate-300">—</span>;

  const allValues = allPerPoints.map((point) => point.value);

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

  const w = 300;
  const h = 132;
  const padL = 44;
  const padR = 30;
  const padT = 12;
  const padB = 30;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const xDenominator = Math.max(periodLabels.length - 1, 1);

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

  const hasForward = Boolean(forwardPoint);
  const forwardX = forwardPoint ? toX(forwardPoint.index) : 0;
  const forwardY = forwardPoint ? toY(forwardPoint.value) : 0;

  return (
    <div>
      <svg width={w} height={h} className="max-w-full overflow-visible" role="img" aria-label="FY별 PER 밴드 차트">
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
          </>
        )}

        {/* Data points */}
        {allPerPoints.map((point) => {
          const x = toX(point.index);
          const y = toY(point.value);
          const isCurrent = !point.estimate && point.index === currentPoint.index;
          return (
            <g key={`${point.label}-${point.index}`}>
              <circle
                cx={x}
                cy={y}
                r={isCurrent ? 5 : point.estimate ? 3.5 : 3}
                fill={point.estimate ? "white" : isCurrent ? currentColor : "#1B73D3"}
                stroke={point.estimate ? "#1B73D3" : "white"}
                strokeWidth={2}
              >
                <title>{`${point.label} PER ${point.value.toFixed(1)}x`}</title>
              </circle>
              <text
                x={x}
                y={Math.max(9, y - 10)}
                textAnchor="middle"
                className="text-[9px] font-black fill-slate-600"
              >
                {point.value.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* X-axis labels */}
        {periodLabels.map((label, index) => (
          <text key={label} x={toX(index)} y={h - 8} textAnchor="middle" className="text-[9px] font-black fill-slate-400">
            {label}
          </text>
        ))}

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
    </div>
  );
}

export function fmtLarge(n: MaybeNumber): string {
  if (!isFiniteNumber(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}T`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}B`;
  return `${sign}${abs}M`;
}

export function RevisionPulse({ detail, compact = false }: { detail: DetailData; compact?: boolean }) {
  const weekly = detail.eps_consensus?.weekly;
  const changes = detail.eps_consensus?.weekly_change;
  const epsRows = [
    { key: "fy1", label: "FY+1 EPS", series: weekly?.fy_plus_1 ?? [], change: changes?.fy_plus_1 },
    { key: "fy2", label: "FY+2 EPS", series: weekly?.fy_plus_2 ?? [], change: changes?.fy_plus_2 },
    { key: "fy3", label: "FY+3 EPS", series: weekly?.fy_plus_3 ?? [], change: changes?.fy_plus_3 },
  ].filter((row) => row.series.length > 0);
  const historyRows = (detail.weekly_revision_history?.weekly_consensus_revision ?? [])
    .filter((row) => typeof row.date === "string")
    .slice(0, compact ? 2 : 4);

  if (epsRows.length === 0 && historyRows.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white/80 p-3">
      <div className="mb-2 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">리비전·컨센서스</h4>
        <span className="text-[10px] font-bold text-slate-400">EPS weekly consensus</span>
      </div>
      {epsRows.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-3">
          {epsRows.map((row) => {
            const latest = row.series[0];
            const previous = row.series[1];
            return (
              <div key={row.key} className="min-w-0 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">{row.label}</span>
                  <span className={`shrink-0 text-[10px] font-black tabular-nums ${toneText(row.change)}`}>
                    {fmtSignedFractionPercent(row.change)}
                  </span>
                </div>
                <p className="orbitron mt-1 text-sm font-black tabular-nums text-slate-950">{fmtEps(latest?.value)}</p>
                <p className="mt-1 truncate text-[9px] font-bold tabular-nums text-slate-400">
                  {latest?.date ?? "—"} · 전주 {fmtEps(previous?.value)}
                </p>
              </div>
            );
          })}
        </div>
      ) : null}
      {historyRows.length > 0 ? (
        <div className="-mx-1 mt-3 overflow-x-auto px-1">
          <table className="w-full min-w-[520px] text-[10px]">
            <thead>
              <tr className="border-b border-slate-200 font-black uppercase tracking-[0.06em] text-slate-400">
                <th className="px-2 py-1 text-left">일자</th>
                <th className="px-2 py-1 text-right">가격</th>
                <th className="px-2 py-1 text-right">매출 컨센</th>
                <th className="px-2 py-1 text-right">EPS 컨센</th>
                <th className="px-2 py-1 text-right">EPS 변화</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((row, index) => (
                <tr key={`${row.date}-${index}`} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-2 py-1.5 font-bold tabular-nums text-slate-600">{row.date}</td>
                  <td className="px-2 py-1.5 text-right orbitron tabular-nums text-slate-700">{fmtPlainNumber(row.price, 2)}</td>
                  <td className="px-2 py-1.5 text-right orbitron tabular-nums text-slate-700">{fmtLarge(row.revenue_consensus)}</td>
                  <td className="px-2 py-1.5 text-right orbitron tabular-nums text-slate-700">{fmtEps(row.eps_consensus)}</td>
                  <td className={`px-2 py-1.5 text-right orbitron font-black tabular-nums ${toneText(row.eps_change)}`}>
                    {fmtSignedNumber(row.eps_change, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function RawFinancialDepth({ detail, compact = false }: { detail: DetailData; compact?: boolean }) {
  const raw = detail.raw_financials;
  const periods = raw?.periods ?? detail.raw_periods ?? [];
  const rows: Array<{ label: string; data?: NumberSeries; fmt: (value: MaybeNumber) => string }> = [
    { label: "매출", data: raw?.income_statement?.revenue, fmt: fmtLarge },
    { label: "영업이익", data: raw?.income_statement?.operating_income, fmt: fmtLarge },
    { label: "순이익", data: raw?.income_statement?.net_income, fmt: fmtLarge },
    { label: "EPS", data: raw?.per_share?.eps, fmt: fmtEps },
    { label: "매출 성장", data: raw?.growth?.revenue_growth, fmt: fmtSignedPercentPoints },
    { label: "PER", data: raw?.valuation?.per, fmt: (value) => fmtPlainNumber(value, 1) },
    { label: "PBR", data: raw?.valuation?.pbr, fmt: (value) => fmtPlainNumber(value, 2) },
    { label: "ROE", data: raw?.profitability?.roe, fmt: fmtSignedPercentPoints },
    { label: "영업마진", data: raw?.profitability?.operating_margin, fmt: fmtSignedPercentPoints },
  ];
  const validRows = rows
    .filter((row) => finiteValues(row.data).length > 0)
    .slice(0, compact ? 6 : rows.length);

  if (periods.length === 0 || validRows.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white/80 p-3">
      <div className="mb-2 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">원재무 깊이</h4>
        <span className="text-[10px] font-bold text-slate-400">FY-4 ~ FY+3 canonical</span>
      </div>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[720px] text-[10px]">
          <thead>
            <tr className="border-b border-slate-200 font-black uppercase tracking-[0.06em] text-slate-400">
              <th className="px-2 py-1.5 text-left">항목</th>
              {periods.map((period) => (
                <th key={period} className="px-2 py-1.5 text-right">{period}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {validRows.map((row) => (
              <tr key={row.label} className="border-b border-slate-100 last:border-b-0">
                <td className="px-2 py-1.5 font-black text-slate-600">{row.label}</td>
                {periods.map((period, index) => {
                  const value = row.data?.[index];
                  return (
                    <td key={`${row.label}-${period}`} className="px-2 py-1.5 text-right orbitron tabular-nums text-slate-800">
                      {row.fmt(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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
              <Sparkline
                data={revenue}
                color="#10b981"
                years={detail.years}
                estimate={detail.income_statement_estimates?.revenue?.fy1}
                formatValue={fmtLarge}
              />
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
              <Sparkline
                data={eps}
                color="#8b5cf6"
                years={detail.years}
                estimate={detail.per_share_estimates?.eps?.fy1}
                formatValue={(value) => `$${value.toFixed(2)}`}
              />
              <div className="mt-1 text-[10px] font-bold text-slate-400">
                {latestEps != null ? `$${latestEps.toFixed(2)} (최신)` : "—"}
              </div>
            </>
          ) : (
            <span className="text-xs text-slate-300">—</span>
          )}
        </div>
      </div>

      <RevisionPulse detail={detail} compact />
      <RawFinancialDepth detail={detail} compact />

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
