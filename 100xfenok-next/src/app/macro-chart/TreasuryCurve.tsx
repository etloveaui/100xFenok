"use client";

import { useEffect, useState } from "react";
import { MarketChartFrame } from "@/lib/market-valuation/charts/MarketChartFrame";
import type { MarketChartSeries } from "@/lib/market-valuation/charts/types";

const MATURITIES = ["1 Mo", "1.5 Mo", "2 Mo", "3 Mo", "4 Mo", "6 Mo", "1 Yr", "2 Yr", "3 Yr", "5 Yr", "7 Yr", "10 Yr", "20 Yr", "30 Yr"];
type Snapshot = { date: string; rates: Array<{ maturity: string; rate: number | null }> };
type CurveData = { updated: string; history: Snapshot[] };

export function parseTreasuryCurve(payload: unknown): CurveData {
  const root = payload as { updated?: unknown; history?: Array<{ date?: unknown; rates?: Array<{ maturity?: unknown; rate?: unknown }> }> } | null;
  const history = (Array.isArray(root?.history) ? root.history : []).flatMap((row): Snapshot[] => {
    if (typeof row?.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Array.isArray(row.rates)) return [];
    const rates = MATURITIES.map((maturity) => {
      const raw = row.rates?.find((rate) => rate?.maturity === maturity)?.rate;
      return { maturity, rate: typeof raw === "number" && Number.isFinite(raw) ? raw : null };
    });
    return rates.some((rate) => rate.rate !== null) ? [{ date: row.date, rates }] : [];
  }).sort((a, b) => b.date.localeCompare(a.date));
  return { updated: typeof root?.updated === "string" ? root.updated : "미확인", history };
}

export default function TreasuryCurve() {
  const [data, setData] = useState<CurveData | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [date, setDate] = useState("");
  const [comparePrevious, setComparePrevious] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setFailed(false);
    void fetch("/data/slickcharts/treasury.json", { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.json(); })
      .then((payload) => { if (!controller.signal.aborted) setData(parseTreasuryCurve(payload)); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [retry]);
  const selected = data?.history.find((row) => row.date === date) ?? data?.history[0];
  const previous = data?.history.find((row) => selected && row.date < selected.date);
  const series: MarketChartSeries[] = (selected ? [selected, ...(comparePrevious && previous ? [previous] : [])] : []).map((row, index) => ({
    id: row.date, label: row.date, paletteIndex: index, lineRole: index === 0 ? "primary" : "secondary",
    points: row.rates.map((rate) => ({ label: rate.maturity, value: rate.rate })),
  }));
  return <section className="cpw5-macro-table-panel" data-macro-treasury-curve="true" aria-label="미 국채 만기별 수익률 곡선">
    <h2 className="text-lg font-bold">미 국채 수익률 곡선</h2>
    <p className="text-sm text-slate-500">가로축 만기 · 세로축 수익률 % · 기간 스프레드 시계열은 위 차트의 %p 값입니다.</p>
    {failed ? <p role="alert">국채 자료를 불러오지 못했습니다. <button type="button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button></p>
      : !data ? <p role="status">국채 곡선을 불러오는 중입니다.</p>
      : !selected ? <p>유효한 국채 관측값이 없습니다.</p>
      : <>
        <div className="my-3 flex flex-wrap items-center gap-4">
          <label>관측일 <select value={selected.date} onChange={(event) => setDate(event.target.value)} className="rounded border p-1">
            {data.history.map((row) => <option key={row.date} value={row.date}>{row.date}</option>)}
          </select></label>
          <label><input type="checkbox" checked={comparePrevious} onChange={(event) => setComparePrevious(event.target.checked)} /> 직전 관측일 비교</label>
        </div>
        <MarketChartFrame ariaLabel="14개 만기 미국 국채 수익률" series={series} ranges={[{ id: "MAX", label: "전체 만기" }]}
          defaultRangeId="MAX" showRangeControls={false} sortLabels={false} xScaleMode="category" spanGaps={false}
          yAxisTitle="수익률 (%)" formatValue={(value) => value === null ? "—" : `${value.toFixed(2)}%`}
          footnote={`Slickcharts · 관측 ${selected.date} · ${selected.rates.filter((rate) => rate.rate !== null).length}/14개 만기`} />
        <details className="mt-2"><summary className="cursor-pointer text-sm">만기별 값 보기</summary>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {selected.rates.map((rate) => <div key={rate.maturity} className="rounded bg-slate-50 p-2 text-sm"><dt>{rate.maturity}</dt><dd className="font-bold">{rate.rate === null ? "관측 없음" : `${rate.rate.toFixed(2)}%`}</dd></div>)}
          </dl>
        </details>
        <p className="mt-2 text-xs text-slate-500">Slickcharts · 갱신 {data.updated} · {data.history.length}개 관측일 ({data.history.at(-1)?.date} ~ {data.history[0]?.date})</p>
      </>}
  </section>;
}
