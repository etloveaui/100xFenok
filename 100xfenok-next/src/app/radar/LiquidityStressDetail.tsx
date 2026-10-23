"use client";

import { useMemo, useState } from "react";
import { MarketChartFrame } from "@/lib/market-valuation/charts/MarketChartFrame";
import type { MarketChartSeries } from "@/lib/market-valuation/charts/types";
import RadarDetailShell, { DetailMetric } from "./RadarDetailShell";
import { useRadarData } from "./useRadarData";
import { DETAIL_RANGES, displayNumber as fmt, valueAt } from "./detail-series";
import type { SeriesPoint } from "./signals-core";

type StressRow = { date: string; sofr: number; iorb: number; spread: number; reserves: number | null };
export function buildStressTimeline(history: Record<string, SeriesPoint[]>): StressRow[] {
  const iorb = new Map((history.IORB ?? []).map((row) => [row.date, row.val]));
  return (history.SOFR ?? []).flatMap((row) => {
    const rate = iorb.get(row.date);
    if (rate === undefined) return [];
    const reserves = valueAt(history.WRESBAL ?? [], row.date);
    return [{ date: row.date, sofr: row.val, iorb: rate, spread: Math.round((row.val - rate) * 100), reserves: reserves === null ? null : reserves / 1e6 }];
  });
}

const STATUS = ["정상", "주의", "경계", "위험"];
export default function LiquidityStressDetail() {
  const { stress, history, retry } = useRadarData();
  const [metric, setMetric] = useState<"dual" | "spread" | "reserves">("dual");
  const rows = useMemo(() => buildStressTimeline(history), [history]);
  const latest = rows.at(-1), gdp = history.GDP?.at(-1);
  const ratio = latest?.reserves != null && gdp && gdp.val > 0 ? latest.reserves / (gdp.val / 1000) * 100 : null;
  const spreadScore = !latest ? null : latest.spread >= 30 ? 3 : latest.spread >= 20 ? 2 : latest.spread >= 10 ? 1 : 0;
  const ratioScore = ratio === null ? null : ratio < 8 ? 3 : ratio < 10 ? 2 : ratio < 12 ? 1 : 0;
  const overall = spreadScore === null || ratioScore === null ? "미확인" : STATUS[Math.round((spreadScore + ratioScore) / 2)];
  const series: MarketChartSeries[] = [];
  if (metric !== "reserves") series.push({ id: "spread", label: "SOFR − IORB (bp)", points: rows.map((row) => ({ label: row.date, value: row.spread })) });
  if (metric !== "spread") {
    const axis = metric === "dual" ? "y1" : "y";
    series.push({ id: "reserves", label: "은행 지급준비금 ($T)", yAxisId: axis, paletteIndex: 1, points: rows.map((row) => ({ label: row.date, value: row.reserves })) });
    if (gdp) for (const percent of [12, 10, 8]) series.push({ id: `gdp-${percent}`, label: `현재 GDP ${percent}% ($T)`, yAxisId: axis, lineRole: "secondary", paletteIndex: percent === 12 ? 2 : percent === 10 ? 3 : 4,
      points: rows.map((row) => ({ label: row.date, value: gdp.val / 1000 * percent / 100 })) });
  }
  return <RadarDetailShell title="유동성 스트레스" legacyPath="tools/macro-monitor/details/liquidity-stress.html" state={stress.state} retry={retry}>
    <p className="text-sm font-bold">종합 {overall} · 관측 {latest?.date ?? "—"}</p>
    <dl className="grid gap-3 sm:grid-cols-2">
      <DetailMetric label={`SOFR − IORB · ${spreadScore === null ? "미확인" : STATUS[spreadScore]}`} value={`${fmt(latest?.spread, 0)} bp`} detail={`SOFR ${fmt(latest?.sofr)}% − IORB ${fmt(latest?.iorb)}% · 같은 관측일 비교`} />
      <DetailMetric label={`지급준비금 / GDP · ${ratioScore === null ? "미확인" : STATUS[ratioScore]}`} value={`${fmt(ratio, 1)}%`} detail={`지준 $${fmt(latest?.reserves)}T · GDP $${fmt(gdp ? gdp.val / 1000 : null)}T (${gdp?.date ?? "—"})`} />
    </dl>
    <div className="grid gap-3 rounded-xl border bg-white p-4 text-sm sm:grid-cols-2">
      <div><label htmlFor="stress-spread">스프레드 구간: 정상 &lt;10 · 주의 10–20 · 경계 20–30 · 위험 ≥30 bp</label>{latest ? <meter id="stress-spread" className="mt-2 block w-full" min={-20} max={40} value={latest.spread} /> : null}</div>
      <div><label htmlFor="stress-reserves">지준/GDP 구간: 위험 &lt;8 · 경계 8–10 · 주의 10–12 · 정상 ≥12%</label>{ratio !== null ? <meter id="stress-reserves" className="mt-2 block w-full" min={6} max={14} value={ratio} /> : null}</div>
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="스트레스 차트 선택">
      {([ ["dual", "함께 보기"], ["spread", "스프레드"], ["reserves", "지급준비금"] ] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={metric === id} onClick={() => setMetric(id)} className="rounded border px-3 py-2 aria-pressed:bg-blue-50">{label}</button>)}
    </div>
    <MarketChartFrame key={metric} ariaLabel="SOFR IORB 스프레드와 지급준비금" series={series} ranges={DETAIL_RANGES} defaultRangeId="1Y"
      sortLabels xScaleMode="time" spanGaps={false} yAxisTitle={metric === "reserves" ? "지급준비금 ($T)" : "스프레드 (bp)"} y1AxisTitle={metric === "dual" ? "지급준비금 ($T)" : undefined}
      footnote={`FRED · 지준은 각 날짜까지의 최근 관측 · GDP 기준선은 현재 GDP (${gdp?.date ?? "—"})의 12% / 10% / 8%로 고정`} />
    <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-bold">관측값과 계산 근거</summary>
      <p className="my-2 text-sm">스프레드 = (SOFR − IORB) × 100 bp. 지급준비금 WRESBAL은 $M에서 $T로 변환합니다. GDP 10% 기준선(LCLoR)은 $${fmt(gdp ? gdp.val * .1 / 1000 : null)}T입니다. 분기 GDP 관측일과 일간 스프레드 관측일은 다릅니다.</p>
      <p className="my-2 text-sm">SOFR은 국채 담보 익일물 조달금리, IORB는 연준의 지급준비금 이자율입니다. 스프레드 상승과 지준 비율 하락을 함께 확인합니다. 2019년 9월 단기금융시장 경색과 2020년 3월 충격이 주요 과거 사례입니다.</p>
      <div className="max-h-96 overflow-auto"><table className="w-full text-right text-xs"><thead><tr><th>관측일</th><th>SOFR %</th><th>IORB %</th><th>차이 bp</th><th>지준 $T</th></tr></thead><tbody>{rows.slice().reverse().map((row) => <tr key={row.date}><th>{row.date}</th><td>{fmt(row.sofr)}</td><td>{fmt(row.iorb)}</td><td>{row.spread}</td><td>{fmt(row.reserves, 3)}</td></tr>)}</tbody></table></div>
      <p className="mt-3 text-xs">FRED: {["SOFR", "IORB", "WRESBAL", "GDP"].map((id) => <a key={id} className="mr-3" href={`https://fred.stlouisfed.org/series/${id}`}>{id}</a>)}</p>
    </details>
  </RadarDetailShell>;
}
