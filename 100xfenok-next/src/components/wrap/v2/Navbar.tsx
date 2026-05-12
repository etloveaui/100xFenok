"use client";

import Link from "next/link";

type NavLink = { href: string; label: string; active?: boolean };

const LINKS: NavLink[] = [
  { href: "/", label: "DASHBOARD" },
  { href: "/100x/daily-wrap/?v2=1", label: "DAILY WRAP", active: true },
  { href: "/alpha-scout", label: "ALPHA SCOUT" },
  { href: "/ib", label: "IB HELPER" },
];

export default function WrapNavbar() {
  return (
    <header className="mw-nav">
      <div className="mw-nav-inner">
        <Link href="/" className="mw-brand">
          <span className="mw-brand-100x">100x</span>
          <span className="mw-brand-fenok">FenoK</span>
        </Link>
        <nav className="mw-nav-links" aria-label="주요 메뉴">
          {LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className={link.active ? "on" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="mw-nav-right">
          <button type="button" className="mw-pill">
            <i className="fas fa-search" aria-hidden="true" />
            <span>⌘ K</span>
          </button>
          <button type="button" className="mw-icon-btn" aria-label="알림">
            <i className="fas fa-bell" aria-hidden="true" />
          </button>
          <button type="button" className="mw-icon-btn" aria-label="설정">
            <i className="fas fa-cog" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
