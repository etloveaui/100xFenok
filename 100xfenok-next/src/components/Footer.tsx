'use client';

import { useState, useEffect } from 'react';

type FooterMarketStatus = 'regular' | 'pre' | 'after' | 'overnight' | 'closed';

const marketStatusConfig: Record<FooterMarketStatus, { label: string; className: string }> = {
  regular: { label: 'MARKET OPEN', className: 'market-regular' },
  pre: { label: 'MARKET PRE', className: 'market-pre' },
  after: { label: 'MARKET AFTER', className: 'market-after' },
  overnight: { label: 'MARKET NIGHT', className: 'market-overnight' },
  closed: { label: 'MARKET CLOSED', className: 'market-closed' },
};

function isDST(date: Date) {
  const year = date.getFullYear();
  const marchFirst = new Date(year, 2, 1);
  const dstStart = new Date(year, 2, 8 + (7 - marchFirst.getDay()) % 7);
  const novFirst = new Date(year, 10, 1);
  const dstEnd = new Date(year, 10, 1 + (7 - novFirst.getDay()) % 7);
  return date >= dstStart && date < dstEnd;
}

function getETTime(date = new Date()) {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const offset = isDST(date) ? -4 : -5;
  return new Date(utc + 3600000 * offset);
}

function getMarketStatus(date = new Date()): FooterMarketStatus {
  const et = getETTime(date);
  const day = et.getDay();
  const time = et.getHours() * 100 + et.getMinutes();

  if (day === 0 || day === 6) return 'closed';
  if (time >= 400 && time < 930) return 'pre';
  if (time >= 930 && time < 1600) return 'regular';
  if (time >= 1600 && time < 2000) return 'after';
  return 'overnight';
}

export default function Footer() {
  const [marketStatus, setMarketStatus] = useState<FooterMarketStatus>('regular');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  useEffect(() => {
    const updateMarketStatus = () => {
      setMarketStatus(getMarketStatus());
    };

    updateMarketStatus();
    const interval = setInterval(updateMarketStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleShareClick = () => {
    navigator.clipboard.writeText(window.location.href);
    setToastMessage('URL 복사 완료!');
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2500);
  };

  const handleMarketStatusClick = () => {
    const status = marketStatusConfig[marketStatus];
    const now = new Date();
    const et = getETTime(now);
    const dst = isDST(now) ? 'DST' : 'EST';
    const etTime = et.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    setToastMessage(`${status.label} | ET ${etTime} (${dst})`);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2500);
  };

  const handleNotificationClick = () => {
    setToastMessage('알림 없음');
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2500);
  };

  const handleHelpClick = () => {
    setToastMessage('도움말: 100xFenok 시장 모니터링 도구');
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2500);
  };

  const status = marketStatusConfig[marketStatus];
  const etClock = getETTime().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <>
      <footer className="fixed bottom-0 left-0 right-0 z-40">
        {/* Upper Ticker Bar - Desktop Only */}
        <div className="hidden md:block bg-gradient-to-r from-brand-navy via-brand-interactive to-brand-navy glow-bar overflow-hidden">
          <div className="h-6 flex items-center px-4">
            {/* LIVE Badge */}
            <div className="flex items-center gap-1.5 flex-shrink-0 mr-3">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[9px] font-bold text-white uppercase">LIVE</span>
            </div>

            {/* Ticker */}
            <div className="flex-1 overflow-hidden">
              <div className="ticker-scroll">
                <div className="flex items-center gap-3 text-[10px] font-medium text-white/90 whitespace-nowrap" aria-hidden="true">
                  <span className="text-white/50">Loading market data...</span>
                </div>
              </div>
            </div>

            {/* Market Status */}
              <button
                type="button"
                onClick={handleMarketStatusClick}
                className={`px-2.5 py-1 rounded text-white text-[10px] font-bold tracking-wide shadow-sm transition-all duration-200 hover:scale-105 hover:brightness-110 ml-3 flex-shrink-0 ${status.className}`}
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
                type="button"
                onClick={handleShareClick}
                className="flex items-center gap-2 group cursor-pointer min-w-0"
                aria-label="Copy URL"
              >
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-navy/10 to-brand-interactive/10 flex items-center justify-center text-brand-navy group-hover:from-brand-navy group-hover:to-brand-interactive group-hover:text-white transition-all duration-300 flex-shrink-0"
                >
                  <i className="fas fa-chart-line" />
                </div>
                <div className="hidden sm:flex flex-col">
                  <span className="font-[800] orbitron text-slate-800 text-sm group-hover:text-brand-interactive transition-colors leading-none">
                    100x <span className="text-brand-gold">FENOK</span>
                  </span>
                  <span className="text-[8px] text-slate-400">© 2025 All rights reserved</span>
                </div>
              </button>

              {/* Center: Disclaimer / Mobile Market Status */}
              <div className="flex-1 flex justify-center min-w-0">
                <p className="hidden md:block text-[11px] text-slate-600 truncate max-w-[400px]">
                  모든 정보는 투자 참고용이지만, <span className="font-bold text-slate-800">손실 나면 니 탓</span> <span className="font-bold text-brand-gold">수익 나면 내 탓</span>
                </p>
                {/* Mobile Market Status */}
                <div className="md:hidden flex flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={handleMarketStatusClick}
                    className={`min-h-11 px-3 py-1.5 rounded text-white text-[10px] font-bold tracking-wide shadow-sm ${status.className}`}
                    aria-label="Market Status"
                  >
                    {status.label}
                  </button>
                  <button
                    type="button"
                    onClick={handleMarketStatusClick}
                    className="text-[10px] font-semibold text-slate-500"
                    aria-label="Market time"
                  >
                    LIVE ET {etClock}
                  </button>
                </div>
              </div>

              {/* Utility Buttons */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleNotificationClick}
                  className="w-11 h-11 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 hover:text-brand-interactive transition-all duration-200"
                  aria-label="Notifications"
                >
                  <i className="fas fa-bell text-sm" />
                </button>
                <button
                  type="button"
                  className="hidden sm:flex w-11 h-11 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 items-center justify-center text-slate-600 hover:text-brand-interactive transition-all duration-200"
                  aria-label="Admin"
                >
                  <i className="fas fa-cog text-sm" />
                </button>
                <button
                  type="button"
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
        <div className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-50 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg toast-animate">
          {toastMessage}
        </div>
      )}

      {/* Spacer for fixed footer */}
      <div className="h-[calc(48px+24px+env(safe-area-inset-bottom))] md:h-[calc(48px+24px+24px+env(safe-area-inset-bottom))]" />
    </>
  );
}
