'use client';

import { useState, useEffect } from 'react';
import { FooterMarketStatus } from '@/types';

const marketStatusConfig: Record<FooterMarketStatus, { label: string; gradient: string }> = {
  regular: { label: 'MARKET OPEN', gradient: 'from-emerald-500 to-emerald-600' },
  pre: { label: 'PRE-MARKET', gradient: 'from-amber-500 to-amber-600' },
  after: { label: 'AFTER HOURS', gradient: 'from-orange-500 to-orange-600' },
  overnight: { label: 'OVERNIGHT', gradient: 'from-blue-500 to-blue-600' },
  closed: { label: 'MARKET CLOSED', gradient: 'from-gray-500 to-gray-600' },
};

export default function Footer() {
  const [marketStatus, setMarketStatus] = useState<FooterMarketStatus>('regular');
  const [tickerData, setTickerData] = useState('Loading market data...');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  useEffect(() => {
    // Simulate market status updates
    const updateMarketStatus = () => {
      const hour = new Date().getUTCHours();
      let status: FooterMarketStatus = 'closed';
      
      if (hour >= 13 && hour < 20) {
        status = 'regular';
      } else if (hour >= 11 && hour < 13) {
        status = 'pre';
      } else if (hour >= 20 && hour < 22) {
        status = 'after';
      }
      
      setMarketStatus(status);
    };

    updateMarketStatus();
    const interval = setInterval(updateMarketStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleShareClick = () => {
    navigator.clipboard.writeText(window.location.href);
    setToastMessage('URL copied!');
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  };

  const handleMarketStatusClick = () => {
    const status = marketStatusConfig[marketStatus];
    setToastMessage(`${status.label} - ET Time`);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  };

  const handleNotificationClick = () => {
    setToastMessage('No new notifications');
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  };

  const handleHelpClick = () => {
    setToastMessage('Help & Support');
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  };

  const status = marketStatusConfig[marketStatus];

  return (
    <>
      <footer className="fixed bottom-0 left-0 right-0 z-40">
        {/* Upper Ticker Bar - Desktop Only */}
        <div 
          className="hidden md:block overflow-hidden"
          style={{ background: 'linear-gradient(to right, #010079, #1B73D3, #010079)' }}
        >
          <div className="h-6 flex items-center px-4">
            {/* LIVE Badge */}
            <div className="flex items-center gap-1.5 flex-shrink-0 mr-3">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[9px] font-bold text-white uppercase">LIVE</span>
            </div>

            {/* Ticker */}
            <div className="flex-1 overflow-hidden">
              <div className="ticker-scroll whitespace-nowrap cursor-pointer text-[11px] font-medium text-white/90" title="15-minute delayed data"
              >
                <span className="text-white/50">{tickerData}</span>
              </div>
            </div>

            {/* 15m Delayed Badge */}
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/30 ml-2 flex-shrink-0">
              <span className="text-[9px] font-bold text-amber-300 uppercase">15m</span>
            </div>

            {/* Market Status */}
            <button
              onClick={handleMarketStatusClick}
              className={`px-2.5 py-1 rounded text-white text-[10px] font-bold tracking-wide shadow-sm transition-all duration-200 hover:scale-105 hover:brightness-110 ml-3 flex-shrink-0 bg-gradient-to-r ${status.gradient}`}
              aria-label="Market Status"
            >
              {status.label}
            </button>
          </div>
        </div>

        {/* Main Bar */}
        <div className="bg-white/95 backdrop-blur-md border-t border-brand-navy/20 shadow-[0_-6px_20px_rgba(0,0,0,0.08)]">
          <div className="container mx-auto px-4 sm:px-6">
            <div className="h-12 flex items-center justify-between gap-3">
              {/* Brand */}
              <button
                onClick={handleShareClick}
                className="flex items-center gap-2 group cursor-pointer min-w-0"
                aria-label="Copy URL"
              >
                <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-brand-navy/10 to-brand-interactive/10 flex items-center justify-center text-brand-navy group-hover:from-brand-navy group-hover:to-brand-interactive group-hover:text-white transition-all duration-300 flex-shrink-0"
                >
                  <i className="fas fa-chart-line" />
                </div>
                <div className="hidden sm:flex flex-col">
                  <span className="font-[800] orbitron text-slate-800 text-sm group-hover:text-brand-interactive transition-colors leading-none">
                    100x <span className="text-brand-gold">FENOK</span>
                  </span>
                  <span className="text-[10px] text-slate-400">© 2026 All rights reserved</span>
                </div>
              </button>

              {/* Center: Disclaimer / Mobile Market Status */}
              <div className="flex-1 flex justify-center min-w-0">
                <p className="hidden md:block text-[11px] text-slate-600 truncate max-w-[400px]">
                  모든 정보는 투자 참고용이지만, <span className="font-bold text-slate-800">손실 나면 니 탓</span> <span className="font-bold text-brand-gold">수익 나면 내 탓</span>
                </p>
                {/* Mobile Market Status */}
                <button
                  onClick={handleMarketStatusClick}
                  className={`md:hidden px-3 py-1.5 rounded text-white text-[10px] font-bold tracking-wide shadow-sm bg-gradient-to-r ${status.gradient}`}
                  aria-label="Market Status"
                >
                  {status.label}
                </button>
              </div>

              {/* Utility Buttons */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleNotificationClick}
                  className="w-11 h-11 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 hover:text-brand-interactive transition-all duration-200"
                  aria-label="Notifications"
                >
                  <i className="fas fa-bell text-sm" />
                </button>
                <button
                  className="hidden sm:flex w-11 h-11 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 items-center justify-center text-slate-600 hover:text-brand-interactive transition-all duration-200"
                  aria-label="Admin"
                >
                  <i className="fas fa-cog text-sm" />
                </button>
                <button
                  onClick={handleHelpClick}
                  className="hidden sm:flex w-11 h-11 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 items-center justify-center text-slate-600 hover:text-brand-interactive transition-all duration-200"
                  aria-label="Help"
                >
                  <i className="fas fa-question text-sm" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </footer>

      {/* Toast Notification */}
      {showToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg animate-fade-in">
          {toastMessage}
        </div>
      )}

      {/* Spacer for fixed footer */}
      <div className="h-[calc(48px+24px)] md:h-[calc(48px+24px+24px)]" />
    </>
  );
}
