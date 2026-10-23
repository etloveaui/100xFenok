"use client";

import { useEffect, useState } from "react";
import { EmptyState, EvidenceRail, Panel, PanelHeader, Stat } from "@/components/ui";
import { fetchJsonOrNull } from "@/lib/client/data-fetch";
import { MarketChartFrame } from "@/lib/market-valuation/charts/MarketChartFrame";
import type { MarketChartPoint } from "@/lib/market-valuation/charts/types";

export default function SoxPanel() {
  const [points, setPoints] = useState<MarketChartPoint[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    fetchJsonOrNull<{ date: string; value: number }[]>("/data/indices/sox.json").then((rows) => {
      if (cancelled) return;
      setPoints(Array.isArray(rows) ? rows.flatMap((row) =>
        /^\d{4}-\d{2}-\d{2}$/.test(row?.date) && Number.isFinite(Date.parse(row.date)) && typeof row.value === "number" && Number.isFinite(row.value)
          ? [{ label: row.date, value: row.value }] : []).sort((a, b) => a.label.localeCompare(b.label)) : []);
    }).catch(() => { if (!cancelled) setPoints([]); });
    return () => { cancelled = true; };
  }, [attempt]);
  const latest = points?.at(-1);
  return <Panel loading={points === null}>
    <div data-sectors-sox>
      <PanelHeader eyebrow="반도체 · 일간" title="필라델피아 반도체지수 (SOX)" />
      {points?.length ? <>
        <Stat label="SOX 지수" value={latest!.value!.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} sub={`일간 기준 ${latest!.label}`} />
        <MarketChartFrame title="SOX 일간 추이" ariaLabel="필라델피아 반도체지수 일간 이력"
          series={[{ id: "sox", label: "SOX", points, colorToken: "brand" }]}
          ranges={[{ id: "1M", label: "1개월", months: 1 }, { id: "3M", label: "3개월", months: 3 }, { id: "MAX", label: "전체" }]}
          defaultRangeId="MAX" yAxisTitle="지수 (포인트)" formatValue={(value) => value === null ? "—" : value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} sortLabels bare />
        <EvidenceRail freshness="fixed" stateLabel="일간 관측" source="필라델피아 반도체지수 · SOX" asOf={latest!.label} coverage={`일간 · ${points.length}개 관측일`} />
      </> : points ? <EmptyState reason="SOX 일간 자료를 불러오지 못했습니다." actionLabel="다시 불러오기" onAction={() => setAttempt((value) => value + 1)} /> : null}
    </div>
  </Panel>;
}
