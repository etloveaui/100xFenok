"use client";

import { useEffect, useState } from "react";
import { EmptyState, EvidenceRail, Panel, PanelHeader, Stat } from "@/components/ui";
import { fetchJsonOrNull } from "@/lib/client/data-fetch";

type Industry = {
  num_firms?: number;
  beta?: Record<string, number | null>;
  margins?: Record<string, number | null>;
  cost_of_capital?: Record<string, number | null>;
  pe_multiples?: Record<string, number | null>;
  book_value_returns?: Record<string, number | null>;
  ev_multiples?: Record<string, number | null>;
};
type IndustryFile = { metadata?: { source_date?: string }; industries: Record<string, Industry> };
type RegionalFile = { metadata?: IndustryFile["metadata"]; regions: Record<string, { industries: Record<string, Industry> }> };
type Loaded = { region: string; base: IndustryFile | null; metrics: IndustryFile | null };
const REGIONS = [
  ["us", "미국"], ["global", "세계"], ["europe", "유럽"], ["japan", "일본"],
  ["rest", "호주·뉴질랜드·캐나다"], ["emerging", "신흥시장"], ["china", "중국"], ["india", "인도"],
] as const;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const number = (value: unknown) => finite(value) ? value.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : "—";
const percent = (value: unknown) => finite(value) ? `${(value * 100).toFixed(2)}%` : "—";
const multiple = (value: unknown) => finite(value) ? `${value.toFixed(2)}배` : "—";
const validFile = (data: IndustryFile | null) => data && data.industries && typeof data.industries === "object" && !Array.isArray(data.industries) ? data : null;

export default function IndustryMetricsPanel() {
  const [region, setRegion] = useState("us");
  const [industry, setIndustry] = useState("Semiconductor");
  const [state, setState] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState(null);
    async function load() {
      if (region === "us") {
        const [base, metrics] = await Promise.all([
          fetchJsonOrNull<IndustryFile>("/data/damodaran/industries.json"),
          fetchJsonOrNull<IndustryFile>("/data/damodaran/industry_metrics.json"),
        ]);
        if (!cancelled) setState({ region, base: validFile(base), metrics: validFile(metrics) });
      } else {
        const data = await fetchJsonOrNull<RegionalFile>("/data/damodaran/industry_metrics_regions.json");
        const rows = data?.regions?.[region]?.industries;
        const file = rows ? validFile({ metadata: data?.metadata, industries: rows }) : null;
        if (!cancelled) setState({ region, base: file, metrics: file });
      }
    }
    void load().catch(() => { if (!cancelled) setState({ region, base: null, metrics: null }); });
    return () => { cancelled = true; };
  }, [region, attempt]);
  const current = state?.region === region ? state : null;
  const names = Array.from(new Set([...Object.keys(current?.base?.industries ?? {}), ...Object.keys(current?.metrics?.industries ?? {})])).sort();
  const selected = names.includes(industry) ? industry : names[0] ?? "";
  const base = current?.base?.industries[selected];
  const metrics = current?.metrics?.industries[selected];
  const hasData = names.length > 0;
  const sourceDate = current?.base?.metadata?.source_date;
  const metricsDate = current?.metrics?.metadata?.source_date;
  return <Panel>
    <div data-sectors-industry-metrics>
      <PanelHeader eyebrow="Damodaran · 연간" title="지역·업종별 가치평가 지표" />
      <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">지역
          <select className="w-full min-w-0 rounded border p-2" value={region} onChange={(event) => setRegion(event.target.value)}>
            {REGIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">업종 (원문 분류)
          <select className="w-full min-w-0 rounded border p-2" value={selected} disabled={!hasData} onChange={(event) => setIndustry(event.target.value)}>
            {!hasData && <option value="">자료 대기</option>}
            {names.map((name) => <option key={name} value={name}>{name === "Semiconductor" ? "반도체 · Semiconductor" : name}</option>)}
          </select>
        </label>
      </div>
      {!current ? <p className="p-4 text-sm" role="status">업종 자료를 불러오는 중입니다.</p>
        : !hasData ? <EmptyState reason="선택한 지역의 업종 자료를 불러오지 못했습니다." actionLabel="다시 불러오기" onAction={() => setAttempt((value) => value + 1)} />
        : <>
          <div className="grid grid-cols-2 lg:grid-cols-4">
            <Stat label="기업 수" value={number(base?.num_firms ?? metrics?.num_firms)} />
            <Stat label="레버리지 베타" value={number(base?.beta?.levered)} />
            <Stat label="순이익률" value={percent(base?.margins?.net)} />
            <Stat label="총이익률" value={percent(base?.margins?.gross)} />
            <Stat label="가중평균 자본비용" value={percent(metrics?.cost_of_capital?.cost_of_capital)} />
            <Stat label="선행 PER" value={multiple(metrics?.pe_multiples?.forward_pe)} />
            <Stat label="PBR" value={multiple(metrics?.book_value_returns?.price_to_book)} />
            <Stat label="EV/EBITDA (양수 기업)" value={multiple(metrics?.ev_multiples?.positive_ev_to_ebitda)} />
          </div>
          <p className="px-4 py-2 text-xs text-slate-500">연간 업종 집계입니다. 지역별 구성 기업이 다르며, —는 해당 지표가 없음을 뜻합니다.</p>
          <EvidenceRail freshness={current.base && current.metrics ? "fixed" : "partial"} stateLabel={current.base && current.metrics ? "연간 자료" : "부분 자료"}
            source={`Damodaran · ${REGIONS.find(([key]) => key === region)?.[1] ?? region}`} asOf={sourceDate ?? metricsDate ?? "—"}
            coverage={`연간 · ${names.length}개 업종${sourceDate && metricsDate && sourceDate !== metricsDate ? ` · 가치평가 기준 ${metricsDate}` : ""}`}
            onRetry={!current.base || !current.metrics ? () => setAttempt((value) => value + 1) : undefined} />
        </>}
    </div>
  </Panel>;
}
