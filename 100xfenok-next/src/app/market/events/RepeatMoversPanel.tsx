"use client";

import { useEffect, useState } from "react";
import TickerChip from "@/components/TickerChip";
import { Panel, PanelHeader } from "@/components/ui";
import { fetchJsonOrNull } from "@/lib/client/data-fetch";
import { refreshOnReturn } from "@/lib/client/refresh-on-return";
import { formatSignedPercent } from "@/lib/format";

type Mover = { symbol: string; company: string; appearances: number; last_date: string; last_change_percent: number };
type RepeatMovers = {
  schema_version: "slickcharts-repeat-movers/v1";
  window_start: string;
  window_end: string;
  observed_days: number;
  top_per_day: number;
  gainers: Mover[];
  losers: Mover[];
};
const URL = "/data/slickcharts/repeat-movers.json";

function parseSummary(value: unknown): RepeatMovers | null {
  if (!value || typeof value !== "object") return null;
  const doc = value as RepeatMovers;
  const validRows = (rows: unknown): rows is Mover[] => Array.isArray(rows)
    && rows.every(row => row && typeof row.symbol === "string"
      && Number.isInteger(row.appearances) && row.appearances >= 2
      && typeof row.last_date === "string" && Number.isFinite(row.last_change_percent));
  return doc.schema_version === "slickcharts-repeat-movers/v1"
    && typeof doc.window_start === "string" && typeof doc.window_end === "string"
    && Number.isInteger(doc.observed_days) && doc.observed_days > 0
    && Number.isInteger(doc.top_per_day) && doc.top_per_day > 0
    && validRows(doc.gainers) && validRows(doc.losers) ? doc : null;
}

export default function RepeatMoversPanel() {
  const [state, setState] = useState<{ doc: RepeatMovers | null; loaded: boolean; failed: boolean; checkedAt: string | null }>({ doc: null, loaded: false, failed: false, checkedAt: null });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    const load = (force = false) => {
      void fetchJsonOrNull<unknown>(URL, { force }).then(value => {
        if (!active) return;
        const doc = parseSummary(value);
        setState(previous => ({ doc: doc ?? previous.doc, loaded: true, failed: !doc, checkedAt: new Date().toISOString() }));
      });
    };
    load(attempt > 0);
    const unsubscribe = refreshOnReturn(() => load());
    return () => { active = false; unsubscribe(); };
  }, [attempt]);

  return (
    <Panel loading={!state.loaded}>
      <PanelHeader eyebrow="SlickCharts" title="반복 등락 종목" />
      {state.doc ? <div className="space-y-4 p-4" data-repeat-movers data-repeat-movers-state="ready">
        <p className="text-xs text-slate-500">{state.doc.window_start}~{state.doc.window_end} · 양쪽 자료가 있는 {state.doc.observed_days}일 · 일별 상승·하락 TOP {state.doc.top_per_day} 등장 횟수</p>
        {state.failed ? <button type="button" onClick={() => retry(value => value + 1)} className="min-h-11 text-sm text-slate-600 underline">갱신 실패 · 이전 집계 표시 · 다시 시도</button> : null}
        <div className="grid gap-4 md:grid-cols-2">
          {([ ["상승 상위 반복", state.doc.gainers], ["하락 상위 반복", state.doc.losers] ] as const).map(([label, rows]) => (
            <section key={label} aria-label={label} className="min-w-0">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">{label}</h3>
              {rows.length ? <ol className="divide-y divide-slate-100">
                {rows.map(row => <li key={row.symbol} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <TickerChip ticker={row.symbol} />
                    <p className="truncate text-xs text-slate-500" title={row.company}>{row.company}</p>
                    <p className="text-xs text-slate-500">최근 등장 {row.last_date} · {formatSignedPercent(row.last_change_percent, { fraction: false, digits: 2 })}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{row.appearances}회</span>
                </li>)}
              </ol> : <p className="text-sm text-slate-500">두 번 이상 등장한 종목이 없습니다.</p>}
            </section>
          ))}
        </div>
        <p className="text-xs text-slate-500">SlickCharts 수집 목록 안의 빈도입니다. 누적 수익률이나 연속 상승·하락 일수를 뜻하지 않습니다.</p>
      </div> : state.loaded ? <div className="space-y-3 p-4" data-repeat-movers data-repeat-movers-state="unavailable">
        <div role="status" className="space-y-1 text-sm text-slate-600">
          <p>반복 등락 종목 집계를 아직 확인할 수 없습니다.</p>
          <p>확인 시각 <time dateTime={state.checkedAt ?? undefined}>{state.checkedAt?.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}</time> · 자료 기준일 미확인</p>
          <p>집계 자료가 없어 상승·하락 반복 횟수를 표시하지 않습니다.</p>
        </div>
        <button type="button" onClick={() => retry(value => value + 1)} className="min-h-11 text-sm text-slate-600 underline">다시 시도</button>
      </div> : null}
    </Panel>
  );
}
