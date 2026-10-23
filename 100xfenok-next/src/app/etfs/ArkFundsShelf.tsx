"use client";

import { useEffect, useState } from "react";
import TickerChip from "@/components/TickerChip";
import { Panel, PanelHeader } from "@/components/ui";
import { fetchJsonOrNull } from "@/lib/client/data-fetch";
import { refreshOnReturn } from "@/lib/client/refresh-on-return";
import { formatSignedPercent } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

type Fund = { symbol: string; price: number | null; changePercent: number | null };
type Funds = { updated: string; ark: Fund[]; index: Fund[] };
const URL = "/data/slickcharts/etf.json";
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function parseFunds(value: unknown): Funds | null {
  if (!value || typeof value !== "object") return null;
  const doc = value as Funds;
  const valid = (rows: unknown): rows is Fund[] => Array.isArray(rows)
    && rows.every(row => row && typeof row.symbol === "string" && row.symbol.trim());
  return typeof doc.updated === "string" && Number.isFinite(Date.parse(doc.updated))
    && valid(doc.ark) && valid(doc.index) ? doc : null;
}

export default function ArkFundsShelf() {
  const [state, setState] = useState<{ doc: Funds | null; loaded: boolean; failed: boolean }>({ doc: null, loaded: false, failed: false });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    const load = (force = false) => {
      void fetchJsonOrNull<unknown>(URL, { force }).then(value => {
        if (!active) return;
        const doc = parseFunds(value);
        setState(previous => ({ doc: doc ?? previous.doc, loaded: true, failed: !doc }));
      });
    };
    load(attempt > 0);
    const unsubscribe = refreshOnReturn(() => load());
    return () => { active = false; unsubscribe(); };
  }, [attempt]);

  return (
    <Panel loading={!state.loaded} empty={state.loaded && !state.doc}
      emptyReason="ARK ETF 스냅샷을 불러오지 못했습니다" emptyActionLabel="다시 시도"
      onEmptyAction={() => retry(value => value + 1)}>
      <PanelHeader eyebrow="SlickCharts" title="ARK 펀드 선반" />
      {state.doc ? <div className="space-y-4 p-4" data-ark-funds-shelf>
        <p className="text-xs text-slate-500">수집 {state.doc.updated.slice(0, 10)} 스냅샷 · 가격 USD · 당일 변동률</p>
        {state.failed ? <button type="button" onClick={() => retry(value => value + 1)} className="min-h-11 text-sm text-slate-600 underline">갱신 실패 · 이전 스냅샷 표시 · 다시 시도</button> : null}
        {([ ["ARK 운용 ETF", state.doc.ark], ["지수 ETF 비교", state.doc.index] ] as const).map(([label, funds]) => (
          <section key={label} aria-label={label}>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">{label} · {funds.length}개</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {funds.map(fund => <div key={fund.symbol} className="min-w-0 rounded-lg border border-slate-200 p-3">
                <TickerChip ticker={fund.symbol} href={ROUTES.etf(fund.symbol)} />
                <p className="mt-1 text-sm font-semibold tabular-nums">{typeof fund.price === "number" && Number.isFinite(fund.price) ? dollars.format(fund.price) : "—"}</p>
                <p className={`text-xs tabular-nums ${typeof fund.changePercent === "number" && fund.changePercent < 0 ? "text-orange-700" : "text-blue-700"}`}>
                  {typeof fund.changePercent === "number" && Number.isFinite(fund.changePercent) ? formatSignedPercent(fund.changePercent, { fraction: false, digits: 2 }) : "—"}
                </p>
              </div>)}
            </div>
          </section>
        ))}
        <p className="text-xs text-slate-500">출처: SlickCharts · 보유종목이나 투자 신호가 아닌 수집 시점 가격 비교입니다.</p>
      </div> : null}
    </Panel>
  );
}
