"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import TickerChip from "@/components/TickerChip";
import type {
  BuyingPressureData,
  NewPositionsData,
  HhiData,
  ConvictionData,
  ConvictionEntriesData,
  ConvictionEntry,
  BuyingPressureRow,
  ConvictionPosition,
  TradesRankingData,
  PortfolioViewsData,
} from "@/lib/superinvestors/types";
import { loadPortfolioViews, RiskReturnScatter } from "./PortfolioCharts";

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
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadBuyingPressure(), loadTradesRanking(), loadNewPositions(), loadHhi(), loadConviction(), loadConvictionEntries(), loadPortfolioViews()]).then(([bpR, trR, npR, hhiR, cvR, ceR, pvR]) => {
      if (cancelled) return;
      const anyData = bpR || trR || npR || hhiR || cvR || ceR || pvR;
      if (!anyData) { setFailed(true); }
      setBp(bpR); setTr(trR); setNp(npR); setHhi(hhiR); setCv(cvR); setCe(ceR); setPv(pvR);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const quarterLabel = bp?.metadata.quarter ?? np?.metadata.quarter ?? hhi?.metadata.quarter ?? ce?.metadata.quarter ?? "";

  if (failed) {
    return (
        <div className="rounded-[1.2rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
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
          {/* 0. 리스크-수익 분포 */}
          <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)] sm:p-5">
            <h3 className="mb-1 text-sm font-black tracking-tight text-slate-900">리스크-수익 분포</h3>
            <p className="mb-3 text-[10px] font-semibold text-[var(--c-ink-3)]">거장 포트폴리오의 연수익률 대비 연변동성 — SPY와 비교</p>
            {pv ? <RiskReturnScatter data={pv} /> : <SkeletonCard />}
          </div>

          {/* 1. 매수 압력 */}
          <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)] sm:p-5">
            <h3 className="mb-1 text-sm font-black tracking-tight text-slate-900">매수 압력</h3>
            <p className="mb-3 text-[10px] font-semibold text-[var(--c-ink-3)]">투자자 간 순매수·순매도 방향성 — 압력 게이지로 강도 측정</p>
            {bp || tr ? <BuyingPressureCard data={bp} trades={tr} /> : <SkeletonCard />}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* 2. 신규 편입 빅베팅 */}
            <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)] sm:p-5">
              <h3 className="mb-1 text-sm font-black tracking-tight text-slate-900">신규 편입 빅베팅</h3>
              <p className="mb-3 text-[10px] font-semibold text-[var(--c-ink-3)]">이번 분기 처음 포트폴리오에 편입된 종목 (금액순)</p>
              {np ? <NewPositionsCard data={np} /> : <SkeletonCard />}
            </div>

            <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)] sm:p-5">
              <h3 className="mb-1 text-sm font-black tracking-tight text-slate-900">고확신 신규 편입</h3>
              <p className="mb-3 text-[10px] font-semibold text-[var(--c-ink-3)]">새 종목인데 곧바로 큰 포트폴리오 비중을 차지한 포지션</p>
              {ce ? <HighConvictionNewCard data={ce} /> : <SkeletonCard />}
            </div>

            {/* 3. 확신 베팅 */}
            <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)] sm:p-5">
              <h3 className="mb-1 text-sm font-black tracking-tight text-slate-900">확신 베팅 (TOP5)</h3>
              <p className="mb-3 text-[10px] font-semibold text-[var(--c-ink-3)]">각 투자자 포트폴리오에서 비중이 가장 높은 TOP5 포지션</p>
              {cv ? <ConvictionCard data={cv} /> : <SkeletonCard />}
            </div>
          </div>

          {/* 4. 집중도 */}
          <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)] sm:p-5">
            <h3 className="mb-1 text-sm font-black tracking-tight text-slate-900">집중도 (HHI)</h3>
            <p className="mb-3 text-[10px] font-semibold text-[var(--c-ink-3)]">포트폴리오 집중도 — HHI가 높을수록 소수 종목에 집중 투자</p>
            {hhi ? <HhiCard data={hhi} /> : <SkeletonCard />}
          </div>
        </div>
      )}
    </section>
  );
}
