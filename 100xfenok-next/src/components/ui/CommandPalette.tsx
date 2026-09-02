"use client";
import * as React from "react";
import { ROUTES } from "@/lib/routes";

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

type Item = { id: string; label: string; sub?: string; section: "종목" | "화면" | "동작"; href?: string; action?: () => void };

const DEFAULT_ITEMS: Item[] = [
  { id: "ticker-nvda", label: "NVDA", sub: "엔비디아", section: "종목", href: ROUTES.stock("NVDA") },
  { id: "ticker-000880", label: "000880.KS", sub: "한화", section: "종목", href: ROUTES.stock("000880.KS") },
  { id: "route-home", label: "홈", sub: ROUTES.home, section: "화면", href: ROUTES.home },
  { id: "route-screener", label: "스크리너", sub: ROUTES.screener, section: "화면", href: ROUTES.screener },
  { id: "route-stock", label: "종목", sub: "/stock/:ticker", section: "화면", href: ROUTES.stock("NVDA") },
  { id: "action-retry", label: "재시도", sub: "데이터 재시도", section: "동작" },
];

export function CommandPalette({ items = DEFAULT_ITEMS, onSelect }: { items?: Item[]; onSelect?: (id: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [showHelp, setShowHelp] = React.useState(false);
  const [recent, setRecent] = React.useState<string[]>([]);

  React.useEffect(() => {
    try {
      const v = localStorage.getItem("ls-cp-recent");
      if (v) setRecent(JSON.parse(v));
    } catch {}
  }, []);

  const pushRecent = (id: string) => {
    const next = [id, ...recent.filter((x) => x !== id)].slice(0, 5);
    setRecent(next);
    try { localStorage.setItem("ls-cp-recent", JSON.stringify(next)); } catch {}
  };

  const filtered = React.useMemo(() => {
    if (!query) return items;
    return items.filter((it) => matchesChosung(query, it.label) || matchesChosung(query, it.sub ?? ""));
  }, [items, query]);

  const grouped = React.useMemo(() => {
    const g: Record<string, Item[]> = { 종목: [], 화면: [], 동작: [] };
    for (const it of filtered) g[it.section].push(it);
    return g;
  }, [filtered]);

  const flat = filtered;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !open) { e.preventDefault(); setShowHelp((v) => !v); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); return; }
      if (e.key === "/" && !open && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault(); setOpen(true); return;
      }
      if (e.key === "Escape" && open) { setOpen(false); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onJK = (e: KeyboardEvent) => {
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
      if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
      if (e.key === "Enter" && flat[active]) {
        const it = flat[active];
        pushRecent(it.id);
        onSelect?.(it.id);
        if (it.href) window.location.href = it.href;
        it.action?.();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onJK);
    return () => window.removeEventListener("keydown", onJK);
  }, [open, flat, active, onSelect, recent]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[18vh]" role="dialog" aria-modal="true">
      <button aria-label="close" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />
      <div className="relative w-[min(640px,92vw)] bg-white rounded-[8px] border border-[#e2e8f0] shadow-[0_16px_40px_rgba(15,23,42,0.18)] overflow-hidden">
        <div className="flex items-center gap-3 h-12 px-4 border-b border-[#e2e8f0]">
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            placeholder="종목, 화면, 동작 검색 — 초성 검색 지원 (예: ㅅㅇ)"
            className="flex-1 outline-none text-[13px] placeholder:text-[#94a3b8]"
          />
          <span className="text-[11px] text-[#94a3b8] border border-[#e2e8f0] rounded px-1.5 py-0.5">⌘K</span>
          <button onClick={() => setShowHelp((v) => !v)} className="text-[11px] text-[#64748b] border border-[#e2e8f0] rounded px-1.5 py-0.5">?</button>
        </div>
        {showHelp && (
          <div className="px-4 py-3 bg-[#f8fafc] border-b border-[#e2e8f0] text-[11px] text-[#475569] grid grid-cols-2 gap-2">
            <span><b>⌘K</b> / <b>/</b> 열기</span><span><b>?</b> 도움말</span>
            <span><b>j/k</b> 이동</span><span><b>↵</b> 선택</span>
          </div>
        )}
        <div className="max-h-[42vh] overflow-auto py-2">
          {recent.length > 0 && !query && (
            <div className="px-2 pb-2">
              <div className="text-[11px] font-semibold tracking-[0.06em] uppercase text-[#64748b] px-2 py-1">최근</div>
              {recent.map((id) => {
                const it = items.find((x) => x.id === id);
                if (!it) return null;
                return (
                  <div key={`recent-${id}`} className="px-2 py-1.5 text-[13px] text-[#334155] flex justify-between hover:bg-[#f8fafc]">
                    <span>{it.label}</span><span className="text-[#94a3b8] text-[11px]">{it.sub}</span>
                  </div>
                );
              })}
            </div>
          )}
          {(["종목", "화면", "동작"] as const).map((sec) => (
            grouped[sec].length > 0 && (
              <div key={sec} className="px-2">
                <div className="text-[11px] font-semibold tracking-[0.06em] uppercase text-[#64748b] px-2 py-1">{sec}</div>
                {grouped[sec].map((it) => {
                  const idx = flat.indexOf(it);
                  const isActive = idx === active;
                  return (
                    <button
                      key={it.id}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => {
                        pushRecent(it.id);
                        onSelect?.(it.id);
                        if (it.href) window.location.href = it.href;
                        it.action?.();
                        setOpen(false);
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded-[6px] flex items-center justify-between text-[13px] transition-colors duration-120 ${isActive ? "bg-[#f8fafc] shadow-[inset_2px_0_0_#1B73D3] text-[#0f172a]" : "text-[#334155] hover:bg-[#f8fafc]"}`}
                    >
                      <span className="font-medium">{it.label}</span>
                      <span className="text-[11px] text-[#94a3b8]">{it.sub}</span>
                    </button>
                  );
                })}
              </div>
            )
          ))}
          {filtered.length === 0 && <div className="px-4 py-8 text-center text-[13px] text-[#64748b]">검색 결과 없음</div>}
        </div>
      </div>
    </div>
  );
}
