"use client";

import { useEffect, useState } from "react";
import { EmptyState, EvidenceRail, Panel, PanelHeader, Stat } from "@/components/ui";
import { fetchJsonOrNull } from "@/lib/client/data-fetch";
import { freshnessVerdict, freshnessRailState } from "@/lib/freshness-policy.mjs";
import { MarketChartFrame } from "@/lib/market-valuation/charts/MarketChartFrame";
import type { MarketChartPoint } from "@/lib/market-valuation/charts/types";

type MarketAggregate = {
  as_of: string;
  issuer_count: number;
  total_market_cap: number;
  top_n: number;
  top_n_weight_pct: number;
  aggregate_only: boolean;
  per_issuer_rows: boolean;
  public_serving: boolean;
};
type BridgeHistory = {
  aggregate_only: boolean;
  per_issuer_rows: boolean;
  public_serving: boolean;
  rows: { source_date: string; public_outputs?: { kosdaq_market_cap?: { top_n_weight?: number } } }[];
};
type LoadState = { status: "loading" | "failed" } | { status: "ready"; aggregate: MarketAggregate | null; history: MarketChartPoint[] };

const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export default function KoreaMarketPanel() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    Promise.all([
      fetchJsonOrNull<MarketAggregate>("/data/computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json"),
      fetchJsonOrNull<BridgeHistory>("/data/computed/fenok-edge-korea-krx-bridge-history.json"),
    ]).then(([raw, bridge]) => {
      if (cancelled) return;
      const aggregate = raw?.aggregate_only === true && raw.per_issuer_rows === false && raw.public_serving === true
        && isDay(raw.as_of) && isNumber(raw.issuer_count) && raw.issuer_count > 0
        && isNumber(raw.total_market_cap) && raw.total_market_cap > 0 && isNumber(raw.top_n) && raw.top_n > 0
        && isNumber(raw.top_n_weight_pct) && raw.top_n_weight_pct >= 0 && raw.top_n_weight_pct <= 100 ? raw : null;
      const history = bridge?.aggregate_only === true && bridge.per_issuer_rows === false && bridge.public_serving === true && Array.isArray(bridge.rows)
        ? bridge.rows.flatMap((row) => {
            const value = row?.public_outputs?.kosdaq_market_cap?.top_n_weight;
            return isDay(row?.source_date) && isNumber(value) && value >= 0 && value <= 1
              ? [{ label: row.source_date, value: value * 100 }] : [];
          }).sort((a, b) => a.label.localeCompare(b.label)) : [];
      setState(aggregate || history.length ? { status: "ready", aggregate, history } : { status: "failed" });
    }).catch(() => { if (!cancelled) setState({ status: "failed" }); });
    return () => { cancelled = true; };
  }, [attempt]);
  const retry = () => setAttempt((value) => value + 1);
  const ready = state.status === "ready" ? state : null;
  const aggregate = ready?.aggregate;
  const dates = [aggregate?.as_of, ready?.history.at(-1)?.label].filter((date): date is string => Boolean(date)).sort();
  const asOf = dates[0] ?? null;
  const rail = freshnessRailState(freshnessVerdict(asOf, "krx"));
  return <section id="korea-market" className="mt-6" data-korea-market-panel>
    <Panel loading={state.status === "loading"}>
      <PanelHeader title="한국 시장 집중도" eyebrow="KRX · 코스닥" />
      {state.status === "failed" ? <EmptyState reason="한국 시장 집계 자료를 불러오지 못했습니다." actionLabel="다시 불러오기" onAction={retry} />
        : ready ? <>
          {aggregate ? <div className="grid grid-cols-1 sm:grid-cols-3">
            <Stat label="상장 종목 수" value={aggregate.issuer_count.toLocaleString("ko-KR")} sub={`기준 ${aggregate.as_of}`} />
            <Stat label="시가총액 합계" value={`${(aggregate.total_market_cap / 1e12).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}조 원`} />
            <Stat label={`상위 ${aggregate.top_n}개 비중`} value={`${aggregate.top_n_weight_pct.toFixed(2)}%`} sub="시가총액 기준" />
          </div> : <p className="text-sm">현재 집계는 확인할 수 없어 보관된 집중도 이력만 표시합니다.</p>}
          {ready.history.length ? <MarketChartFrame title="코스닥 상위 10개 시가총액 비중" ariaLabel="코스닥 집중도 이력"
            series={[{ id: "kosdaq-top10", label: "상위 10개 비중", points: ready.history, colorToken: "brand" }]}
            ranges={[{ id: "3M", label: "3개월", months: 3 }, { id: "1Y", label: "1년", months: 12 }, { id: "MAX", label: "전체" }]}
            defaultRangeId="3M" yAxisTitle="시가총액 비중 (%)" formatValue={(value) => value === null ? "—" : `${value.toFixed(2)}%`} sortLabels bare />
            : <p className="text-sm">집중도 이력은 확인할 수 없습니다.</p>}
          <EvidenceRail source="한국거래소 · 공개 시장 집계" asOf={asOf ?? "—"}
            freshness={aggregate && ready.history.length ? rail?.freshness ?? "partial" : "partial"}
            coverage={`${ready.history.length}개 관측일`} />
        </> : null}
    </Panel>
  </section>;
}
