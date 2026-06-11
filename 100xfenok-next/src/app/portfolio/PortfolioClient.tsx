"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import {
  usePortfolios,
  savePortfolios,
  SAMPLE_PORTFOLIO,
  type Portfolio,
  type Holding,
} from "@/lib/portfolio";

interface PriceDoc {
  data?: { info?: { currentPrice?: number | null } };
}
interface AnalyzerDoc {
  data?: Array<{ symbol: string; price?: number | null }>;
}

const priceCache = new Map<string, number | null>();
const pricePending = new Map<string, Promise<number | null>>();

async function fetchPrice(ticker: string): Promise<number | null> {
  if (priceCache.has(ticker)) return priceCache.get(ticker)!;
  if (pricePending.has(ticker)) return pricePending.get(ticker)!;

  const p = (async () => {
    try {
      const r1 = await fetch("/data/global-scouter/core/stocks_analyzer.json");
      if (r1.ok) {
        const doc: AnalyzerDoc = await r1.json();
        const row = doc.data?.find((d) => d.symbol === ticker);
        if (row?.price != null) {
          priceCache.set(ticker, row.price);
          return row.price;
        }
      }
    } catch {
      // fall through
    }
    try {
      const r2 = await fetch(`/data/yf/finance/${encodeURIComponent(ticker)}.json`);
      if (r2.ok) {
        const doc: PriceDoc = await r2.json();
        const price = doc.data?.info?.currentPrice;
        if (price != null) {
          priceCache.set(ticker, price);
          return price;
        }
      }
    } catch {
      // fall through
    }
    priceCache.set(ticker, null);
    return null;
  })();

  pricePending.set(ticker, p);
  return p;
}

function fmt$(v: number): string {
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(v: number): string {
  const s = v >= 0 ? "+" : "";
  return `${s}${(v * 100).toFixed(2)}%`;
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

export default function PortfolioClient() {
  const portfolios = usePortfolios();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [prices, setPrices] = useState<Map<string, number | null>>(new Map());
  const [exportText, setExportText] = useState("");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [newTicker, setNewTicker] = useState("");
  const [newShares, setNewShares] = useState("");
  const [newCost, setNewCost] = useState("");
  const [cashInput, setCashInput] = useState("");
  const [editingCash, setEditingCash] = useState(false);
  const cashRef = useRef<HTMLInputElement>(null);

  const active = useMemo(
    () => portfolios.find((p) => p.id === activeId) ?? portfolios[0] ?? null,
    [portfolios, activeId],
  );

  const isSample = active?.id === "sample";

  useEffect(() => {
    if (active && !editingCash) setCashInput(String(active.cash));
  }, [active, editingCash]);

  const tickers = useMemo(
    () => (active ? [...new Set(active.holdings.map((h) => h.ticker))] : []),
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
      const price = prices.get(h.ticker);
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
        if (entries.length === 0) throw new Error("portfolios가 비어 있습니다");
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
        throw new Error("지원하지 않는 형식입니다");
      }
      const next = [...portfolios, doc];
      savePortfolios(next);
      setActiveId(doc.id);
      setImportText("");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "JSON 파싱 실패");
    }
  }

  const holdingRows = useMemo(() => {
    if (!active) return [];
    return active.holdings.map((h) => {
      const price = prices.get(h.ticker) ?? null;
      const marketValue = price != null ? h.shares * price : null;
      const costBasis = h.shares * h.avg_cost;
      const gain = marketValue != null ? marketValue - costBasis : null;
      const gainPct = costBasis > 0 && gain != null ? gain / costBasis : null;
      const weight = grandTotal > 0 && marketValue != null ? marketValue / grandTotal : null;
      return { ...h, price, marketValue, costBasis, gain, gainPct, weight };
    });
  }, [active, prices, grandTotal]);

  if (portfolios.length === 0) {
    return (
      <div className="data-shell-page">
        <section className="panel data-shell-header">
          <div className="data-shell-head-main">
            <p className="data-shell-kicker">Portfolio</p>
            <h1 className="data-shell-title">내 포트폴리오</h1>
            <p className="data-shell-desc">기기 안에서만 보관되는 개인 포트폴리오입니다.</p>
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
          <div className="mt-3 -mx-1 overflow-x-auto px-1">
            <HoldingsTable rows={buildSampleRows()} />
          </div>
          <button
            type="button"
            onClick={handleCreateEmpty}
            className="mt-4 inline-flex min-h-9 items-center rounded-full border border-brand-interactive bg-brand-interactive/5 px-4 text-[11px] font-black text-brand-interactive transition hover:bg-brand-interactive/10"
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
          <p className="data-shell-kicker">Portfolio</p>
          <h1 className="data-shell-title">내 포트폴리오</h1>
          <p className="data-shell-desc">보유 종목, 현금, 손익을 기기 안에서 관리합니다.</p>
        </div>
        <div className="data-shell-head-actions">
          {portfolios.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setActiveId(p.id)}
              className={`inline-flex min-h-8 items-center rounded-full border px-3 text-[11px] font-black transition ${
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
            className="inline-flex min-h-8 items-center rounded-full border border-dashed border-slate-300 px-3 text-[11px] font-black text-slate-400 transition hover:border-brand-interactive hover:text-brand-interactive"
          >
            + 새 포트폴리오
          </button>
        </div>
      </section>

      {isSample && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700">
            예시 데이터
          </span>
        </div>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="총 평가액" value={fmt$(grandTotal)} />
        <Kpi label="총 손익" value={`${fmt$(totalGain)} (${fmtPct(totalGainPct)})`} valueClass={gainColor(totalGain)} />
        <Kpi label="현금" value={fmt$(active?.cash ?? 0)} />
        <Kpi label="보유 종목" value={`${active?.holdings.length ?? 0}종목`} />
      </div>

      {/* Holdings table */}
      <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-black tracking-tight text-slate-900">보유 종목</h2>
        <div className="mt-3 -mx-1 overflow-x-auto px-1">
          <HoldingsTable rows={holdingRows} onDelete={handleDeleteHolding} />
        </div>
        {missingCount > 0 && (
          <p className="mt-2 text-[10px] font-semibold text-slate-400">
            시세 없는 {missingCount}종목은 합계에서 제외
          </p>
        )}
      </div>

      {/* Add ticker form */}
      <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-black tracking-tight text-slate-900">종목 추가</h2>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-slate-500">티커</span>
            <input
              value={newTicker}
              onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
              placeholder="AAPL"
              className="h-9 w-24 rounded-xl border border-slate-200 bg-white px-2 text-sm font-bold uppercase text-slate-900 outline-none focus:border-brand-interactive"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-slate-500">수량</span>
            <input
              value={newShares}
              onChange={(e) => setNewShares(e.target.value)}
              type="number"
              min="0"
              step="any"
              placeholder="10"
              className="h-9 w-20 rounded-xl border border-slate-200 bg-white px-2 text-sm font-bold text-slate-900 outline-none focus:border-brand-interactive"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-slate-500">평단 ($)</span>
            <input
              value={newCost}
              onChange={(e) => setNewCost(e.target.value)}
              type="number"
              min="0"
              step="any"
              placeholder="150.00"
              className="h-9 w-24 rounded-xl border border-slate-200 bg-white px-2 text-sm font-bold text-slate-900 outline-none focus:border-brand-interactive"
            />
          </label>
          <button
            type="button"
            onClick={handleAddHolding}
            className="inline-flex min-h-9 items-center rounded-full border border-brand-interactive bg-brand-interactive/5 px-3 text-[11px] font-black text-brand-interactive transition hover:bg-brand-interactive/10"
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
              className="inline-flex min-h-8 items-center rounded-full border border-brand-interactive bg-brand-interactive/5 px-3 text-[11px] font-black text-brand-interactive"
            >
              저장
            </button>
            <button
              type="button"
              onClick={() => setEditingCash(false)}
              className="inline-flex min-h-8 items-center rounded-full border border-slate-200 px-3 text-[11px] font-black text-slate-500"
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
          <h2 className="text-sm font-black tracking-tight text-slate-900">JSON 내보내기</h2>
          <button
            type="button"
            onClick={handleExport}
            className="mt-2 inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
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
          <h2 className="text-sm font-black tracking-tight text-slate-900">JSON 가져오기</h2>
          <textarea
            value={importText}
            onChange={(e) => {
              setImportText(e.target.value);
              setImportError(null);
            }}
            placeholder='{"portfolios": {"내 포트폴리오": {"cash": 0, "holders": [...]}}} 또는 {"version":1, "portfolios":[...]}'
            className="mt-2 h-32 w-full rounded-xl border border-slate-200 bg-white p-2 font-mono text-[10px] text-slate-700 outline-none focus:border-brand-interactive"
          />
          {importError && <p className="mt-1 text-[10px] font-bold text-rose-600">{importError}</p>}
          <button
            type="button"
            onClick={handleImport}
            disabled={!importText.trim()}
            className="mt-2 inline-flex min-h-8 items-center rounded-full border border-brand-interactive bg-brand-interactive/5 px-3 text-[11px] font-black text-brand-interactive transition hover:bg-brand-interactive/10 disabled:opacity-40"
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
}

function HoldingsTable({
  rows,
  onDelete,
}: {
  rows: HoldingRow[];
  onDelete?: (ticker: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center">
        <p className="text-xs font-bold text-slate-500">보유 종목이 없습니다</p>
      </div>
    );
  }

  return (
    <table className="w-full min-w-[640px] text-xs">
      <thead>
        <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">
          <th className="px-2 py-2 text-left">티커</th>
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
                  className="text-[10px] font-black text-slate-400 transition hover:text-rose-600"
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
    <p className="text-[10px] font-semibold text-slate-400">
      기기 내 저장(localStorage) · 서버 전송 없음 · 시세는 주간 데이터 기준으로 지연될 수 있음
    </p>
  );
}

/* ─── Sample data helpers (no fetch) ─── */

const SAMPLE_PRICES: Record<string, number> = { AAPL: 307.34, NVDA: 138.35, KORU: 30.22, SCHD: 28.51 };

function buildSampleRows(): HoldingRow[] {
  const totalMv = SAMPLE_PORTFOLIO.holdings.reduce((s, h) => {
    const p = SAMPLE_PRICES[h.ticker];
    return p != null ? s + h.shares * p : s;
  }, 0);
  const grand = totalMv + SAMPLE_PORTFOLIO.cash;
  return SAMPLE_PORTFOLIO.holdings.map((h) => {
    const price = SAMPLE_PRICES[h.ticker] ?? null;
    const mv = price != null ? h.shares * price : null;
    const cost = h.shares * h.avg_cost;
    const gain = mv != null ? mv - cost : null;
    const pct = cost > 0 && gain != null ? gain / cost : null;
    return {
      ...h,
      price,
      marketValue: mv,
      costBasis: cost,
      gain,
      gainPct: pct,
      weight: grand > 0 && mv != null ? mv / grand : null,
    };
  });
}
