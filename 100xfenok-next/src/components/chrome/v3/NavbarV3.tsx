"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { v2cx } from "@/components/dashboard/v2/types";
import CommandPaletteV2 from "@/components/chrome/v2/CommandPaletteV2";

const TABS = ["DASHBOARD", "MARKET", "ANALYTICS", "STRATEGIES", "TOOLS"] as const;
const TABS_WITH_CHEVRON = new Set(["MARKET", "ANALYTICS", "STRATEGIES", "TOOLS"]);

type Props = {
  alertsUnread: number;
  onToggleInbox: () => void;
  onOpenBuilder: () => void;
};

/**
 * V3 navigation chrome. Extends NavbarV2 with a bell button (count badge)
 * and a "Watch builder" CTA. Cmd+K palette is reused from V2.
 */
export default function NavbarV3({
  alertsUnread,
  onToggleInbox,
  onOpenBuilder,
}: Props) {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("DASHBOARD");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        onToggleInbox();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggleInbox]);

  return (
    <>
      <header
        className={v2cx("hp-nav", isMobile && "hp-nav--mob")}
        style={{ position: "sticky" }}
      >
        <Link href="/?v3=1" className="hp-nav__brand">
          <div className="hp-nav__mark">
            <Image
              src="/100x-fenok-logo.png"
              alt=""
              width={22}
              height={22}
              aria-hidden="true"
            />
          </div>
          <span className="hp-nav__wordmark">
            100x <span>FENOK</span>
          </span>
        </Link>

        {!isMobile ? (
          <nav className="hp-nav__tabs" aria-label="주요 메뉴">
            {TABS.map((tab, idx) => (
              <span
                key={tab}
                style={{ display: "inline-flex", alignItems: "center" }}
              >
                <button
                  type="button"
                  className={v2cx("hp-nav__tab", activeTab === tab && "is-active")}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                  {TABS_WITH_CHEVRON.has(tab) ? (
                    <i className="fas fa-chevron-down hp-nav__chev" aria-hidden="true" />
                  ) : null}
                </button>
                {idx < TABS.length - 1 ? (
                  <span className="hp-nav__sep" aria-hidden="true" />
                ) : null}
              </span>
            ))}
          </nav>
        ) : null}

        <div className="hp-nav__actions">
          {isMobile ? (
            <>
              <button
                type="button"
                className="hp-icon-btn"
                onClick={() => setPaletteOpen(true)}
                aria-label="검색"
              >
                <i className="fas fa-search" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="hp-bell-btn"
                onClick={onToggleInbox}
                aria-label={`알림 ${alertsUnread}건`}
              >
                <i className="fas fa-bell" aria-hidden="true" />
                {alertsUnread > 0 ? (
                  <span className="hp-bell-btn__badge">{alertsUnread}</span>
                ) : null}
              </button>
              <button type="button" className="hp-icon-btn" aria-label="메뉴">
                <i className="fas fa-bars" aria-hidden="true" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="hp-search-trigger"
                onClick={() => setPaletteOpen(true)}
                aria-label="명령어 팔레트 열기"
              >
                <i className="fas fa-search" aria-hidden="true" />
                <span>티커 · 리포트 · &quot;watch VIX&gt;25&quot;…</span>
                <span className="hp-search-trigger__kbd">⌘K</span>
              </button>
              <button
                type="button"
                className="hp-bell-btn"
                onClick={onToggleInbox}
                aria-label={`알림 ${alertsUnread}건`}
              >
                <i className="fas fa-bell" aria-hidden="true" />
                {alertsUnread > 0 ? (
                  <span className="hp-bell-btn__badge">{alertsUnread}</span>
                ) : null}
              </button>
              <button
                type="button"
                className="hp-btn hp-btn--pill"
                onClick={onOpenBuilder}
                style={{ marginLeft: 4 }}
              >
                + Watch
              </button>
              <div className="hp-avatar" title="Fenok 사용자" aria-label="사용자 프로필">
                FK
              </div>
            </>
          )}
        </div>
      </header>
      <CommandPaletteV2 open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}
