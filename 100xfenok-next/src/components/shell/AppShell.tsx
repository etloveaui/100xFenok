"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { usePathname } from "next/navigation";
import BrandLogo from "@/components/BrandLogo";
import ConnectedView from "@/components/connected/ConnectedView";
import TransitionLink from "@/components/TransitionLink";
import TickerTypeahead from "@/components/TickerTypeahead";
import AppShellFreshnessPill from "@/components/shell/AppShellFreshnessPill";
import UserAuthPill from "@/components/shell/UserAuthPill";
import AdoptStorePrompt from "@/components/personal/AdoptStorePrompt";
import { useUserHeartbeat } from "@/lib/auth/clientAuth";
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
} from "@/lib/product-nav";
import { ROUTES } from "@/lib/routes";
import { currentJourneyReturnTo } from "@/lib/journey-context";
import type { DataState } from "@/lib/data-state";
import { useModal } from "@/hooks/useModal";
import { NavItemPending, useNavigationPending } from "@/components/shell/navigation-progress";
import { normalizeShellPathname, resolveShellRoute } from "@/components/shell/shell-routes";

/**
 * Product shell (v3 design handoff): desktop = left rail + global top bar +
 * ticker strip; mobile = app header + bottom tab bar (PWA standalone-safe).
 * CSS: src/styles/app-shell.css (.fnk-shell scope).
 *
 * The chrome is persistent: `AppShellFrame` (root layout) draws it once and
 * keeps it mounted across client navigations, so the rail, tab bar, search
 * box, ticker tape and signed-in state never blink or refetch between pages.
 * Pages keep rendering `<AppShell active title backHref freshness>` — inside
 * the frame that call only registers the page's chrome state (title, back
 * link, freshness pill) and returns the page content. Outside a frame (a route
 * missing from shell-routes.ts) AppShell draws the chrome itself as before.
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
  | "research"
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
    label: "시황",
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
    id: "research",
    group: "분석",
    label: "리서치",
    href: ROUTES.research,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 3.5h7.5L15.5 6.5v10h-10.5z" />
        <path d="M12 3.5v3.5h3.5" />
        <path d="M7.5 10.5h5M7.5 13.5h5" />
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
  "research",
  "ib",
  "vr",
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

const MORE_NAV_GROUPS: NavGroup[] = NAV_GROUPS.map((group) => ({
  label: group.label,
  items: group.items.filter((item) => MORE_TAB_IDS.includes(item.id)),
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

function TypeaheadPreviewDrawer({
  ticker,
  onClose,
  panelRef,
}: {
  ticker: string;
  onClose: () => void;
  panelRef: Ref<HTMLDivElement>;
}) {
  const [entry, setEntry] = useState<StockConnectionEntry | null | undefined>(undefined);
  const [services, setServices] = useState<StockServicesEntry | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

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
    closeButtonRef.current?.focus();
  }, []);

  return (
    <div
      ref={panelRef}
      className="typeahead-preview"
      data-testid="typeahead-preview"
      role="dialog"
      aria-modal="true"
      aria-labelledby="typeahead-preview-title"
    >
      <div className="typeahead-preview__head">
        <div className="typeahead-preview__title">
          <span>연결 미리보기</span>
          <strong id="typeahead-preview-title">{ticker}</strong>
        </div>
        <button ref={closeButtonRef} type="button" className="typeahead-preview__close" onClick={onClose} aria-label="미리보기 닫기">
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
        <TransitionLink href={ROUTES.stock(ticker, currentJourneyReturnTo())} onClick={onClose} className="typeahead-preview__primary">
          전체 보기
        </TransitionLink>
      </div>
    </div>
  );
}

// The tape is one shared load: both strips read the same rows, and AppShell
// renders no strip at all once the load settles empty, so the reserved band
// height never outlives its content. Until the first result the space stays
// reserved, which keeps the common case free of layout shift.
function useTape(): { items: TapeItem[]; settled: boolean } {
  const [tape, setTape] = useState<{ items: TapeItem[]; settled: boolean }>({ items: [], settled: false });
  useEffect(() => {
    let cancelled = false;
    const settle = (items: TapeItem[]) => { if (!cancelled) setTape({ items, settled: true }); };
    loadTape().then(settle).catch(() => settle([]));
    return () => {
      cancelled = true;
    };
  }, []);
  return tape;
}

function Tape({ items }: { items: TapeItem[] }) {
  const fmt = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  const seq = [...items, ...items];
  // The period label sits outside the moving track: as the first track item
  // it scrolled away within seconds and left bare "+66.9%" figures behind.
  return (
    <>
      <span className="tk-label">연초 대비</span>
      <div className="ticker-track">
        {seq.map((it, i) => (
          <span key={`${it.label}-${i}`} className="tk-item">
            <span className="s">{it.label}</span>
            {it.price ? <span className="p num">{it.price}</span> : null}
            <span className={`num ${it.pct >= 0 ? "up" : "down"}`}>{fmt(it.pct)}</span>
          </span>
        ))}
      </div>
    </>
  );
}

type AppShellMeta = {
  active?: ShellPage;
  title: string;
  backHref?: string;
  backLabel?: string;
  freshness?: DataState | null;
};

type ShellRegistration = { pathname: string; meta: AppShellMeta };

type ShellFrameApi = {
  register: (registration: ShellRegistration) => void;
  unregister: (registration: ShellRegistration) => void;
};

const ShellFrameContext = createContext<ShellFrameApi | null>(null);

function sameFreshness(a: DataState | null | undefined, b: DataState | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameRegistration(a: ShellRegistration, b: ShellRegistration): boolean {
  return (
    a.pathname === b.pathname &&
    a.meta.active === b.meta.active &&
    a.meta.title === b.meta.title &&
    a.meta.backHref === b.meta.backHref &&
    a.meta.backLabel === b.meta.backLabel &&
    sameFreshness(a.meta.freshness, b.meta.freshness)
  );
}

function ShellChrome({
  meta,
  pathname,
  children,
}: {
  meta: AppShellMeta;
  pathname: string;
  children: ReactNode;
}) {
  const { active, title, backHref, backLabel = "뒤로", freshness } = meta;
  useUserHeartbeat();
  const navPending = useNavigationPending();
  const [searching, setSearching] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [typeaheadPreviewTicker, setTypeaheadPreviewTicker] = useState<string | null>(null);
  const [status, setStatus] = useState<{ dot: string; text: string }>(() => marketStatusKST());
  const moreModal = useModal("mobile-more");
  const previewModal = useModal("typeahead-preview");
  const moreOpen = moreModal.isOpen;
  const moreCloseRef = useRef<HTMLButtonElement>(null);
  const navActive: ShellPage | null = active && NAV.some((item) => item.id === active) ? active : null;
  const tape = useTape();
  const tickerVisible = tape.items.length > 0;
  // Only a settled empty tape releases the reserved band height.
  const tickerOff = tape.settled && !tickerVisible;

  // The chrome outlives the page, so transient chrome UI (mobile search, More
  // sheet, stock preview) must close when the route changes underneath it.
  const [routePath, setRoutePath] = useState(pathname);
  if (routePath !== pathname) {
    setRoutePath(pathname);
    setSearching(false);
    if (moreModal.isOpen) moreModal.close();
    if (previewModal.isOpen) previewModal.close();
  }

  const handleTypeaheadStockPreview = (ticker: string) => {
    moreModal.close();
    setTypeaheadPreviewTicker(ticker);
    previewModal.open();
    setSearching(false);
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
    document.body.classList.toggle("fnk-shell-ticker-off", tickerOff);
    return () => {
      document.body.classList.remove("fnk-shell-ticker-off");
    };
  }, [tickerOff]);

  useEffect(() => {
    if (!moreOpen) return;
    moreCloseRef.current?.focus();
  }, [moreOpen]);

  useEffect(() => {
    const update = () => {
      const next = window.scrollY > 480;
      setShowScrollTop((current) => (current === next ? current : next));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  const closeTypeaheadPreview = () => {
    previewModal.close();
    setTypeaheadPreviewTicker(null);
  };

  const openMore = () => {
    closeTypeaheadPreview();
    moreModal.open();
  };

  const scrollToTop = () => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    window.scrollTo({ top: 0, left: 0, behavior });
  };

  return (
    <div className="fnk-shell" data-shell-frame="">
      <div className="nav-progress" aria-hidden="true" data-active={navPending ? "" : undefined} />
      {/* desktop left rail */}
      <aside className="rail">
        <TransitionLink href={ROUTES.home} className="rail-logo" aria-label="100x Fenok 홈">
          <BrandLogo size="md" />
          <span>
            100x <b>Fenok</b>
          </span>
        </TransitionLink>
        <nav className="rail-nav" aria-label="사이트 메뉴">
          {NAV_GROUPS.map((group, groupIndex) => (
            <section key={group.label} className="rail-group" aria-labelledby={`rail-group-${groupIndex}`}>
              <h2 id={`rail-group-${groupIndex}`} className="rail-sect">{group.label}</h2>
              {group.items.map((n) => {
                return (
                  <TransitionLink
                    key={n.id}
                    href={n.href}
                    className={`rail-item ${n.id === navActive ? "on" : ""}`}
                    aria-current={n.id === navActive ? "page" : undefined}
                  >
                    {n.icon} {n.label}
                    <NavItemPending />
                  </TransitionLink>
                );
              })}
            </section>
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
          <UserAuthPill />
        </div>
      </header>

      {/* ticker strip — no rows, no band, no reserved height */}
      {tickerVisible ? (
        <div className="ticker" aria-hidden="true">
          <Tape items={tape.items} />
        </div>
      ) : null}

      {/* mobile app header */}
      <header className={`appbar ${searching ? "searching" : ""}`}>
        <div className="appbar-main">
          {backHref ? (
            <TransitionLink href={backHref} className="back" aria-label={backLabel}>
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
          <UserAuthPill />
          <span className="grow" />
          <button
            className="ic-btn"
            aria-label={searching ? "검색 닫기" : "검색 열기"}
            aria-expanded={searching}
            aria-controls="mobile-search"
            onClick={() => setSearching((v) => !v)}
          >
            <SearchIcon />
          </button>
        </div>
        <div id="mobile-search" className="msearch">
          <div className="gs2">
            <SearchIcon />
            <TickerTypeahead
              placeholder="종목명, 티커 검색"
              focusOnOpen={searching}
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              formClass="flex w-full items-center"
              onStockSelect={handleTypeaheadStockPreview}
            />
          </div>
        </div>
        {tickerVisible ? (
          <div className="mticker" aria-hidden="true">
            <Tape items={tape.items} />
          </div>
        ) : null}
      </header>

      <div className="content" aria-busy={navPending || undefined}>{children}</div>
      {typeaheadPreviewTicker && previewModal.isOpen ? (
        <div className="typeahead-preview-layer">
          <button type="button" className="typeahead-preview-backdrop" aria-label="미리보기 닫기" onClick={closeTypeaheadPreview} />
          <TypeaheadPreviewDrawer
            key={typeaheadPreviewTicker}
            ticker={typeaheadPreviewTicker}
            onClose={closeTypeaheadPreview}
            panelRef={previewModal.modalProps.ref}
          />
        </div>
      ) : null}

      {/* mobile bottom tab bar */}
      <nav className="tabbar" aria-label="주요 메뉴">
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
                onClick={() => (moreOpen ? moreModal.close() : openMore())}
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
              <NavItemPending />
            </TransitionLink>
          );
        })}
      </nav>
      <button
        type="button"
        className="scroll-top"
        aria-label="페이지 맨 위로 이동"
        onClick={scrollToTop}
        hidden={!showScrollTop}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 14l6-6 6 6" />
          <path d="M12 8v10" />
        </svg>
      </button>
      {moreOpen ? (
        <div id="mobile-more-sheet" className="mobile-more-sheet">
          <div className="mobile-more-backdrop" onClick={moreModal.close} aria-hidden="true" />
          <div
            className="mobile-more-panel"
            {...moreModal.modalProps}
            aria-labelledby="mobile-more-title"
          >
            <div className="mobile-more-header">
              <span id="mobile-more-title">더보기</span>
              <button ref={moreCloseRef} type="button" onClick={moreModal.close} className="mobile-more-close" aria-label="닫기">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <nav className="mobile-more-list" aria-label="추가 메뉴">
              {MORE_NAV_GROUPS.map((group, groupIndex) => (
                <section key={group.label} className="mobile-more-group" aria-labelledby={`mobile-more-group-${groupIndex}`}>
                  <h2 id={`mobile-more-group-${groupIndex}`} className="mobile-more-group-title">{group.label}</h2>
                  <div className="mobile-more-group-items">
                    {group.items.map((n) => (
                      <TransitionLink
                        key={n.id}
                        href={n.href}
                        className={`mobile-more-item ${n.id === navActive ? "on" : ""}`}
                        onClick={moreModal.close}
                        aria-current={n.id === navActive ? "page" : undefined}
                      >
                        <span className="mobile-more-icon">{n.icon}</span>
                        <span className="mobile-more-label">{n.label}</span>
                      </TransitionLink>
                    ))}
                  </div>
                </section>
              ))}
            </nav>
          </div>
        </div>
      ) : null}
      <AdoptStorePrompt />
    </div>
  );
}

/**
 * Root-layout host for the persistent chrome. Shell routes (shell-routes.ts)
 * get the chrome immediately — on the server render and on the loading state
 * of a client navigation — using the route table's defaults; the page's own
 * `<AppShell>` props take over as soon as it mounts. Other routes (admin,
 * winddown, intro, /ib, …) render untouched.
 */
export function AppShellFrame({ children }: { children: ReactNode }) {
  const pathname = normalizeShellPathname(usePathname());
  const routeMeta = resolveShellRoute(pathname);
  const [registration, setRegistration] = useState<ShellRegistration | null>(null);
  const api = useMemo<ShellFrameApi>(
    () => ({
      register: (next) => setRegistration((prev) => (prev && sameRegistration(prev, next) ? prev : next)),
      unregister: (gone) => setRegistration((prev) => (prev && sameRegistration(prev, gone) ? null : prev)),
    }),
    [],
  );

  if (!routeMeta) return <>{children}</>;
  const meta = registration && registration.pathname === pathname ? registration.meta : routeMeta;
  return (
    <ShellFrameContext.Provider value={api}>
      <ShellChrome meta={meta} pathname={pathname}>
        {children}
      </ShellChrome>
    </ShellFrameContext.Provider>
  );
}

export default function AppShell({
  active,
  title,
  backHref,
  backLabel = "뒤로",
  freshness,
  children,
}: {
  active?: ShellPage;
  title: string;
  backHref?: string;
  backLabel?: string;
  freshness?: DataState | null;
  children: ReactNode;
}) {
  const frame = useContext(ShellFrameContext);
  const pathname = normalizeShellPathname(usePathname());

  useLayoutEffect(() => {
    if (!frame) return;
    const registration: ShellRegistration = { pathname, meta: { active, title, backHref, backLabel, freshness } };
    frame.register(registration);
    return () => frame.unregister(registration);
  }, [frame, pathname, active, title, backHref, backLabel, freshness]);

  if (frame) return <>{children}</>;
  return (
    <ShellChrome meta={{ active, title, backHref, backLabel, freshness }} pathname={pathname}>
      {children}
    </ShellChrome>
  );
}
