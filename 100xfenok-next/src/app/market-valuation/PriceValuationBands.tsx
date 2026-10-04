"use client";

import { useMemo, useState } from "react";
import type { UseBenchmarkOrdinalsResult } from "@/hooks/useBenchmarkOrdinals";
import {
  BENCHMARK_ORDINAL_GROUPS,
  priceValuationBand,
  type BenchmarkGroupId,
  type BenchmarkOrdinalRow,
  type PriceBandRefusal,
} from "@/lib/market-valuation/benchmarkOrdinals";
import { MarketChartFrame } from "@/lib/market-valuation/charts/MarketChartFrame";
import type { MarketChartSeries } from "@/lib/market-valuation/charts/types";
import { EmptyState, EvidenceRail, Panel, PanelHeader } from "@/components/ui";
import { freshnessVerdict, freshnessRailState } from "@/lib/freshness-policy.mjs";

const STANDARD_YEARS = [3, 5, 10] as const;
const LEVELS = ["p25", "p50", "p75"] as const;
const COLORS = [
  ["#93c5fd", "#2563eb", "#1e3a8a"],
  ["#86efac", "#16a34a", "#166534"],
  ["#fcd34d", "#d97706", "#92400e"],
  ["#d8b4fe", "#9333ea", "#6b21a8"],
] as const;

const REFUSAL_LABEL: Record<PriceBandRefusal, string> = {
  missing_eps: "기준일의 양수 예상 EPS가 없어 밴드를 표시하지 않습니다.",
  missing_current_price: "기준일 가격이 없어 밴드를 표시하지 않습니다.",
  missing_pe_history: "양수 예상 PER 이력이 없어 밴드를 표시하지 않습니다.",
  truncated: "요청한 기간을 채우지 못해 밴드를 표시하지 않습니다.",
  insufficient_history: "유효한 예상 PER 관측치가 52개 미만이라 밴드를 표시하지 않습니다.",
  invalid_level: "환산 가격을 계산할 수 없어 밴드를 표시하지 않습니다.",
};

const fmt = (value: number) => new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);

export default function PriceValuationBands({ board }: { board: UseBenchmarkOrdinalsResult }) {
  const [selectedKey, setSelectedKey] = useState("us:sp500");
  const [years, setYears] = useState<number[]>([5]);
  const [customText, setCustomText] = useState("");
  const groups = board.view?.status === "ready" ? board.view.groups.filter((group) => group.rows.length > 0) : [];
  const indices = groups.flatMap((group) => group.rows);
  const selected = indices.find((row) => `${row.groupId}:${row.id}` === selectedKey) ?? indices[0];
  const currentGroup = selected?.groupId ?? "us";
  const groupRows = groups.find((group) => group.id === currentGroup)?.rows ?? [];
  const activeKey = selected ? `${selected.groupId}:${selected.id}` : "";
  const bands = useMemo(() => selected ? years.map((year) => priceValuationBand(selected, year)) : [], [selected, years]);
  const pricePoints = useMemo(() => selected?.priceHistory.map((point) => ({ label: point.date, value: point.value })) ?? [], [selected]);
  const series = useMemo<MarketChartSeries[]>(() => {
    if (!selected || pricePoints.length === 0) return [];
    const output: MarketChartSeries[] = [{ id: "price", label: "실제 가격", points: pricePoints, colorToken: "ink", lineRole: "primary" }];
    bands.forEach((band, periodIndex) => {
      if (band.refusal !== null) return;
      LEVELS.forEach((level, levelIndex) => {
        const value = band[level];
        if (value === null) return;
        output.push({
          id: `${band.years}y-${level}`,
          label: `${band.years}년 ${level.toUpperCase()} · ${fmt(value)}`,
          points: pricePoints.map((point) => ({ label: point.label, value })),
          color: COLORS[periodIndex][levelIndex],
          lineRole: "secondary",
        });
      });
    });
    return output;
  }, [selected, pricePoints, bands]);
  const largestYears = Math.max(5, ...years);
  const displayRanges = [
    { id: "1Y", label: "1년", months: 12 },
    { id: `${largestYears}Y`, label: `${largestYears}년`, months: largestYears * 12 },
    { id: "MAX", label: "전체" },
  ];
  const customNumber = Number(customText);
  const customValid = customText.trim() !== "" && Number.isInteger(customNumber) && customNumber >= 1 && customNumber <= 30;

  const chooseGroup = (id: BenchmarkGroupId) => {
    const first = groups.find((group) => group.id === id)?.rows[0];
    if (first) setSelectedKey(`${id}:${first.id}`);
  };
  const toggleYear = (year: number) => {
    if (years.includes(year)) setYears((prior) => prior.filter((value) => value !== year));
    else if (years.length < 4) setYears((prior) => [...prior, year].sort((a, b) => a - b));
  };
  const addCustom = () => {
    if (!customValid || years.includes(customNumber) || years.length >= 4) return;
    setYears((prior) => [...prior, customNumber].sort((a, b) => a - b));
    setCustomText("");
  };

  return (
    <section aria-label="지수 가격과 과거 예상 PER 구간">
      <Panel>
        <PanelHeader eyebrow="Historical Forward PER" title="지수 가격과 역사적 PER 구간" />
        {board.state === "pending" ? <EmptyState reason="가격 이력을 불러오는 중입니다." />
          : !selected ? <EmptyState reason="표시할 지수 가격 이력이 없습니다." actionLabel="다시 시도" onAction={board.refetch} />
            : (
              <div className="space-y-4 p-4">
                <div className="flex flex-wrap gap-3">
                  <label className="grid gap-1 text-xs font-semibold text-[var(--c-ink-2)]">
                    지수 그룹
                    <select value={currentGroup} onChange={(event) => chooseGroup(event.target.value as BenchmarkGroupId)} className="min-h-11 rounded-md border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-sm text-[var(--c-ink)]">
                      {BENCHMARK_ORDINAL_GROUPS.filter((group) => groups.some((item) => item.id === group.id)).map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
                    </select>
                  </label>
                  <label className="grid min-w-48 gap-1 text-xs font-semibold text-[var(--c-ink-2)]">
                    지수
                    <select value={activeKey} onChange={(event) => setSelectedKey(event.target.value)} className="min-h-11 rounded-md border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-sm text-[var(--c-ink)]">
                      {groupRows.map((row: BenchmarkOrdinalRow) => <option key={row.id} value={`${row.groupId}:${row.id}`}>{row.name}</option>)}
                    </select>
                  </label>
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-xs font-semibold text-[var(--c-ink-2)]">PER 이력 기간 · 최대 4개 동시 선택</legend>
                  <div className="flex flex-wrap items-center gap-3">
                    {STANDARD_YEARS.map((year) => <label key={year} className="inline-flex min-h-11 items-center gap-1.5 text-sm text-[var(--c-ink)]">
                      <input type="checkbox" checked={years.includes(year)} disabled={!years.includes(year) && years.length >= 4} onChange={() => toggleYear(year)} />{year}년
                    </label>)}
                    {years.filter((year) => !STANDARD_YEARS.some((standard) => standard === year)).map((year) => <button key={year} type="button" onClick={() => toggleYear(year)} aria-label={`${year}년 사용자 기간 제거`} className="min-h-11 rounded-md border border-[var(--c-line)] px-3 text-sm text-[var(--c-ink)]">{year}년 ×</button>)}
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="grid gap-1 text-xs font-semibold text-[var(--c-ink-2)]">사용자 기간 · 1~30년
                      <input type="number" min="1" max="30" step="1" value={customText} onChange={(event) => setCustomText(event.target.value)} className="min-h-11 w-28 rounded-md border border-[var(--c-line)] bg-[var(--c-panel)] px-3 text-sm text-[var(--c-ink)]" />
                    </label>
                    <button type="button" onClick={addCustom} disabled={!customValid || years.includes(customNumber) || years.length >= 4} className="min-h-11 rounded-md bg-[var(--c-brand)] px-3 text-sm font-semibold text-white disabled:opacity-50">추가</button>
                  </div>
                </fieldset>
                <p className="text-xs text-[var(--c-ink-2)]">현재 EPS 고정 · 역사 PER 분포 · 예측 아님. 가격과 세 밴드는 같은 가격축입니다.</p>
                <p className="text-xs text-[var(--c-ink-2)]">기준일 {selected.asOf ?? "—"} · 현재 예상 EPS {selected.currentForwardEps === null ? "없음" : fmt(selected.currentForwardEps)}</p>
                {pricePoints.length > 0 ? (
                  <MarketChartFrame key={`${activeKey}:${largestYears}`} title={selected.name} ariaLabel={`${selected.name} 실제 가격과 현재 EPS로 환산한 역사적 PER 구간`} series={series} ranges={displayRanges} defaultRangeId={`${largestYears}Y`} sortLabels yAxisTitle="지수 가격" formatValue={(value) => value === null ? "—" : fmt(value)} footnote="화면 기간은 차트만 바꾸며 PER 계산 기간은 위 선택값을 따릅니다." />
                ) : <EmptyState reason="유효한 가격 이력이 없어 차트를 표시할 수 없습니다." />}
                {years.length === 0 && <p className="text-xs text-[var(--c-ink-2)]">PER 기간을 선택하면 가격 기준선을 표시합니다.</p>}
                {bands.length > 0 && <ul className="grid gap-1 text-xs text-[var(--c-ink-2)]">
                  {bands.map((band) => <li key={band.years}>
                    <strong className="text-[var(--c-ink)]">{band.years}년</strong> · 실제 PER 이력 {band.spanYears === null ? "없음" : `${band.spanYears.toFixed(2)}년`} · 구간 표본 {band.points}개 · {band.refusal === null ? `가격 P25 ${fmt(band.p25!)} / P50 ${fmt(band.p50!)} / P75 ${fmt(band.p75!)}` : REFUSAL_LABEL[band.refusal]}
                  </li>)}
                </ul>}
                <EvidenceRail source="지수 예상 이익·PER 이력" asOf={selected.asOf ?? "—"}
                  freshness={freshnessRailState(freshnessVerdict(selected.asOf, "benchmarks"))?.freshness ?? "partial"}
                  coverage={`${selected.priceHistory.length}개 가격 관측치`} />
              </div>
            )}
      </Panel>
    </section>
  );
}
