"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import BrandLogo from "@/components/BrandLogo";
import TransitionLink from "@/components/TransitionLink";
import TickerTypeahead from "@/components/TickerTypeahead";
import AppShellFreshnessPill from "@/components/shell/AppShellFreshnessPill";
import UserAuthPill from "@/components/shell/UserAuthPill";
import AdoptStorePrompt from "@/components/personal/AdoptStorePrompt";
import { useUserHeartbeat } from "@/lib/auth/clientAuth";
import {
  CHART_NAV_LABEL,
  CHART_ROUTE,
  EXPLORE_NAV_LABEL,
  EXPLORE_ROUTE,
} from "@/lib/product-nav";
import { ROUTES } from "@/lib/routes";
import type { DataState } from "@/lib/data-state";
import { useModal } from "@/hooks/useModal";
import { NavItemPending, useNavigationPending } from "@/components/shell/navigation-progress";
import { normalizeShellPathname, resolveShellRoute } from "@/components/shell/shell-routes";
import { openCommandPalette } from "@/components/ui/CommandPalette";

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
  | "vr"
  | "changes"
  | "events";

/**
 * The rail is grouped by the job a visit is for, not by page type:
 * 오늘 = what happened, 시장 = understand the market, 발견 = find names,
 * 내 투자 = my holdings, 도구 = calculators and reading. URLs are unchanged.
 */
type NavGroupName = "오늘" | "시장" | "발견" | "내 투자" | "도구";
type NavItem = { id: ShellPage; group: NavGroupName; label: string; href: string; icon: ReactNode };
type MobileTabId = ShellPage | "more";
type NavGroup = { label: NavGroupName; items: NavItem[] };

/** Nav items in their order inside each group; groups render in NAV_GROUP_ORDER. */
const NAV: NavItem[] = [
  {
    id: "explore",
    group: "오늘",
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
    id: "changes",
    group: "오늘",
    label: "무엇이 바뀌었나",
    href: ROUTES.changes,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h10.5M11.5 4l3 3-3 3" />
        <path d="M16 13H5.5M8.5 10l-3 3 3 3" />
      </svg>
    ),
  },
  {
    id: "market",
    group: "시장",
    label: "밸류에이션",
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
    group: "시장",
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
    id: "events",
    group: "시장",
    label: "이벤트",
    href: ROUTES.marketEvents,
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
        <path d="M3 8.5h14M7 3v3M13 3v3" />
        <path d="M6.5 12h2M11.5 12h2" />
      </svg>
    ),
  },
  {
    id: "sectors",
    group: "시장",
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
    id: "chart",
    group: "시장",
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
    id: "screener",
    group: "발견",
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
    id: "etfs",
    group: "발견",
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
    id: "superinvestors",
    group: "발견",
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
    group: "내 투자",
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
    id: "research",
    group: "도구",
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
/** Mobile tab labels where the tab names an area rather than its first page. */
const TAB_LABELS: Partial<Record<ShellPage, string>> = { market: "시장" };
/** Every nav page except the primary tabs, in nav order. */
const MORE_TAB_IDS: ShellPage[] = [
  "changes",
  "regime",
  "events",
  "sectors",
  "chart",
  "etfs",
  "superinvestors",
  "ib",
  "vr",
  "research",
];
/**
 * Which bottom tab lights up for a page. A market page (시황, 이벤트, 섹터, 차트)
 * lights 시장, the same area its in-page 밸류에이션·시황·이벤트·섹터 pills name,
 * and 무엇이 바뀌었나 lights 홈; everything else without a tab of its own lights 더보기.
 */
const TAB_FOR_PAGE: Partial<Record<ShellPage, MobileTabId>> = {
  explore: "explore",
  changes: "explore",
  market: "market",
  regime: "market",
  events: "market",
  sectors: "market",
  chart: "market",
  screener: "screener",
  portfolio: "portfolio",
};

const NAV_GROUP_ORDER: NavGroupName[] = ["오늘", "시장", "발견", "내 투자", "도구"];

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

function subscribeNever(): () => void {
  return () => {};
}

/** Server and first paint say ⌘K; other platforms switch to Ctrl K after hydration. */
function macShortcutLabel(): string {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M14 14l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
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
  const [status, setStatus] = useState<{ dot: string; text: string }>(() => marketStatusKST());
  const moreModal = useModal("mobile-more");
  const moreOpen = moreModal.isOpen;
  const moreCloseRef = useRef<HTMLButtonElement>(null);
  const navActive: ShellPage | null = active && NAV.some((item) => item.id === active) ? active : null;
  const activeTab: MobileTabId | null = navActive ? TAB_FOR_PAGE[navActive] ?? "more" : null;
  const paletteShortcut = useSyncExternalStore(subscribeNever, macShortcutLabel, () => "⌘K");
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
  }

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

  const openMore = () => {
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
            placeholder="종목명, 티커 검색"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            formClass="flex w-full items-center"
          />
          <button
            type="button"
            className="kbd"
            onClick={openCommandPalette}
            aria-label={`화면·종목 빠른 이동 열기 (${paletteShortcut})`}
            title="화면·종목 빠른 이동 · / 키로도 열립니다"
          >
            {paletteShortcut}
          </button>
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

      {/* mobile bottom tab bar */}
      <nav className="tabbar" aria-label="주요 메뉴">
        {PRIMARY_TAB_IDS.map((id) => {
          const n = id === "more" ? MORE_TAB : navById(id);
          if (id === "more") {
            const moreActive = moreOpen || activeTab === "more";
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
              className={`tab ${id === activeTab ? "on" : ""}`}
              aria-current={id === navActive ? "page" : id === activeTab ? "true" : undefined}
            >
              {n.icon} {TAB_LABELS[id as ShellPage] ?? n.label}
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
