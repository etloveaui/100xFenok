'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { lockBodyScroll, unlockBodyScroll } from '@/lib/client/body-scroll-lock';

type DesktopMenuId = 'market' | 'analytics' | 'strategies';

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopMenuOpen, setDesktopMenuOpen] = useState<DesktopMenuId | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobilePanelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const marketDropdownRef = useRef<HTMLDivElement | null>(null);
  const analyticsDropdownRef = useRef<HTMLDivElement | null>(null);
  const strategiesDropdownRef = useRef<HTMLDivElement | null>(null);
  const marketMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const analyticsMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const strategiesMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();

  const isDashboard = pathname === '/';
  const isMarket = pathname === '/market' || pathname === '/alpha-scout';
  const isAnalytics = pathname === '/multichart' || pathname === '/radar' || pathname === '/posts';
  const isStrategies = pathname === '/ib' || pathname === '/infinite-buying' || pathname === '/vr';

  const closeMobileMenu = () => setMobileMenuOpen(false);
  const closeDesktopMenu = () => setDesktopMenuOpen(null);
  const hasFinePointer = () =>
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  const getDesktopDropdownRef = (menuId: DesktopMenuId) => {
    switch (menuId) {
      case 'market':
        return marketDropdownRef.current;
      case 'analytics':
        return analyticsDropdownRef.current;
      case 'strategies':
        return strategiesDropdownRef.current;
      default:
        return null;
    }
  };

  const getDesktopMenuPanelRef = (menuId: DesktopMenuId) => {
    switch (menuId) {
      case 'market':
        return marketMenuPanelRef.current;
      case 'analytics':
        return analyticsMenuPanelRef.current;
      case 'strategies':
        return strategiesMenuPanelRef.current;
      default:
        return null;
    }
  };

  const focusFirstDesktopMenuItem = (menuId: DesktopMenuId) => {
    const focusMenuItem = () => {
      const panel = getDesktopMenuPanelRef(menuId);
      const firstLink = panel?.querySelector<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      firstLink?.focus();
    };

    window.requestAnimationFrame(() => {
      focusMenuItem();
      window.setTimeout(focusMenuItem, 40);
    });
  };

  const openDesktopMenu = (menuId: DesktopMenuId) => {
    setDesktopMenuOpen(menuId);
  };

  const toggleDesktopMenu = (menuId: DesktopMenuId) => {
    if (hasFinePointer()) {
      openDesktopMenu(menuId);
      return;
    }
    setDesktopMenuOpen((current) => (current === menuId ? null : menuId));
  };

  const handleDesktopMenuKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    menuId: DesktopMenuId,
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (desktopMenuOpen === menuId) {
        closeDesktopMenu();
        return;
      }
      openDesktopMenu(menuId);
      focusFirstDesktopMenuItem(menuId);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openDesktopMenu(menuId);
      focusFirstDesktopMenuItem(menuId);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeDesktopMenu();
    }
  };

  const handleDesktopMenuBlur = (
    event: React.FocusEvent<HTMLDivElement>,
    menuId: DesktopMenuId,
  ) => {
    const nextTarget = event.relatedTarget;
    const wrapper = getDesktopDropdownRef(menuId);
    if (wrapper && nextTarget instanceof Node && wrapper.contains(nextTarget)) return;
    if (desktopMenuOpen === menuId) {
      closeDesktopMenu();
    }
  };

  const handleDesktopMenuMouseLeave = (menuId: DesktopMenuId) => {
    if (!hasFinePointer()) return;
    const wrapper = getDesktopDropdownRef(menuId);
    if (wrapper?.contains(document.activeElement)) return;
    if (desktopMenuOpen === menuId) {
      closeDesktopMenu();
    }
  };

  useEffect(() => {
    if (!mobileMenuOpen) return;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    lockBodyScroll('navbar-mobile-menu');
    closeButtonRef.current?.focus();

    return () => {
      unlockBodyScroll('navbar-mobile-menu');
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

  useEffect(() => {
    if (!desktopMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      const wrapper = getDesktopDropdownRef(desktopMenuOpen);
      if (wrapper?.contains(event.target)) return;
      closeDesktopMenu();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeDesktopMenu();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [desktopMenuOpen]);

  return (
    <>
      <nav className="nav-wrapper fixed top-0 left-0 right-0 z-50 bg-white shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] border-b border-gray-100" id="mainNav">
        <div className="w-full">
          <div className="container mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
            {/* Brand */}
              <Link
                href="/"
                className="flex items-center gap-2 sm:gap-3 group flex-shrink-0 min-w-0 cursor-pointer"
                aria-label="Go to home"
              >
                <div className="brand-logo w-8 h-8 sm:w-10 sm:h-10 bg-white rounded-xl flex items-center justify-center shadow-md group-hover:scale-105 transition-all duration-300 border border-slate-100 active:scale-95">
                  <Image
                    src="/favicon-96x96.png"
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
              <div
                ref={marketDropdownRef}
                className="relative dropdown-wrapper h-full flex items-center"
                onMouseEnter={() => {
                  if (hasFinePointer()) openDesktopMenu('market');
                }}
                onMouseLeave={() => handleDesktopMenuMouseLeave('market')}
                onBlur={(event) => handleDesktopMenuBlur(event, 'market')}
              >
                <button
                  type="button"
                  className={`nav-pill px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                    isMarket
                      ? 'text-brand-navy bg-blue-50/50'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  } ${desktopMenuOpen === 'market' ? 'bg-white shadow-sm text-brand-navy' : ''}`}
                  aria-haspopup="menu"
                  aria-expanded={desktopMenuOpen === 'market'}
                  aria-controls="desktop-market-menu"
                  onClick={() => toggleDesktopMenu('market')}
                  onKeyDown={(event) => handleDesktopMenuKeyDown(event, 'market')}
                >
                  MARKET
                  <i className={`fas fa-chevron-down text-[8px] transition-all ${desktopMenuOpen === 'market' ? 'text-brand-gold rotate-180' : 'opacity-30'}`} />
                </button>
                <div
                  ref={marketMenuPanelRef}
                  id="desktop-market-menu"
                  role="menu"
                  aria-label="Market menu"
                  className={`dropdown-menu absolute top-full left-0 mt-1 w-[min(90vw,360px)] bg-white border border-gray-200 shadow-xl rounded-xl p-4 transition-all transform z-50 ${desktopMenuOpen === 'market' ? '!visible !opacity-100 !translate-y-0 !pointer-events-auto' : '!invisible !opacity-0 !translate-y-[-10px] !pointer-events-none'}`}
                >
                  <div className="px-1 pb-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-gray-100 mb-2">Briefing Deck</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Link href="/market" role="menuitem" tabIndex={desktopMenuOpen === 'market' ? 0 : -1} onClick={closeDesktopMenu} className="flex flex-col items-center p-3 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all text-center group/card">
                      <i className="fas fa-chart-bar text-xl text-brand-navy mb-2 group-hover/card:scale-110 transition-transform" />
                      <span className="text-xs font-bold text-slate-700">Market Wrap</span>
                      <span className="text-[10px] text-slate-500 mt-0.5">Daily Pulse</span>
                    </Link>
                    <Link href="/alpha-scout" role="menuitem" tabIndex={desktopMenuOpen === 'market' ? 0 : -1} onClick={closeDesktopMenu} className="flex flex-col items-center p-3 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all text-center group/card">
                      <i className="fas fa-compass text-xl text-brand-interactive mb-2 group-hover/card:scale-110 transition-transform" />
                      <span className="text-xs font-bold text-slate-700">Alpha Scout</span>
                      <span className="text-[10px] text-slate-500 mt-0.5">Weekly Deep Dive</span>
                    </Link>
                  </div>
                </div>
              </div>

              {/* ANALYTICS Dropdown */}
              <div
                ref={analyticsDropdownRef}
                className="relative dropdown-wrapper h-full flex items-center"
                onMouseEnter={() => {
                  if (hasFinePointer()) openDesktopMenu('analytics');
                }}
                onMouseLeave={() => handleDesktopMenuMouseLeave('analytics')}
                onBlur={(event) => handleDesktopMenuBlur(event, 'analytics')}
              >
                <button type="button" className={`nav-pill px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                    isAnalytics
                      ? 'text-brand-navy bg-blue-50/50'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  } ${desktopMenuOpen === 'analytics' ? 'bg-white shadow-sm text-brand-navy' : ''}`}
                  aria-haspopup="menu"
                  aria-expanded={desktopMenuOpen === 'analytics'}
                  aria-controls="desktop-analytics-menu"
                  onClick={() => toggleDesktopMenu('analytics')}
                  onKeyDown={(event) => handleDesktopMenuKeyDown(event, 'analytics')}
                >
                  ANALYTICS
                  <i className={`fas fa-chevron-down text-[8px] transition-all ${desktopMenuOpen === 'analytics' ? 'text-brand-gold rotate-180' : 'opacity-30'}`} />
                </button>
                <div
                  ref={analyticsMenuPanelRef}
                  id="desktop-analytics-menu"
                  role="menu"
                  aria-label="Analytics menu"
                  className={`dropdown-menu absolute top-full right-0 mt-1 w-[min(90vw,360px)] bg-white border border-gray-200 shadow-xl rounded-xl p-4 transition-all transform z-50 ${desktopMenuOpen === 'analytics' ? '!visible !opacity-100 !translate-y-0 !pointer-events-auto' : '!invisible !opacity-0 !translate-y-[-10px] !pointer-events-none'}`}
                >
                  <div className="px-1 pb-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-gray-100 mb-2">Tools & Charts</div>
                  <div className="grid grid-cols-3 gap-2">
                    <Link href="/multichart" role="menuitem" tabIndex={desktopMenuOpen === 'analytics' ? 0 : -1} onClick={closeDesktopMenu} className="flex flex-col items-center p-3 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all text-center group/card">
                      <i className="fas fa-chart-line text-xl text-brand-interactive mb-2 group-hover/card:scale-110 transition-transform" />
                      <span className="text-xs font-bold text-slate-700">Multichart</span>
                    </Link>
                    <Link href="/radar" role="menuitem" tabIndex={desktopMenuOpen === 'analytics' ? 0 : -1} onClick={closeDesktopMenu} className="flex flex-col items-center p-3 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all text-center group/card">
                      <i className="fas fa-satellite-dish text-xl text-brand-navy mb-2 group-hover/card:scale-110 transition-transform" />
                      <span className="text-xs font-bold text-slate-700">Radar</span>
                    </Link>
                    <Link href="/posts" role="menuitem" tabIndex={desktopMenuOpen === 'analytics' ? 0 : -1} onClick={closeDesktopMenu} className="relative flex flex-col items-center p-3 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all text-center group/card">
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full ring-2 ring-white animate-pulse" />
                      <i className="fas fa-lightbulb text-xl text-amber-500 mb-2 group-hover/card:scale-110 transition-transform" />
                      <span className="text-xs font-bold text-slate-700">Insights</span>
                    </Link>
                  </div>
                </div>
              </div>

              {/* STRATEGIES Dropdown */}
              <div
                ref={strategiesDropdownRef}
                className="relative dropdown-wrapper h-full flex items-center"
                onMouseEnter={() => {
                  if (hasFinePointer()) openDesktopMenu('strategies');
                }}
                onMouseLeave={() => handleDesktopMenuMouseLeave('strategies')}
                onBlur={(event) => handleDesktopMenuBlur(event, 'strategies')}
              >
                <button type="button" className={`nav-pill px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                    isStrategies
                      ? 'text-brand-navy bg-blue-50/50'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  } ${desktopMenuOpen === 'strategies' ? 'bg-white shadow-sm text-brand-navy' : ''}`}
                  aria-haspopup="menu"
                  aria-expanded={desktopMenuOpen === 'strategies'}
                  aria-controls="desktop-strategies-menu"
                  onClick={() => toggleDesktopMenu('strategies')}
                  onKeyDown={(event) => handleDesktopMenuKeyDown(event, 'strategies')}
                >
                  STRATEGIES
                  <i className={`fas fa-chevron-down text-[8px] transition-all ${desktopMenuOpen === 'strategies' ? 'text-brand-gold rotate-180' : 'opacity-30'}`} />
                </button>
                <div
                  ref={strategiesMenuPanelRef}
                  id="desktop-strategies-menu"
                  role="menu"
                  aria-label="Strategies menu"
                  className={`dropdown-menu absolute top-full right-0 mt-1 w-[min(90vw,360px)] bg-white border border-gray-200 shadow-xl rounded-xl p-4 transition-all transform z-50 ${desktopMenuOpen === 'strategies' ? '!visible !opacity-100 !translate-y-0 !pointer-events-auto' : '!invisible !opacity-0 !translate-y-[-10px] !pointer-events-none'}`}
                >
                  <div className="px-1 pb-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-gray-100 mb-2">Playbooks</div>
                  <div className="grid grid-cols-3 gap-2">
                    <Link href="/ib" role="menuitem" tabIndex={desktopMenuOpen === 'strategies' ? 0 : -1} onClick={closeDesktopMenu} className="flex flex-col items-center p-3 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all text-center group/card">
                      <i className="fas fa-calculator text-xl text-rose-600 mb-2 group-hover/card:scale-110 transition-transform" />
                      <span className="text-xs font-bold text-slate-700">IB Helper</span>
                      <span className="text-[10px] text-slate-500 mt-0.5">V2.2</span>
                    </Link>
                    <Link href="/infinite-buying" role="menuitem" tabIndex={desktopMenuOpen === 'strategies' ? 0 : -1} onClick={closeDesktopMenu} className="flex flex-col items-center p-3 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all text-center group/card">
                      <i className="fas fa-infinity text-xl text-green-600 mb-2 group-hover/card:scale-110 transition-transform" />
                      <span className="text-xs font-bold text-slate-700">Infinite</span>
                      <span className="text-[10px] text-slate-500 mt-0.5">DCA</span>
                    </Link>
                    <Link href="/vr" role="menuitem" tabIndex={desktopMenuOpen === 'strategies' ? 0 : -1} onClick={closeDesktopMenu} className="flex flex-col items-center p-3 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all text-center group/card">
                      <i className="fas fa-balance-scale text-xl text-brand-gold mb-2 group-hover/card:scale-110 transition-transform" />
                      <span className="text-xs font-bold text-slate-700">Rebalance</span>
                      <span className="text-[10px] text-slate-500 mt-0.5">VR</span>
                    </Link>
                  </div>
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
