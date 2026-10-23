"use client";

import { useId, useMemo, useState } from "react";
import type { ScreenerStock } from "@/lib/screener/types";
import ScreenerAnalysisCharts from "./ScreenerAnalysisCharts";
import {
  COMPARISON_METRICS, comparisonCsv, comparisonEntities, comparisonScore, finite, screenerAnalysisCsv,
  type AnalysisDates, type ComparisonMode,
} from "./screener-analysis";

function downloadCsv(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function display(value: unknown, percent = false): string {
  if (!finite(value)) return "—";
  return (value * (percent ? 100 : 1)).toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + (percent ? "%" : "");
}

export type ScreenerAnalysisToolsProps = AnalysisDates & {
  stocks: readonly ScreenerStock[];
  selectedStocks?: readonly ScreenerStock[];
};

/** Receives the complete filtered/sorted set, never the paginated table slice. */
export default function ScreenerAnalysisTools({ stocks, selectedStocks = [], sourceDate, marketFactsDate }: ScreenerAnalysisToolsProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ComparisonMode>("stocks");
  const [selection, setSelection] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [candidate, setCandidate] = useState("");
  const candidates = useMemo(() => open ? comparisonEntities(stocks, mode) : [], [open, stocks, mode]);
  const entities = useMemo(() => {
    const lookup = new Map(candidates.map((entity) => [entity.id, entity]));
    return selection.flatMap((key) => { const entity = lookup.get(key); return entity ? [entity] : []; });
  }, [candidates, selection]);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return candidates.filter((entity) => !selection.includes(entity.id) && entity.name.toLocaleLowerCase().includes(needle));
  }, [candidates, selection, query]);
  const dates = { sourceDate, marketFactsDate };
  const button = "min-h-11 rounded-md border border-[var(--c-line)] px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50";

  return <section className="rounded-xl border border-[var(--c-line)] bg-[var(--c-panel)] p-4" data-screener-analysis-tools="true">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-bold">분석 CSV · 종목 비교</h2><p className="mt-1 text-xs text-[var(--c-ink-2)]">프로필 기준 {sourceDate ?? "미제공"} · 재무 기준 {marketFactsDate ?? "미제공"}</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={!stocks.length} onClick={() => downloadCsv(screenerAnalysisCsv(stocks, dates), `100xfenok-analysis-filtered-${sourceDate ?? "undated"}.csv`)}>필터 분석 CSV ({stocks.length.toLocaleString("ko-KR")})</button>
        <button type="button" className={button} disabled={!selectedStocks.length} onClick={() => downloadCsv(screenerAnalysisCsv(selectedStocks, dates), `100xfenok-analysis-selected-${sourceDate ?? "undated"}.csv`)}>선택 분석 CSV ({selectedStocks.length.toLocaleString("ko-KR")})</button>
      </div>
    </div>
    <p className="mt-2 text-xs text-[var(--c-ink-2)]">CSV에 성장률·순위·EPS·밸류에이션·배당·모멘텀·FY1–3 전망과 자료 기준일을 포함합니다. 미제공 값은 빈칸입니다.</p>
    <details className="mt-4" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="min-h-11 cursor-pointer py-2 font-bold">종목 · 섹터 · 국가 비교 (최대 4개)</summary>
      {open ? <div className="mt-3 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm" htmlFor={`${id}-mode`}>비교 단위<select id={`${id}-mode`} aria-label="비교 단위" value={mode} className="mt-1 block min-h-11 rounded-md border border-[var(--c-line)] bg-[var(--c-panel)] px-3" onChange={(event) => { setMode(event.target.value as ComparisonMode); setSelection([]); setCandidate(""); setQuery(""); }}>
            <option value="stocks">종목</option><option value="sectors">섹터</option><option value="countries">국가</option>
          </select></label>
          <label className="text-sm" htmlFor={`${id}-search`}>대상 검색<input id={`${id}-search`} type="search" value={query} onChange={(event) => { setQuery(event.target.value); setCandidate(""); }} className="mt-1 block min-h-11 rounded-md border border-[var(--c-line)] bg-[var(--c-panel)] px-3" placeholder="티커 · 이름 · 그룹" /></label>
          <label className="min-w-0 max-w-full text-sm" htmlFor={`${id}-candidate`}>검색 결과<select id={`${id}-candidate`} aria-label="검색 결과" value={candidate} onChange={(event) => setCandidate(event.target.value)} className="mt-1 block min-h-11 w-full max-w-sm rounded-md border border-[var(--c-line)] bg-[var(--c-panel)] px-3" disabled={entities.length >= 4}>
            <option value="">{matches.length ? `${matches.length.toLocaleString("ko-KR")}개 중 선택` : "대상 없음"}</option>
            {matches.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
          </select></label>
          <button type="button" className={button} disabled={!candidate || entities.length >= 4} onClick={() => {
            const available = new Set(candidates.map((entity) => entity.id));
            setSelection((current) => {
              const visible = current.filter((key) => available.has(key));
              return visible.length >= 4 || visible.includes(candidate) ? visible : [...visible, candidate];
            });
            setCandidate("");
          }}>비교 추가</button>
          <button type="button" className={button} disabled={mode !== "stocks" || !selectedStocks.length || selectedStocks.length > 4} onClick={() => { setMode("stocks"); setSelection(selectedStocks.map((stock) => stock.ticker)); }}>선택 종목으로 비교</button>
          <button type="button" className={button} disabled={!entities.length} onClick={() => downloadCsv(comparisonCsv(entities, sourceDate), `100xfenok-comparison-${sourceDate ?? "undated"}.csv`)}>비교 CSV</button>
        </div>
        <div className="flex flex-wrap gap-2">{entities.map((entity) => <button type="button" key={entity.id} className={button} onClick={() => setSelection((current) => current.filter((key) => key !== entity.id))} aria-label={`${entity.name} 비교에서 제거`}>{entity.name} ×</button>)}</div>
        {mode !== "stocks" ? <p className="text-xs text-[var(--c-ink-2)]">현재 필터 결과의 단순 평균입니다. 미제공 값은 평균에서 제외하며 표에 제공 종목 수를 표시합니다. 서로 다른 통화의 EPS는 그룹 평균을 내지 않습니다.</p> : null}
        {!entities.length ? <p className="py-6 text-sm text-[var(--c-ink-2)]">현재 필터의 대상을 최대 4개 추가하세요. 선택한 종목이 4개 이하면 한 번에 비교할 수 있습니다.</p> : <>
          <ScreenerAnalysisCharts entities={entities} sourceDate={sourceDate} />
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="원래 지표 값 비교표">
            <table className="w-full min-w-[560px] text-sm"><thead><tr className="border-b border-[var(--c-line)]"><th className="p-3 text-left">지표</th>{entities.map((entity) => <th key={entity.id} className="p-3 text-right">{entity.id}<span className="block text-xs font-normal">{entity.count}개 종목</span></th>)}</tr></thead>
              <tbody>
                {COMPARISON_METRICS.map((metric) => <tr key={metric.key} className="border-b border-[var(--c-line)]"><th className="p-3 text-left font-medium">{metric.label}</th>{entities.map((entity) => <td key={entity.id} className="p-3 text-right tabular-nums">{display(entity.values[metric.key], metric.percent)}<span className="block text-xs text-[var(--c-ink-2)]">{entity.coverage[metric.key] ?? 0}/{entity.count} 제공</span></td>)}</tr>)}
                {([['eps', 'EPS (원통화)'], ['rank', '순위'], ['marketCap', '시총 (USD 백만)']] as const).map(([key, label]) => <tr key={key} className="border-b border-[var(--c-line)]"><th className="p-3 text-left font-medium">{label}</th>{entities.map((entity) => <td key={entity.id} className="p-3 text-right tabular-nums">{display(entity.values[key])}</td>)}</tr>)}
                <tr><th className="p-3 text-left font-medium">비교 점수 (0–5)</th>{entities.map((entity) => <td key={entity.id} className="p-3 text-right tabular-nums">{display(comparisonScore(entity))}</td>)}</tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--c-ink-2)]">비교 점수는 ROE 25%, 성장률·12개월 모멘텀·PER 각 20%, 배당 15%입니다. 고정 범위로 정규화한 탐색용 점수이며 5개 지표가 모두 있을 때만 계산합니다. 레이더 범위: ROE −20~50%, 성장률 −50~40%, 모멘텀 −60~100%, PER 0~80, 배당 0~10%. 표에는 범위 밖 원래 값도 그대로 표시합니다.</p>
        </>}
      </div> : null}
    </details>
  </section>;
}
