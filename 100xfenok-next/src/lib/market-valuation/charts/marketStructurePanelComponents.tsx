"use client";

// Market Structure interactive chart panels (FORGE Slice C, Claude/cc-29).
//
// One panel per slot in cx-9's MarketStructureDetailClient. Default render uses the
// compact summary series; selecting MAX lazily pulls the raw full-depth series via
// each model's loadFull(), so UI-reachable == coverage available_count (gate note N1).
// Rendered `bare` because SlotShell already provides the card chrome.

import { useCallback, useMemo, useState } from "react";

import MarketStructureDetailClient, {
  type MarketStructureDetailSlots,
  type MarketStructureSlotProps,
} from "@/app/market-valuation/structure/MarketStructureDetailClient";

import { MarketChartFrame } from "./MarketChartFrame";
import {
  aaiiChartSeries,
  liquidityChartSeries,
  rawChartSeries,
  sentimentChartSeries,
} from "./marketStructurePanels";
import type { MarketChartSeries, MarketChartValueFormatter } from "./types";

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const compact: MarketChartValueFormatter = (value) =>
  value === null
    ? "—"
    : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);

const pct1: MarketChartValueFormatter = (value) =>
  value === null ? "—" : `${value.toFixed(1)}`;

function depthFootnote(loading: boolean, full: boolean, reachable: number): string {
  if (loading) return "원본 깊이 불러오는 중…";
  if (full) return `원본 전체 ${reachable.toLocaleString("ko-KR")} 포인트`;
  return "기본 요약 · MAX로 원본 깊이 확장";
}

function LiquidityPanel({ model }: MarketStructureSlotProps) {
  const summary = useMemo<MarketChartSeries[]>(
    () =>
      liquidityChartSeries(model).map((series, index) => ({
        ...series,
        yAxisId: (index === 0 ? "y" : "y1") as "y" | "y1",
      })),
    [model],
  );
  const [full, setFull] = useState<MarketChartSeries[] | null>(null);
  const [loading, setLoading] = useState(false);

  const onRangeChange = useCallback(
    (rangeId: string) => {
      if (rangeId !== "MAX" || full || loading) return;
      setLoading(true);
      Promise.all(
        model.liquidity.map(async (item, index) => ({
          ...rawChartSeries(item.id, item.label, (await item.loadFull?.()) ?? []),
          yAxisId: (index === 0 ? "y" : "y1") as "y" | "y1",
        })),
      )
        .then((next) => setFull(next))
        .finally(() => setLoading(false));
    },
    [model, full, loading],
  );

  const reachable = model.liquidity[0]?.meta.reachable_count ?? 0;
  return (
    <MarketChartFrame
      bare
      ariaLabel="유동성 추이 (TGA · 스테이블코인)"
      series={full ?? summary}
      type="line"
      sortLabels
      formatValue={compact}
      onRangeChange={onRangeChange}
      footnote={depthFootnote(loading, full !== null, reachable)}
    />
  );
}

function SentimentPanel({ model }: MarketStructureSlotProps) {
  const summary = useMemo(() => sentimentChartSeries(model), [model]);
  const [full, setFull] = useState<MarketChartSeries[] | null>(null);
  const [loading, setLoading] = useState(false);

  const onRangeChange = useCallback(
    (rangeId: string) => {
      if (rangeId !== "MAX" || full || loading) return;
      setLoading(true);
      Promise.all(
        model.sentiment.map(async (item) =>
          rawChartSeries(item.id, item.label, (await item.loadFull?.()) ?? []),
        ),
      )
        .then((next) => setFull(next))
        .finally(() => setLoading(false));
    },
    [model, full, loading],
  );

  const reachable = model.sentiment[0]?.meta.reachable_count ?? 0;
  return (
    <MarketChartFrame
      bare
      ariaLabel="CNN 하위 심리 추이 (7개 구성요소)"
      series={full ?? summary}
      type="line"
      sortLabels
      suggestedMin={0}
      suggestedMax={100}
      formatValue={pct1}
      onRangeChange={onRangeChange}
      footnote={depthFootnote(loading, full !== null, reachable)}
    />
  );
}

function AaiiPanel({ model }: MarketStructureSlotProps) {
  const summary = useMemo(() => aaiiChartSeries(model), [model]);
  const [full, setFull] = useState<MarketChartSeries[] | null>(null);
  const [loading, setLoading] = useState(false);

  const onRangeChange = useCallback(
    (rangeId: string) => {
      const aaii = model.aaii;
      if (rangeId !== "MAX" || full || loading || !aaii) return;
      setLoading(true);
      (aaii.loadFull?.() ?? Promise.resolve([]))
        .then((raw) => setFull([rawChartSeries("aaii_spread", "AAII Bull-Bear", raw)]))
        .finally(() => setLoading(false));
    },
    [model, full, loading],
  );

  const reachable = model.aaii?.meta.reachable_count ?? 0;
  return (
    <MarketChartFrame
      bare
      ariaLabel="AAII Bull-Bear 스프레드 추이"
      series={full ?? summary}
      type="line"
      sortLabels
      formatValue={pct1}
      onRangeChange={onRangeChange}
      footnote={depthFootnote(loading, full !== null, reachable)}
    />
  );
}

function ConcentrationPanel({ model }: MarketStructureSlotProps) {
  const series = useMemo<MarketChartSeries[]>(() => {
    const items = model.concentration;
    const labelOf = (item: (typeof items)[number]) => item.label ?? item.id ?? "—";
    return [
      {
        id: "top3",
        label: "Top3 비중",
        points: items.map((item) => ({ label: labelOf(item), value: numberOrNull(item.top3Weight) })),
      },
      {
        id: "top10",
        label: "Top10 비중",
        points: items.map((item) => ({ label: labelOf(item), value: numberOrNull(item.top10Weight) })),
      },
    ];
  }, [model]);

  return (
    <MarketChartFrame
      bare
      ariaLabel="지수 집중도 (Top3 · Top10 비중)"
      series={series}
      type="bar"
      ranges={[]}
      formatValue={(value) => (value === null ? "—" : `${value.toFixed(1)}%`)}
      footnote="SlickCharts 보유 비중 기준"
    />
  );
}

/** Wire into the route: MarketStructureDetailClient slots={marketStructureDetailSlots}. */
// ── Comprehensive-detail panels (structure IA expansion) ──────────────────
// These make the detail route the full superset: benchmark matrix, credit,
// Mag7 leadership, index membership changes. Inline market page stays A-lite.

const BENCH_PERIODS = [
  { id: "1w", label: "1W" },
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "6m", label: "6M" },
  { id: "ytd", label: "YTD" },
] as const;

const BENCH_METRICS = [
  { key: "price", label: "가격" },
  { key: "eps", label: "EPS" },
  { key: "pe", label: "P/E" },
  { key: "pb", label: "P/B" },
  { key: "roe", label: "ROE" },
] as const;

const CREDIT_LABELS: Record<string, string> = {
  large_manufacturing: "대형 제조",
  small_risky: "소형 위험",
  financial: "금융",
};

/** Fraction (e.g. -0.0852) -> signed colored percent. */
function fracPct(value: number | null): { text: string; cls: string } {
  if (value === null) return { text: "—", cls: "text-slate-300" };
  const pct = value * 100;
  const cls = pct > 0 ? "text-emerald-600" : pct < 0 ? "text-rose-600" : "text-slate-500";
  return { text: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, cls };
}

/** Already-percent value (e.g. -6.2) -> signed colored percent. */
function signedPct(value: number | null): { text: string; cls: string } {
  if (value === null) return { text: "—", cls: "text-slate-300" };
  const cls = value > 0 ? "text-emerald-600" : value < 0 ? "text-rose-600" : "text-slate-500";
  return { text: `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`, cls };
}

function BenchmarkMatrixPanel({ model }: MarketStructureSlotProps) {
  const [period, setPeriod] = useState<string>("ytd");
  const rows = model.benchmarkMatrix.rows;
  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="기간 선택">
        {BENCH_PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPeriod(p.id)}
            aria-pressed={p.id === period}
            className={
              p.id === period
                ? "rounded-md bg-slate-800 px-2 py-1 text-[11px] font-bold text-white"
                : "rounded-md bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-200"
            }
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[390px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-400">
              <th className="py-2 pr-2 text-left">지수</th>
              {BENCH_METRICS.map((m) => (
                <th key={m.key} className="px-2 py-2 text-right">{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100">
                <td className="py-2 pr-2 text-left font-bold text-slate-700">{row.label}</td>
                {BENCH_METRICS.map((m) => {
                  const cell = fracPct(numberOrNull(row[m.key]?.[period]));
                  return (
                    <td key={m.key} className={`px-2 py-2 text-right font-bold tabular-nums ${cell.cls}`}>
                      {cell.text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] font-semibold text-slate-400">
        기간별 변화율 · 가격 = EPS × 멀티플 분해 (멀티플 확장/축소 vs 이익)
      </p>
    </div>
  );
}

function CreditRatingsPanel({ model }: MarketStructureSlotProps) {
  const tables = model.creditRatings.tables;
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full min-w-[360px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-400">
            <th className="py-2 pr-2 text-left">구간</th>
            <th className="px-2 py-2 text-right">종목</th>
            <th className="px-2 py-2 text-right">최고</th>
            <th className="px-2 py-2 text-right">최저</th>
            <th className="px-2 py-2 text-right">중앙 스프레드</th>
          </tr>
        </thead>
        <tbody>
          {tables.map((t) => (
            <tr key={t.id} className="border-b border-slate-100">
              <td className="py-2 pr-2 text-left font-bold text-slate-700">{CREDIT_LABELS[t.id] ?? t.id}</td>
              <td className="px-2 py-2 text-right tabular-nums text-slate-600">{t.rows ?? "—"}</td>
              <td className="px-2 py-2 text-right font-bold text-emerald-600">{t.bestRating ?? "—"}</td>
              <td className="px-2 py-2 text-right font-bold text-rose-600">{t.worstRating ?? "—"}</td>
              <td className="px-2 py-2 text-right font-bold tabular-nums text-slate-700">
                {t.medianSpread === null ? "—" : `${(t.medianSpread * 100).toFixed(2)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] font-semibold text-slate-400">
        {model.creditRatings.sourceDate ? `Damodaran 신용 스프레드 · ${model.creditRatings.sourceDate}` : "Damodaran 신용 스프레드"}
      </p>
    </div>
  );
}

function Mag7Panel({ model }: MarketStructureSlotProps) {
  const mag7 = model.magnificent7;
  const series = useMemo<MarketChartSeries[]>(
    () => [
      {
        id: "mag7_weight",
        label: "비중 %",
        points: mag7.holdings.map((h) => ({ label: h.symbol ?? "—", value: numberOrNull(h.weight) })),
      },
    ],
    [mag7],
  );
  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap gap-3 text-[11px] font-semibold text-slate-500">
        <span>총 비중 <b className="text-slate-800">{mag7.totalWeight === null ? "—" : `${mag7.totalWeight.toFixed(1)}%`}</b></span>
        {mag7.totalMarketCap !== null ? (
          <span>총 시총 <b className="text-slate-800">{new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(mag7.totalMarketCap)}</b></span>
        ) : null}
      </div>
      <MarketChartFrame
        bare
        ariaLabel="Magnificent 7 비중"
        series={series}
        type="bar"
        ranges={[]}
        togglableSeries={false}
        formatValue={(v) => (v === null ? "—" : `${v.toFixed(1)}%`)}
      />
      <div className="mt-3 min-w-0 overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-[12px]">
          <tbody>
            {mag7.holdings.map((h) => {
              const chg = signedPct(numberOrNull(h.changePercent));
              return (
                <tr key={h.symbol ?? String(h.rank ?? "")} className="border-b border-slate-100">
                  <td className="py-1.5 pr-2 text-left font-bold text-slate-700">{h.rank ?? "—"} {h.symbol ?? "—"}</td>
                  <td className="px-2 py-1.5 text-left text-slate-500">{h.company ?? ""}</td>
                  <td className="px-2 py-1.5 text-right font-bold tabular-nums text-slate-800">{h.weight === null ? "—" : `${h.weight.toFixed(1)}%`}</td>
                  <td className={`px-2 py-1.5 text-right font-bold tabular-nums ${chg.cls}`}>{chg.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MembershipPanel({ model }: MarketStructureSlotProps) {
  const recent = model.membershipChanges.recent;
  if (recent.length === 0) {
    return (
      <div className="grid min-h-32 place-items-center text-xs font-bold text-slate-400">
        편입/편출 데이터 없음
      </div>
    );
  }
  return (
    <div className="min-w-0 space-y-2">
      {recent.slice(0, 6).map((ev, index) => (
        <div key={`${ev.date}-${ev.index}-${index}`} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{(ev.index ?? "—").toUpperCase()}</span>
            <span className="text-[10px] font-bold text-slate-400">{ev.date ?? "—"} · {ev.previousCount ?? "—"}→{ev.currentCount ?? "—"}</span>
          </div>
          <p className="mt-1 min-w-0 break-words text-[11px] font-semibold leading-5">
            <span className="text-emerald-600">＋{ev.added.length}</span> {ev.added.slice(0, 8).join(" · ")}{ev.added.length > 8 ? " …" : ""}
          </p>
          <p className="mt-1 min-w-0 break-words text-[11px] font-semibold leading-5">
            <span className="text-rose-600">－{ev.removed.length}</span> {ev.removed.slice(0, 8).join(" · ")}{ev.removed.length > 8 ? " …" : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

export const marketStructureDetailSlots: MarketStructureDetailSlots = {
  benchmark: (props) => <BenchmarkMatrixPanel {...props} />,
  credit: (props) => <CreditRatingsPanel {...props} />,
  mag7: (props) => <Mag7Panel {...props} />,
  membership: (props) => <MembershipPanel {...props} />,
  liquidity: (props) => <LiquidityPanel {...props} />,
  sentiment: (props) => <SentimentPanel {...props} />,
  aaii: (props) => <AaiiPanel {...props} />,
  concentration: (props) => <ConcentrationPanel {...props} />,
};

/**
 * Pre-wired client component. The server page renders this so the slot functions
 * never cross the server -> client boundary (Next forbids passing functions to a
 * Client Component from a Server Component). page.tsx: render <MarketStructureDetailWired />.
 */
export function MarketStructureDetailWired() {
  return <MarketStructureDetailClient slots={marketStructureDetailSlots} />;
}
