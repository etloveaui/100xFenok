"use client";

import { useEffect, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import WatchStar from "@/components/WatchStar";
import { formatSignedPercent } from "@/lib/format";
import TickerSurfaceEventsCard from "@/app/stock/[ticker]/TickerSurfaceEventsCard";

type MaybeNumber = number | null | undefined;

interface EtfHolding {
  rank?: number | null;
  symbol?: string | null;
  name?: string | null;
  weight_pct?: number | null;
  shares?: number | string | null;
}

interface WeightedRow {
  key?: string | null;
  n?: string | null;
  country?: string | null;
  code?: string | null;
  value?: number | null;
  w?: number | null;
  weight?: number | null;
}

interface HistoryPoint {
  t?: string | null;
  o?: number | null;
  h?: number | null;
  l?: number | null;
  c?: number | null;
  v?: number | null;
  ch?: number | null;
}

interface EtfPayload {
  ticker?: string;
  asset_type?: string;
  fetched_at?: string;
  detail_status?: string;
  normalized?: {
    holdings?: EtfHolding[];
    asset_allocation?: WeightedRow[] | null;
    sectors?: WeightedRow[] | null;
    countries?: WeightedRow[] | null;
    holding_count?: number | null;
    holdings_updated?: string | null;
    overview?: Record<string, unknown> | null;
    quote?: Record<string, unknown> | null;
    history?: HistoryPoint[];
  };
}

interface MarketFact {
  value?: unknown;
  source?: string;
  as_of?: string | null;
  fetched_at?: string | null;
  unit?: string;
}

interface MarketFactsPayload {
  ticker?: string;
  asset_type?: string;
  generated_at?: string;
  identity?: {
    name?: string | null;
    exchange?: string | null;
    currency?: string | null;
    fund_family?: string | null;
    category?: string | null;
  };
  facts?: Record<string, MarketFact>;
  etf?: {
    holdings_count?: number | null;
    holdings_updated?: string | null;
    top_holdings?: EtfHolding[];
    asset_allocation?: WeightedRow[];
    sectors?: WeightedRow[];
    countries?: WeightedRow[];
    classification?: {
      is_leveraged?: boolean;
      leverage_factor?: number | null;
      is_inverse?: boolean;
      is_single_stock?: boolean;
      underlying?: string | null;
    } | null;
  } | null;
}

type EtfClassification = NonNullable<NonNullable<MarketFactsPayload["etf"]>["classification"]>;

const etfCache: Record<string, Promise<EtfPayload | null> | EtfPayload | null> = {};
const factsCache: Record<string, Promise<MarketFactsPayload | null> | MarketFactsPayload | null> = {};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function cleanSymbol(value: string) {
  return value.trim().toUpperCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function loadEtfPayload(ticker: string): Promise<EtfPayload | null> {
  const symbol = cleanSymbol(ticker);
  if (!symbol) return Promise.resolve(null);
  const cached = etfCache[symbol];
  if (cached instanceof Promise) return cached;
  if (cached !== undefined) return Promise.resolve(cached);

  const request = fetch(`/api/data/stockanalysis/etfs/${encodeURIComponent(symbol)}`, { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((payload) => {
      const parsed = asRecord(payload) ? payload as EtfPayload : null;
      etfCache[symbol] = parsed;
      return parsed;
    })
    .catch(() => {
      etfCache[symbol] = null;
      return null;
    });
  etfCache[symbol] = request;
  return request;
}

function loadMarketFacts(ticker: string): Promise<MarketFactsPayload | null> {
  const symbol = cleanSymbol(ticker);
  if (!symbol) return Promise.resolve(null);
  const cached = factsCache[symbol];
  if (cached instanceof Promise) return cached;
  if (cached !== undefined) return Promise.resolve(cached);

  const request = fetch(`/data/computed/market_facts/tickers/${encodeURIComponent(symbol)}.json`, { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((payload) => {
      const parsed = asRecord(payload) ? payload as MarketFactsPayload : null;
      factsCache[symbol] = parsed;
      return parsed;
    })
    .catch(() => {
      factsCache[symbol] = null;
      return null;
    });
  factsCache[symbol] = request;
  return request;
}

function factNumber(facts: MarketFactsPayload | null | undefined, key: string): number | null {
  const value = facts?.facts?.[key]?.value;
  return isFiniteNumber(value) ? value : null;
}

function factDate(facts: MarketFactsPayload | null | undefined, key: string): string | null {
  const fact = facts?.facts?.[key];
  return fact?.as_of ?? fact?.fetched_at ?? null;
}

function rawText(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (isFiniteNumber(value)) return value.toLocaleString("ko-KR");
  return "—";
}

function fmtDateish(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "—";
  return value.trim();
}

function formatMoney(value: MaybeNumber, currency: string) {
  if (!isFiniteNumber(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
  }).format(value);
}

function formatCompactMoney(value: MaybeNumber, currency: string) {
  if (!isFiniteNumber(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function fmtPercentPoints(value: MaybeNumber) {
  if (!isFiniteNumber(value)) return "—";
  const abs = Math.abs(value);
  return `${value.toFixed(abs >= 100 ? 1 : 2)}%`;
}

function fmtSignedPercentPoints(value: MaybeNumber) {
  return isFiniteNumber(value) ? formatSignedPercent(value, { digits: 2, fraction: false }) : "—";
}

function fmtShares(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!isFiniteNumber(value)) return "—";
  return value.toLocaleString("ko-KR", { maximumFractionDigits: value >= 1000 ? 0 : 2 });
}

function metricValue(value: unknown, fallback: unknown = null) {
  const primary = rawText(value);
  return primary !== "—" ? primary : rawText(fallback);
}

function weightedRowName(row: WeightedRow): string {
  return row.key ?? row.n ?? row.country ?? row.code ?? "—";
}

function weightedRowValue(row: WeightedRow): number | null {
  if (isFiniteNumber(row.value)) return row.value;
  if (isFiniteNumber(row.w)) return row.w;
  if (isFiniteNumber(row.weight)) return row.weight;
  return null;
}

function detailStatusText(status: string | null) {
  if (status === "surface_only" || status === "universe_only") return "요약 정보 우선 표시 중입니다. 보유 구성은 데이터 갱신 시 자동으로 보강됩니다.";
  if (status === "yf_fallback") return "가격 정보 우선 표시 중입니다. 보유·분류 지표는 데이터 갱신 시 자동으로 보강됩니다.";
  return null;
}

function classificationLabels(classification: EtfClassification | null | undefined) {
  if (!classification) return [];
  const labels: string[] = [];
  if (classification.is_leveraged) {
    labels.push(isFiniteNumber(classification.leverage_factor) ? `${classification.leverage_factor}x 레버리지` : "레버리지");
  }
  if (classification.is_inverse) labels.push("인버스");
  if (classification.is_single_stock) labels.push("단일종목");
  if (classification.underlying) labels.push(`기초 ${classification.underlying}`);
  return labels;
}

function SectionCard({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="panel stock-section">
      <div className="panel-h">
        <h2>{title}</h2>
        {desc ? <span className="desc">{desc}</span> : null}
      </div>
      <div className="panel-b">{children}</div>
    </section>
  );
}

function SkeletonSection() {
  return (
    <div className="panel stock-section">
      <div className="panel-b">
        <div className="h-5 w-1/3 rounded bg-slate-200" />
        <div className="mt-3 h-32 rounded bg-slate-200" />
      </div>
    </div>
  );
}

function MetricCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/70 px-3 py-3">
      <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="orbitron mt-1 min-w-0 break-words text-base font-black tabular-nums text-slate-950">{value}</p>
      {note && note !== "—" ? <p className="mt-1 min-w-0 break-words text-[10px] font-semibold text-slate-400">{note}</p> : null}
    </div>
  );
}

function HoldingsTable({ holdings, currency }: { holdings: EtfHolding[]; currency: string }) {
  if (!holdings.length) {
    return <p className="text-sm font-semibold text-slate-400">보유 구성 데이터 없음</p>;
  }
  return (
    <div className="-mx-1 max-h-[560px] overflow-auto px-1">
      <table className="w-full min-w-[620px] text-xs">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
            <th className="px-2 py-2 text-right">#</th>
            <th className="px-2 py-2 text-left">종목/계약</th>
            <th className="px-2 py-2 text-left">티커</th>
            <th className="px-2 py-2 text-right">비중</th>
            <th className="px-2 py-2 text-right">수량</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((item, index) => {
            const weight = isFiniteNumber(item.weight_pct) ? item.weight_pct : null;
            const weightClass = weight !== null && weight < 0 ? "text-rose-600" : "text-slate-900";
            return (
              <tr key={`${item.rank ?? index}-${item.symbol ?? ""}-${item.name ?? ""}`} className="border-b border-slate-100 last:border-b-0">
                <td className="px-2 py-2 text-right orbitron tabular-nums text-[11px] font-bold text-slate-400">{item.rank ?? index + 1}</td>
                <td className="px-2 py-2 font-bold text-slate-800">{item.name ?? "—"}</td>
                <td className="px-2 py-2 orbitron tabular-nums text-[11px] font-black text-slate-500">{item.symbol ?? "—"}</td>
                <td className={`px-2 py-2 text-right orbitron tabular-nums text-xs font-black ${weightClass}`}>{fmtPercentPoints(weight)}</td>
                <td className="px-2 py-2 text-right orbitron tabular-nums text-[11px] font-semibold text-slate-600">{fmtShares(item.shares)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {currency ? <p className="mt-2 text-[10px] font-semibold text-slate-400">표시 통화: {currency}</p> : null}
    </div>
  );
}

function WeightedList({ rows, empty }: { rows: WeightedRow[] | null | undefined; empty: string }) {
  const items = Array.isArray(rows) ? rows.filter((row) => weightedRowValue(row) !== null) : [];
  if (!items.length) return <p className="text-sm font-semibold text-slate-400">{empty}</p>;
  return (
    <div className="space-y-2">
      {items.map((row, index) => {
        const value = weightedRowValue(row) ?? 0;
        const width = Math.min(100, Math.abs(value));
        return (
          <div key={`${weightedRowName(row)}-${index}`}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate font-bold text-slate-700">{weightedRowName(row)}</span>
              <span className={`orbitron tabular-nums font-black ${value < 0 ? "text-rose-600" : "text-slate-900"}`}>{fmtPercentPoints(value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-2 rounded-full ${value < 0 ? "bg-rose-400" : "bg-brand-interactive"}`} style={{ width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HistoryView({ history, currency }: { history: HistoryPoint[]; currency: string }) {
  const rows = history.filter((point) => isFiniteNumber(point.c));
  if (!rows.length) return <p className="text-sm font-semibold text-slate-400">가격 히스토리 없음</p>;
  const chronological = [...rows].reverse();
  const closes = chronological.map((point) => point.c).filter(isFiniteNumber);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
      <div className="flex h-40 items-end gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
        {chronological.map((point, index) => {
          const close = isFiniteNumber(point.c) ? point.c : min;
          const height = 10 + ((close - min) / range) * 90;
          const up = isFiniteNumber(point.ch) ? point.ch >= 0 : true;
          return (
            <div key={`${point.t ?? "month"}-${index}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${point.t}: ${formatMoney(close, currency)}`}>
              <div className={`w-full rounded-t ${up ? "bg-emerald-400" : "bg-rose-400"}`} style={{ height: `${height}%` }} />
              <span className="hidden max-w-full truncate text-[9px] font-bold text-slate-400 sm:block">{(point.t ?? "").slice(5, 7)}</span>
            </div>
          );
        })}
      </div>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[360px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
              <th className="px-2 py-2 text-left">월</th>
              <th className="px-2 py-2 text-right">종가</th>
              <th className="px-2 py-2 text-right">변화</th>
              <th className="px-2 py-2 text-right">거래량</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((point, index) => (
              <tr key={`${point.t ?? "row"}-${index}`} className="border-b border-slate-100 last:border-b-0">
                <td className="px-2 py-2 font-bold text-slate-700">{point.t ?? "—"}</td>
                <td className="px-2 py-2 text-right orbitron tabular-nums font-black text-slate-900">{formatMoney(point.c, currency)}</td>
                <td className={`px-2 py-2 text-right orbitron tabular-nums font-black ${isFiniteNumber(point.ch) && point.ch < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmtSignedPercentPoints(point.ch)}</td>
                <td className="px-2 py-2 text-right orbitron tabular-nums font-semibold text-slate-500">{fmtShares(point.v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function EtfDetailClient({ ticker }: { ticker: string }) {
  const symbol = cleanSymbol(ticker);
  const [state, setState] = useState<{
    symbol: string;
    etfData: EtfPayload | null | undefined;
    marketFacts: MarketFactsPayload | null | undefined;
  }>({ symbol, etfData: undefined, marketFacts: undefined });

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadEtfPayload(symbol), loadMarketFacts(symbol)]).then(([nextEtf, nextFacts]) => {
      if (!cancelled) {
        setState({ symbol, etfData: nextEtf, marketFacts: nextFacts });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const etfData = state.symbol === symbol ? state.etfData : undefined;
  const marketFacts = state.symbol === symbol ? state.marketFacts : undefined;
  const loading = etfData === undefined || marketFacts === undefined;
  const normalized = etfData?.normalized ?? {};
  const overview = normalized.overview ?? {};
  const quote = normalized.quote ?? {};
  const identity = marketFacts?.identity ?? {};
  const currency = identity.currency ?? "USD";
  const price = factNumber(marketFacts, "price") ?? (isFiniteNumber(quote.p) ? quote.p : null);
  const changePct = factNumber(marketFacts, "change_pct") ?? (isFiniteNumber(quote.cp) ? quote.cp : null);
  const displayName = identity.name && identity.name !== symbol ? identity.name : metricValue(overview.name, symbol);
  const category = identity.category ?? metricValue(overview.category);
  const exchange = identity.exchange ?? metricValue(quote.ex);
  const provider = identity.fund_family ?? metricValue(overview.provider ?? overview.issuer);
  const holdingsFromFacts = Array.isArray(marketFacts?.etf?.top_holdings) ? marketFacts.etf.top_holdings : [];
  const holdings = Array.isArray(normalized.holdings) && normalized.holdings.length > 0 ? normalized.holdings : holdingsFromFacts;
  const holdingCount = isFiniteNumber(normalized.holding_count)
    ? normalized.holding_count
    : isFiniteNumber(marketFacts?.etf?.holdings_count)
      ? marketFacts.etf.holdings_count
      : holdings.length;
  const holdingsUpdated = normalized.holdings_updated ?? marketFacts?.etf?.holdings_updated ?? null;
  const totalWeight = holdings.reduce((sum, item) => sum + (isFiniteNumber(item.weight_pct) ? item.weight_pct : 0), 0);
  const assetAllocation = normalized.asset_allocation ?? marketFacts?.etf?.asset_allocation ?? null;
  const sectors = normalized.sectors ?? marketFacts?.etf?.sectors ?? null;
  const countries = normalized.countries ?? marketFacts?.etf?.countries ?? null;
  const history = Array.isArray(normalized.history) ? normalized.history : [];
  const statusText = detailStatusText(etfData?.detail_status ?? null);
  const classification = marketFacts?.etf?.classification ?? null;
  const labels = classificationLabels(classification);
  const website = typeof overview.etf_website === "string" && overview.etf_website.trim() ? overview.etf_website.trim() : null;
  const updateDate = factDate(marketFacts, "price") ?? rawText(quote.u) ?? etfData?.fetched_at ?? marketFacts?.generated_at;

  const totalAssets = factNumber(marketFacts, "total_assets");
  const expenseRatio = factNumber(marketFacts, "expense_ratio");
  const dividendYield = factNumber(marketFacts, "dividend_yield");
  const beta = factNumber(marketFacts, "beta");
  const trailingPe = factNumber(marketFacts, "trailing_pe");
  const metrics = [
    { label: "가격", value: formatMoney(price, currency), note: fmtDateish(updateDate) },
    { label: "당일 변화", value: fmtSignedPercentPoints(changePct), note: metricValue(quote.ex, exchange) },
    { label: "운용자산", value: totalAssets !== null ? formatCompactMoney(totalAssets, currency) : rawText(overview.aum), note: "총 운용자산" },
    { label: "보수율", value: expenseRatio !== null ? fmtPercentPoints(expenseRatio) : rawText(overview.expenseRatio), note: "총보수" },
    { label: "배당률", value: dividendYield !== null ? fmtPercentPoints(dividendYield) : rawText(overview.dividendYield), note: "분배금 기준" },
    { label: "베타", value: beta !== null ? beta.toFixed(2) : rawText(overview.beta), note: "시장 민감도" },
    { label: "NAV", value: rawText(overview.nav), note: "순자산가치" },
    { label: "PER", value: trailingPe !== null ? trailingPe.toFixed(1) : rawText(overview.peRatio), note: "최근 실적 기준" },
    { label: "52주 고가", value: isFiniteNumber(quote.h52) ? formatMoney(quote.h52, currency) : "—", note: "최근 52주 고점" },
    { label: "52주 저가", value: isFiniteNumber(quote.l52) ? formatMoney(quote.l52, currency) : "—", note: "최근 52주 저점" },
    { label: "보유 항목", value: `${holdings.length.toLocaleString("ko-KR")} / ${holdingCount.toLocaleString("ko-KR")}`, note: fmtDateish(holdingsUpdated) },
    { label: "표시 비중 합계", value: holdings.length > 0 ? fmtPercentPoints(totalWeight) : "—", note: "표시 항목 기준" },
  ].filter((metric) => metric.value !== "—");

  if (loading) {
    return (
      <div className="stock-shell">
        <section className="stock-entity panel">
          <div className="stock-entity-in">
            <span className="stock-logo">{symbol.slice(0, 1)}</span>
            <div className="stock-id">
              <div className="stock-name"><h1>{symbol}</h1></div>
              <div className="stock-meta"><span>ETF 정보 확인 중</span></div>
            </div>
          </div>
        </section>
        <SkeletonSection />
        <SkeletonSection />
      </div>
    );
  }

  if (!etfData && !marketFacts) {
    return (
      <div className="stock-shell">
        <div className="panel stock-empty">
          <p className="text-lg font-black text-slate-700">ETF 정보 연결 전</p>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            {symbol} — 목록에는 잡혔지만 보유 구성과 가격 정보가 아직 충분히 연결되지 않았습니다.
          </p>
          <TransitionLink href="/etfs" className="mt-4 inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive">← ETF 목록에서 보기</TransitionLink>
        </div>
      </div>
    );
  }

  return (
    <div className="stock-shell">
      <section className="stock-entity panel">
        <div className="stock-entity-in">
          <span className="stock-logo">{symbol.slice(0, 1)}</span>
          <div className="stock-id">
            <div className="stock-name">
              <h1>{displayName}</h1>
              <WatchStar ticker={symbol} className="stock-star" />
            </div>
            <div className="stock-meta">
              <span className="num">{symbol}</span>
              <span className="x">·</span>
              <span>ETF</span>
              {exchange !== "—" ? <><span className="x">·</span><span>{exchange}</span></> : null}
              {category !== "—" ? <><span className="x">·</span><span>{category}</span></> : null}
              {provider !== "—" ? <><span className="x">·</span><span>{provider}</span></> : null}
            </div>
            {labels.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {labels.map((label) => (
                  <span key={label} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-600">{label}</span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="stock-price">
            <span className="big num">{formatMoney(price, currency)}</span>
            {changePct !== null ? <span className={`stock-chip num ${changePct >= 0 ? "up" : "down"}`}>{fmtSignedPercentPoints(changePct)}</span> : null}
            <span className="delay">{fmtDateish(updateDate)}</span>
          </div>
        </div>
      </section>

      <div className="stock-body">
        <div className="stock-summary-stack">
          <TickerSurfaceEventsCard ticker={symbol} assetKind="etf" compact />
        </div>

        <div className="stock-main-stack">
          <SectionCard title="ETF 핵심 지표" desc="가격·비용·분류">
            {statusText ? (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-black text-amber-800">
                {statusText}
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => (
                <MetricCard key={`${metric.label}-${metric.value}`} label={metric.label} value={metric.value} note={metric.note} />
              ))}
            </div>
            {website ? (
              <a
                href={website}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-slate-50 px-3 text-[10px] font-black uppercase tracking-[0.08em] text-slate-600 transition hover:border-brand-interactive hover:bg-white hover:text-brand-interactive"
              >
                운용사 웹사이트
              </a>
            ) : null}
          </SectionCard>

          <SectionCard title="보유·스왑 구성" desc={`${symbol} · ${holdings.length.toLocaleString("ko-KR")}개 표시`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
              <span>{holdingCount.toLocaleString("ko-KR")}개 원장 중 표시 가능한 항목</span>
              <span>{fmtDateish(holdingsUpdated) !== "—" ? `기준 ${fmtDateish(holdingsUpdated)}` : "기준일 미표시"}</span>
            </div>
            <HoldingsTable holdings={holdings} currency={currency} />
          </SectionCard>

          <div className="grid gap-4 lg:grid-cols-3">
            <SectionCard title="자산 분해">
              <WeightedList rows={assetAllocation} empty="자산 분해 데이터 없음" />
            </SectionCard>
            <SectionCard title="섹터 분해">
              <WeightedList rows={sectors} empty="섹터 데이터 없음" />
            </SectionCard>
            <SectionCard title="국가 분해">
              <WeightedList rows={countries} empty="국가 데이터 없음" />
            </SectionCard>
          </div>

          <SectionCard title="가격 히스토리" desc="월간 종가">
            <HistoryView history={history} currency={currency} />
          </SectionCard>

          <footer className="stock-footer">
            <TransitionLink href="/etfs" className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">← ETF 목록에서 보기</TransitionLink>
            <TransitionLink href={`/portfolio?ticker=${encodeURIComponent(symbol)}`} className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 hover:text-brand-interactive">포트폴리오에서 보기</TransitionLink>
          </footer>
        </div>
      </div>
    </div>
  );
}
