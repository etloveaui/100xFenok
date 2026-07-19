"use client";

import { useEffect, useState, type ReactNode } from "react";
import BrandLogo from "@/components/BrandLogo";
import ConnectedView from "@/components/connected/ConnectedView";
import TransitionLink from "@/components/TransitionLink";
import TickerTypeahead from "@/components/TickerTypeahead";
import AppShellFreshnessPill from "@/components/shell/AppShellFreshnessPill";
import {
  getStockConnection,
  getStockServices,
  loadStockConnectionIndex,
  loadStockServicesIndex,
  type StockConnectionEntry,
  type StockServicesEntry,
} from "@/lib/data-entity-graph/stock-index";
import {
  CHART_NAV_LABEL,
  CHART_ROUTE,
  EXPLORE_NAV_LABEL,
  EXPLORE_ROUTE,
  WORKBENCH_NAV_LABEL,
} from "@/lib/product-nav";
import { ROUTES } from "@/lib/routes";
import type { DataState } from "@/lib/data-state";

/**
 * Product shell (v3 design handoff): desktop = left rail + global top bar +
 * ticker strip; mobile = app header + bottom tab bar (PWA standalone-safe).
 * V1 Navbar/Footer are hidden via body.fnk-shell-on (globals.css) while a
 * shell page is mounted. CSS: src/styles/app-shell.css (.fnk-shell scope).
 */

export type ShellPage =
  | "explore"
  | "workbench"
  | "market"
  | "regime"
  | "sectors"
  | "etfs"
  | "screener"
  | "superinvestors"
  | "portfolio"
  | "chart"
  | "dailyWrap"
  | "posts"
  | "alphaScout"
  | "stockAnalyzer"
  | "ib"
  | "vr";

type NavGroupName = "분석" | "도구" | "더보기";
type NavItem = { id: ShellPage; group: NavGroupName; label: string; href: string; icon: ReactNode };
type MobileTabId = ShellPage | "more";
type NavGroup = { label: NavGroupName; items: NavItem[] };

const NAV: NavItem[] = [
  {
    id: "explore",
    group: "분석",
    label: EXPLORE_NAV_LABEL,
    href: EXPLORE_ROUTE,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M3.5 9.2L10 3.8l6.5 5.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.4 8.6v7.2h9.2V8.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8.4 15.8v-4.2h3.2v4.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "market",
    group: "분석",
    label: "시장",
    href: ROUTES.market,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M2.5 13.5l4-4.5 3 2.5L17 4.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 4.5h4v4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "regime",
    group: "분석",
    label: "국면",
    href: ROUTES.regime,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M4 12a6 6 0 1112 0" strokeLinecap="round" />
        <path d="M10 12l3-4" strokeLinecap="round" />
        <path d="M5.5 15h9" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "sectors",
    group: "분석",
    label: "섹터",
    href: ROUTES.sectors,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="3" width="6" height="6" rx="1.5" />
        <rect x="11" y="3" width="6" height="6" rx="1.5" />
        <rect x="3" y="11" width="6" height="6" rx="1.5" />
        <rect x="11" y="11" width="6" height="6" rx="1.5" />
      </svg>
    ),
  },
  {
    id: "etfs",
    group: "분석",
    label: "ETF",
    href: ROUTES.etfs,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
        <path d="M10 2.8l7 3.8-7 3.8-7-3.8 7-3.8z" />
        <path d="M3 10l7 3.8 7-3.8" strokeLinecap="round" />
        <path d="M3 13.4l7 3.8 7-3.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "screener",
    group: "분석",
    label: "스크리너",
    href: ROUTES.screener,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <path d="M3 6h9M15 6h2M3 14h2M9 14h8" />
        <circle cx="13.5" cy="6" r="2" fill="var(--c-panel)" />
        <circle cx="6.5" cy="14" r="2" fill="var(--c-panel)" />
      </svg>
    ),
  },
  {
    id: "superinvestors",
    group: "분석",
    label: "투자자",
    href: ROUTES.superinvestors,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="7.2" cy="7.5" r="2.6" />
        <path d="M2.6 16c0-2.6 2-4.2 4.6-4.2s4.6 1.6 4.6 4.2" strokeLinecap="round" />
        <path d="M13.5 7.2a2.3 2.3 0 100-.2M14 11.9c2 .3 3.5 1.7 3.5 4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "portfolio",
    group: "분석",
    label: "포트폴리오",
    href: ROUTES.portfolio,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="2.5" y="6" width="15" height="10.5" rx="2" />
        <path d="M7 6V4.6c0-.9.6-1.6 1.5-1.6h3c.9 0 1.5.7 1.5 1.6V6" strokeLinecap="round" />
        <path d="M2.5 10.5h15" />
      </svg>
    ),
  },
  {
    id: "chart",
    group: "분석",
    label: CHART_NAV_LABEL,
    href: CHART_ROUTE,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="3.5" width="14" height="13" rx="2" />
        <path d="M6 12l2.4-3 2.2 2 3.4-4.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 15h8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "ib",
    group: "도구",
    label: "무한매수",
    href: ROUTES.ib,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M3.8 10c1.7-3.3 4.2-3.3 6.2 0s4.5 3.3 6.2 0" strokeLinecap="round" />
        <path d="M3.8 10c1.7 3.3 4.2 3.3 6.2 0s4.5-3.3 6.2 0" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "vr",
    group: "도구",
    label: "VR 계산기",
    href: ROUTES.vr,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 3v13M5 6h10M5 6l-2 4h4zM15 6l-2 4h4z" />
        <path d="M6.5 16h7" />
      </svg>
    ),
  },
  {
    id: "workbench",
    group: "더보기",
    label: WORKBENCH_NAV_LABEL,
    href: ROUTES.workbench,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="10" cy="10" r="7.5" />
        <path d="M13.2 6.8l-2 4.4-4.4 2 2-4.4z" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "dailyWrap",
    group: "더보기",
    label: "Daily Wrap",
    href: ROUTES.dailyWrap,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="3.5" width="14" height="13" rx="2" />
        <path d="M6 7h8M6 10h5M6 13h7" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "posts",
    group: "더보기",
    label: "아카이브",
    href: ROUTES.posts,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M5 3.5h7l3 3v10H5z" strokeLinejoin="round" />
        <path d="M12 3.5v4h4M7.5 10.5h5M7.5 13.5h4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "alphaScout",
    group: "더보기",
    label: "Alpha Scout (미리보기)",
    href: ROUTES.alphaScout,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="8.5" cy="8.5" r="4.8" />
        <path d="M12 12l4 4M14.5 4.5l.7 1.4 1.5.2-1.1 1.1.3 1.5-1.4-.7-1.4.7.3-1.5-1.1-1.1 1.5-.2z" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "stockAnalyzer",
    group: "더보기",
    label: "종목분석 (레거시)",
    href: ROUTES.stockAnalyzer,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="3" y="3.5" width="14" height="13" rx="2" />
        <path d="M6.2 12.8l2.3-2.7 2 1.8 3.3-4.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 15h8" strokeLinecap="round" />
      </svg>
    ),
  },
];

const MORE_TAB: Omit<NavItem, "id" | "group"> & { id: "more" } = {
  id: "more",
  label: "더보기",
  href: "#more",
  icon: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <circle cx="10" cy="4.5" r="1.5" fill="currentColor" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" />
      <circle cx="10" cy="15.5" r="1.5" fill="currentColor" />
    </svg>
  ),
};

const PRIMARY_TAB_IDS: MobileTabId[] = ["explore", "market", "screener", "portfolio", "more"];
const MORE_TAB_IDS: ShellPage[] = [
  "chart",
  "workbench",
  "ib",
  "vr",
  "dailyWrap",
  "posts",
  "alphaScout",
  "stockAnalyzer",
  "regime",
  "sectors",
  "etfs",
  "superinvestors",
];

const NAV_GROUP_ORDER: NavGroupName[] = ["분석", "도구", "더보기"];

const NAV_GROUPS: NavGroup[] = NAV_GROUP_ORDER.map((label) => ({
  label,
  items: NAV.filter((item) => item.group === label),
})).filter((group) => group.items.length > 0);

function navById(id: ShellPage): NavItem {
  return NAV.find((item) => item.id === id)!;
}

interface TapeItem {
  label: string;
  price: string | null;
  pct: number;
}

let tapeCache: TapeItem[] | null = null;
let tapePending: Promise<TapeItem[]> | null = null;
// indices YTD from the already-cached benchmarks file — no extra API surface
function loadTape(): Promise<TapeItem[]> {
  if (tapeCache) return Promise.resolve(tapeCache);
  if (tapePending) return tapePending;
  tapePending = fetch("/data/benchmarks/summaries.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((bench) => {
      const items: TapeItem[] = [];
      const labels: Array<[string, string]> = [
        ["sp500", "S&P 500"],
        ["nasdaq100", "나스닥 100"],
        ["russell2000", "러셀 2000"],
        ["kospi", "코스피"],
        ["nikkei", "니케이"],
        ["emerging", "신흥국"],
      ];
      for (const [key, label] of labels) {
        const v = bench?.momentum?.[key]?.ytd;
        if (typeof v === "number") items.push({ label, price: null, pct: v * 100 });
      }
      tapeCache = items;
      return items;
    });
  return tapePending;
}

function marketStatusKST(): { dot: string; text: string } {
  // US cash session in ET, displayed compactly; weekend-aware
  const now = new Date();
  const et = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => et.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  const mins = parseInt(get("hour"), 10) * 60 + parseInt(get("minute"), 10);
  if (wd === "Sat" || wd === "Sun") return { dot: "var(--c-neutral)", text: "주말 휴장" };
  if (mins >= 570 && mins < 960) return { dot: "var(--c-up)", text: "정규장" };
  if (mins >= 240 && mins < 570) return { dot: "var(--c-warn)", text: "프리마켓" };
  if (mins >= 960 && mins < 1200) return { dot: "var(--c-warn)", text: "애프터마켓" };
  return { dot: "var(--c-neutral)", text: "장 마감" };
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M14 14l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M6 8a4 4 0 018 0c0 3 1 4.2 1.6 4.8H4.4C5 12.2 6 11 6 8z" strokeLinejoin="round" />
      <path d="M8.4 15.5a1.7 1.7 0 003.2 0" strokeLinecap="round" />
    </svg>
  );
}

function TypeaheadPreviewDrawer({
  ticker,
  onClose,
}: {
  ticker: string;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState<StockConnectionEntry | null | undefined>(undefined);
  const [services, setServices] = useState<StockServicesEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    Promise.all([
      loadStockConnectionIndex(controller.signal),
      loadStockServicesIndex(controller.signal),
    ]).then(([stockIndex, servicesIndex]) => {
      if (cancelled) return;
      setEntry(getStockConnection(stockIndex, ticker));
      setServices(getStockServices(servicesIndex, ticker));
    }).catch(() => {
      if (cancelled) return;
      setEntry(null);
      setServices(null);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [ticker]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <aside
      className="typeahead-preview"
      data-testid="typeahead-preview"
      role="dialog"
      aria-label={`${ticker} 연결 미리보기`}
    >
      <div className="typeahead-preview__head">
        <div className="typeahead-preview__title">
          <span>연결 미리보기</span>
          <strong>{ticker}</strong>
        </div>
        <button type="button" className="typeahead-preview__close" onClick={onClose} aria-label="미리보기 닫기">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="typeahead-preview__body">
        {entry === null ? (
          <div className="typeahead-preview__empty">
            <strong>{ticker}</strong>
            <span>연결 인덱스에는 아직 잡히지 않은 종목입니다.</span>
          </div>
        ) : (
          <ConnectedView ticker={ticker} entry={entry} services={services} variant="drawer" compact />
        )}
      </div>
      <div className="typeahead-preview__actions">
        <button type="button" onClick={onClose} className="typeahead-preview__secondary">닫기</button>
        <TransitionLink href={ROUTES.stock(ticker)} onClick={onClose} className="typeahead-preview__primary">
          전체 보기
        </TransitionLink>
      </div>
    </aside>
  );
}

function Tape() {
  const [items, setItems] = useState<TapeItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadTape().then((t) => {
      if (!cancelled) setItems(t);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (items.length === 0) return null;
  const fmt = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  const seq = [...items, ...items];
  return (
    <div className="ticker-track">
      <span className="tk-item"><span className="p">YTD</span></span>
      {seq.map((it, i) => (
        <span key={`${it.label}-${i}`} className="tk-item">
          <span className="s">{it.label}</span>
          {it.price ? <span className="p num">{it.price}</span> : null}
          <span className={`num ${it.pct >= 0 ? "up" : "down"}`}>{fmt(it.pct)}</span>
        </span>
      ))}
    </div>
  );
}

export default function AppShell({
  active,
  title,
  backHref,
  freshness,
  children,
}: {
  active?: ShellPage;
  title: string;
  backHref?: string;
  freshness?: DataState | null;
  children: ReactNode;
}) {
  const [searching, setSearching] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [typeaheadPreviewTicker, setTypeaheadPreviewTicker] = useState<string | null>(null);
  const [status, setStatus] = useState<{ dot: string; text: string }>(() => marketStatusKST());
  const navActive = active && NAV.some((item) => item.id === active) ? active : "explore";

  const handleTypeaheadStockPreview = (ticker: string) => {
    setTypeaheadPreviewTicker(ticker);
    setSearching(false);
    setMoreOpen(false);
  };

  useEffect(() => {
    document.body.classList.add("fnk-shell-on");
    const t = setInterval(() => setStatus(marketStatusKST()), 60_000);
    return () => {
      document.body.classList.remove("fnk-shell-on");
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moreOpen]);

  return (
    <>
      {/* desktop left rail */}
      <aside className="rail">
        <TransitionLink href={ROUTES.home} className="rail-logo" aria-label="100x Fenok 홈">
          <BrandLogo size="md" />
          <span>
            100x <b>Fenok</b>
          </span>
        </TransitionLink>
        <nav className="rail-nav">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="rail-group">
              <div className="rail-sect">{group.label}</div>
              {group.items.map((n) => {
                return (
                  <TransitionLink key={n.id} href={n.href} className={`rail-item ${n.id === navActive ? "on" : ""}`}>
                    {n.icon} {n.label}
                  </TransitionLink>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* desktop top bar */}
      <header className="topbar">
        <div className="gsearch">
          <SearchIcon />
          <TickerTypeahead
            placeholder="종목명, 티커 검색 — 연결 미리보기"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            formClass="flex w-full items-center"
            onStockSelect={handleTypeaheadStockPreview}
          />
        </div>
        <div className="spacer" />
        <div className="topbar-actions">
          {status ? (
            <span className="mstatus">
              <span className="dot" style={{ background: status.dot }} /> {status.text}
            </span>
          ) : null}
          <AppShellFreshnessPill state={freshness} />
          <button className="ic-btn" aria-label="알림">
            <BellIcon />
          </button>
        </div>
      </header>

      {/* ticker strip */}
      <div className="ticker" aria-hidden="true">
        <Tape />
      </div>

      {/* mobile app header */}
      <header className={`appbar ${searching ? "searching" : ""}`}>
        <div className="appbar-main">
          {backHref ? (
            <TransitionLink href={backHref} className="back" aria-label="뒤로">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </TransitionLink>
          ) : (
            <TransitionLink href={ROUTES.home} className="appbar-logo" aria-label="100x Fenok 홈">
              <BrandLogo size="md" />
            </TransitionLink>
          )}
          <span className="title">{title}</span>
          {status ? (
            <span className="mstat">
              <span className="dot" style={{ background: status.dot }} /> {status.text}
            </span>
          ) : null}
          <AppShellFreshnessPill state={freshness} />
          <span className="grow" />
          <button className="ic-btn" aria-label="검색" onClick={() => setSearching((v) => !v)}>
            <SearchIcon />
          </button>
        </div>
        <div className="msearch">
          <div className="gs2">
            <SearchIcon />
            <TickerTypeahead
              placeholder="종목명, 티커 검색"
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              formClass="flex w-full items-center"
              onStockSelect={handleTypeaheadStockPreview}
            />
          </div>
        </div>
        <div className="mticker" aria-hidden="true">
          <Tape />
        </div>
      </header>

      <div className="content">{children}</div>
      {typeaheadPreviewTicker ? (
        <TypeaheadPreviewDrawer
          key={typeaheadPreviewTicker}
          ticker={typeaheadPreviewTicker}
          onClose={() => setTypeaheadPreviewTicker(null)}
        />
      ) : null}

      {/* mobile bottom tab bar */}
      <nav className="tabbar">
        {PRIMARY_TAB_IDS.map((id) => {
          const n = id === "more" ? MORE_TAB : navById(id);
          if (id === "more") {
            const moreActive = moreOpen || MORE_TAB_IDS.includes(navActive as ShellPage);
            return (
              <button
                key={id}
                type="button"
                aria-expanded={moreOpen}
                aria-controls="mobile-more-sheet"
                aria-haspopup="dialog"
                onClick={() => setMoreOpen((v) => !v)}
                className={`tab ${moreActive ? "on" : ""}`}
              >
                {n.icon} {n.label}
              </button>
            );
          }
          return (
            <TransitionLink
              key={id}
              href={n.href}
              className={`tab ${id === navActive ? "on" : ""}`}
              aria-current={id === navActive ? "page" : undefined}
            >
              {n.icon} {n.label}
            </TransitionLink>
          );
        })}
      </nav>
      {moreOpen ? (
        <div id="mobile-more-sheet" className="mobile-more-sheet" role="dialog" aria-modal="true" aria-label="더보기 메뉴">
          <div className="mobile-more-backdrop" onClick={() => setMoreOpen(false)} aria-hidden="true" />
          <div className="mobile-more-panel">
            <div className="mobile-more-header">
              <span>더보기</span>
              <button type="button" onClick={() => setMoreOpen(false)} className="mobile-more-close" aria-label="닫기">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <nav className="mobile-more-list" aria-label="추가 메뉴">
              {MORE_TAB_IDS.map((id) => {
                const n = navById(id);
                return (
                  <TransitionLink
                    key={id}
                    href={n.href}
                    className={`mobile-more-item ${id === navActive ? "on" : ""}`}
                    onClick={() => setMoreOpen(false)}
                    aria-current={id === navActive ? "page" : undefined}
                  >
                    <span className="mobile-more-icon">{n.icon}</span>
                    <span className="mobile-more-label">{n.label}</span>
                  </TransitionLink>
                );
              })}
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}
