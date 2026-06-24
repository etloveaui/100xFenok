"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import DataStateNotice, { DataStateBadge } from "@/components/DataStateNotice";
import MarketQuickLinks from "@/components/market/MarketQuickLinks";
import { StaticStockAnalyzerDataProvider } from "@/features/stock-analyzer/data/static-data-provider";
import { makeDataState } from "@/lib/data-state";
import {
  getStockConnection,
  getStockServices,
  loadStockConnectionIndex,
  loadStockServicesIndex,
  stockConnectionCount,
  type StockConnectionEntry,
  type StockConnectionIndex,
  type StockServiceEtfLink,
  type StockServicesEntry,
  type StockServicesIndex,
} from "@/lib/data-entity-graph/stock-index";
import { stockConnectionFreshnessState } from "@/lib/data-entity-graph/freshness";
import {
  usePortfolios,
  savePortfolios,
  SAMPLE_PORTFOLIO,
  type Portfolio,
  type Holding,
} from "@/lib/portfolio";
import { formatSignedPercent } from "@/lib/format";

interface PriceDoc {
  data?: { info?: { currentPrice?: number | null } };
}

const priceCache = new Map<string, number | null>();
const pricePending = new Map<string, Promise<number | null>>();
const analyzerProvider = new StaticStockAnalyzerDataProvider();

function normalizeTicker(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

async function fetchPrice(ticker: string): Promise<number | null> {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) return null;
  if (priceCache.has(symbol)) return priceCache.get(symbol)!;
  if (pricePending.has(symbol)) return pricePending.get(symbol)!;

  const p = (async () => {
    try {
      const row = await analyzerProvider.getBySymbol(symbol);
      if (typeof row?.price === "number" && Number.isFinite(row.price)) {
        priceCache.set(symbol, row.price);
        return row.price;
      }
    } catch {
      // fall through
    }
    try {
      const r2 = await fetch(`/data/yf/finance/${encodeURIComponent(symbol)}.json`);
      if (r2.ok) {
        const doc: PriceDoc = await r2.json();
        const price = doc.data?.info?.currentPrice;
        if (typeof price === "number" && Number.isFinite(price)) {
          priceCache.set(symbol, price);
          return price;
        }
      }
    } catch {
      // fall through
    }
    priceCache.set(symbol, null);
    return null;
  })();

  pricePending.set(symbol, p);
  return p;
}

function fmt$(v: number): string {
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(v: number): string {
  return formatSignedPercent(v, { digits: 2 });
}

function gainColor(v: number): string {
  if (v > 0) return "text-emerald-700";
  if (v < 0) return "text-rose-700";
  return "text-slate-500";
}

let idCounter = 0;
function newId(): string {
  return `p-${Date.now()}-${++idCounter}`;
}

export default function PortfolioClient({ initialTicker = "" }: { initialTicker?: string }) {
  const portfolios = usePortfolios();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [prices, setPrices] = useState<Map<string, number | null>>(new Map());
  const [connectionIndex, setConnectionIndex] = useState<StockConnectionIndex | null | undefined>(undefined);
  const [servicesIndex, setServicesIndex] = useState<StockServicesIndex | null | undefined>(undefined);
  const [exportText, setExportText] = useState("");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [newTicker, setNewTicker] = useState("");
  const [newShares, setNewShares] = useState("");
  const [newCost, setNewCost] = useState("");
  const [cashInput, setCashInput] = useState("");
  const [editingCash, setEditingCash] = useState(false);
  const cashRef = useRef<HTMLInputElement>(null);
  const appliedInitialTickerRef = useRef("");

  const active = useMemo(
    () => portfolios.find((p) => p.id === activeId) ?? portfolios[0] ?? null,
    [portfolios, activeId],
  );

  const isSample = active?.id === "sample";

  useEffect(() => {
    const normalized = normalizeTicker(initialTicker);
    if (!normalized || appliedInitialTickerRef.current === normalized) return;
    appliedInitialTickerRef.current = normalized;
    setNewTicker(normalized);
  }, [initialTicker]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    void Promise.all([
      loadStockConnectionIndex(controller.signal),
      loadStockServicesIndex(controller.signal),
    ]).then(([stockIndex, stockServices]) => {
      if (cancelled) return;
      setConnectionIndex(stockIndex);
      setServicesIndex(stockServices);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (active && !editingCash) setCashInput(String(active.cash));
  }, [active, editingCash]);

  const tickers = useMemo(
    () => (active ? [...new Set(active.holdings.map((h) => h.ticker.trim().toUpperCase()).filter(Boolean))] : []),
    [active],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const entries = await Promise.all(
        tickers.map(async (t) => {
          const price = await fetchPrice(t);
          return [t, price] as const;
        }),
      );
      if (!cancelled) {
        setPrices((prev) => {
          const next = new Map(prev);
          for (const [t, p] of entries) next.set(t, p);
          return next;
        });
      }
    }
    if (tickers.length > 0) load();
    return () => {
      cancelled = true;
    };
  }, [tickers]);

  const { totalValue, totalGain, totalGainPct, missingCount } = useMemo(() => {
    if (!active) return { totalValue: 0, totalGain: 0, totalGainPct: 0, missingCount: 0 };
    let value = 0;
    let cost = 0;
    let missing = 0;
    for (const h of active.holdings) {
      const price = prices.get(h.ticker.trim().toUpperCase());
      if (price == null) {
        missing++;
        continue;
      }
      value += h.shares * price;
      cost += h.shares * h.avg_cost;
    }
    const gain = value - cost;
    const pct = cost > 0 ? gain / cost : 0;
    return { totalValue: value, totalGain: gain, totalGainPct: pct, missingCount: missing };
  }, [active, prices]);

  const grandTotal = totalValue + (active?.cash ?? 0);
  const priceState = useMemo(() => {
    if (!active) {
      return makeDataState({
        status: "unavailable",
        label: "포트폴리오 없음",
        detail: "보유 종목을 만들면 로컬 데이터 캐시 기준으로 평가액을 계산합니다.",
      });
    }
    if (active.holdings.length === 0) {
      return makeDataState({
        status: "ready",
        label: "입력 대기",
        detail: "보유 종목을 추가하면 가격 확인을 시작합니다.",
      });
    }
    if (missingCount === 0) {
      return makeDataState({
        status: "ready",
        label: "가격 확인 완료",
        detail: `${active.holdings.length}개 보유 종목이 모두 평가액에 반영됐습니다.`,
      });
    }
    const priced = Math.max(active.holdings.length - missingCount, 0);
    return makeDataState({
      status: priced > 0 ? "partial" : "unavailable",
      label: priced > 0 ? "일부 가격 확인" : "가격 확인 불가",
      detail: `${priced}/${active.holdings.length}개 보유 종목만 평가액에 반영됐습니다. 확인 불가 종목은 합계에서 제외합니다.`,
      reason: "로컬 데이터 캐시에 현재가가 없거나 읽지 못했습니다.",
    });
  }, [active, missingCount]);

  function handleCreateEmpty() {
    const doc: Portfolio = {
      id: newId(),
      name: "내 포트폴리오",
      currency: "USD",
      cash: 0,
      holdings: [],
    };
    const next = [...portfolios, doc];
    savePortfolios(next);
    setActiveId(doc.id);
  }

  function handleDeleteHolding(ticker: string) {
    if (!active) return;
    const next = portfolios.map((p) =>
      p.id === active.id
        ? { ...p, holdings: p.holdings.filter((h) => h.ticker !== ticker) }
        : p,
    );
    savePortfolios(next);
  }

  function handleAddHolding() {
    if (!active) return;
    const t = newTicker.trim().toUpperCase();
    const s = parseFloat(newShares);
    const c = parseFloat(newCost);
    if (!t || isNaN(s) || s <= 0 || isNaN(c) || c < 0) return;
    const existing = active.holdings.find((h) => h.ticker === t);
    let holdings: Holding[];
    if (existing) {
      const totalShares = existing.shares + s;
      const avgCost = (existing.shares * existing.avg_cost + s * c) / totalShares;
      holdings = active.holdings.map((h) =>
        h.ticker === t ? { ...h, shares: totalShares, avg_cost: avgCost } : h,
      );
    } else {
      holdings = [...active.holdings, { ticker: t, shares: s, avg_cost: c }];
    }
    const next = portfolios.map((p) => (p.id === active.id ? { ...p, holdings } : p));
    savePortfolios(next);
    setNewTicker("");
    setNewShares("");
    setNewCost("");
  }

  function handleCashSave() {
    if (!active) return;
    const v = parseFloat(cashInput);
    if (isNaN(v) || v < 0) return;
    const next = portfolios.map((p) => (p.id === active.id ? { ...p, cash: v } : p));
    savePortfolios(next);
    setEditingCash(false);
  }

  function handleExport() {
    if (!active) return;
    setExportText(JSON.stringify(active, null, 2));
  }

  function handleImport() {
    setImportError(null);
    try {
      const parsed = JSON.parse(importText);
      let doc: Portfolio;
      if (parsed.portfolios && typeof parsed.portfolios === "object" && !Array.isArray(parsed.portfolios)) {
        const entries = Object.entries(parsed.portfolios) as [string, { cash?: number; holdings?: Array<{ ticker: string; shares: number; avg_cost: number }> }][];
        if (entries.length === 0) throw new Error("백업에 포트폴리오가 없습니다");
        const [name, data] = entries[0];
        doc = {
          id: newId(),
          name,
          currency: "USD",
          cash: data.cash ?? 0,
          holdings: (data.holdings ?? []).map((h) => ({ ticker: h.ticker.toUpperCase(), shares: h.shares, avg_cost: h.avg_cost })),
        };
      } else if (parsed.version === 1 && Array.isArray(parsed.portfolios)) {
        doc = {
          id: newId(),
          name: parsed.portfolios[0]?.name ?? "가져오기",
          currency: "USD",
          cash: parsed.portfolios[0]?.cash ?? 0,
          holdings: (parsed.portfolios[0]?.holdings ?? []).map((h: Holding) => ({ ticker: h.ticker.toUpperCase(), shares: h.shares, avg_cost: h.avg_cost })),
        };
      } else {
        throw new Error("지원하지 않는 백업 형식입니다");
      }
      const next = [...portfolios, doc];
      savePortfolios(next);
      setActiveId(doc.id);
      setImportText("");
    } catch {
      setImportError("백업 내용을 읽지 못했습니다. 내보낸 백업 내용을 그대로 붙여넣어 주세요.");
    }
  }

  const holdingRows = useMemo(() => {
    if (!active) return [];
    return active.holdings.map((h) => {
      const ticker = normalizeTicker(h.ticker);
      const price = prices.get(ticker) ?? null;
      const marketValue = price != null ? h.shares * price : null;
      const costBasis = h.shares * h.avg_cost;
      const gain = marketValue != null ? marketValue - costBasis : null;
      const gainPct = costBasis > 0 && gain != null ? gain / costBasis : null;
      const weight = grandTotal > 0 && marketValue != null ? marketValue / grandTotal : null;
      const connection = connectionIndex === undefined ? undefined : getStockConnection(connectionIndex, ticker);
      const services = servicesIndex === undefined ? undefined : getStockServices(servicesIndex, ticker);
      return { ...h, ticker, price, marketValue, costBasis, gain, gainPct, weight, connection, services };
    });
  }, [active, prices, grandTotal, connectionIndex, servicesIndex]);

  const connectionSummary = useMemo(() => buildPortfolioConnectionSummary(holdingRows, connectionIndex), [holdingRows, connectionIndex]);

  if (portfolios.length === 0) {
    return (
      <div className="data-shell-page">
        <section className="panel data-shell-header">
          <div className="data-shell-head-main">
            <p className="data-shell-kicker">포트폴리오</p>
            <h1 className="data-shell-title">내 포트폴리오</h1>
            <p className="data-shell-desc">기기 안에서만 보관되는 개인 포트폴리오입니다.</p>
          </div>
          <div className="data-shell-head-actions">
            <MarketQuickLinks />
          </div>
        </section>

        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700">
              예시 데이터
            </span>
          </div>
          <p className="mt-2 text-xs font-semibold text-slate-500">
            아래는 샘플 포트폴리오입니다. 실제 데이터를 입력하려면 포트폴리오를 만드세요.
          </p>
          <div className="mt-3 grid gap-3 lg:hidden">
            {buildSampleRows().map((row) => (
              <MobileHoldingCard key={row.ticker} row={row} />
            ))}
          </div>
          <div className="scroll-hint-x mt-3 -mx-1 hidden px-1 lg:block" role="region" tabIndex={0} aria-label="샘플 보유 종목 표 가로 스크롤">
            <HoldingsTable rows={buildSampleRows()} />
          </div>
          <div className="mt-3">
            <DataStateNotice
              state={makeDataState({
                status: "unavailable",
                label: "샘플 가격 없음",
                detail: "예시 포트폴리오는 보유 구조만 보여주며, 현재가와 평가액을 임의로 만들지 않습니다.",
              })}
            />
          </div>
          <button
            type="button"
            onClick={handleCreateEmpty}
            className="mt-4 inline-flex min-h-9 items-center rounded-full border border-brand-interactive bg-brand-interactive px-4 text-[11px] font-black text-white transition hover:bg-brand-interactive/90"
          >
            내 포트폴리오 만들기
          </button>
        </div>

        <Disclaimer />
      </div>
    );
  }

  return (
    <div className="data-shell-page">
      <section className="panel data-shell-header">
        <div className="data-shell-head-main">
          <p className="data-shell-kicker">포트폴리오</p>
          <h1 className="data-shell-title">내 포트폴리오</h1>
          <p className="data-shell-desc">보유 종목, 현금, 손익을 기기 안에서 관리합니다.</p>
        </div>
        <div className="data-shell-head-actions">
          {portfolios.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setActiveId(p.id)}
              className={`inline-flex min-h-11 items-center rounded-full border px-3 text-[11px] font-black transition sm:min-h-8 ${
                active?.id === p.id
                  ? "border-brand-interactive bg-brand-interactive/5 text-brand-interactive"
                  : "border-slate-200 bg-white text-slate-500 hover:text-slate-800"
              }`}
            >
              {p.name}
            </button>
          ))}
          <button
            type="button"
            onClick={handleCreateEmpty}
            className="inline-flex min-h-11 items-center rounded-full border border-dashed border-slate-300 px-3 text-[11px] font-black text-slate-600 transition hover:border-brand-interactive hover:text-brand-interactive sm:min-h-8"
          >
            + 새 포트폴리오
          </button>
          <MarketQuickLinks />
        </div>
      </section>

      {isSample && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700">
            예시 데이터
          </span>
        </div>
      )}

      <DataStateNotice state={priceState} />

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="총 평가액" value={fmt$(grandTotal)} />
        <Kpi label="총 손익" value={`${fmt$(totalGain)} (${fmtPct(totalGainPct)})`} valueClass={gainColor(totalGain)} />
        <Kpi label="현금" value={fmt$(active?.cash ?? 0)} />
        <Kpi label="보유 종목" value={`${active?.holdings.length ?? 0}종목`} />
      </div>

      <PortfolioConnectionPanel
        rows={holdingRows}
        summary={connectionSummary}
        loading={connectionIndex === undefined || servicesIndex === undefined}
      />

      {/* Holdings table */}
      <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-black tracking-tight text-slate-900">보유 종목</h2>
        <div className="mt-3 grid gap-3 lg:hidden">
          {holdingRows.length === 0 ? (
            <HoldingsEmptyState />
          ) : (
            holdingRows.map((row) => (
              <MobileHoldingCard key={row.ticker} row={row} onDelete={handleDeleteHolding} />
            ))
          )}
        </div>
        <div className="scroll-hint-x mt-3 -mx-1 hidden px-1 lg:block" role="region" tabIndex={0} aria-label="보유 종목 표 가로 스크롤">
          <HoldingsTable rows={holdingRows} onDelete={handleDeleteHolding} />
        </div>
        {missingCount > 0 && (
          <p className="mt-2 text-[10px] font-semibold text-slate-500">
            시세 없는 {missingCount}종목은 합계에서 제외
          </p>
        )}
      </div>

      {/* Add ticker form */}
      <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-black tracking-tight text-slate-900">종목 추가</h2>
        <div className="mt-2 flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex w-full flex-col gap-1 sm:w-auto">
            <span className="text-[10px] font-bold text-slate-500">티커</span>
            <input
              value={newTicker}
              onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
              placeholder="AAPL"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold uppercase text-slate-900 outline-none focus:border-brand-interactive sm:h-9 sm:w-24 sm:px-2"
            />
          </label>
          <label className="flex w-full flex-col gap-1 sm:w-auto">
            <span className="text-[10px] font-bold text-slate-500">수량</span>
            <input
              value={newShares}
              onChange={(e) => setNewShares(e.target.value)}
              type="number"
              min="0"
              step="any"
              placeholder="10"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-brand-interactive sm:h-9 sm:w-20 sm:px-2"
            />
          </label>
          <label className="flex w-full flex-col gap-1 sm:w-auto">
            <span className="text-[10px] font-bold text-slate-500">평단 ($)</span>
            <input
              value={newCost}
              onChange={(e) => setNewCost(e.target.value)}
              type="number"
              min="0"
              step="any"
              placeholder="150.00"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-brand-interactive sm:h-9 sm:w-24 sm:px-2"
            />
          </label>
          <button
            type="button"
            onClick={handleAddHolding}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-brand-interactive bg-brand-interactive/5 px-3 text-[11px] font-black text-brand-interactive transition hover:bg-brand-interactive/10 sm:min-h-9"
          >
            추가
          </button>
        </div>
      </div>

      {/* Cash edit */}
      <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-black tracking-tight text-slate-900">현금</h2>
        {editingCash ? (
          <div className="mt-2 flex items-center gap-2">
            <input
              ref={cashRef}
              value={cashInput}
              onChange={(e) => setCashInput(e.target.value)}
              type="number"
              min="0"
              step="any"
              className="h-9 w-32 rounded-xl border border-slate-200 bg-white px-2 text-sm font-bold text-slate-900 outline-none focus:border-brand-interactive"
            />
            <button
              type="button"
              onClick={handleCashSave}
              className="inline-flex min-h-11 items-center rounded-full border border-brand-interactive bg-brand-interactive/5 px-3 text-[11px] font-black text-brand-interactive sm:min-h-8"
            >
              저장
            </button>
            <button
              type="button"
              onClick={() => setEditingCash(false)}
              className="inline-flex min-h-11 items-center rounded-full border border-slate-200 px-3 text-[11px] font-black text-slate-500 sm:min-h-8"
            >
              취소
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditingCash(true);
              setTimeout(() => cashRef.current?.focus(), 0);
            }}
            className="mt-2 text-sm font-bold text-slate-700 hover:text-brand-interactive"
          >
            {fmt$(active?.cash ?? 0)} <span className="text-[10px] text-slate-400">편집</span>
          </button>
        )}
      </div>

      {/* Import / Export */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-black tracking-tight text-slate-900">백업 내보내기</h2>
          <button
            type="button"
            onClick={handleExport}
            className="mt-2 inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive sm:min-h-8"
          >
            내보내기
          </button>
          {exportText && (
            <textarea
              readOnly
              value={exportText}
              className="mt-2 h-32 w-full rounded-xl border border-slate-200 bg-slate-50 p-2 font-mono text-[10px] text-slate-700"
            />
          )}
        </div>
        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-black tracking-tight text-slate-900">백업 가져오기</h2>
          <textarea
            value={importText}
            onChange={(e) => {
              setImportText(e.target.value);
              setImportError(null);
            }}
            placeholder="백업 내용을 붙여넣으세요"
            className="mt-2 h-32 w-full rounded-xl border border-slate-200 bg-white p-2 font-mono text-[10px] text-slate-700 outline-none focus:border-brand-interactive"
          />
          {importError && <p className="mt-1 text-[10px] font-bold text-rose-600">{importError}</p>}
          <button
            type="button"
            onClick={handleImport}
            disabled={!importText.trim()}
            className="mt-2 inline-flex min-h-11 items-center rounded-full border border-brand-interactive bg-brand-interactive/5 px-3 text-[11px] font-black text-brand-interactive transition hover:bg-brand-interactive/10 disabled:opacity-40 sm:min-h-8"
          >
            가져오기
          </button>
        </div>
      </div>

      <Disclaimer />
    </div>
  );
}

/* ─── Sub-components ─── */

function Kpi({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-400">{label}</p>
      <p className={`mt-1 orbitron text-sm font-black tabular-nums text-slate-900 ${valueClass ?? ""}`}>
        {value}
      </p>
    </div>
  );
}

interface HoldingRow extends Holding {
  price: number | null;
  marketValue: number | null;
  costBasis: number;
  gain: number | null;
  gainPct: number | null;
  weight: number | null;
  connection?: StockConnectionEntry | null;
  services?: StockServicesEntry | null;
}

interface PortfolioConnectionSummary {
  totalHoldings: number;
  connectedHoldings: number;
  missingHoldings: number;
  filings: number;
  smartMoney: number;
  indexMembership: number;
  singleStockEtfs: number;
  serviceLinks: number;
  sourceAsOf: StockConnectionIndex["source_as_of"] | null;
}

function countAnyConnection(row: HoldingRow): boolean {
  const flags = row.connection?.flags;
  return Boolean(
    flags?.market_facts
      || flags?.filings
      || flags?.sec_13f
      || flags?.index_membership
      || flags?.single_stock_etfs,
  );
}

function buildPortfolioConnectionSummary(
  rows: HoldingRow[],
  connectionIndex: StockConnectionIndex | null | undefined,
): PortfolioConnectionSummary {
  let connectedHoldings = 0;
  let missingHoldings = 0;
  let filings = 0;
  let smartMoney = 0;
  let indexMembership = 0;
  let singleStockEtfs = 0;
  let serviceLinks = 0;

  for (const row of rows) {
    const flags = row.connection?.flags;
    if (row.connection === null) missingHoldings += 1;
    if (countAnyConnection(row)) connectedHoldings += 1;
    if (flags?.filings) filings += 1;
    if (flags?.sec_13f) smartMoney += 1;
    if (flags?.index_membership) indexMembership += 1;
    if (flags?.single_stock_etfs) singleStockEtfs += 1;
    serviceLinks += row.services?.single_stock_etfs?.length ?? row.connection?.service_count ?? 0;
  }

  return {
    totalHoldings: rows.length,
    connectedHoldings,
    missingHoldings,
    filings,
    smartMoney,
    indexMembership,
    singleStockEtfs,
    serviceLinks,
    sourceAsOf: connectionIndex?.source_as_of ?? null,
  };
}

function HoldingsEmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center">
      <p className="text-xs font-bold text-slate-500">보유 종목이 없습니다</p>
    </div>
  );
}

function buildSingleStockEtfHref(links: StockServiceEtfLink[]): string {
  const tickers = links.map((link) => normalizeTicker(link.ticker)).filter(Boolean);
  if (tickers.length >= 2) return `/etfs/compare?tickers=${encodeURIComponent(tickers.slice(0, 4).join(","))}`;
  if (tickers.length === 1) return links[0]?.route || `/etfs/${encodeURIComponent(tickers[0])}`;
  return "/etfs";
}

function ConnectionActionLink({
  href,
  children,
  tone = "slate",
}: {
  href: string;
  children: React.ReactNode;
  tone?: "slate" | "emerald" | "violet" | "cyan";
}) {
  const toneClass = {
    slate: "border-slate-200 bg-white text-slate-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
    cyan: "border-cyan-200 bg-cyan-50 text-cyan-700",
  }[tone];
  return (
    <TransitionLink
      href={href}
      className={`inline-flex min-h-8 items-center rounded-full border px-2.5 text-[10px] font-black transition hover:border-brand-interactive hover:text-brand-interactive ${toneClass}`}
    >
      {children}
    </TransitionLink>
  );
}

function HoldingConnectionActions({ row }: { row: HoldingRow }) {
  const flags = row.connection?.flags;
  const etfLinks = row.services?.single_stock_etfs ?? [];
  const etfHref = buildSingleStockEtfHref(etfLinks);

  if (row.connection === undefined) {
    return <span className="text-[10px] font-bold text-slate-600">연결 확인 중</span>;
  }
  if (!row.connection) {
    return <span className="text-[10px] font-bold text-slate-600">연결 데이터 없음</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      <ConnectionActionLink href={`/stock/${encodeURIComponent(row.ticker)}`}>상세</ConnectionActionLink>
      {flags?.filings ? (
        <ConnectionActionLink href={`/stock/${encodeURIComponent(row.ticker)}?tab=filings`} tone="emerald">
          공시
        </ConnectionActionLink>
      ) : null}
      {flags?.sec_13f ? (
        <ConnectionActionLink href={`/superinvestors?tab=by-ticker&ticker=${encodeURIComponent(row.ticker)}`} tone="violet">
          13F
        </ConnectionActionLink>
      ) : null}
      {flags?.single_stock_etfs ? (
        <ConnectionActionLink href={etfHref} tone="cyan">
          ETF{etfLinks.length ? ` ${etfLinks.length}` : ""}
        </ConnectionActionLink>
      ) : null}
      <ConnectionActionLink href={`/screener?ticker=${encodeURIComponent(row.ticker)}`}>스크리너</ConnectionActionLink>
    </div>
  );
}

function HoldingConnectionFreshness({ row }: { row: HoldingRow }) {
  const entry = row.connection;
  if (!entry) return null;
  const etfAsOf = row.services?.as_of?.etf_universe
    ?? row.services?.single_stock_etfs?.find((link) => typeof link.as_of?.etf_universe === "string")?.as_of?.etf_universe
    ?? null;
  const badges = [
    entry.flags?.market_facts ? { key: "market_facts" as const, asOf: entry.as_of?.market_facts } : null,
    entry.flags?.filings ? { key: "filings" as const, asOf: entry.as_of?.filings } : null,
    entry.flags?.sec_13f ? { key: "sec_13f" as const, asOf: entry.as_of?.sec_13f } : null,
    entry.flags?.single_stock_etfs ? { key: "etf_universe" as const, asOf: etfAsOf } : null,
  ].filter(Boolean) as Array<{ key: "market_facts" | "filings" | "sec_13f" | "etf_universe"; asOf?: string | null }>;

  if (!badges.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((badge) => (
        <DataStateBadge
          key={badge.key}
          state={stockConnectionFreshnessState(badge.key, badge.asOf)}
          prefix=""
          className="px-1.5 py-0.5"
        />
      ))}
    </div>
  );
}

function HoldingConnectionMini({ row }: { row: HoldingRow }) {
  const entry = row.connection;
  if (entry === undefined) return <span className="text-[10px] font-bold text-slate-600">확인 중</span>;
  if (!entry) return <span className="text-[10px] font-bold text-slate-600">없음</span>;
  const flags = entry.flags ?? {};
  const items = [
    flags.market_facts ? "시세" : null,
    flags.filings ? "공시" : null,
    flags.sec_13f ? "13F" : null,
    flags.index_membership ? "지수" : null,
    flags.single_stock_etfs ? `ETF${row.services?.single_stock_etfs?.length ? ` ${row.services.single_stock_etfs.length}` : ""}` : null,
  ].filter((item): item is string => Boolean(item));
  return (
    <span className="flex flex-wrap gap-1">
      <span className="orbitron rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-black tabular-nums text-slate-800">
        {stockConnectionCount(entry) ?? items.length}
      </span>
      {items.slice(0, 3).map((item) => (
        <span key={item} className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-black text-slate-600">
          {item}
        </span>
      ))}
      {items.length > 3 ? (
        <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-black text-slate-600">
          +{items.length - 3}
        </span>
      ) : null}
    </span>
  );
}

function PortfolioConnectionPanel({
  rows,
  summary,
  loading,
}: {
  rows: HoldingRow[];
  summary: PortfolioConnectionSummary;
  loading: boolean;
}) {
  if (rows.length === 0) return null;

  const sourceBadges = [
    { key: "market_facts" as const, asOf: summary.sourceAsOf?.market_facts },
    { key: "filings" as const, asOf: summary.sourceAsOf?.edgar_summaries },
    { key: "sec_13f" as const, asOf: summary.sourceAsOf?.sec_13f },
    { key: "etf_universe" as const, asOf: summary.sourceAsOf?.etf_universe },
  ];

  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-black tracking-tight text-slate-900">데이터 연결 서비스</h2>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
            보유 종목에서 공시, 13F, 단일종목 ETF, 스크리너 화면으로 바로 이동합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {loading ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-black text-slate-500">연결 인덱스 확인 중</span>
          ) : (
            sourceBadges.map((badge) => (
              <DataStateBadge
                key={badge.key}
                state={stockConnectionFreshnessState(badge.key, badge.asOf)}
                prefix=""
                className="px-1.5 py-0.5"
              />
            ))
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Kpi label="연결 보유" value={`${summary.connectedHoldings}/${summary.totalHoldings}`} />
        <Kpi label="공시" value={`${summary.filings}종목`} />
        <Kpi label="13F" value={`${summary.smartMoney}종목`} />
        <Kpi label="단일종목 ETF" value={`${summary.singleStockEtfs}종목`} />
        <Kpi label="ETF 링크" value={`${summary.serviceLinks}개`} />
      </div>

      <div className="mt-4 grid gap-3">
        {rows.map((row) => {
          const etfLinks = row.services?.single_stock_etfs ?? [];
          const missing = row.connection === null;
          return (
            <article key={row.ticker} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <TransitionLink
                      href={`/stock/${encodeURIComponent(row.ticker)}`}
                      className="text-sm font-black text-brand-interactive hover:underline"
                    >
                      {row.ticker}
                    </TransitionLink>
                    {row.connection?.canonical_sector ? (
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                        {row.connection.canonical_sector}
                      </span>
                    ) : null}
                    {row.connection?.confidence?.label ? (
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                        신뢰 {row.connection.confidence.label}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[10px] font-semibold leading-4 text-slate-500">
                    {missing ? "연결 인덱스에 없는 ticker입니다. 가격 캐시만 사용합니다." : row.connection?.label ?? "보유 종목 연결 확인"}
                  </p>
                </div>
                <HoldingConnectionActions row={row} />
              </div>
              <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <HoldingConnectionFreshness row={row} />
                {etfLinks.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {etfLinks.slice(0, 4).map((link) => (
                      <TransitionLink
                        key={link.ticker}
                        href={link.route || `/etfs/${encodeURIComponent(link.ticker)}`}
                        className="rounded-full border border-cyan-200 bg-white px-2 py-0.5 text-[10px] font-black text-cyan-700 transition hover:border-brand-interactive hover:text-brand-interactive"
                        title={[link.label ?? link.ticker, link.raw_underlying ? `분류 원문 ${link.raw_underlying}` : null].filter(Boolean).join(" · ")}
                      >
                        {link.ticker}
                      </TransitionLink>
                    ))}
                    {etfLinks.length > 4 ? (
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                        +{etfLinks.length - 4}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <p className="mt-3 text-[10px] font-semibold leading-4 text-slate-500">
        연결은 관련 데이터 화면으로 이동하는 서비스 링크이며 매수·매도 추천이 아닙니다. 포트폴리오 입력값은 이 브라우저에만 저장됩니다.
      </p>
    </section>
  );
}

function MobileHoldingCard({
  row,
  onDelete,
}: {
  row: HoldingRow;
  onDelete?: (ticker: string) => void;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <TransitionLink
            href={`/stock/${encodeURIComponent(row.ticker)}`}
            className="text-base font-black text-brand-interactive hover:underline"
          >
            {row.ticker}
          </TransitionLink>
          <p className="mt-0.5 text-xs font-bold text-slate-500">기기 저장 보유 종목</p>
        </div>
        {onDelete ? (
          <button
            type="button"
            onClick={() => onDelete(row.ticker)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-lg font-black text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
            aria-label={`${row.ticker} 삭제`}
          >
            ×
          </button>
        ) : null}
      </div>
      <div className="mt-3">
        <HoldingConnectionMini row={row} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-slate-50 p-2">
          <p className="text-[10px] font-black uppercase text-slate-500">수량</p>
          <p className="orbitron mt-1 font-black tabular-nums text-slate-900">{row.shares}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2">
          <p className="text-[10px] font-black uppercase text-slate-500">평단</p>
          <p className="orbitron mt-1 font-black tabular-nums text-slate-900">{fmt$(row.avg_cost)}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2">
          <p className="text-[10px] font-black uppercase text-slate-500">현재가</p>
          <p className="orbitron mt-1 font-black tabular-nums text-slate-900">{row.price != null ? fmt$(row.price) : "—"}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2">
          <p className="text-[10px] font-black uppercase text-slate-500">평가액</p>
          <p className="orbitron mt-1 font-black tabular-nums text-slate-900">{row.marketValue != null ? fmt$(row.marketValue) : "—"}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-sm">
        <span className={`orbitron font-black tabular-nums ${row.gain != null ? gainColor(row.gain) : "text-slate-400"}`}>
          {row.gain != null ? fmt$(row.gain) : "—"}
        </span>
        <span className={`orbitron font-black tabular-nums ${row.gainPct != null ? gainColor(row.gainPct) : "text-slate-400"}`}>
          {row.gainPct != null ? fmtPct(row.gainPct) : "—"}
        </span>
        <span className="orbitron text-xs font-bold text-slate-500">
          {row.weight != null ? `${(row.weight * 100).toFixed(1)}%` : "—"}
        </span>
      </div>
    </article>
  );
}

function HoldingsTable({
  rows,
  onDelete,
}: {
  rows: HoldingRow[];
  onDelete?: (ticker: string) => void;
}) {
  if (rows.length === 0) {
    return <HoldingsEmptyState />;
  }

  return (
    <table className="w-full min-w-[760px] text-xs">
      <thead>
        <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">
          <th className="px-2 py-2 text-left">티커</th>
          <th className="px-2 py-2 text-left">연결</th>
          <th className="px-2 py-2 text-right">수량</th>
          <th className="px-2 py-2 text-right">평단</th>
          <th className="px-2 py-2 text-right">현재가</th>
          <th className="px-2 py-2 text-right">평가액</th>
          <th className="px-2 py-2 text-right">손익</th>
          <th className="px-2 py-2 text-right">손익률</th>
          <th className="px-2 py-2 text-right">비중</th>
          {onDelete ? <th className="px-2 py-2" /> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.ticker} className="border-b border-slate-100 last:border-b-0">
            <td className="px-2 py-2">
              <TransitionLink
                href={`/stock/${encodeURIComponent(r.ticker)}`}
                className="font-black text-brand-interactive hover:underline"
              >
                {r.ticker}
              </TransitionLink>
            </td>
            <td className="px-2 py-2">
              <HoldingConnectionMini row={r} />
            </td>
            <td className="px-2 py-2 text-right orbitron tabular-nums font-bold text-slate-700">
              {r.shares}
            </td>
            <td className="px-2 py-2 text-right orbitron tabular-nums text-slate-700">
              {fmt$(r.avg_cost)}
            </td>
            <td className="px-2 py-2 text-right orbitron tabular-nums font-bold text-slate-900">
              {r.price != null ? fmt$(r.price) : "—"}
            </td>
            <td className="px-2 py-2 text-right orbitron tabular-nums font-bold text-slate-900">
              {r.marketValue != null ? fmt$(r.marketValue) : "—"}
            </td>
            <td className={`px-2 py-2 text-right orbitron tabular-nums font-bold ${r.gain != null ? gainColor(r.gain) : "text-slate-400"}`}>
              {r.gain != null ? fmt$(r.gain) : "—"}
            </td>
            <td className={`px-2 py-2 text-right orbitron tabular-nums font-bold ${r.gainPct != null ? gainColor(r.gainPct) : "text-slate-400"}`}>
              {r.gainPct != null ? fmtPct(r.gainPct) : "—"}
            </td>
            <td className="px-2 py-2 text-right orbitron tabular-nums text-slate-500">
              {r.weight != null ? `${(r.weight * 100).toFixed(1)}%` : "—"}
            </td>
            {onDelete ? (
              <td className="px-2 py-2 text-right">
                <button
                  type="button"
                  onClick={() => onDelete(r.ticker)}
                  className="inline-flex min-h-9 items-center rounded-lg px-2 text-[10px] font-black text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                  aria-label={`${r.ticker} 삭제`}
                >
                  삭제
                </button>
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Disclaimer() {
  return (
    <p className="text-[10px] font-semibold text-slate-600">
      이 브라우저에만 저장 · 서버 전송 없음 · 시세를 확인하지 못한 종목은 평가액에서 제외
    </p>
  );
}

/* ─── Sample data helpers (prices intentionally absent) ─── */

function buildSampleRows(): HoldingRow[] {
  return SAMPLE_PORTFOLIO.holdings.map((h) => {
    const cost = h.shares * h.avg_cost;
    return {
      ...h,
      price: null,
      marketValue: null,
      costBasis: cost,
      gain: null,
      gainPct: null,
      weight: null,
      connection: null,
      services: null,
    };
  });
}
