"use client";

import { useEffect, useState, type ReactNode } from "react";
import TransitionLink from "@/components/TransitionLink";
import TickerTypeahead from "@/components/TickerTypeahead";

/**
 * Product shell (v3 design handoff): desktop = left rail + global top bar +
 * ticker strip; mobile = app header + bottom tab bar (PWA standalone-safe).
 * V1 Navbar/Footer are hidden via body.fnk-shell-on (globals.css) while a
 * shell page is mounted. CSS: src/styles/app-shell.css (.fnk-shell scope).
 */

export type ShellPage =
  | "explore"
  | "market"
  | "sectors"
  | "screener"
  | "superinvestors"
  | "portfolio";

const NAV: Array<{ id: ShellPage; label: string; href: string; icon: ReactNode }> = [
  {
    id: "explore",
    label: "탐색",
    href: "/explore",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="10" cy="10" r="7.5" />
        <path d="M13.2 6.8l-2 4.4-4.4 2 2-4.4z" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "market",
    label: "시장",
    href: "/market-valuation",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path d="M2.5 13.5l4-4.5 3 2.5L17 4.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 4.5h4v4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "sectors",
    label: "섹터",
    href: "/sectors",
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
    id: "screener",
    label: "스크리너",
    href: "/screener",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <path d="M3 6h9M15 6h2M3 14h2M9 14h8" />
        <circle cx="13.5" cy="6" r="2" fill="#fff" />
        <circle cx="6.5" cy="14" r="2" fill="#fff" />
      </svg>
    ),
  },
  {
    id: "superinvestors",
    label: "구루",
    href: "/superinvestors",
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
    label: "포트폴리오",
    href: "/portfolio",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="2.5" y="6" width="15" height="10.5" rx="2" />
        <path d="M7 6V4.6c0-.9.6-1.6 1.5-1.6h3c.9 0 1.5.7 1.5 1.6V6" strokeLinecap="round" />
        <path d="M2.5 10.5h15" />
      </svg>
    ),
  },
];

// 5 mobile slots: real pages only (no dead "더보기" sheet yet)
const TAB_IDS: ShellPage[] = ["explore", "market", "screener", "superinvestors", "portfolio"];

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
        ["emerging", "이머징"],
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
  children,
}: {
  active: ShellPage;
  title: string;
  children: ReactNode;
}) {
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<{ dot: string; text: string } | null>(null);

  useEffect(() => {
    document.body.classList.add("fnk-shell-on");
    setStatus(marketStatusKST());
    const t = setInterval(() => setStatus(marketStatusKST()), 60_000);
    return () => {
      document.body.classList.remove("fnk-shell-on");
      clearInterval(t);
    };
  }, []);

  return (
    <>
      {/* desktop left rail */}
      <aside className="rail">
        <TransitionLink href="/" className="rail-logo">
          <span className="mk">F</span>
          <span>
            100x <b>Fenok</b>
          </span>
        </TransitionLink>
        <nav className="rail-nav">
          {NAV.map((n) => (
            <TransitionLink key={n.id} href={n.href} className={`rail-item ${n.id === active ? "on" : ""}`}>
              {n.icon} {n.label}
            </TransitionLink>
          ))}
        </nav>
      </aside>

      {/* desktop top bar */}
      <header className="topbar">
        <div className="gsearch">
          <SearchIcon />
          <TickerTypeahead
            placeholder="종목명, 티커 검색 — 종목 상세로 이동"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
            formClass="flex w-full items-center"
          />
        </div>
        <div className="spacer" />
        <div className="topbar-actions">
          {status ? (
            <span className="mstatus">
              <span className="dot" style={{ background: status.dot }} /> {status.text}
            </span>
          ) : null}
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
          <span className="title">{title}</span>
          {status ? (
            <span className="mstat">
              <span className="dot" style={{ background: status.dot }} /> {status.text}
            </span>
          ) : null}
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
            />
          </div>
        </div>
        <div className="mticker" aria-hidden="true">
          <Tape />
        </div>
      </header>

      <div className="content">{children}</div>

      {/* mobile bottom tab bar */}
      <nav className="tabbar">
        {TAB_IDS.map((id) => {
          const n = NAV.find((x) => x.id === id)!;
          return (
            <TransitionLink key={id} href={n.href} className={`tab ${id === active ? "on" : ""}`}>
              {n.icon} {n.label}
            </TransitionLink>
          );
        })}
      </nav>
    </>
  );
}
