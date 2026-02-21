'use client';

import { useEffect, useRef, useState, type TouchEvent } from 'react';
import Link from 'next/link';

type TabId = 'overview' | 'sectors' | 'liquidity' | 'sentiment';

const periods = ['1D', '1W', '1M', 'YTD', '1Y'];
const TAB_SEQUENCE: TabId[] = ['overview', 'sectors', 'liquidity', 'sentiment'];
const SWIPE_HINT_DISMISS_KEY = 'fenok_swipe_hint_dismissed_v1';

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [activePeriod, setActivePeriod] = useState('1W');
  const [isPeriodMenuOpen, setIsPeriodMenuOpen] = useState(false);
  const [showSwipeHint, setShowSwipeHint] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(SWIPE_HINT_DISMISS_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const periodMenuRef = useRef<HTMLDivElement>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isPeriodMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!periodMenuRef.current) return;
      if (!periodMenuRef.current.contains(event.target as Node)) {
        setIsPeriodMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPeriodMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isPeriodMenuOpen]);

  const dismissSwipeHint = () => {
    setShowSwipeHint(false);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SWIPE_HINT_DISMISS_KEY, '1');
    } catch {
      // ignore storage failures
    }
  };

  const handleSwipeTabChange = (direction: 'next' | 'prev') => {
    const currentIndex = TAB_SEQUENCE.indexOf(activeTab);
    if (currentIndex < 0) return;
    const offset = direction === 'next' ? 1 : -1;
    const nextIndex = currentIndex + offset;
    if (nextIndex < 0 || nextIndex >= TAB_SEQUENCE.length) return;
    setActiveTab(TAB_SEQUENCE[nextIndex]);
    if (showSwipeHint) {
      dismissSwipeHint();
    }
  };

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    const first = event.touches[0];
    if (!first) return;
    touchStartXRef.current = first.clientX;
    touchStartYRef.current = first.clientY;
  };

  const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const first = event.changedTouches[0];
    if (!first || touchStartXRef.current === null || touchStartYRef.current === null) return;

    const deltaX = first.clientX - touchStartXRef.current;
    const deltaY = first.clientY - touchStartYRef.current;

    touchStartXRef.current = null;
    touchStartYRef.current = null;

    const horizontalIntent = Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
    if (!horizontalIntent) return;

    handleSwipeTabChange(deltaX < 0 ? 'next' : 'prev');
  };

  return (
    <main className="container mx-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4">
      <section className="command-toolbar" role="toolbar" aria-label="Dashboard controls">
        <div className="command-main">
          <div className="tab-pills tab-pills-compact" role="tablist" aria-label="View tabs">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'overview'}
              className={`tab-pill ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              Overview
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'sectors'}
              className={`tab-pill ${activeTab === 'sectors' ? 'active' : ''}`}
              onClick={() => setActiveTab('sectors')}
            >
              Sectors
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'liquidity'}
              className={`tab-pill ${activeTab === 'liquidity' ? 'active' : ''}`}
              onClick={() => setActiveTab('liquidity')}
            >
              Liquidity
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'sentiment'}
              className={`tab-pill ${activeTab === 'sentiment' ? 'active' : ''}`}
              onClick={() => setActiveTab('sentiment')}
            >
              Sentiment
            </button>
          </div>

          <div className="period-menu-wrap" ref={periodMenuRef}>
            <button
              type="button"
              className="period-trigger"
              aria-haspopup="menu"
              aria-expanded={isPeriodMenuOpen}
              onClick={() => setIsPeriodMenuOpen((prev) => !prev)}
            >
              <i className="fas fa-calendar-days" aria-hidden="true" />
              <span>{activePeriod}</span>
              <i
                className={`fas fa-chevron-down text-[10px] transition-transform ${isPeriodMenuOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>

            {isPeriodMenuOpen && (
              <div className="period-menu" role="menu" aria-label="Time period">
                {periods.map((period) => (
                  <button
                    type="button"
                    key={period}
                    role="menuitemradio"
                    aria-checked={activePeriod === period}
                    className={`period-option ${activePeriod === period ? 'active' : ''}`}
                    onClick={() => {
                      setActivePeriod(period);
                      setIsPeriodMenuOpen(false);
                    }}
                  >
                    {period}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {showSwipeHint ? (
        <button
          type="button"
          className="mb-2 px-1 text-[11px] font-semibold text-slate-500 sm:hidden"
          onClick={dismissSwipeHint}
          aria-label="스와이프 안내 닫기"
        >
          좌우 스와이프로 탭 전환
        </button>
      ) : null}

      <section
        key={activeTab}
        className="tab-scene"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {activeTab === 'overview' && (
          <>
            {/* Latest Analysis Spotlight */}
            <Link href="/posts/2026-02-21_tariff-ruling-comprehensive.html"
              className="group block w-full rounded-2xl overflow-hidden mb-4
                        bg-gradient-to-r from-red-50 via-amber-50/80 to-slate-50
                        border border-red-200/50 hover:border-amber-300/70
                        shadow-sm hover:shadow-lg transition-all duration-300">
              <div className="flex items-start gap-3 px-3 py-3 sm:items-center sm:gap-4 sm:px-5 sm:py-4">
                <span className="text-2xl flex-shrink-0">&#9878;</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider
                                     bg-red-100 text-red-700 px-2 py-0.5 rounded-full
                                     animate-pulse">Breaking</span>
                    <span className="text-[10px] text-slate-600 font-mono">2026.02.21</span>
                  </div>
                  <p className="text-sm font-bold text-slate-800 line-clamp-2">
                    IEEPA 관세 위헌 판결 — 종합 분석
                  </p>
                  <p className="text-xs text-slate-600 line-clamp-2">
                    대법원 6-3 위헌 · 트럼프 122조 10% 즉시 서명 · 국가별 관세 영향 · 포트폴리오 함의
                  </p>
                </div>
                <div className="hidden min-[420px]:block flex-shrink-0 text-slate-300 group-hover:text-amber-600
                                transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                  </svg>
                </div>
              </div>
            </Link>

            <div className="hero-zone min-w-0">
              <div className="bento-card p-4">
                <h3 className="text-xs font-bold text-slate-600 tracking-widest mb-2 orbitron">FEAR & GREED</h3>
                <div className="flex items-center gap-3">
                  <div className="relative w-16 h-8">
                    <svg viewBox="0 0 100 50" className="w-full h-full" aria-hidden="true">
                      <defs>
                        <linearGradient id="gaugeFinal" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#ef4444" />
                          <stop offset="50%" stopColor="#eab308" />
                          <stop offset="100%" stopColor="#22c55e" />
                        </linearGradient>
                      </defs>
                      <path d="M 10 45 A 40 40 0 0 1 90 45" fill="none" stroke="#e2e8f0" strokeWidth="6" strokeLinecap="round" />
                      <path d="M 10 45 A 40 40 0 0 1 90 45" fill="none" stroke="url(#gaugeFinal)" strokeWidth="6" strokeLinecap="round" strokeDasharray="126" strokeDashoffset="35" />
                    </svg>
                  </div>
                  <span className="text-2xl font-bold text-brand-navy orbitron">72</span>
                  <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded-full font-bold text-xs">GREED</span>
                </div>
              </div>

              <div className="bento-card p-4">
                <h3 className="text-xs font-bold text-slate-600 tracking-widest mb-2 orbitron">MARKET REGIME</h3>
                <div className="flex items-center justify-between">
                  <div className="regime-badge">
                    <i className="fas fa-rocket text-xs" />
                    <span>RISK-ON</span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-600">Confidence</p>
                    <p className="text-xl font-bold text-emerald-800 orbitron">87%</p>
                  </div>
                </div>
              </div>

              <div className="bento-card p-4 quick-indices-card">
                <h3 className="text-xs font-bold text-slate-600 tracking-widest mb-2 orbitron">QUICK INDICES</h3>
                <div className="quick-indices-scroll">
                  <div className="index-item">
                    <span className="text-xs text-slate-600">SPY</span>
                    <svg className="sparkline" viewBox="0 0 60 20" aria-hidden="true"><polyline fill="none" stroke="#22c55e" strokeWidth="1.5" points="0,16 10,14 20,12 30,10 40,11 50,6 60,4" /></svg>
                    <span className="font-bold text-emerald-800 text-sm">+0.85%</span>
                  </div>
                  <div className="index-item">
                    <span className="text-xs text-slate-600">QQQ</span>
                    <svg className="sparkline" viewBox="0 0 60 20" aria-hidden="true"><polyline fill="none" stroke="#22c55e" strokeWidth="1.5" points="0,18 10,16 20,12 30,10 40,8 50,6 60,3" /></svg>
                    <span className="font-bold text-emerald-800 text-sm">+1.12%</span>
                  </div>
                  <div className="index-item">
                    <span className="text-xs text-slate-600">DXY</span>
                    <svg className="sparkline" viewBox="0 0 60 20" aria-hidden="true"><polyline fill="none" stroke="#ef4444" strokeWidth="1.5" points="0,8 10,10 20,12 30,14 40,12 50,14 60,16" /></svg>
                    <span className="font-bold text-red-700 text-sm">-0.3%</span>
                  </div>
                  <div className="index-item">
                    <span className="text-xs text-slate-600">BTC</span>
                    <svg className="sparkline" viewBox="0 0 60 20" aria-hidden="true"><polyline fill="none" stroke="#22c55e" strokeWidth="1.5" points="0,14 10,12 20,10 30,8 40,10 50,7 60,5" /></svg>
                    <span className="font-bold text-emerald-800 text-sm">+2.4%</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
              <div className="bento-card p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-xs font-bold text-slate-600 tracking-widest orbitron">SECTOR SNAPSHOT</h3>
                  <button
                    type="button"
                    onClick={() => setActiveTab('sectors')}
                    className="text-xs text-brand-navy font-bold min-h-[44px] flex items-center hover:text-brand-interactive transition-colors"
                  >
                    View All →
                  </button>
                </div>
                <div className="sector-snapshot">
                  <div className="flex gap-2 items-center">
                    <span className="w-2 h-2 bg-green-500 rounded-full" />
                    <span className="font-bold text-emerald-800 text-sm">7 Up</span>
                    <span className="w-2 h-2 bg-red-500 rounded-full ml-2" />
                    <span className="font-bold text-red-700 text-sm">4 Down</span>
                  </div>
                  <div className="flex gap-1 flex-wrap mt-2">
                    <span className="sector-chip bg-green-100 text-green-800">XLK +2.3%</span>
                    <span className="sector-chip bg-green-100 text-green-800">XLF +1.5%</span>
                    <span className="sector-chip bg-green-100 text-green-800">XLC +1.1%</span>
                  </div>
                </div>
              </div>

              <div className="bento-card p-4">
                <h3 className="text-xs font-bold text-slate-600 tracking-widest mb-3 orbitron">LIQUIDITY FLOW</h3>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl font-bold text-brand-navy orbitron">+$87B</span>
                  <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs font-bold">WoW</span>
                </div>
                <div className="h-10 bg-gradient-to-r from-green-100 to-green-50 rounded flex items-end px-1 gap-0.5">
                  <div className="w-3 bg-green-400 rounded-t h-[60%]" />
                  <div className="w-3 bg-green-400 rounded-t h-[75%]" />
                  <div className="w-3 bg-green-500 rounded-t h-[90%]" />
                  <div className="w-3 bg-green-400 rounded-t h-[70%]" />
                  <div className="w-3 bg-green-500 rounded-t h-[85%]" />
                  <div className="w-3 bg-green-600 rounded-t h-full" />
                </div>
              </div>

              <div className="bento-card p-4">
                <h3 className="text-xs font-bold text-slate-600 tracking-widest mb-3 orbitron">SENTIMENT</h3>
                <div className="space-y-2">
                  <div className="flex justify-between items-center"><span className="text-xs text-slate-600">VIX</span><span className="font-bold text-emerald-800 text-sm">14.2 <span className="text-xs text-slate-600">Low</span></span></div>
                  <div className="flex justify-between items-center"><span className="text-xs text-slate-600">Put/Call</span><span className="font-bold text-slate-700 text-sm">0.78</span></div>
                  <div className="flex justify-between items-center"><span className="text-xs text-slate-600">Crypto F&G</span><span className="font-bold text-brand-gold text-sm">78 <span className="text-xs">Greed</span></span></div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bento-card p-4">
                <h3 className="text-xs font-bold text-slate-600 tracking-widest mb-3 orbitron">BANKING HEALTH</h3>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-lg font-bold text-emerald-800">Stable</span>
                </div>
                <p className="text-xs text-slate-600 mt-1">BTFP $12.3B ↓ / DW $4.1B</p>
              </div>
              <div className="bento-card p-4">
                <h3 className="text-xs font-bold text-slate-600 tracking-widest mb-3 orbitron">STRESS INDEX</h3>
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold text-emerald-800 orbitron">0.12</span>
                  <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs font-bold">Low Risk</span>
                </div>
                <p className="text-xs text-slate-600 mt-1">SOFR-IORB Spread</p>
              </div>
            </div>
          </>
        )}

        {activeTab === 'sectors' && (
          <div className="bento-card p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-bold text-slate-600 tracking-widest orbitron">SECTOR HEATMAP</h3>
              <span className="text-xs text-slate-600">Treemap by Market Cap</span>
            </div>
            <div className="heatmap-grid">
              <div className="heatmap-cell xlk bg-green-500 text-white"><span className="font-bold text-lg">XLK</span><span className="text-sm">Tech</span><span className="font-bold">+2.34%</span></div>
              <div className="heatmap-cell xlf bg-green-400 text-white"><span className="font-bold">XLF</span><span className="text-xs">+1.56%</span></div>
              <div className="heatmap-cell bg-green-300 text-green-800"><span className="font-bold">XLV</span><span className="text-xs">+0.89%</span></div>
              <div className="heatmap-cell bg-red-400 text-white"><span className="font-bold">XLE</span><span className="text-xs">-1.23%</span></div>
              <div className="heatmap-cell bg-green-200 text-green-800"><span className="font-bold">XLI</span><span className="text-xs">+0.45%</span></div>
              <div className="heatmap-cell bg-green-400 text-white"><span className="font-bold">XLC</span><span className="text-xs">+1.12%</span></div>
              <div className="heatmap-cell bg-red-300 text-red-800"><span className="font-bold">XLY</span><span className="text-xs">-0.67%</span></div>
              <div className="heatmap-cell bg-slate-200 text-slate-600"><span className="font-bold">XLP</span><span className="text-xs">+0.12%</span></div>
              <div className="heatmap-cell bg-red-200 text-red-700"><span className="font-bold">XLRE</span><span className="text-xs">-0.34%</span></div>
              <div className="heatmap-cell bg-green-300 text-green-800"><span className="font-bold">XLB</span><span className="text-xs">+0.78%</span></div>
              <div className="heatmap-cell bg-red-500 text-white"><span className="font-bold">XLU</span><span className="text-xs">-1.89%</span></div>
            </div>
          </div>
        )}

        {activeTab === 'liquidity' && (
          <div className="route-embed-shell">
            <iframe
              src="/tools/macro-monitor/widgets/liquidity-flow.html"
              title="Liquidity Flow"
              loading="lazy"
              className="h-full w-full border-0"
            />
          </div>
        )}

        {activeTab === 'sentiment' && (
          <div className="route-embed-shell">
            <iframe
              src="/tools/macro-monitor/widgets/sentiment-signal.html"
              title="Sentiment Signal"
              loading="lazy"
              className="h-full w-full border-0"
            />
          </div>
        )}
      </section>
    </main>
  );
}
