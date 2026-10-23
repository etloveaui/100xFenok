"use client";

import { useEffect, useMemo, useState } from "react";
import { MarketChartFrame } from "@/lib/market-valuation/charts/MarketChartFrame";
import type { MarketChartSeries } from "@/lib/market-valuation/charts/types";
import { RECESSIONS } from "../../../public/tools/macro-monitor/shared/recession-data.js";
import { computeSentimentSignalSnapshot } from "../../../public/tools/macro-monitor/shared/signals-core.mjs";
import type { SentimentSnapshot } from "./signals-core";
import RadarDetailShell, { DetailMetric } from "./RadarDetailShell";
import { displayNumber as fmt } from "./detail-series";
import { CNN_COMPONENTS, SENTIMENT_VIEWS, movingAverage125, numberAt, returnSinceStart, sentimentRows, sentimentSeries, sentimentStatus, sentimentThresholds, type SentimentRow } from "./sentiment-detail-data";

const LEGACY = "tools/macro-monitor/details/sentiment-signal/";
const SOURCES = [...SENTIMENT_VIEWS.map((view) => view.file), "move", "cnn-components", "sp500"];
const RANGES = ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "10Y", "20Y", "YTD", "1987~", "1990~", "2000~", "2010~", "2011~", "2015~", "2018~", "2020~", "2022~", "2024~", "MAX", "직접 선택"];
const STATE_LABEL: Record<string, string> = { neutral: "중립", opportunity: "매수 검토", warning: "경계", active: "충족", near: "근접", inactive: "미충족", met: "충족", unmet: "미충족", unknown: "미확인", buy: "매수", sell: "경계", warn: "경계" };
const componentStatus = (value: number | null) => value === null ? "미확인" : value >= 75 ? "Extreme Greed" : value >= 60 ? "Greed" : value >= 40 ? "Neutral" : value >= 25 ? "Fear" : "Extreme Fear";

export default function SentimentSignalDetail({ initialView = "cnn-fg" }: { initialView?: string }) {
  const [viewId, setViewId] = useState(initialView);
  const [data, setData] = useState<Record<string, SentimentRow[]>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [range, setRange] = useState("1Y");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [overlay, setOverlay] = useState(false);
  const [thresholds, setThresholds] = useState(true);
  const [recession, setRecession] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all(SOURCES.map(async (file) => {
      try {
        const response = await fetch(`/data/${file === "sp500" ? "indices" : "sentiment"}/${file}.json`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        return [file, sentimentRows(await response.json(), file)] as const;
      } catch { return [file, []] as const; }
    })).then((entries) => {
      if (cancelled) return;
      setData(Object.fromEntries(entries));
      setFailed(entries.filter(([, rows]) => !rows.length).map(([file]) => file));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [nonce]);
  const view = SENTIMENT_VIEWS.find((item) => item.id === viewId) ?? SENTIMENT_VIEWS[0];
  const isComponents = viewId === "components";
  const rows = data[isComponents ? "cnn-components" : view.file] ?? [];
  const lastDate = rows.at(-1)?.date ?? "";
  let from = "", until = lastDate;
  if (range === "직접 선택") { from = start; until = end || lastDate; }
  else if (/^\d{4}~$/.test(range)) from = `${range.slice(0, 4)}-01-01`;
  else if (range === "YTD") from = `${lastDate.slice(0, 4)}-01-01`;
  else if (range !== "MAX" && lastDate) {
    const date = new Date(`${lastDate}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - ({ "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "2Y": 24, "3Y": 36, "5Y": 60, "10Y": 120, "20Y": 240 }[range] ?? 12));
    from = date.toISOString().slice(0, 10);
  }
  const filter = (items: SentimentRow[]) => items.filter((row) => (!from || row.date >= from) && (!until || row.date <= until));
  const selected = filter(rows);
  const selectedLast = selected.at(-1), selectedPrev = selected.at(-2);
  const current = numberAt(selectedLast, view.field), previous = numberAt(selectedPrev, view.field);
  const ma = movingAverage125(data["cnn-momentum"] ?? []);
  const selectedMa = numberAt(filter(ma).at(-1), "value");
  const combo = useMemo(() => {
    const latest = (file: string, field = "value") => numberAt(data[file]?.at(-1), field);
    return computeSentimentSignalSnapshot({ vix: latest("vix"), move: latest("move"), cnn_fg: latest("cnn-fear-greed", "score"), crypto_fg: latest("crypto-fear-greed"), cftc_net: latest("cftc-sp500", "net"), aaii_bearish: latest("aaii", "bearish"), aaii_spread: latest("aaii", "spread"), putcall_ratio: latest("cnn-put-call") }) as unknown as SentimentSnapshot;
  }, [data]);
  const series: MarketChartSeries[] = [sentimentSeries(view.id, `${view.label} (${view.unit})`, selected, view.field, { chartType: view.id === "cftc" ? "bar" : "line" })];
  if (view.id === "aaii") for (const [key, label] of [["bullish", "Bullish %"], ["bearish", "Bearish %"], ["neutral", "Neutral %"]]) series.push(sentimentSeries(key, label, selected, key, { paletteIndex: series.length }));
  if (view.id === "cftc") for (const [key, label] of [["long", "Long 계약"], ["short", "Short 계약"], ["openInterest", "Open Interest 계약"]]) series.push(sentimentSeries(key, label, selected, key, { hidden: true, paletteIndex: series.length }));
  if (view.id === "vix-move") series.push(sentimentSeries("move", "MOVE 지수", filter(data.move ?? []), "value", { yAxisId: "y1", paletteIndex: 1 }));
  if (view.id === "cnn-momentum") series.push(sentimentSeries("ma125", "125개 관측 이동평균", filter(ma), "value", { paletteIndex: 1, lineRole: "secondary" }));
  if (thresholds && selected.length) {
    for (const [index, level] of sentimentThresholds(view, rows).entries()) series.push({ id: `threshold-${index}`, label: `기준 ${fmt(level)}`, lineRole: "secondary", paletteIndex: index + 3, points: [{ label: selected[0].date, value: level }, { label: selectedLast!.date, value: level }] });
    if (view.id === "vix-move") for (const level of [120, 150]) series.push({ id: `move-${level}`, label: `MOVE ${level}`, yAxisId: "y1", lineRole: "secondary", paletteIndex: 5, points: [{ label: selected[0].date, value: level }, { label: selectedLast!.date, value: level }] });
  }
  const spRows = returnSinceStart(filter(data.sp500 ?? []));
  const spSeries = sentimentSeries("sp500-return", "S&P 500 기간 수익률 (%)", spRows, "value", { yAxisId: view.id === "vix-move" ? "y" : "y1", paletteIndex: 7 });
  if (overlay && view.id !== "vix-move" && view.id !== "cnn-momentum") series.push(spSeries);
  const fields = isComponents ? CNN_COMPONENTS.map(([key]) => key) : view.id === "aaii" ? ["bullish", "neutral", "bearish", "spread"] : view.id === "cftc" ? ["net", "long", "short", "openInterest"] : [view.field];
  const latestComponents = data["cnn-components"]?.at(-1), prevComponents = data["cnn-components"]?.at(-2);
  const componentChanges = CNN_COMPONENTS.flatMap(([key]) => { const a = numberAt(latestComponents, key), b = numberAt(prevComponents, key); return a === null || b === null ? [] : [a - b]; });
  const legacyPath = `${LEGACY}${isComponents ? "charts/table-cnn-components.html" : `charts/chart-${view.id}.html`}`;
  return <RadarDetailShell title="시장 심리 상세" legacyPath={legacyPath} state={loading ? "loading" : !Object.values(data).some((items) => items.length) ? "failed" : failed.length ? "missing" : "ready"} retry={() => setNonce((value) => value + 1)}>
    <section className="space-y-3" aria-label="심리 요약">
      <p className="font-bold">종합 {loading || !Object.values(combo.values).some((value) => value !== null) ? "미확인" : STATE_LABEL[combo.overallStatus]} · 매수 충족 {combo.buy_active} / 근접 {combo.buy_near} · 경계 충족 {combo.warn_active} / 근접 {combo.warn_near}</p>
      <p className="text-xs text-slate-500">각 지표의 최신 관측을 비교합니다. 관측일은 서로 다르며, 화면을 불러온 시간이 데이터 기준일이 되지는 않습니다.</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{SENTIMENT_VIEWS.map((item) => {
        const items = data[item.file] ?? [];
        return <div key={item.id}><button type="button" className="w-full text-left" onClick={() => setViewId(item.id)}><dl><DetailMetric label={item.label} value={`${fmt(numberAt(items.at(-1), item.field), item.id === "cftc" ? 0 : 2)} ${item.unit}`} detail={`${sentimentStatus(item, items)} · ${items.at(-1)?.date ?? "미확인"}`} /></dl></button></div>;
      })}<dl><DetailMetric label="MOVE" value={fmt(numberAt(data.move?.at(-1), "value"))} detail={`관측 ${data.move?.at(-1)?.date ?? "미확인"} · 스트레스 ≥120 / 극단 ≥150`} /></dl></div>
      <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-bold">조합 신호와 현재 조건</summary><div className="mt-3 grid gap-3 md:grid-cols-2">{combo.combos.map((item) => <div key={item.id} className="rounded border p-3 text-sm"><p className="font-bold">{item.name} · {STATE_LABEL[item.category] ?? item.category} · {STATE_LABEL[item.status]}</p><ul className="mt-2 space-y-1">{item.conditions.map((condition, index) => <li key={index}>{condition.label ?? condition.indicator} {condition.operator} {condition.value} · 현재 {fmt(condition.current)} · {STATE_LABEL[condition.status]}</li>)}</ul></div>)}</div></details>
    </section>
    {failed.length ? <p role="alert" className="text-sm">자료 없음: {failed.join(", ")} · 새로고침으로 다시 시도할 수 있습니다.</p> : null}
    <label className="block text-sm font-bold">상세 차트 / 표<select value={viewId} onChange={(event) => setViewId(event.target.value)} className="ml-3 max-w-full rounded border bg-white p-2">{SENTIMENT_VIEWS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}<option value="components">CNN 7개 구성요소 점수</option></select></label>
    {isComponents ? <section className="overflow-auto rounded-xl border bg-white p-4"><h2 className="font-bold">CNN 7개 구성요소 · 0–100 점수</h2><p className="my-2 text-sm">관측 {latestComponents?.date ?? "—"} / 이전 {prevComponents?.date ?? "—"} · 평균 변화 {fmt(componentChanges.length ? componentChanges.reduce((a, b) => a + b, 0) / componentChanges.length : null, 1)}점</p><table className="w-full text-right text-sm"><thead><tr><th>구성요소</th><th>최신</th><th>이전</th><th>변화</th><th>상태</th></tr></thead><tbody>{CNN_COMPONENTS.map(([key, label]) => { const current = numberAt(latestComponents, key), prior = numberAt(prevComponents, key); return <tr key={key}><th className="py-2 text-left">{label}</th><td>{fmt(current, 1)}</td><td>{fmt(prior, 1)}</td><td>{fmt(current === null || prior === null ? null : current - prior, 1)}</td><td>{componentStatus(current)}</td></tr>; })}</tbody></table><p className="mt-2 text-xs">점수 구간: &lt;25 Extreme Fear · 25–40 Fear · 40–60 Neutral · 60–75 Greed · ≥75 Extreme Greed. 각 원시 지표의 단위와 구분합니다.</p></section> : <>
      <p className="text-sm">{view.description}</p>
      {view.id === "vix-move" ? <p className="text-sm font-bold">선택 기간 MOVE {fmt(numberAt(filter(data.move ?? []).at(-1), "value"))} · {filter(data.move ?? []).at(-1)?.date ?? "미확인"} · {current !== null && numberAt(filter(data.move ?? []).at(-1), "value") !== null ? current >= 30 && numberAt(filter(data.move ?? []).at(-1), "value")! >= 120 ? "DUAL STRESS: 주식·채권 동시 스트레스" : "동시 스트레스 기준 미충족" : "동시 스트레스 미확인"}</p> : null}
      <dl className="grid gap-3 sm:grid-cols-3"><DetailMetric label="선택 기간 마지막 값" value={`${fmt(current, view.id === "cftc" ? 0 : 2)} ${view.unit}`} detail={`관측 ${selectedLast?.date ?? "—"}`} /><DetailMetric label="직전 관측 대비" value={fmt(current === null || previous === null ? null : current - previous)} detail={`이전 ${selectedPrev?.date ?? "—"} · ${view.unit}`} /><DetailMetric label={view.id === "cnn-momentum" ? "125개 관측 MA / 괴리율" : "전체 이력"} value={view.id === "cnn-momentum" ? `${fmt(selectedMa)} / ${fmt(current !== null && selectedMa ? (current / selectedMa - 1) * 100 : null)}%` : `${rows.length.toLocaleString()}개`} detail={`${rows[0]?.date ?? "—"} ~ ${lastDate || "—"}`} /></dl>
    </>}
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="기간 선택">{RANGES.map((id) => <button key={id} type="button" aria-pressed={range === id} className="rounded border px-3 py-2 text-sm aria-pressed:bg-blue-50" onClick={() => setRange(id)}>{id}</button>)}</div>
    {range === "직접 선택" ? <div className="flex flex-wrap gap-3 text-sm"><label>시작 <input type="date" value={start} max={end || lastDate} onChange={(event) => setStart(event.target.value)} className="rounded border p-2" /></label><label>종료 <input type="date" value={end} min={start} max={lastDate} onChange={(event) => setEnd(event.target.value)} className="rounded border p-2" /></label>{start && end && start > end ? <p role="alert">종료일을 시작일 이후로 선택하세요.</p> : null}</div> : null}
    {!isComponents ? <>
      <div className="flex flex-wrap gap-4 text-sm">{view.id !== "cnn-momentum" ? <label><input type="checkbox" checked={overlay} onChange={(event) => setOverlay(event.target.checked)} /> S&P 500 수익률 비교</label> : null}<label><input type="checkbox" checked={thresholds} onChange={(event) => setThresholds(event.target.checked)} /> 기준선</label><label><input type="checkbox" checked={recession} onChange={(event) => setRecession(event.target.checked)} /> NBER 경기침체 음영</label></div>
      <MarketChartFrame key={viewId} ariaLabel={view.label} series={series} ranges={[{ id: "MAX", label: "선택 기간" }]} defaultRangeId="MAX" showRangeControls={false} seriesAreRangeFiltered sortLabels spanGaps={false} xScaleMode="time" yAxisTitle={view.unit} y1AxisTitle={view.id === "vix-move" ? "MOVE 지수" : overlay && view.id !== "cnn-momentum" ? "S&P 500 수익률 (%)" : undefined} dateBands={recession ? RECESSIONS : undefined} onHoverLabel={setCursor} cursorLabel={cursor} footnote={`관측 ${selected[0]?.date ?? "—"} ~ ${selectedLast?.date ?? "—"} · ${selected.length}개 · 기준선은 전체 이력으로 계산 · 계열 이름을 눌러 표시 전환`} />
      {overlay && view.id === "vix-move" ? <MarketChartFrame ariaLabel="S&P 500 기간 수익률" series={[spSeries]} ranges={[{ id: "MAX", label: "선택 기간" }]} defaultRangeId="MAX" showRangeControls={false} seriesAreRangeFiltered xScaleMode="time" yAxisTitle="S&P 500 수익률 (%)" onHoverLabel={setCursor} cursorLabel={cursor} footnote={`비교 시작 ${spRows[0]?.date ?? "—"} = 0% · VIX / MOVE와 같은 기간`} /> : null}
      {overlay && view.id !== "cnn-momentum" ? <p className="text-xs">S&P 500은 선택 기간의 첫 유효 관측을 0%로 계산합니다. 비교 관측일 {spRows[0]?.date ?? "—"} ~ {spRows.at(-1)?.date ?? "—"}. 비거래일 값을 미래 관측으로 채우지 않습니다.</p> : null}
    </> : null}
    <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-bold">선택 기간 관측값 · {selected.length}개</summary><div className="mt-3 max-h-96 overflow-auto"><table className="w-full text-right text-xs"><thead><tr><th>관측일</th>{fields.map((field) => <th key={field}>{field}</th>)}</tr></thead><tbody>{selected.slice().reverse().map((row) => <tr key={row.date}><th>{row.date}</th>{fields.map((field) => <td className="py-1" key={field}>{fmt(numberAt(row, field), view.id === "cftc" ? 0 : 2)}</td>)}</tr>)}</tbody></table></div></details>
    <p className="text-xs text-slate-500">출처: CNN / CFTC COT / AAII / Cboe / ICE / Alternative.me. <a className="text-blue-700" href={`/data/sentiment/${isComponents ? "cnn-components" : view.file}.json`}>원본 관측값</a> · <a className="text-blue-700" href={`/radar?legacy=1&path=${encodeURIComponent(`${LEGACY}index.html`)}`}>기존 지표 설명과 활용 사례</a></p>
  </RadarDetailShell>;
}
