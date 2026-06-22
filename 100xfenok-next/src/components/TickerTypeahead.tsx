"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StaticStockAnalyzerDataProvider } from "@/features/stock-analyzer/data/static-data-provider";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

interface StockRow {
  symbol: string;
  companyName: string;
  sector: string;
}

interface GuruRow {
  id: string;
  name: string;
}

interface Suggestion {
  type: "stock" | "guru" | "divider";
  key: string;
  stock?: StockRow;
  guru?: GuruRow;
}

// ---------------------------------------------------------------------------
// Module-level caches
// ---------------------------------------------------------------------------

let stocksCache: StockRow[] | null = null;
let stocksPromise: Promise<StockRow[]> | null = null;
const stocksProvider = new StaticStockAnalyzerDataProvider();

function loadStocks(): Promise<StockRow[]> {
  if (stocksCache) return Promise.resolve(stocksCache);
  if (stocksPromise) return stocksPromise;
  stocksPromise = stocksProvider.load()
    .then((records) => records.map((record) => ({
      symbol: String(record.symbol ?? ""),
      companyName: String(record.companyName ?? ""),
      sector: String(record.sector ?? ""),
    })))
    .then((rows) => {
      stocksCache = rows;
      return rows;
    })
    .catch(() => { stocksPromise = null; return []; });
  return stocksPromise;
}

let gurusCache: GuruRow[] | null = null;
let gurusPromise: Promise<GuruRow[]> | null = null;

function loadGurus(): Promise<GuruRow[]> {
  if (gurusCache) return Promise.resolve(gurusCache);
  if (gurusPromise) return gurusPromise;
  gurusPromise = fetch("/data/sec-13f/analytics/portfolio_views.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d: any) => {
      const rows: GuruRow[] = [];
      const investors = d?.investors ?? {};
      for (const [id, inv] of Object.entries(investors) as Array<[string, any]>) {
        rows.push({ id, name: String(inv.name ?? id) });
      }
      gurusCache = rows;
      return rows;
    })
    .catch(() => { gurusPromise = null; return []; });
  return gurusPromise;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function matchStocks(query: string, stocks: StockRow[]): StockRow[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const exact: StockRow[] = [];
  const prefix: StockRow[] = [];
  const substr: StockRow[] = [];
  for (const s of stocks) {
    const sym = s.symbol.toLowerCase();
    if (sym === q) { exact.push(s); continue; }
    if (sym.startsWith(q)) { prefix.push(s); continue; }
    if (s.companyName.toLowerCase().includes(q)) { substr.push(s); continue; }
    if (s.sector.includes(q)) { substr.push(s); }
  }
  return [...exact, ...prefix, ...substr].slice(0, 8);
}

function matchGurus(query: string, gurus: GuruRow[]): GuruRow[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return gurus.filter((g) => g.id.toLowerCase().includes(q) || g.name.toLowerCase().includes(q)).slice(0, 3);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TickerTypeaheadProps {
  placeholder?: string;
  className?: string;
  onSubmit?: (value: string) => void;
  showButton?: boolean;
  buttonLabel?: string;
  buttonClass?: string;
  formClass?: string;
}

export default function TickerTypeahead({
  placeholder = "티커 또는 투자자 검색…",
  className = "",
  onSubmit,
  showButton = false,
  buttonLabel = "→",
  buttonClass = "",
  formClass = "",
}: TickerTypeaheadProps) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<number>(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const doSearch = (q: string) => {
    if (!q.trim()) { setSuggestions([]); setOpen(false); return; }
    setLoading(true);
    Promise.all([loadStocks(), loadGurus()]).then(([stocks, gurus]) => {
      const sMatches = matchStocks(q, stocks);
      const gMatches = matchGurus(q, gurus);
      const items: Suggestion[] = sMatches.map((s) => ({ type: "stock" as const, key: `s:${s.symbol}`, stock: s }));
      if (gMatches.length > 0) {
        items.push({ type: "divider" as const, key: "div" });
        gMatches.forEach((g) => items.push({ type: "guru" as const, key: `g:${g.id}`, guru: g }));
      }
      setSuggestions(items);
      setOpen(items.length > 0);
      setActiveIdx(-1);
      setLoading(false);
    });
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setValue(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => doSearch(v), 120);
  };

  const selectItem = (s: Suggestion) => {
    if (s.type === "stock" && s.stock) {
      router.push(`/stock/${encodeURIComponent(s.stock.symbol)}`);
    } else if (s.type === "guru" && s.guru) {
      router.push(`/superinvestors?tab=gurus&guru=${encodeURIComponent(s.guru.id)}`);
    }
    setOpen(false);
    setValue("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    const selectable = suggestions.filter((s) => s.type !== "divider");
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, selectable.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, -1)); return; }
    if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      const sel = selectable[activeIdx];
      if (sel) selectItem(sel);
      return;
    }
    if (e.key === "Escape") { setOpen(false); return; }
  };

  const handleSubmit = () => {
    if (activeIdx >= 0) {
      const selectable = suggestions.filter((s) => s.type !== "divider");
      const sel = selectable[activeIdx];
      if (sel) { selectItem(sel); return true; }
    }
    const t = value.trim().toUpperCase();
    if (t) {
      if (onSubmit) onSubmit(t);
      else router.push(`/stock/${encodeURIComponent(t)}`);
    }
    setOpen(false);
    return !!t;
  };

  // Click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectableItems = suggestions.filter((s) => s.type !== "divider");
  const activeId = activeIdx >= 0 && activeIdx < selectableItems.length ? selectableItems[activeIdx].key : undefined;

  const doSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    handleSubmit();
  };

  return (
    <div ref={wrapRef} className="relative w-full">
      <form onSubmit={doSubmit} className={formClass}>
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls="ticker-listbox"
          aria-activedescendant={activeId ?? undefined}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
          placeholder={placeholder}
          className={className}
        />
        {showButton ? (
          <button type="submit" className={buttonClass || "inline-flex min-h-12 shrink-0 items-center rounded-full bg-brand-interactive px-5 text-sm font-black text-white transition hover:opacity-90"}>
            {buttonLabel}
          </button>
        ) : null}
      </form>

      {open ? (
        <ul
          ref={listRef}
          id="ticker-listbox"
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg"
        >
          {loading ? (
            <li className="px-4 py-3 text-xs text-slate-400">검색 중…</li>
          ) : (
            suggestions.map((s) => {
              if (s.type === "divider") {
                return <li key="div" className="mx-3 my-1 border-t border-slate-100" role="separator" />;
              }
              const selIdx = selectableItems.indexOf(s);
              const isActive = selIdx === activeIdx;
              return (
                <li
                  key={s.key}
                  id={s.key}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => selectItem(s)}
                  onMouseEnter={() => setActiveIdx(selIdx)}
                  className={`flex cursor-pointer items-center gap-2 px-4 py-2 text-sm ${isActive ? "bg-slate-100" : ""}`}
                >
                  {s.type === "stock" && s.stock ? (
                    <>
                      <span className="orbitron text-sm font-black text-slate-900">{s.stock.symbol}</span>
                      <span className="truncate text-xs font-semibold text-slate-600">{s.stock.companyName}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-slate-400">{s.stock.sector}</span>
                    </>
                  ) : s.type === "guru" && s.guru ? (
                    <>
                      <span className="text-xs">👤</span>
                      <span className="text-sm font-bold text-amber-700">{s.guru.name}</span>
                      <span className="ml-auto rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-700">투자자</span>
                    </>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
