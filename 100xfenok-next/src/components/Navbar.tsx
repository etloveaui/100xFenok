'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobilePanelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const scrollOffsetRef = useRef(0);
  const pathname = usePathname();

  const isDashboard = pathname === '/';
  const isMarket = pathname === '/market' || pathname === '/alpha-scout';
  const isAnalytics = pathname === '/multichart' || pathname === '/radar' || pathname === '/posts';
  const isStrategies = pathname === '/ib' || pathname === '/infinite-buying' || pathname === '/vr';

  const closeMobileMenu = () => setMobileMenuOpen(false);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const body = document.body;
    scrollOffsetRef.current = window.scrollY;
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollOffsetRef.current}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    closeButtonRef.current?.focus();

    return () => {
      body.style.overflow = '';
      body.style.position = '';
      body.style.top = '';
      body.style.left = '';
      body.style.right = '';
      body.style.width = '';
      window.scrollTo(0, scrollOffsetRef.current);
      previouslyFocusedRef.current?.focus();
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        return;
      }

      if (event.key !== 'Tab') return;
      const panel = mobilePanelRef.current;
      if (!panel) return;

      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'));

      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [mobileMenuOpen]);

  return (
    <>
      <nav className="relative w-full z-50" id="mainNav">
        <div className="nav-wrapper w-full bg-white shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] border-b border-gray-100 sticky top-0">
          <div className="container mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
            {/* Brand */}
              <Link
                href="/"
                className="flex items-center gap-2 sm:gap-3 group flex-shrink-0 min-w-0 cursor-pointer"
                aria-label="Go to home"
              >
                <div className="brand-logo w-8 h-8 sm:w-10 sm:h-10 bg-white rounded-xl flex items-center justify-center shadow-md group-hover:scale-105 transition-all duration-300 border border-slate-100 active:scale-95">
                  <Image
                    src="/favicon.svg"
                    alt=""
                    width={32}
                    height={32}
                    priority
                    sizes="(max-width: 640px) 24px, 32px"
                    className="h-6 w-6 sm:h-8 sm:w-8"
                  />
                </div>
                <span className="brand-text font-[900] orbitron text-slate-800 text-base min-[390px]:text-lg sm:text-xl leading-none tracking-tight whitespace-nowrap">
                  100x <span className="text-brand-gold">FENOK</span>
                </span>
              </Link>

              {/* Desktop Navigation */}
              <nav className="nav-text-only hidden md:flex items-center gap-1 ml-6">
                {/* DASHBOARD */}
                <Link
                  href="/"
                  aria-current={isDashboard ? 'page' : undefined}
                  className={`nav-pill h-10 flex items-center px-4 text-xs font-[800] rounded-t-lg orbitron tracking-wide ${
                    isDashboard
                      ? 'text-brand-navy border-b-2 border-brand-navy bg-blue-50/50'
                      : 'text-slate-500 border-b-2 border-transparent hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  DASHBOARD
                </Link>

              <div className="h-4 w-[1px] bg-gray-200 mx-1" />

              {/* MARKET Dropdown */}
              <div className="relative dropdown-wrapper h-full flex items-center group">
                <button
                  type="button"
                  className={`nav-pill px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1 group-hover:bg-white group-hover:shadow-sm ${
                    isMarket
                      ? 'text-brand-navy bg-blue-50/50'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                  aria-haspopup="true"
                  aria-expanded="false"
                >
                  MARKET
                  <i className="fas fa-chevron-down text-[8px] opacity-30 group-hover:text-brand-gold transition-colors" />
                </button>
                <div className="dropdown-menu absolute top-full left-0 mt-1 w-[min(90vw,220px)] bg-white border border-gray-200 shadow-xl rounded-xl p-2 opacity-0 invisible group-hover:visible group-hover:opacity-100 transition-all transform group-hover:translate-y-0 translate-y-[-10px] z-50">
                  <div className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-gray-100 mb-1">Briefing</div>
                  <Link href="/market" className="flex items-center px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg group/link transition-colors">
                    <span className="w-1 h-4 bg-brand-gold rounded-full mr-3 opacity-0 group-hover/link:opacity-100 transition-opacity" />
                    <div>
                      <span className="block font-bold text-slate-700">Market Wrap</span>
                      <span className="text-[10px] text-slate-500">Daily Updates</span>
                    </div>
                  </Link>
                  <Link href="/alpha-scout" className="flex items-center px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg group/link transition-colors">
                    <span className="w-1 h-4 bg-brand-interactive rounded-full mr-3 opacity-0 group-hover/link:opacity-100 transition-opacity" />
                    <div>
                      <span className="block font-bold text-slate-700">Alpha Scout</span>
                      <span className="text-[10px] text-slate-500">Weekly Deep Dive</span>
                    </div>
                  </Link>
                </div>
              </div>

              {/* ANALYTICS Dropdown */}
              <div className="relative dropdown-wrapper h-full flex items-center group">
                <button type="button" className={`nav-pill px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1 group-hover:bg-white group-hover:shadow-sm ${
                    isAnalytics
                      ? 'text-brand-navy bg-blue-50/50'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                  aria-haspopup="true"
                  aria-expanded="false"
                >
                  ANALYTICS
                  <i className="fas fa-chevron-down text-[8px] opacity-30 group-hover:text-brand-gold transition-colors" />
                </button>
                <div className="dropdown-menu absolute top-full right-0 mt-1 w-[min(90vw,360px)] bg-white border border-gray-200 shadow-xl rounded-xl p-4 opacity-0 invisible group-hover:visible group-hover:opacity-100 transition-all transform group-hover:translate-y-0 translate-y-[-10px] z-50">
                  <div className="px-1 pb-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-gray-100 mb-2">Tools & Charts</div>
                  <div className="grid grid-cols-3 gap-2">
                    <Link href="/multichart" className="flex flex-col items-center p-3 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all text-center group/card">
                      <i className="fas fa-chart-line text-xl text-brand-interactive mb-2 group-hover/card:scale-110 transition-transform" />
                      <span className="text-xs font-bold text-slate-700">Multichart</span>
                    </Link>
                    <Link href="/radar" className="flex flex-col items-center p-3 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all text-center group/card">
                      <i className="fas fa-satellite-dish text-xl text-brand-navy mb-2 group-hover/card:scale-110 transition-transform" />
                      <span className="text-xs font-bold text-slate-700">Radar</span>
                    </Link>
                    <Link href="/posts" className="relative flex flex-col items-center p-3 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all text-center group/card">
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full ring-2 ring-white animate-pulse" />
                      <i className="fas fa-lightbulb text-xl text-amber-500 mb-2 group-hover/card:scale-110 transition-transform" />
                      <span className="text-xs font-bold text-slate-700">Insights</span>
                    </Link>
                  </div>
                </div>
              </div>

              {/* STRATEGIES Dropdown */}
              <div className="relative dropdown-wrapper h-full flex items-center group">
                <button type="button" className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1 group-hover:bg-white group-hover:shadow-sm ${
                    isStrategies
                      ? 'text-brand-navy bg-blue-50/50'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                  aria-haspopup="true"
                  aria-expanded="false"
                >
                  STRATEGIES
                  <i className="fas fa-chevron-down text-[8px] opacity-30 group-hover:text-brand-gold transition-colors" />
                </button>
                <div className="dropdown-menu absolute top-full right-0 mt-1 w-[min(90vw,280px)] bg-white border border-gray-200 shadow-xl rounded-xl p-3 opacity-0 invisible group-hover:visible group-hover:opacity-100 transition-all transform group-hover:translate-y-0 translate-y-[-10px] z-50">
                  <div className="px-2 pb-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-gray-100 mb-2">Proven Methods</div>
                  <Link href="/ib" className="flex items-start p-2 rounded-lg hover:bg-slate-50 transition-colors mb-1 group/strat">
                    <div className="w-8 h-8 rounded bg-rose-100 flex items-center justify-center text-rose-600 mr-3 mt-0.5 group-hover/strat:bg-rose-200 transition-colors">
                      <i className="fas fa-calculator text-xs" />
                    </div>
                    <div>
                      <span className="block text-sm font-bold text-slate-700 group-hover/strat:text-brand-navy">IB Helper (무한매수)</span>
                      <span className="block text-[10px] text-slate-500 leading-tight mt-0.5">V2.2 실사용 계산기</span>
                    </div>
                  </Link>
                  <Link href="/infinite-buying" className="flex items-start p-2 rounded-lg hover:bg-slate-50 transition-colors mb-1 group/strat">
                    <div className="w-8 h-8 rounded bg-green-100 flex items-center justify-center text-green-600 mr-3 mt-0.5 group-hover/strat:bg-green-200 transition-colors">
                      <i className="fas fa-infinity text-xs" />
                    </div>
                    <div>
                      <span className="block text-sm font-bold text-slate-700 group-hover/strat:text-brand-navy">Infinite Buying</span>
                      <span className="block text-[10px] text-slate-500 leading-tight mt-0.5">DCA strategy for volatile markets</span>
                    </div>
                  </Link>
                  <Link href="/vr" className="flex items-start p-2 rounded-lg hover:bg-slate-50 transition-colors group/strat">
                    <div className="w-8 h-8 rounded bg-brand-gold/20 flex items-center justify-center text-brand-gold mr-3 mt-0.5 group-hover/strat:bg-brand-gold/30 transition-colors">
                      <i className="fas fa-balance-scale text-xs" />
                    </div>
                    <div>
                      <span className="block text-sm font-bold text-slate-700 group-hover/strat:text-brand-navy">Value Rebalancing</span>
                      <span className="block text-[10px] text-slate-500 leading-tight mt-0.5">Asset allocation optimization</span>
                    </div>
                  </Link>
                </div>
              </div>
            </nav>

            {/* Tablet Icon Navigation */}
            <nav className="nav-icon-only hidden sm:flex md:hidden items-center gap-1.5 ml-4" aria-label="Tablet navigation">
              <Link href="/" className={`nav-icon ${isDashboard ? 'active' : ''}`} title="Dashboard" aria-label="Dashboard">
                <i className="fas fa-home" />
              </Link>
              <Link href="/market" className={`nav-icon ${isMarket ? 'active' : ''}`} title="Market" aria-label="Market">
                <i className="fas fa-chart-bar" />
              </Link>
              <Link href="/multichart" className={`nav-icon ${isAnalytics ? 'active' : ''}`} title="Analytics" aria-label="Analytics">
                <i className="fas fa-chart-line" />
              </Link>
              <Link href="/ib" className={`nav-icon ${isStrategies ? 'active' : ''}`} title="Strategies" aria-label="Strategies">
                <i className="fas fa-lightbulb" />
              </Link>
            </nav>

            {/* Mobile Hamburger */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden w-11 h-11 rounded-lg bg-slate-50 text-slate-500 hover:bg-brand-navy hover:text-white transition-all border border-slate-100 shadow-sm flex items-center justify-center"
              aria-label="Open menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-navigation-panel"
            >
              <i className="fas fa-bars text-sm" />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div
          ref={mobilePanelRef}
          id="mobile-navigation-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation menu"
          className="mobile-menu open fixed inset-y-0 right-0 w-[min(22rem,100vw)] bg-white shadow-2xl z-50"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <span className="font-bold orbitron text-slate-800">MENU</span>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeMobileMenu}
              className="w-11 h-11 rounded-lg hover:bg-slate-100 transition-colors flex items-center justify-center"
              aria-label="Close menu"
            >
              <i className="fas fa-times text-slate-600" />
            </button>
          </div>

          <div className="px-4 pt-6 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-2 overflow-y-auto h-[calc(100dvh-4.5rem)]">
            {/* Dashboard */}
            <Link
              href="/"
              onClick={closeMobileMenu}
              className={`block min-h-12 px-4 py-3 rounded-lg font-bold text-sm ${
                isDashboard
                  ? 'bg-blue-50 border-l-4 border-brand-navy text-brand-navy'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <i className="fas fa-home mr-2" /> DASHBOARD
            </Link>

            <details className="group">
              <summary className={`min-h-12 px-4 py-3 rounded-lg hover:bg-slate-50 cursor-pointer font-bold text-sm list-none flex items-center justify-between ${
                  isMarket ? 'text-brand-navy bg-blue-50/30' : 'text-slate-700'
                }`}>
                <span><i className="fas fa-chart-bar mr-2" /> MARKET</span>
                <i className="fas fa-chevron-down text-xs text-slate-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="ml-4 mt-1 space-y-1">
                <Link href="/market" onClick={closeMobileMenu} className="flex items-center min-h-11 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Market Wrap</Link>
                <Link href="/alpha-scout" onClick={closeMobileMenu} className="flex items-center min-h-11 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Alpha Scout</Link>
              </div>
            </details>

            <details className="group">
              <summary className={`min-h-12 px-4 py-3 rounded-lg hover:bg-slate-50 cursor-pointer font-bold text-sm list-none flex items-center justify-between ${
                  isAnalytics ? 'text-brand-navy bg-blue-50/30' : 'text-slate-700'
                }`}>
                <span><i className="fas fa-chart-line mr-2" /> ANALYTICS</span>
                <i className="fas fa-chevron-down text-xs text-slate-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="ml-4 mt-1 space-y-1">
                <Link href="/multichart" onClick={closeMobileMenu} className="flex items-center min-h-11 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Multichart</Link>
                <Link href="/radar" onClick={closeMobileMenu} className="flex items-center min-h-11 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Radar</Link>
                <Link href="/posts" onClick={closeMobileMenu} className="flex items-center min-h-11 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Insights</Link>
              </div>
            </details>

            <details className="group">
              <summary className={`min-h-12 px-4 py-3 rounded-lg hover:bg-slate-50 cursor-pointer font-bold text-sm list-none flex items-center justify-between ${
                  isStrategies ? 'text-brand-navy bg-blue-50/30' : 'text-slate-700'
                }`}>
                <span><i className="fas fa-lightbulb mr-2" /> STRATEGIES</span>
                <i className="fas fa-chevron-down text-xs text-slate-500 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="ml-4 mt-1 space-y-1">
                <Link href="/ib" onClick={closeMobileMenu} className="flex items-center min-h-11 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">IB Helper (무한매수)</Link>
                <Link href="/infinite-buying" onClick={closeMobileMenu} className="flex items-center min-h-11 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Infinite Buying</Link>
                <Link href="/vr" onClick={closeMobileMenu} className="flex items-center min-h-11 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Value Rebalancing</Link>
              </div>
            </details>
          </div>
        </div>
      )}

      {/* Mobile Overlay */}
      {mobileMenuOpen && (
        <button
          type="button"
          className="mobile-overlay visible fixed inset-0 bg-black/50 z-40"
          onClick={closeMobileMenu}
          aria-label="Close mobile menu overlay"
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              closeMobileMenu();
            }
          }}
        />
      )}
    </>
  );
}
