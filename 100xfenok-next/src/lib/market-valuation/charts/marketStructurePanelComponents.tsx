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
export const marketStructureDetailSlots: MarketStructureDetailSlots = {
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
