"use client";

import { useMemo, useState } from "react";
import { MarketChartFrame } from "@/lib/market-valuation/charts/MarketChartFrame";
import type { MarketChartSeries } from "@/lib/market-valuation/charts/types";
import { RECESSIONS } from "../../../public/tools/macro-monitor/shared/recession-data.js";
import RadarDetailShell, { DetailMetric } from "./RadarDetailShell";
import { useRadarData } from "./useRadarData";
import { chartSeries, displayNumber as fmt, valueAt } from "./detail-series";
import type { SeriesPoint } from "./signals-core";

const RANGES = [1, 3, 5, 10, 15, 20, 25].map((years) => ({ id: `${years}Y`, label: `${years}Y`, months: years * 12 })).concat([{ id: "MAX", label: "전체", months: 0 }]);
const CHART_RANGES = RANGES.map(({ months, ...range }) => months ? { ...range, months } : range);
const SECTORS = [
  ["전체 대출", "DRALACBN", "CORALACBN"], ["신용카드", "DRCCLACBS", "CORCCACBS"],
  ["소비자 대출", "DRCLACBS", "CORCACBS"], ["기업 대출", "DRBLACBS", "CORBLACBS"],
  ["상업용 부동산", "DRCRELEXFACBS", "CORCREXFACBS"],
] as const;
const STATUS: Record<string, string> = { normal: "정상", caution: "주의", warning: "경계", danger: "위험" };

export function weeklyLoanGrowth(loans: readonly SeriesPoint[]): SeriesPoint[] {
  let priorIndex = 0;
  return loans.flatMap((row) => {
    const target = Date.parse(row.date) - 364 * 86400000;
    while (priorIndex + 1 < loans.length && Date.parse(loans[priorIndex + 1].date) <= target) priorIndex += 1;
    const candidates = [loans[priorIndex], loans[priorIndex + 1]].filter((point) => point && point.date < row.date);
    const prior = candidates.sort((a, b) => Math.abs(Date.parse(a.date) - target) - Math.abs(Date.parse(b.date) - target))[0];
    return !prior || prior.val === 0 || Math.abs(Date.parse(prior.date) - target) > 7 * 86400000 ? [] : [{ date: row.date, val: (row.val / prior.val - 1) * 100 }];
  });
}

export default function BankingHealthDetail() {
  const { banking, credit, history, retry } = useRadarData();
  const [tab, setTab] = useState<"capital" | "credit" | "risks">("capital");
  const [ranges, setRanges] = useState({ capital: "10Y", credit: "10Y", risks: "MAX" });
  const [nco, setNco] = useState(false);
  const [recession, setRecession] = useState(true);
  const creditById = useMemo(() => new Map(credit.series.map((series) => [series.id, series.points])), [credit.series]);
  const loans = history.TOTLL ?? [], deposits = history.DPSACBW027SBOG ?? [];
  const depositByDate = new Map(deposits.map((row) => [row.date, row.val]));
  const loanDeposit = loans.flatMap((row) => {
    const deposit = depositByDate.get(row.date);
    return !deposit || row.date < "1998-01-01" ? [] : [{ date: row.date, val: row.val / deposit * 100 }];
  });
  const loanGrowth = weeklyLoanGrowth(loans).filter((row) => row.date >= "1998-01-01");
  const capitalKeys = ["fdic_tier1", "BOGZ1FL010000016Q", "DGS10", "BAMLH0A0HYM2"];
  const capitalDates = [...new Set(capitalKeys.flatMap((id) => (history[id] ?? []).map((row) => row.date)))].sort();
  const capital: MarketChartSeries[] = capitalKeys.map((id, index) => ({
    id, label: ["FDIC Tier 1 (%)", "FED Tier 1 (%)", "10년 국채 (%)", "HY 스프레드 (%)"][index],
    yAxisId: index < 2 ? "y" : "y1", paletteIndex: index, lineRole: index % 2 ? "secondary" : "primary",
    points: capitalDates.map((date) => ({ label: date, value: valueAt(history[id] ?? [], date) })),
  }));
  const snapshot = banking.snapshot;
  const del = creditById.get("DRALACBN")?.at(-1), tier1 = history.fdic_tier1?.at(-1) ?? history.BOGZ1FL010000016Q?.at(-1);
  const ld = loanDeposit.at(-1), growth = loanGrowth.at(-1);
  const dates = credit.series.flatMap((series) => series.points.map((point) => point.date));
  const latestCreditDate = dates.sort().at(-1);
  const months = RANGES.find((range) => range.id === ranges.risks)?.months;
  const cutoff = new Date(latestCreditDate ?? "1970-01-01");
  if (months) cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const cutoffDate = months ? cutoff.toISOString().slice(0, 10) : "";
  const riskMax = Math.ceil(Math.max(1, ...SECTORS.flatMap(([, id]) => (creditById.get(id) ?? []).filter((row) => row.date >= cutoffDate).map((row) => row.val)))) + 1;
  return <RadarDetailShell title="은행 건전성" legacyPath="tools/macro-monitor/details/banking-health.html" state={banking.state} retry={retry}>
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <DetailMetric label="종합 건전성" value={snapshot ? STATUS[snapshot.overallStatus] : "미확인"} detail="연체율·자본비율·예대율·대출 증가율 중 가장 약한 신호" />
      <DetailMetric label={`전체 연체율 · ${snapshot ? STATUS[snapshot.delinquency.status] : "미확인"}`} value={`${fmt(del?.val)}%`} detail={del?.date ?? "관측 없음"} />
      <DetailMetric label={`예대율 · ${snapshot ? STATUS[snapshot.loanDeposit.status] : "미확인"}`} value={`${fmt(ld?.val, 1)}%`} detail={`${ld?.date ?? "관측 없음"} · 대출 YoY ${fmt(growth?.val)}%`} />
      <DetailMetric label={`Tier 1 · ${snapshot ? STATUS[snapshot.tier1.status] : "미확인"}`} value={`${fmt(tier1?.val)}%`} detail={`${history.fdic_tier1?.length ? "FDIC" : "FED"} · ${tier1?.date ?? "관측 없음"}`} />
    </dl>
    <div className="flex flex-wrap items-center gap-3" role="group" aria-label="은행 건전성 차트 선택">
      {([ ["capital", "자본"], ["credit", "신용"], ["risks", "연체·순상각"] ] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} className="rounded border px-3 py-2 aria-pressed:bg-blue-50">{label}</button>)}
      <label className="text-sm"><input type="checkbox" checked={recession} onChange={(event) => setRecession(event.target.checked)} /> NBER 경기침체 음영</label>
    </div>
    {tab !== "risks" ? <MarketChartFrame key={tab} ariaLabel={tab === "capital" ? "은행 자본비율과 시장금리" : "예대율과 대출 증가율"}
      series={tab === "capital" ? capital : [chartSeries("ld", "예대율 (%)", loanDeposit), chartSeries("growth", "대출 YoY (%)", loanGrowth, "y1")]}
      ranges={CHART_RANGES} rangeId={ranges[tab]} defaultRangeId="10Y" onRangeChange={(value) => setRanges((current) => ({ ...current, [tab]: value }))}
      sortLabels xScaleMode="time" spanGaps={false} dateBands={recession ? RECESSIONS : undefined}
      yAxisTitle={tab === "capital" ? "Tier 1 (%)" : "예대율 (%)"} y1AxisTitle={tab === "capital" ? "10Y / HY (%)" : "대출 YoY (%)"}
      footnote={tab === "capital" ? "FDIC·FED 분기 자본비율은 각 날짜까지의 마지막 관측값 · 금리·스프레드는 일간" : "TOTLL / DPSACBW027SBOG × 100 · 대출 YoY는 52주 전 ±7일 내 가장 가까운 관측과 비교"} /> : <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3"><label><input type="checkbox" checked={nco} onChange={(event) => setNco(event.target.checked)} /> 순상각률 겹쳐 보기 (오른쪽 축)</label>
        <label>기간 <select value={ranges.risks} onChange={(event) => setRanges((current) => ({ ...current, risks: event.target.value }))} className="rounded border p-1">{CHART_RANGES.map((range) => <option key={range.id} value={range.id}>{range.label}</option>)}</select></label>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">{SECTORS.map(([label, delinquencyId, ncoId], index) => {
        const delinquency = creditById.get(delinquencyId) ?? [], chargeOff = creditById.get(ncoId) ?? [];
        const latest = delinquency.at(-1), latestNco = chargeOff.at(-1);
        return <section key={delinquencyId} className={index === 0 ? "lg:col-span-2" : undefined}>
          <h2 className="mb-1 font-bold">{label} · 연체 {fmt(latest?.val)}% ({latest?.date ?? "—"}) · 순상각 {fmt(latestNco?.val)}% ({latestNco?.date ?? "—"})</h2>
          <MarketChartFrame ariaLabel={`${label} 연체율과 순상각률`} series={[chartSeries(delinquencyId, "연체율 (%)", delinquency), ...(nco ? [chartSeries(ncoId, "순상각률 (%)", chargeOff, "y1")] : [])]}
            ranges={CHART_RANGES} rangeId={ranges.risks} defaultRangeId="MAX" showRangeControls={false} sortLabels xScaleMode="time" spanGaps={false}
            suggestedMin={0} suggestedMax={riskMax} yAxisTitle="연체율 (%)" y1AxisTitle={nco ? "순상각률 (%)" : undefined} dateBands={recession ? RECESSIONS : undefined}
            footnote="FRED 분기 자료 · 부문별 연체율의 왼쪽 축 범위는 공통" />
        </section>;
      })}</div>
    </section>}
    <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-bold">기준일·해석·전체 관측값</summary>
      <p className="my-2 text-sm">Tier 1은 손실 흡수 자본, 예대율은 대출과 예금의 균형, 연체율은 실제 신용 부실을 보여 줍니다. 대출 증가율은 신용 확대·축소를 보여 줍니다. 연체율과 순상각률은 서로 다른 지표입니다.</p>
      <dl className="my-3 grid gap-2 sm:grid-cols-2">{capitalKeys.map((id, index) => <div key={id}><dt className="text-sm">{capital[index].label}</dt><dd className="font-bold">{fmt(history[id]?.at(-1)?.val)}% · {history[id]?.at(-1)?.date ?? "관측 없음"}</dd></div>)}</dl>
      <div className="max-h-96 overflow-auto"><table className="w-full text-right text-xs"><caption>신용 상세 · 분기 관측 · 단위 %</caption><thead><tr><th>시리즈</th><th>관측일</th><th>값</th></tr></thead><tbody>{credit.series.flatMap((series) => series.points.slice().reverse().map((row) => <tr key={`${series.id}-${row.date}`}><th>{series.label}</th><td>{row.date}</td><td>{fmt(row.val)}</td></tr>))}</tbody></table></div>
      <p className="mt-3 text-xs">출처: FDIC · FRED · NBER. 원본: {capitalKeys.filter((id) => id !== "fdic_tier1").map((id) => <a key={id} className="mr-3" href={`https://fred.stlouisfed.org/series/${id}`}>{id}</a>)}</p>
    </details>
  </RadarDetailShell>;
}
