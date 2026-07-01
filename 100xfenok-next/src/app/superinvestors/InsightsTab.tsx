"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import TransitionLink from "@/components/TransitionLink";
import TickerChip from "@/components/TickerChip";
import { ROUTES } from "@/lib/routes";
import type {
  BuyingPressureData,
  NewPositionsData,
  HhiData,
  ConvictionData,
  ConvictionEntriesData,
  ConvictionEntry,
  BuyingPressureRow,
  ConvictionPosition,
  FactorExposuresSummaryData,
  TradesRankingData,
  PortfolioViewsData,
} from "@/lib/superinvestors/types";
import { loadPortfolioViews, loadFactorExposuresSummary, RiskReturnScatter, CumulativeReturnOverlay, FactorExposureRadar } from "./PortfolioCharts";

// ---------------------------------------------------------------------------
// Module-level caches
// ---------------------------------------------------------------------------

let bpCache: BuyingPressureData | null = null;
let bpPromise: Promise<BuyingPressureData | null> | null = null;
function loadBuyingPressure(): Promise<BuyingPressureData | null> {
  if (bpCache) return Promise.resolve(bpCache);
  if (bpPromise) return bpPromise;
  bpPromise = fetch("/data/sec-13f/analytics/buying_pressure.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { bpCache = d; return d; })
    .catch(() => { bpPromise = null; return null; });
  return bpPromise;
}

let trCache: TradesRankingData | null = null;
let trPromise: Promise<TradesRankingData | null> | null = null;
function loadTradesRanking(): Promise<TradesRankingData | null> {
  if (trCache) return Promise.resolve(trCache);
  if (trPromise) return trPromise;
  trPromise = fetch("/data/sec-13f/analytics/trades_ranking.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { trCache = d; return d; })
    .catch(() => { trPromise = null; return null; });
  return trPromise;
}

let npCache: NewPositionsData | null = null;
let npPromise: Promise<NewPositionsData | null> | null = null;
function loadNewPositions(): Promise<NewPositionsData | null> {
  if (npCache) return Promise.resolve(npCache);
  if (npPromise) return npPromise;
  npPromise = fetch("/data/sec-13f/analytics/new_positions.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { npCache = d; return d; })
    .catch(() => { npPromise = null; return null; });
  return npPromise;
}

let hhiCache: HhiData | null = null;
let hhiPromise: Promise<HhiData | null> | null = null;
function loadHhi(): Promise<HhiData | null> {
  if (hhiCache) return Promise.resolve(hhiCache);
  if (hhiPromise) return hhiPromise;
  hhiPromise = fetch("/data/sec-13f/analytics/hhi.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { hhiCache = d; return d; })
    .catch(() => { hhiPromise = null; return null; });
  return hhiPromise;
}

let cvCache: ConvictionData | null = null;
let cvPromise: Promise<ConvictionData | null> | null = null;
function loadConviction(): Promise<ConvictionData | null> {
  if (cvCache) return Promise.resolve(cvCache);
  if (cvPromise) return cvPromise;
  cvPromise = fetch("/data/sec-13f/analytics/conviction.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { cvCache = d; return d; })
    .catch(() => { cvPromise = null; return null; });
  return cvPromise;
}

let ceCache: ConvictionEntriesData | null = null;
let cePromise: Promise<ConvictionEntriesData | null> | null = null;
function loadConvictionEntries(): Promise<ConvictionEntriesData | null> {
  if (ceCache) return Promise.resolve(ceCache);
  if (cePromise) return cePromise;
  cePromise = fetch("/data/sec-13f/analytics/conviction_entries.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { ceCache = d; return d; })
    .catch(() => { cePromise = null; return null; });
  return cePromise;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtUSD(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${n >= 0 ? "" : "-"}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${n >= 0 ? "" : "-"}$${(abs / 1_000_000).toFixed(0)}M`;
  return `${n >= 0 ? "" : "-"}$${Math.round(abs).toLocaleString()}`;
}

function isTicker(s: string): boolean {
  return /^[A-Z0-9.]+$/.test(s) && s.length <= 6;
}

function classificationColor(c: string): string {
  if (c === "concentrated") return "bg-amber-100 text-amber-700 border-amber-200";
  if (c === "moderate") return "bg-slate-100 text-slate-600 border-slate-200";
  return "bg-sky-100 text-sky-700 border-sky-200";
}

function classificationLabel(c: string): string {
  if (c === "concentrated") return "집중";
  if (c === "moderate") return "보통";
  if (c === "dispersed") return "분산";
  return c;
}

function InsightTableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="scroll-hint-x -mx-1 px-1" role="region" tabIndex={0} aria-label={`${label} 표 가로 스크롤`}>
      {children}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)] sm:p-5">
      <div className="h-5 w-1/3 rounded bg-slate-200" />
      <div className="mt-3 space-y-2">
        {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-4 w-full rounded bg-slate-200" />)}
      </div>
    </div>
  );
}

function UnavailablePanel({ label }: { label: string }) {
  return (
    <div data-superinvestor-insights-empty-state className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-xs font-bold text-slate-500">
      {label} 데이터를 불러오지 못했습니다. 다른 인사이트는 계속 확인할 수 있습니다.
    </div>
  );
}

type InsightMetadata = {
  quarter?: string;
  investors_included?: string[];
  investors_excluded?: Array<{ id: string; latest_quarter?: string }>;
  excluded_stale_investors?: string[];
  current_cohort_investors?: number;
  investors_count?: number;
  cohort_count?: number;
  generated_at?: string;
  disclaimer?: string;
};

function formatGeneratedAt(value?: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function SuperinvestorInsightsStatus({ metadata }: { metadata: Array<InsightMetadata | undefined> }) {
  const available = metadata.filter((item): item is InsightMetadata => Boolean(item));
  const quarter = available.find((item) => item.quarter)?.quarter ?? "";
  const cohortCount =
    available.find((item) => item.current_cohort_investors)?.current_cohort_investors ??
    available.find((item) => item.investors_included?.length)?.investors_included?.length ??
    available.find((item) => item.cohort_count)?.cohort_count ??
    available.find((item) => item.investors_count)?.investors_count ??
    null;
  const generatedAt = formatGeneratedAt(available.find((item) => item.generated_at)?.generated_at);
  const disclaimer = available.find((item) => item.disclaimer)?.disclaimer;
  const excluded = new Map<string, string | undefined>();
  for (const item of available) {
    for (const investor of item.investors_excluded ?? []) {
      excluded.set(investor.id, investor.latest_quarter);
    }
    for (const id of item.excluded_stale_investors ?? []) {
      if (!excluded.has(id)) excluded.set(id, undefined);
    }
  }
  const excludedSummary = [...excluded.entries()]
    .map(([id, latest]) => (latest ? `${id} ${latest}` : id))
    .slice(0, 4)
    .join(", ");

  return (
    <div
      data-superinvestor-insights-status
      data-superinvestor-insights-excluded-count={excluded.size}
      className="rounded-[1.2rem] border border-emerald-100 bg-emerald-50/70 px-3 py-3 shadow-[var(--sh-sm)]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-superinvestor-insights-quarter
          className="inline-flex min-h-8 items-center rounded-full border border-emerald-200 bg-white px-2.5 text-[10px] font-black uppercase tracking-[0.08em] text-emerald-700"
        >
          {quarter ? `${quarter} 기준` : "분기 확인 중"}
        </span>
        <span
          data-superinvestor-insights-cohort
          className="inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-white px-2.5 text-[10px] font-black text-slate-700"
        >
          {cohortCount ? `${cohortCount}명 반영` : "코호트 확인 중"}
        </span>
        <span
          data-superinvestor-insights-lag
          className="inline-flex min-h-8 items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 text-[10px] font-black text-amber-700"
        >
          13F 최대 45일 지연
        </span>
        <span
          data-superinvestor-insights-stale
          className="inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-white px-2.5 text-[10px] font-black text-slate-600"
          title={excludedSummary || undefined}
        >
          stale 제외 {excluded.size}명
        </span>
      </div>
      <p className="mt-2 text-[10px] font-semibold leading-relaxed text-[var(--c-ink-3)]">
        {generatedAt ? `생성 ${generatedAt}` : "생성 시각 미표기"} · {disclaimer ?? "13F 분기 스냅샷 기반으로 장중 매매, 숏 포지션, 비13F 자산은 제외됩니다."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card 1: 매수 압력
// ---------------------------------------------------------------------------

/**
 * Joins trades_ranking bought/sold (50+50 rows, per-ticker investor counts)
 * instead of the converter's top_buying/top_selling, whose ratio sort
 * surfaces only single-buyer tickers and left this card nearly empty.
 */
function buildPressureRows(trades: TradesRankingData): { buy: BuyingPressureRow[]; sell: BuyingPressureRow[] } {
  const byTicker = new Map<string, { buyers: number; sellers: number; buyAmt: number; sellAmt: number }>();
  for (const r of trades.bought ?? []) {
    const cur = byTicker.get(r.ticker) ?? { buyers: 0, sellers: 0, buyAmt: 0, sellAmt: 0 };
    cur.buyers = r.investors_count;
    cur.buyAmt = r.amount;
    byTicker.set(r.ticker, cur);
  }
  for (const r of trades.sold ?? []) {
    const cur = byTicker.get(r.ticker) ?? { buyers: 0, sellers: 0, buyAmt: 0, sellAmt: 0 };
    cur.sellers = r.investors_count;
    cur.sellAmt = r.amount;
    byTicker.set(r.ticker, cur);
  }
  const rows: BuyingPressureRow[] = [...byTicker.entries()].map(([ticker, v]) => ({
    ticker,
    net_buyers: v.buyers,
    net_sellers: v.sellers,
    net_holders: 0,
    pressure: v.buyers + v.sellers > 0 ? v.buyers / (v.buyers + v.sellers) : 0,
    total_value_change: v.buyAmt - v.sellAmt,
  }));
  const buy = rows
    .filter((r) => r.net_buyers >= 2)
    .sort((a, b) => b.net_buyers - a.net_buyers || b.total_value_change - a.total_value_change)
    .slice(0, 12);
  const sell = rows
    .filter((r) => r.net_sellers >= 2)
    .sort((a, b) => b.net_sellers - a.net_sellers || a.total_value_change - b.total_value_change)
    .slice(0, 12);
  return { buy, sell };
}

function BuyingPressureCard({ data, trades }: { data: BuyingPressureData | null; trades: TradesRankingData | null }) {
  const { buyRows, sellRows, quarter, note } = useMemo(() => {
    if (trades?.bought?.length) {
      const { buy, sell } = buildPressureRows(trades);
      return {
        buyRows: buy,
        sellRows: sell,
        quarter: trades.metadata.quarter,
        note: "투자 대가 매매 순위 기반 — 매수/매도 참여 투자자 수와 거래액으로 압력 측정 (2인 이상)",
      };
    }
    const legacyBuy = (data?.top_buying ?? [])
      .filter((r) => r.net_buyers + r.net_sellers >= 3)
      .sort((a, b) => b.pressure - a.pressure)
      .slice(0, 12);
    const legacySell = (data?.top_selling ?? [])
      .filter((r) => r.net_buyers + r.net_sellers >= 3)
      .sort((a, b) => a.pressure - b.pressure)
      .slice(0, 12);
    return {
      buyRows: legacyBuy,
      sellRows: legacySell,
      quarter: data?.metadata.quarter ?? "",
      note: "29인 전체 포트폴리오 변화량 기반 매수/매도 압력 (net_buyers+net_sellers≥3 필터)",
    };
  }, [data, trades]);

  const hasSelling = sellRows.length > 0;

  return (
    <div>
      <div className={hasSelling ? "grid gap-4 lg:grid-cols-2" : ""}>
        <PressurePanel title="매수 압력 TOP" rows={buyRows} color="emerald" signLabel={(r) => `${r.net_buyers} vs ${r.net_sellers}`} />
        {hasSelling ? (
          <PressurePanel title="매도 압력 TOP" rows={sellRows} color="rose" signLabel={(r) => `${r.net_sellers} vs ${r.net_buyers}`} />
        ) : null}
      </div>
      <p className="mt-2 text-[10px] font-semibold text-[var(--c-ink-3)]">
        {quarter} 기준 · {note}
      </p>
    </div>
  );
}

function AccumulationHeatmap({ trades }: { trades: TradesRankingData | null }) {
  const rows = useMemo(() => {
    return [...(trades?.bought ?? [])]
      .sort((a, b) => b.investors_count - a.investors_count || b.amount - a.amount)
      .slice(0, 12);
  }, [trades]);
  const maxInvestors = Math.max(1, ...rows.map((row) => row.investors_count));
  const maxAmount = Math.max(1, ...rows.map((row) => Math.abs(row.amount)));

  if (rows.length === 0) {
    return (
      <div data-superinvestor-accumulation-heatmap className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-xs font-bold text-slate-500">
        누적 매수 heat-map 데이터가 없습니다.
      </div>
    );
  }

  return (
    <div data-superinvestor-accumulation-heatmap className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {rows.map((row) => {
        const investorIntensity = row.investors_count / maxInvestors;
        const amountIntensity = Math.min(1, Math.abs(row.amount) / maxAmount);
        const heat = Math.round(18 + investorIntensity * 34);
        return (
          <TransitionLink
            key={`${row.rank}-${row.ticker}`}
            href={ROUTES.stock(row.ticker)}
            data-superinvestor-accumulation-tile
            data-superinvestor-accumulation-investors={row.investors_count}
            data-superinvestor-accumulation-link
            className="block min-h-[44px] min-w-0 rounded-xl border border-emerald-200 px-3 py-3 transition hover:border-emerald-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            style={{ backgroundColor: `color-mix(in srgb, var(--c-up) ${heat}%, var(--c-panel))` }}
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              <TickerChip ticker={row.ticker} variant="inline" />
              <span className="shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-[9px] font-black tabular-nums text-emerald-700">
                #{row.rank}
              </span>
            </div>
            <p className="mt-1 truncate text-[10px] font-semibold text-slate-700" title={row.name}>{row.name}</p>
            <div className="mt-2 flex items-end justify-between gap-2">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.08em] text-emerald-800">매수 참여</p>
                <p className="orbitron text-lg font-black tabular-nums text-slate-950">{row.investors_count}명</p>
              </div>
              <p className="orbitron text-[11px] font-black tabular-nums text-emerald-800">{fmtUSD(row.amount)}</p>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-white/70">
              <div className="h-1.5 rounded-full bg-emerald-700" style={{ width: `${Math.max(8, amountIntensity * 100)}%` }} />
            </div>
            <p className="mt-1 truncate text-[9px] font-semibold text-slate-600">
              대표 {row.top_investor?.name ?? row.top_investor?.id ?? "—"}
            </p>
          </TransitionLink>
        );
      })}
    </div>
  );
}

function PressurePanel({ title, rows, color, signLabel }: {
  title: string; rows: BuyingPressureRow[]; color: "emerald" | "rose";
  signLabel: (r: BuyingPressureRow) => string;
}) {
  const textColor = color === "emerald" ? "text-[var(--c-up)]" : "text-[var(--c-down)]";
  const barColor = color === "emerald" ? "var(--c-up)" : "var(--c-down)";
  if (rows.length === 0) return <p className="text-xs text-[var(--c-ink-3)]">데이터 없음</p>;
  return (
    <div>
      <h4 className="mb-2 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">{title}</h4>
      <InsightTableScroll label={title}>
        <table className="w-full min-w-[380px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
              <th className="px-2 py-1.5 text-left">티커</th>
              <th className="px-2 py-1.5 text-center">매수/매도</th>
              <th className="px-2 py-1.5 text-left">압력</th>
              <th className="px-2 py-1.5 text-right">순변화액</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ticker} className="border-b border-slate-100 last:border-b-0">
                <td className="px-2 py-1.5">
                  <TickerChip ticker={r.ticker} variant="inline" />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <span className={`text-[10px] font-bold ${textColor}`}>{signLabel(r)}</span>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-full bg-slate-100">
                      <div className="h-2 rounded-full" style={{ width: `${Math.abs(r.pressure) * 100}%`, backgroundColor: barColor }} />
                    </div>
                    <span className="orbitron tabular-nums text-[10px] font-bold text-slate-600">{(Math.abs(r.pressure) * 100).toFixed(0)}%</span>
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span className={`orbitron tabular-nums text-[10px] font-bold ${r.total_value_change >= 0 ? "text-[var(--c-up)]" : "text-[var(--c-down)]"}`}>
                    {fmtUSD(r.total_value_change)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </InsightTableScroll>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card 2: 신규 편입 빅베팅
// ---------------------------------------------------------------------------

function NewPositionsCard({ data }: { data: NewPositionsData }) {
  const rows = useMemo(() => {
    const q = data.metadata.quarter;
    return (data.new_positions ?? [])
      .filter((r) => r.quarter_added === q)
      .sort((a, b) => b.position_value - a.position_value)
      .slice(0, 12);
  }, [data]);

  return (
    <div>
      <InsightTableScroll label="신규 편입 빅베팅">
        <table className="w-full min-w-[400px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
              <th className="px-2 py-1.5 text-left">종목</th>
              <th className="px-2 py-1.5 text-left">투자자</th>
              <th className="px-2 py-1.5 text-right">금액</th>
              <th className="px-2 py-1.5 text-right">비중</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.ticker}-${r.investor}-${i}`} className="border-b border-slate-100 last:border-b-0">
                <td className="px-2 py-1.5">
                  {isTicker(r.ticker) ? (
                    <TickerChip ticker={r.ticker} variant="inline" />
                  ) : (
                    <span className="font-semibold text-slate-700">{r.ticker}</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <span className="text-[10px] font-bold text-slate-600">{r.investor}</span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span className="orbitron tabular-nums text-[10px] font-bold text-slate-900">{fmtUSD(r.position_value)}</span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span className="orbitron tabular-nums text-[10px] font-semibold text-slate-600">{(r.position_weight * 100).toFixed(2)}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </InsightTableScroll>
      {rows.length === 0 ? <p className="text-xs text-[var(--c-ink-3)]">현재 분기 신규 편입 데이터 없음</p> : null}
      <p className="mt-2 text-[10px] font-semibold text-[var(--c-ink-3)]">
        {data.metadata.quarter} 신규 편입 · 총 {data.metadata.new_positions_count}건 ({data.metadata.unique_tickers}종목)
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card 3: 확신 베팅 (TOP5)
// ---------------------------------------------------------------------------

function ConvictionCard({ data }: { data: ConvictionData }) {
  const rows = useMemo(() => {
    const flat: Array<ConvictionPosition & { investor: string }> = [];
    for (const [investor, positions] of Object.entries(data.by_investor ?? {})) {
      for (const p of positions) {
        if (p.is_top5) flat.push({ ...p, investor });
      }
    }
    return flat.sort((a, b) => b.weight - a.weight).slice(0, 12);
  }, [data]);

  return (
    <div>
      <InsightTableScroll label="확신 베팅">
        <table className="w-full min-w-[400px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
              <th className="px-2 py-1.5 text-left">투자자</th>
              <th className="px-2 py-1.5 text-left">티커</th>
              <th className="px-2 py-1.5 text-right">포트 비중</th>
              <th className="px-2 py-1.5 text-right">평가액</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.investor}-${r.ticker}`} className="border-b border-slate-100 last:border-b-0">
                <td className="px-2 py-1.5">
                  <span className="text-[10px] font-bold text-slate-600">{r.investor}</span>
                </td>
                <td className="px-2 py-1.5">
                  <TickerChip ticker={r.ticker} variant="inline" />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span className="orbitron tabular-nums font-bold text-slate-900">{(r.weight * 100).toFixed(1)}%</span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span className="orbitron tabular-nums text-[10px] font-semibold text-slate-600">{fmtUSD(r.market_value)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </InsightTableScroll>
      <p className="mt-2 text-[10px] font-semibold text-[var(--c-ink-3)]">
        {data.metadata.quarter} · 각 투자자 포트폴리오 TOP5 포지션 (비중 기준 정렬, 상위 12개)
      </p>
    </div>
  );
}

function HighConvictionNewCard({ data }: { data: ConvictionEntriesData }) {
  const rows = useMemo(() => {
    return [...(data.high_conviction_new ?? [])]
      .sort((a, b) => b.weight - a.weight || b.value - a.value)
      .slice(0, 12);
  }, [data]);

  return (
    <div>
      <InsightTableScroll label="신규 고확신 편입">
        <table className="w-full min-w-[420px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
              <th className="px-2 py-1.5 text-left">투자자</th>
              <th className="px-2 py-1.5 text-left">종목</th>
              <th className="px-2 py-1.5 text-right">포트 비중</th>
              <th className="px-2 py-1.5 text-right">평가액</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: ConvictionEntry) => (
              <tr key={`${r.investor}-${r.ticker}`} className="border-b border-slate-100 last:border-b-0">
                <td className="px-2 py-1.5">
                  <span className="text-[10px] font-bold text-slate-600">{r.investor}</span>
                </td>
                <td className="px-2 py-1.5">
                  {isTicker(r.ticker) ? (
                    <TickerChip ticker={r.ticker} variant="inline" />
                  ) : (
                    <span className="font-bold text-slate-800">{r.ticker}</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span className="orbitron tabular-nums font-bold text-slate-900">{(r.weight * 100).toFixed(1)}%</span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span className="orbitron tabular-nums text-[10px] font-semibold text-slate-600">{fmtUSD(r.value)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </InsightTableScroll>
      <p className="mt-2 text-[10px] font-semibold text-[var(--c-ink-3)]">
        {data.metadata.quarter} · 새로 편입되면서 바로 큰 비중이 된 포지션 {data.metadata.high_conviction_new_count}건 중 상위 12개
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card 4: 집중도 (HHI)
// ---------------------------------------------------------------------------

function HhiCard({ data }: { data: HhiData }) {
  const rows = useMemo(() => {
    return Object.values(data.by_investor ?? [])
      .sort((a, b) => b.hhi - a.hhi)
      .slice(0, 8);
  }, [data]);

  return (
    <div>
      <InsightTableScroll label="집중도">
        <table className="w-full min-w-[400px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
              <th className="px-2 py-1.5 text-left">투자자</th>
              <th className="px-2 py-1.5 text-right">HHI</th>
              <th className="px-2 py-1.5 text-right">TOP1 비중</th>
              <th className="px-2 py-1.5 text-right">보유수</th>
              <th className="px-2 py-1.5 text-center">분류</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.investor} className="border-b border-slate-100 last:border-b-0">
                <td className="px-2 py-1.5">
                  <span className="text-[10px] font-bold text-slate-600">{r.investor}</span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span className="orbitron tabular-nums font-bold text-slate-900">{r.hhi.toFixed(2)}</span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span className="orbitron tabular-nums text-[10px] font-semibold text-slate-600">{(r.top_weight * 100).toFixed(1)}%</span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span className="orbitron tabular-nums text-[10px] font-semibold text-slate-600">{r.holdings_count}</span>
                </td>
                <td className="px-2 py-1.5 text-center">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${classificationColor(r.classification)}`}>
                    {classificationLabel(r.classification)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </InsightTableScroll>
      <p className="mt-2 text-[10px] font-semibold text-[var(--c-ink-3)]">
        {data.metadata.quarter} · HHI: 0~1, 높을수록 집중 · 집중≥0.25, 보통≥0.15, 분산&lt;0.15
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main InsightsTab
// ---------------------------------------------------------------------------

export default function InsightsTab() {
  const [bp, setBp] = useState<BuyingPressureData | null>(null);
  const [tr, setTr] = useState<TradesRankingData | null>(null);
  const [np, setNp] = useState<NewPositionsData | null>(null);
  const [hhi, setHhi] = useState<HhiData | null>(null);
  const [cv, setCv] = useState<ConvictionData | null>(null);
  const [ce, setCe] = useState<ConvictionEntriesData | null>(null);
  const [pv, setPv] = useState<PortfolioViewsData | null>(null);
  const [fx, setFx] = useState<FactorExposuresSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadBuyingPressure(), loadTradesRanking(), loadNewPositions(), loadHhi(), loadConviction(), loadConvictionEntries(), loadPortfolioViews(), loadFactorExposuresSummary()]).then(([bpR, trR, npR, hhiR, cvR, ceR, pvR, fxR]) => {
      if (cancelled) return;
      const anyData = bpR || trR || npR || hhiR || cvR || ceR || pvR || fxR;
      if (!anyData) { setFailed(true); }
      setBp(bpR); setTr(trR); setNp(npR); setHhi(hhiR); setCv(cvR); setCe(ceR); setPv(pvR); setFx(fxR);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const quarterLabel = bp?.metadata.quarter ?? np?.metadata.quarter ?? hhi?.metadata.quarter ?? ce?.metadata.quarter ?? "";

  if (failed) {
    return (
        <div data-superinvestor-insights-error className="rounded-[1.2rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          기관 공시 인사이트 데이터를 불러오지 못했습니다.
        </div>
    );
  }

  return (
    <section className="space-y-4">
      {/* Header strip */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {quarterLabel ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {quarterLabel} 기준
            </span>
          ) : null}
          <span className="text-[10px] font-bold text-[var(--c-ink-3)]">기관 공시는 분기 종료 후 최대 45일 지연됩니다</span>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <SkeletonCard />
          <div className="grid gap-4 lg:grid-cols-2">
            <SkeletonCard /><SkeletonCard />
          </div>
          <SkeletonCard />
        </div>
      ) : (
        <div className="space-y-4">
          <SuperinvestorInsightsStatus metadata={[tr?.metadata, pv?.metadata, bp?.metadata, np?.metadata, hhi?.metadata, ce?.metadata]} />

          {/* 0. 리스크-수익 분포 */}
          <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)] sm:p-5">
            <h3 className="mb-1 text-sm font-black tracking-tight text-slate-900">리스크-수익 분포</h3>
            <p className="mb-3 text-[10px] font-semibold text-[var(--c-ink-3)]">거장 포트폴리오의 연수익률 대비 연변동성 — SPY와 비교</p>
            {pv ? <RiskReturnScatter data={pv} /> : <UnavailablePanel label="리스크-수익 분포" />}
          </div>

          {/* 0b. 동일기간 누적 수익 오버레이 */}
          <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)] sm:p-5">
            <h3 className="mb-1 text-sm font-black tracking-tight text-slate-900">2021-Q1 기준 누적 수익 (동일기간)</h3>
            <p className="mb-3 text-[10px] font-semibold text-[var(--c-ink-3)]">22개 분기 전체 데이터를 가진 투자자만 대상으로 2021-Q1 기준 100에서 누적 성과 비교</p>
            {pv ? <CumulativeReturnOverlay data={pv} /> : <UnavailablePanel label="동일기간 누적 수익" />}
          </div>

          {/* 0c. Fama-French 파생 팩터 틸트 */}
          <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)] sm:p-5">
            <h3 className="mb-1 text-sm font-black tracking-tight text-slate-900">팩터 틸트 레이더</h3>
            <p className="mb-3 text-[10px] font-semibold text-[var(--c-ink-3)]">FF-derived factor tilt · confidence · coverage · as_of</p>
            {fx ? <FactorExposureRadar data={fx} /> : <UnavailablePanel label="팩터 틸트" />}
          </div>

          {/* 1. 매수 압력 */}
          <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)] sm:p-5">
            <h3 className="mb-1 text-sm font-black tracking-tight text-slate-900">매수 압력</h3>
            <p className="mb-3 text-[10px] font-semibold text-[var(--c-ink-3)]">투자자 간 순매수·순매도 방향성 — 압력 게이지로 강도 측정</p>
            {bp || tr ? <BuyingPressureCard data={bp} trades={tr} /> : <UnavailablePanel label="매수 압력" />}
          </div>

          <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)] sm:p-5">
            <h3 className="mb-1 text-sm font-black tracking-tight text-slate-900">거장 누적 매수 heat-map</h3>
            <p className="mb-3 text-[10px] font-semibold text-[var(--c-ink-3)]">매수 참여 투자자 수로 정렬한 종목 heat-map — 진할수록 더 많은 투자자가 같은 분기에 매수</p>
            {tr ? <AccumulationHeatmap trades={tr} /> : <UnavailablePanel label="거장 누적 매수 heat-map" />}
            <p className="mt-2 text-[10px] font-semibold text-[var(--c-ink-3)]">
              {tr?.metadata.quarter ?? quarterLabel} 기준 · 순매수 금액은 막대 길이, 참여 투자자 수는 타일 진하기로 표시합니다.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* 2. 신규 편입 빅베팅 */}
            <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)] sm:p-5">
              <h3 className="mb-1 text-sm font-black tracking-tight text-slate-900">신규 편입 빅베팅</h3>
              <p className="mb-3 text-[10px] font-semibold text-[var(--c-ink-3)]">이번 분기 처음 포트폴리오에 편입된 종목 (금액순)</p>
              {np ? <NewPositionsCard data={np} /> : <UnavailablePanel label="신규 편입 빅베팅" />}
            </div>

            <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)] sm:p-5">
              <h3 className="mb-1 text-sm font-black tracking-tight text-slate-900">고확신 신규 편입</h3>
              <p className="mb-3 text-[10px] font-semibold text-[var(--c-ink-3)]">새 종목인데 곧바로 큰 포트폴리오 비중을 차지한 포지션</p>
              {ce ? <HighConvictionNewCard data={ce} /> : <UnavailablePanel label="고확신 신규 편입" />}
            </div>

            {/* 3. 확신 베팅 */}
            <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)] sm:p-5">
              <h3 className="mb-1 text-sm font-black tracking-tight text-slate-900">확신 베팅 (TOP5)</h3>
              <p className="mb-3 text-[10px] font-semibold text-[var(--c-ink-3)]">각 투자자 포트폴리오에서 비중이 가장 높은 TOP5 포지션</p>
              {cv ? <ConvictionCard data={cv} /> : <UnavailablePanel label="확신 베팅" />}
            </div>
          </div>

          {/* 4. 집중도 */}
          <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)] sm:p-5">
            <h3 className="mb-1 text-sm font-black tracking-tight text-slate-900">집중도 (HHI)</h3>
            <p className="mb-3 text-[10px] font-semibold text-[var(--c-ink-3)]">포트폴리오 집중도 — HHI가 높을수록 소수 종목에 집중 투자</p>
            {hhi ? <HhiCard data={hhi} /> : <UnavailablePanel label="집중도" />}
          </div>
        </div>
      )}
    </section>
  );
}
