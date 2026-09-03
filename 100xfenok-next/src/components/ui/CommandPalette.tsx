"use client";
import * as React from "react";
import { ROUTES, SITEMAP_PRODUCT_ROUTES, withQuery } from "@/lib/routes";
import { getWatchlist, toggleWatch, useWatchlist } from "@/lib/watchlist";
import { StaticStockAnalyzerDataProvider } from "@/features/stock-analyzer/data/static-data-provider";
import { stooqSeriesIdFromInput } from "@/lib/macro-chart/stooq";

/* ---- chosung utilities (no hangul-js) ---- */
const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
function toChosung(str: string) {
  let out = "";
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const choIdx = Math.floor((code - 0xac00) / (21 * 28));
      out += CHO[choIdx];
    } else if (code >= 0x3131 && code <= 0x314e) {
      out += ch;
    } else {
      out += ch;
    }
  }
  return out;
}
function matchesChosung(query: string, target: string) {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) return true;
  const tCho = toChosung(target);
  const qCho = toChosung(query);
  // initial-consonant search: query is jamo sequence like "ㅅㅇ"
  if (/^[ㄱ-ㅎ]+$/.test(q)) return tCho.includes(q);
  if (/^[ㄱ-ㅎ]+$/.test(qCho)) return tCho.includes(qCho);
  return tCho.includes(q) || t.includes(qCho);
}

type Item = {
  id: string;
  label: string;
  sub?: string;
  section: "종목" | "화면" | "동작";
  href?: string;
  kbd?: string;
  action?: () => void;
};

/* ---- screen items derived from canonical sitemap routes (legacy/retired excluded) ---- */
const SCREEN_LABELS: Record<string, { label: string; kbd?: string }> = {
  [ROUTES.home]: { label: "홈" },
  [ROUTES.market]: { label: "시장" },
  [ROUTES.marketStructure]: { label: "시장 구조" },
  [ROUTES.regime]: { label: "시장 국면" },
  [ROUTES.marketEvents]: { label: "시장 이벤트" },
  [ROUTES.sectors]: { label: "섹터 히트맵", kbd: "g h" },
  [ROUTES.etfs]: { label: "ETF" },
  [ROUTES.etfCompare]: { label: "ETF 비교" },
  [ROUTES.etfNew]: { label: "신규 상장 ETF" },
  [ROUTES.screener]: { label: "스크리너", kbd: "g s" },
  [ROUTES.superinvestors]: { label: "투자자" },
  [ROUTES.portfolio]: { label: "포트폴리오" },
  [ROUTES.ib]: { label: "무한매수" },
  [ROUTES.vr]: { label: "VR 전략 가이드" },
  [ROUTES.radar]: { label: "Market Radar" },
  [ROUTES.macroChart]: { label: "차트" },
  [ROUTES.multichart]: { label: "시장 비교" },
};

const SCREEN_ITEMS: Item[] = SITEMAP_PRODUCT_ROUTES.filter((r) => SCREEN_LABELS[r.path]).map((r) => ({
  id: `screen:${r.path}`,
  label: SCREEN_LABELS[r.path].label,
  sub: r.path,
  section: "화면",
  href: r.path,
  kbd: SCREEN_LABELS[r.path].kbd,
}));

/* ---- stock universe (stocks_analyzer.json 1,066-ticker universe, module-cached) ---- */
type StockRow = { symbol: string; companyName: string; sector: string };
const stocksProvider = new StaticStockAnalyzerDataProvider();
let stocksCache: StockRow[] | null = null;
let stocksPromise: Promise<StockRow[]> | null = null;
function loadStocks(): Promise<StockRow[]> {
  if (stocksCache) return Promise.resolve(stocksCache);
  if (stocksPromise) return stocksPromise;
  stocksPromise = stocksProvider.load()
    .then((records) => records.map((record) => ({
      symbol: String(record.symbol ?? ""),
      companyName: String(record.companyName ?? ""),
      sector: String(record.sector ?? ""),
    })).filter((row) => row.symbol.length > 0))
    .then((rows) => {
      stocksCache = rows;
      return rows;
    })
    .catch(() => { stocksPromise = null; return []; });
  return stocksPromise;
}

function matchStocks(query: string, stocks: StockRow[]): StockRow[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const exact: StockRow[] = [];
  const prefix: StockRow[] = [];
  const rest: StockRow[] = [];
  for (const s of stocks) {
    const sym = s.symbol.toLowerCase();
    if (sym === q) { exact.push(s); continue; }
    if (sym.startsWith(q)) { prefix.push(s); continue; }
    if (matchesChosung(query, s.symbol) || matchesChosung(query, s.companyName) || (s.sector && matchesChosung(query, s.sector))) {
      rest.push(s);
    }
  }
  return [...exact, ...prefix, ...rest].slice(0, 8);
}

function stockRow(s: StockRow): Item {
  const meta = [s.companyName, s.sector].filter(Boolean).join(" · ");
  return {
    id: `stock:${s.symbol}`,
    label: s.symbol,
    sub: meta || undefined,
    section: "종목",
    href: ROUTES.stock(s.symbol),
  };
}

const G_SEQUENCE_WINDOW_MS = 600;

function eventTargetInDialog(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (target && typeof target.closest === "function" && target.closest('[role="dialog"], dialog, [aria-modal="true"]')) return true;
  if (typeof document !== "undefined" && document.querySelector('[role="dialog"], dialog[open]')) return true;
  return false;
}

export function CommandPalette({ items, onSelect }: { items?: Item[]; onSelect?: (id: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [showHelp, setShowHelp] = React.useState(false);
  const [recent, setRecent] = React.useState<string[]>([]);
  const [stocks, setStocks] = React.useState<StockRow[]>([]);
  const watchlist = useWatchlist();
  const gArmedAt = React.useRef(0);

  React.useEffect(() => {
    try {
      const v = localStorage.getItem("ls-cp-recent");
      if (v) setRecent(JSON.parse(v));
    } catch {}
  }, []);

  // Load the ticker universe lazily on first open; never blocks first paint.
  React.useEffect(() => {
    if (!open || stocksCache) { if (stocksCache) setStocks(stocksCache); return; }
    let cancelled = false;
    loadStocks().then((rows) => { if (!cancelled) setStocks(rows); });
    return () => { cancelled = true; };
  }, [open ]);

  const bySymbol = React.useMemo(() => {
    const m = new Map<string, StockRow>();
    for (const s of stocks) m.set(s.symbol.toUpperCase(), s);
    return m;
  }, [stocks]);

  const pushRecent = (id: string) => {
    const next = [id, ...recent.filter((x) => x !== id)].slice(0, 5);
    setRecent(next);
    try { localStorage.setItem("ls-cp-recent", JSON.stringify(next)); } catch {}
  };

  const dynamicItems: Item[] = React.useMemo(() => {
    const q = query.trim();
    if (!q) {
      const watched = getWatchlist()
        .map((t) => bySymbol.get(t.toUpperCase()))
        .filter((s): s is StockRow => Boolean(s))
        .slice(0, 5)
        .map(stockRow);
      const top = watched.length > 0 ? watched : stocks.slice(0, 3).map(stockRow);
      return [...top, ...SCREEN_ITEMS];
    }
    const hits = matchStocks(q, stocks).map(stockRow);
    const screens = SCREEN_ITEMS.filter(
      (it) => matchesChosung(q, it.label) || matchesChosung(q, it.sub ?? ""),
    );
    const actions: Item[] = [];
    const context = hits[0];
    if (context) {
      const sym = context.label;
      const watched = watchlist.includes(sym.toUpperCase());
      actions.push({
        id: `action:watch:${sym}`,
        label: watched ? `${sym}을 관심종목에서 해제` : `${sym}을 관심종목에 추가`,
        sub: watched ? "관심종목에 있음" : "관심종목에 없음",
        section: "동작",
        kbd: "w",
        action: () => { toggleWatch(sym); },
      });
      const second = hits.slice(1).find((h) => h.label !== sym);
      const idA = stooqSeriesIdFromInput(sym);
      const idB = second ? stooqSeriesIdFromInput(second.label) : null;
      if (second && idA && idB) {
        actions.push({
          id: `action:compare:${sym}+${second.label}`,
          label: `${sym} vs ${second.label} 비교 차트 열기`,
          sub: ROUTES.multichart,
          section: "동작",
          kbd: "c",
          href: withQuery(ROUTES.multichart, { series: `${idA},${idB}`, transform: "rebase100,rebase100" }),
        });
      }
    }
    return [...hits, ...screens, ...actions];
  }, [query, stocks, bySymbol, watchlist]);

  const allItems = items ?? dynamicItems;

  const filtered = React.useMemo(() => {
    if (items) {
      if (!query) return allItems;
      return allItems.filter((it) => matchesChosung(query, it.label) || matchesChosung(query, it.sub ?? ""));
    }
    return allItems;
  }, [items, allItems, query]);

  const grouped = React.useMemo(() => {
    const g: Record<string, Item[]> = { 종목: [], 화면: [], 동작: [] };
    for (const it of filtered) g[it.section].push(it);
    return g;
  }, [filtered]);

  const flat = filtered;

  const select = React.useCallback((it: Item, opts?: { keepOpen?: boolean }) => {
    pushRecent(it.id);
    onSelect?.(it.id);
    if (it.href) window.location.href = it.href;
    it.action?.();
    if (!opts?.keepOpen) setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSelect, recent]);

  const openPalette = (help: boolean) => {
    setOpen(true);
    setQuery("");
    setActive(0);
    setShowHelp(help);
    gArmedAt.current = 0;
  };

  /* Global open shortcuts + g s / g h sequences (palette closed). */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (target?.isContentEditable ?? false);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); return; }
      if (open || isEditable || eventTargetInDialog(e)) { gArmedAt.current = 0; return; }
      if (e.key === "?" ) {
        e.preventDefault();
        openPalette(true);
        return;
      }
      if (e.key.length === 1 && e.key.charCodeAt(0) === 47) {
        e.preventDefault(); openPalette(false); return;
      }
      const now = Date.now();
      if (e.key === "g") { gArmedAt.current = now; return; }
      if (now - gArmedAt.current <= G_SEQUENCE_WINDOW_MS && (e.key === "s" || e.key === "h")) {
        gArmedAt.current = 0;
        e.preventDefault();
        window.location.href = e.key === "s" ? ROUTES.screener : ROUTES.sectors;
        return;
      }
      gArmedAt.current = 0;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /* In-palette navigation (palette open). */
  React.useEffect(() => {
    if (!open) return;
    document.documentElement.dataset.cpOpen = "1";
    const onJK = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (target?.isContentEditable ?? false);
      if (isEditable) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          // allow arrow navigation while typing — fall through
        } else if (e.key.length === 1 || e.key === "Escape") {
          if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
          return;
        }
      }
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); return; }
      if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); return; }
      if (!isEditable && (e.key === "w" || e.key === "c")) {
        const row = flat.find((it) => it.kbd === e.key && it.section === "동작");
        if (row) { e.preventDefault(); select(row, e.key === "w" ? { keepOpen: true } : undefined); }
        return;
      }
      if (e.key === "Enter" && flat[active]) {
        e.preventDefault();
        const it = flat[active];
        select(it, it.kbd === "w" ? { keepOpen: true } : undefined);
      }
    };
    window.addEventListener("keydown", onJK);
    return () => {
      window.removeEventListener("keydown", onJK);
      delete document.documentElement.dataset.cpOpen;
    };
  }, [open, flat, active, select]);

  if (!open) return null;

  // Recent ids resolve against the full stock universe + screen registry, not the
  // current empty-query list, so previously opened tickers survive reopen.
  const recentItems = recent
    .map((id) => {
      const found = allItems.find((x) => x.id === id);
      if (found) return found;
      if (id.startsWith("stock:")) {
        const sym = id.slice("stock:".length);
        if (!sym) return undefined;
        const row = bySymbol.get(sym.toUpperCase());
        if (row) return stockRow(row);
        return { id, label: sym, section: "종목", href: ROUTES.stock(sym) } as Item;
      }
      if (id.startsWith("screen:")) {
        return SCREEN_ITEMS.find((x) => x.id === id);
      }
      return undefined;
    })
    .filter((it): it is Item => Boolean(it));
  const recentTickers = recentItems
    .filter((it) => it.section === "종목")
    .map((it) => it.label);

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[18vh]" role="dialog" aria-modal="true" aria-label="명령 팔레트">
      <button aria-label="close" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />
      <div className="relative w-[min(640px,92vw)] bg-white rounded-[8px] border border-[var(--fnk-neutral-200)] shadow-[0_16px_40px_rgba(15,23,42,0.18)] overflow-hidden">
        <div className="flex items-center gap-3 h-12 px-4 border-b border-[var(--fnk-neutral-200)]">
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            placeholder="종목, 화면, 동작 검색 — 초성 검색 지원 (예: ㅅㅇ)"
            className="flex-1 outline-none text-[13px] placeholder:text-[var(--fnk-neutral-500)]"
          />
          <span className="text-[11px] text-[var(--fnk-neutral-500)] border border-[var(--fnk-neutral-200)] rounded px-1.5 py-0.5">⌘K</span>
          <button onClick={() => setShowHelp((v) => !v)} className="text-[11px] text-[var(--fnk-neutral-500)] border border-[var(--fnk-neutral-200)] rounded px-1.5 py-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-interactive">?</button>
        </div>
        {showHelp && (
          <div className="px-4 py-3 bg-[var(--fnk-neutral-50)] border-b border-[var(--fnk-neutral-200)] text-[11px] text-[var(--fnk-neutral-600)] grid grid-cols-2 gap-2">
            <span><b>⌘K</b> / <b>/</b> 열기</span><span><b>?</b> 도움말</span>
            <span><b>j/k</b> 이동</span><span><b>↵</b> 선택</span>
            <span><b>g s</b> 스크리너</span><span><b>g h</b> 섹터 히트맵</span>
            <span><b>w</b> 관심종목 토글</span><span><b>c</b> 비교 차트</span>
          </div>
        )}
        <div className="max-h-[42vh] overflow-auto py-2">
          {recentItems.length > 0 && !query && (
            <div className="px-2 pb-2">
              <div className="text-[11px] font-semibold tracking-[0.06em] uppercase text-[var(--fnk-neutral-500)] px-2 py-1">최근</div>
              {recentItems.map((it) => (
                <button
                  key={`recent-${it.id}`}
                  onClick={() => select(it, it.kbd === "w" ? { keepOpen: true } : undefined)}
                  className="w-full text-left px-2 py-1.5 rounded-[6px] text-[13px] text-[var(--fnk-neutral-700)] flex justify-between hover:bg-[var(--fnk-neutral-50)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-interactive"
                >
                  <span>{it.label}</span><span className="text-[var(--fnk-neutral-500)] text-[11px]">{it.sub}</span>
                </button>
              ))}
            </div>
          )}
          {(["종목", "화면", "동작"] as const).map((sec) => (
            grouped[sec].length > 0 && (
              <div key={sec} className="px-2">
                <div className="text-[11px] font-semibold tracking-[0.06em] uppercase text-[var(--fnk-neutral-500)] px-2 py-1">{sec}</div>
                {grouped[sec].map((it) => {
                  const idx = flat.indexOf(it);
                  const isActive = idx === active;
                  const starred = it.section === "종목" && watchlist.includes(it.label.toUpperCase());
                  return (
                    <button
                      key={it.id}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => select(it, it.kbd === "w" ? { keepOpen: true } : undefined)}
                      className={`w-full text-left px-2 py-1.5 rounded-[6px] flex items-center justify-between text-[13px] transition-colors duration-120 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-interactive ${isActive ? "bg-[var(--fnk-neutral-50)] shadow-[inset_2px_0_0_#1B73D3] text-[var(--fnk-neutral-900)]" : "text-[var(--fnk-neutral-700)] hover:bg-[var(--fnk-neutral-50)]"}`}
                    >
                      <span className="font-medium">{starred ? "★ " : ""}{it.label}</span>
                      <span className="text-[11px] text-[var(--fnk-neutral-500)] flex items-center gap-2">
                        <span>{it.sub}</span>
                        {it.kbd && (
                          <span className="border border-[var(--fnk-neutral-200)] rounded px-1.5 py-0.5">{it.kbd}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )
          ))}
          {filtered.length === 0 && <div className="px-4 py-8 text-center text-[13px] text-[var(--fnk-neutral-500)]">검색 결과 없음</div>}
        </div>
        <div className="flex items-center gap-3 h-9 px-4 border-t border-[var(--fnk-neutral-200)] text-[11px] text-[var(--fnk-neutral-500)]">
          {recentTickers.length > 0 && (
            <span>최근: <span className="mono text-[var(--fnk-neutral-500)]">{recentTickers.join(" · ")}</span></span>
          )}
          <span className="ml-auto"><span className="border border-[var(--fnk-neutral-200)] rounded px-1 py-px">⌘K</span> 어디서든 열기 · <span className="border border-[var(--fnk-neutral-200)] rounded px-1 py-px">?</span> 단축키</span>
        </div>
      </div>
    </div>
  );
}
