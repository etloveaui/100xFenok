'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  const isDashboard = pathname === '/';

  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <>
      <nav className="relative w-full z-50" id="mainNav">
        <div className="nav-wrapper w-full bg-white shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] border-b border-gray-100 sticky top-0">
          <div className="container mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
            {/* Brand */}
              <Link href="/" className="flex items-center gap-2 sm:gap-3 group flex-shrink-0">
                <div className="brand-logo w-8 h-8 sm:w-10 sm:h-10 bg-white rounded-xl flex items-center justify-center shadow-md group-hover:scale-105 transition-transform border border-slate-100">
                  <img src="/favicon.ico" alt="Icon" className="h-6 w-6 sm:h-8 sm:w-8" />
                </div>
                <span className="brand-text font-[900] orbitron text-slate-800 text-lg sm:text-xl leading-none tracking-tight">
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
                  className="nav-pill px-4 py-2 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all flex items-center gap-1 group-hover:bg-white group-hover:shadow-sm"
                  aria-haspopup="true"
                  aria-expanded="false"
                >
                  MARKET
                  <i className="fas fa-chevron-down text-[8px] opacity-30 group-hover:text-brand-gold transition-colors" />
                </button>
                <div className="dropdown-menu absolute top-full left-0 mt-1 bg-white border border-gray-200 shadow-xl rounded-xl p-2 min-w-[220px] opacity-0 invisible group-hover:visible group-hover:opacity-100 transition-all transform group-hover:translate-y-0 translate-y-[-10px] z-50">
                  <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-gray-100 mb-1">Briefing</div>
                  <Link href="/posts" className="flex items-center px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg group/link transition-colors">
                    <span className="w-1 h-4 bg-brand-gold rounded-full mr-3 opacity-0 group-hover/link:opacity-100 transition-opacity" />
                    <div>
                      <span className="block font-bold text-slate-700">Market Wrap</span>
                      <span className="text-[10px] text-slate-400">Daily Updates</span>
                    </div>
                  </Link>
                  <Link href="/posts" className="flex items-center px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg group/link transition-colors">
                    <span className="w-1 h-4 bg-brand-interactive rounded-full mr-3 opacity-0 group-hover/link:opacity-100 transition-opacity" />
                    <div>
                      <span className="block font-bold text-slate-700">Alpha Scout</span>
                      <span className="text-[10px] text-slate-400">Weekly Deep Dive</span>
                    </div>
                  </Link>
                </div>
              </div>

              {/* ANALYTICS Dropdown */}
              <div className="relative dropdown-wrapper h-full flex items-center group">
                <button className="nav-pill px-4 py-2 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all flex items-center gap-1 group-hover:bg-white group-hover:shadow-sm"
                  aria-haspopup="true"
                  aria-expanded="false"
                >
                  ANALYTICS
                  <i className="fas fa-chevron-down text-[8px] opacity-30 group-hover:text-brand-gold transition-colors" />
                </button>
                <div className="dropdown-menu absolute top-full left-0 mt-1 bg-white border border-gray-200 shadow-xl rounded-xl p-4 min-w-[360px] opacity-0 invisible group-hover:visible group-hover:opacity-100 transition-all transform group-hover:translate-y-0 translate-y-[-10px] z-50">
                  <div className="px-1 pb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-gray-100 mb-2">Tools & Charts</div>
                  <div className="grid grid-cols-3 gap-2">
                    <Link href="/posts" className="flex flex-col items-center p-3 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all text-center group/card">
                      <i className="fas fa-lightbulb text-xl text-amber-500 mb-2 group-hover/card:scale-110 transition-transform" />
                      <span className="text-xs font-bold text-slate-700">Insights</span>
                    </Link>
                    <Link href="/ib" className="flex flex-col items-center p-3 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all text-center group/card">
                      <i className="fas fa-calculator text-xl text-brand-interactive mb-2 group-hover/card:scale-110 transition-transform" />
                      <span className="text-xs font-bold text-slate-700">IB Helper</span>
                    </Link>
                    <Link href="/vr" className="flex flex-col items-center p-3 rounded-lg hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all text-center group/card">
                      <i className="fas fa-balance-scale text-xl text-brand-navy mb-2 group-hover/card:scale-110 transition-transform" />
                      <span className="text-xs font-bold text-slate-700">V/R</span>
                    </Link>
                  </div>
                </div>
              </div>

              {/* STRATEGIES Dropdown */}
              <div className="relative dropdown-wrapper h-full flex items-center group">
                <button className="px-4 py-2 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all flex items-center gap-1 group-hover:bg-white group-hover:shadow-sm"
                  aria-haspopup="true"
                  aria-expanded="false"
                >
                  STRATEGIES
                  <i className="fas fa-chevron-down text-[8px] opacity-30 group-hover:text-brand-gold transition-colors" />
                </button>
                <div className="dropdown-menu absolute top-full right-0 mt-1 bg-white border border-gray-200 shadow-xl rounded-xl p-3 min-w-[280px] opacity-0 invisible group-hover:visible group-hover:opacity-100 transition-all transform group-hover:translate-y-0 translate-y-[-10px] z-50">
                  <div className="px-2 pb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-gray-100 mb-2">Proven Methods</div>
                  <Link href="/ib" className="flex items-start p-2 rounded-lg hover:bg-slate-50 transition-colors mb-1 group/strat">
                    <div className="w-8 h-8 rounded bg-rose-100 flex items-center justify-center text-rose-600 mr-3 mt-0.5 group-hover/strat:bg-rose-200 transition-colors">
                      <i className="fas fa-calculator text-xs" />
                    </div>
                    <div>
                      <span className="block text-sm font-bold text-slate-700 group-hover/strat:text-brand-navy">IB Helper (무한매수)</span>
                      <span className="block text-[10px] text-slate-500 leading-tight mt-0.5">V2.2 실사용 계산기</span>
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
            <nav className="nav-icon-only hidden sm:flex md:hidden items-center gap-1 ml-4">
              <Link href="/" className={`nav-icon ${isDashboard ? 'active' : ''}`} title="Dashboard">
                <i className="fas fa-home" />
              </Link>
              <Link href="/posts" className="nav-icon" title="Market">
                <i className="fas fa-chart-bar" />
              </Link>
              <Link href="/posts" className="nav-icon" title="Analytics">
                <i className="fas fa-chart-line" />
              </Link>
              <Link href="/ib" className="nav-icon" title="Strategies">
                <i className="fas fa-lightbulb" />
              </Link>
            </nav>

            {/* Mobile Hamburger */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden w-11 h-11 rounded-lg bg-slate-50 text-slate-500 hover:bg-brand-navy hover:text-white transition-all border border-slate-100 shadow-sm flex items-center justify-center"
              aria-label="Open menu"
            >
              <i className="fas fa-bars text-sm" />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu */}
      <div className={`mobile-menu fixed inset-y-0 right-0 w-80 max-w-[85vw] bg-white shadow-2xl z-50 ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <span className="font-bold orbitron text-slate-800">MENU</span>
          <button 
            onClick={closeMobileMenu}
            className="w-11 h-11 rounded-lg hover:bg-slate-100 transition-colors flex items-center justify-center"
          >
            <i className="fas fa-times text-slate-600" />
          </button>
        </div>

        <div className="p-4 pt-12 space-y-2 overflow-y-auto h-[calc(100vh-5rem)]">
          {/* Dashboard */}
          <Link
            href="/"
            onClick={closeMobileMenu}
            className="block px-4 py-3 rounded-lg bg-blue-50 border-l-4 border-brand-navy font-bold text-sm text-brand-navy"
          >
            <i className="fas fa-home mr-2" /> DASHBOARD
          </Link>

          <details className="group">
            <summary className="px-4 py-3 rounded-lg hover:bg-slate-50 cursor-pointer font-bold text-sm text-slate-700 list-none flex items-center justify-between">
              <span><i className="fas fa-chart-bar mr-2" /> MARKET</span>
              <i className="fas fa-chevron-down text-xs text-slate-400 group-open:rotate-180 transition-transform" />
            </summary>
            <div className="ml-4 mt-1 space-y-1">
              <Link href="/posts" onClick={closeMobileMenu} className="block px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Market Wrap</Link>
              <Link href="/posts" onClick={closeMobileMenu} className="block px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Alpha Scout</Link>
            </div>
          </details>

          <details className="group">
            <summary className="px-4 py-3 rounded-lg hover:bg-slate-50 cursor-pointer font-bold text-sm text-slate-700 list-none flex items-center justify-between">
              <span><i className="fas fa-chart-line mr-2" /> ANALYTICS</span>
              <i className="fas fa-chevron-down text-xs text-slate-400 group-open:rotate-180 transition-transform" />
            </summary>
            <div className="ml-4 mt-1 space-y-1">
              <Link href="/posts" onClick={closeMobileMenu} className="block px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Insights</Link>
              <Link href="/ib" onClick={closeMobileMenu} className="block px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">IB Helper</Link>
              <Link href="/vr" onClick={closeMobileMenu} className="block px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">V/R</Link>
            </div>
          </details>

          <details className="group">
            <summary className="px-4 py-3 rounded-lg hover:bg-slate-50 cursor-pointer font-bold text-sm text-slate-700 list-none flex items-center justify-between">
              <span><i className="fas fa-lightbulb mr-2" /> STRATEGIES</span>
              <i className="fas fa-chevron-down text-xs text-slate-400 group-open:rotate-180 transition-transform" />
            </summary>
            <div className="ml-4 mt-1 space-y-1">
              <Link href="/ib" onClick={closeMobileMenu} className="block px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">IB Helper (무한매수)</Link>
              <Link href="/vr" onClick={closeMobileMenu} className="block px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Value Rebalancing</Link>
            </div>
          </details>
        </div>
      </div>

      {/* Mobile Overlay */}
      <div 
        className={`mobile-overlay fixed inset-0 bg-black/50 z-40 ${mobileMenuOpen ? 'visible' : ''}`}
        onClick={closeMobileMenu}
      />
    </>
  );
}
