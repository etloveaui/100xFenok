"use client";

import { useMemo, useState } from "react";
import { MarketChartFrame } from "@/lib/market-valuation/charts/MarketChartFrame";
import type { MarketChartSeries } from "@/lib/market-valuation/charts/types";
import RadarDetailShell, { DetailMetric } from "./RadarDetailShell";
import { useRadarData } from "./useRadarData";
import { chartSeries, completeWeeks, DETAIL_RANGES, displayNumber as fmt, valueAt, weekStart, yearOverYear } from "./detail-series";
import type { SeriesPoint } from "./signals-core";

type FlowRow = { date: string; walcl: number; tga: number; rrp: number; net: number };
export function buildFlowTimeline(history: Record<string, SeriesPoint[]>): FlowRow[] {
  return (history.tga ?? []).flatMap((point) => {
    const walcl = valueAt(history.WALCL ?? [], point.date);
    const rrp = valueAt(history.RRPONTSYD ?? [], point.date);
    if (walcl === null || rrp === null) return [];
    return [{ date: point.date, walcl: walcl / 1000, tga: point.val / 1000, rrp, net: walcl / 1000 - point.val / 1000 - rrp }];
  });
}

export default function LiquidityFlowDetail() {
  const { flow, history, retry } = useRadarData();
  const [tab, setTab] = useState<"pulse" | "credit" | "crypto">("pulse");
  const [range, setRange] = useState("6M");
  const timeline = useMemo(() => buildFlowTimeline(history), [history]);
  const weekly = useMemo(() => completeWeeks(timeline), [timeline]);
  const dailyMode = range === "1M" || range === "3M";
  const rows = dailyMode ? timeline : weekly;
  const changes = rows.slice(1).map((row, index) => ({ date: row.date, net: row.net - rows[index].net,
    walcl: row.walcl - rows[index].walcl, tga: rows[index].tga - row.tga, rrp: rows[index].rrp - row.rrp }));
  const last = weekly.at(-1), previous = weekly.at(-2);
  const wow = last && previous ? last.net - previous.net : null;
  const m2 = history.M2SL ?? [], stable = history.stablecoins ?? [];
  const m2YoY = yearOverYear(m2);
  const stableRatio = stable.flatMap((row) => {
    const money = valueAt(m2, row.date);
    return money === null || money === 0 ? [] : [{ date: row.date, val: (row.val / 1e9) / money * 100 }];
  });
  let series: MarketChartSeries[];
  if (tab === "pulse") {
    series = ([ ["walcl", "Fed BS Δ"], ["tga", "−TGA Δ"], ["rrp", "−RRP Δ"], ["net", "Net Liquidity Δ"] ] as const)
      .map(([key, label], index) => ({ id: key, label: `${label} ($B)`, chartType: key === "net" ? "line" : "bar", paletteIndex: index,
        points: changes.map((row) => ({ label: row.date, value: row[key] })) }));
  } else if (tab === "credit") {
    series = [chartSeries("m2-yoy", "M2 YoY (%)", m2YoY), chartSeries("m2-total", "M2 총량 ($T)", m2, "y1", .001)];
  } else {
    series = [chartSeries("stablecoin", "스테이블코인 공급 ($B)", stable, "y", 1e-9), chartSeries("sc-m2", "SC/M2 (%)", stableRatio, "y1")];
  }
  const latestM2 = m2.at(-1), latestStable = stable.at(-1);
  return <RadarDetailShell title="유동성 흐름" legacyPath="tools/macro-monitor/details/liquidity-flow.html" state={flow.state} retry={retry}>
    <dl className="grid gap-3 sm:grid-cols-3">
      <DetailMetric label="M2 YoY" value={`${fmt(m2YoY.at(-1)?.val)}%`} detail={`총량 $${fmt(latestM2 ? latestM2.val / 1000 : null)}T · ${latestM2?.date ?? "관측 없음"}`} />
      <DetailMetric label="순유동성 주간 변화" value={`${fmt(wow, 1)}B USD`} detail={`완결 주 ${last ? weekStart(last.date) : "—"} · 순유동성 $${fmt(last ? last.net / 1000 : null)}T`} />
      <DetailMetric label="스테이블코인 / M2" value={`${fmt(stableRatio.at(-1)?.val)}%`} detail={`공급 $${fmt(latestStable ? latestStable.val / 1e9 : null, 1)}B · ${latestStable?.date ?? "관측 없음"}`} />
    </dl>
    <p className="text-sm font-bold">종합 {flow.snapshot ? ({ rising: "상승", stable: "안정", falling: "하락" }[flow.snapshot.status]) : "미확인"} · {wow === null ? "완결 주 자료가 부족합니다." : wow > 50 ? "주간 유동성 상승" : wow < -50 ? "주간 유동성 하락" : "주간 유동성 횡보"}</p>
    <div className="flex flex-wrap gap-2" role="group" aria-label="유동성 차트 선택">
      {([ ["pulse", "유동성 변화"], ["credit", "M2 신용 흐름"], ["crypto", "크립토 연결"] ] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} className="rounded border px-3 py-2 aria-pressed:bg-blue-50">{label}</button>)}
    </div>
    <MarketChartFrame key={tab} ariaLabel={`유동성 상세 ${tab}`} series={series} ranges={DETAIL_RANGES} rangeId={range} onRangeChange={setRange}
      defaultRangeId="6M" sortLabels xScaleMode="time" spanGaps={false} yAxisTitle={tab === "credit" ? "M2 YoY (%)" : "$B"}
      y1AxisTitle={tab === "credit" ? "M2 총량 ($T)" : tab === "crypto" ? "SC/M2 (%)" : undefined}
      footnote={tab === "pulse" ? `${dailyMode ? "일간 변화" : "완결 주 변화"} · Net = ΔFed BS − ΔTGA − ΔRRP · 단위 $B` : tab === "credit" ? "FRED M2 · 동일 월 전년 대비 · 월간 관측" : "스테이블코인 일간 공급 / 해당 시점까지 발표된 M2"} />
    <section className="rounded-xl border bg-white p-4">
      <h2 className="font-bold">완결 주 구성요소</h2>
      <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([ ["walcl", "Fed BS Δ", 1], ["tga", "−TGA Δ", -1], ["rrp", "−RRP Δ", -1], ["net", "순유동성 Δ", 1] ] as const).map(([key, label, sign]) => <div key={key}><dt className="text-sm text-slate-500">{label}</dt><dd className="font-bold">{fmt(last && previous ? sign * (last[key] - previous[key]) : null, 1)}B USD</dd></div>)}
      </dl>
      <p className="mt-2 text-xs text-slate-500">관측 {previous?.date ?? "—"} → {last?.date ?? "—"} · 현재 진행 중인 주는 주간 변화에서 제외</p>
    </section>
    <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-bold">관측값과 계산 근거</summary>
      <p className="my-2 text-sm">순유동성 = WALCL/1000 − TGA/1000 − RRP. $B 단위로 맞춥니다. 월간·주간 자료는 해당 날짜 이전의 마지막 관측값을 사용합니다. 관측 전 기간을 현재 값으로 채우지 않습니다.</p>
      <p className="my-2 text-sm">해석 기준: 순유동성 주간 ±$50B, M2 YoY 2% / 6%, SC/M2 1.0% / 1.5%. 유동성 증가·감소는 위험자산의 자금 환경을 보여 줍니다.</p>
      <div className="max-h-96 overflow-auto"><table className="w-full text-right text-xs"><caption>일간 잔액 · 단위 $B</caption><thead><tr><th>관측일</th><th>Fed BS</th><th>TGA</th><th>RRP</th><th>순유동성</th></tr></thead><tbody>{timeline.slice().reverse().map((row) => <tr key={row.date}><th>{row.date}</th><td>{fmt(row.walcl)}</td><td>{fmt(row.tga)}</td><td>{fmt(row.rrp)}</td><td>{fmt(row.net)}</td></tr>)}</tbody></table></div>
      <p className="mt-3 text-xs"><a href="https://fred.stlouisfed.org/series/M2SL">FRED M2</a> · <a href="https://fred.stlouisfed.org/series/WALCL">Fed 총자산</a> · <a href="https://fiscaldata.treasury.gov/">미 재무부 TGA</a> · <a href="https://fred.stlouisfed.org/series/RRPONTSYD">RRP</a></p>
    </details>
  </RadarDetailShell>;
}
