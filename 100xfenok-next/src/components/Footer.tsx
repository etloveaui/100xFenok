'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  isAdminAuthenticated,
  setAdminAuthenticated,
  verifyAdminPassword,
} from '@/lib/client/admin-auth';

type FooterMarketStatus = 'regular' | 'pre' | 'after' | 'overnight' | 'closed';

const marketStatusConfig: Record<FooterMarketStatus, { label: string; className: string }> = {
  regular: { label: 'MARKET OPEN', className: 'market-regular' },
  pre: { label: 'MARKET PRE', className: 'market-pre' },
  after: { label: 'MARKET AFTER', className: 'market-after' },
  overnight: { label: 'MARKET NIGHT', className: 'market-overnight' },
  closed: { label: 'MARKET CLOSED', className: 'market-closed' },
};

const ET_WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getETSnapshot(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(date);

  let weekday = 'Mon';
  let hour = 0;
  let minute = 0;
  let zone = 'ET';

  for (const part of parts) {
    if (part.type === 'weekday') weekday = part.value;
    if (part.type === 'hour') hour = Number(part.value) || 0;
    if (part.type === 'minute') minute = Number(part.value) || 0;
    if (part.type === 'timeZoneName') zone = part.value || 'ET';
  }

  return {
    day: ET_WEEKDAY_MAP[weekday] ?? 1,
    time: hour * 100 + minute,
    zone,
  };
}

function formatETClock(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function getMarketStatus(date = new Date()): FooterMarketStatus {
  const { day, time } = getETSnapshot(date);

  if (day === 0 || day === 6) return 'closed';
  if (time >= 400 && time < 930) return 'pre';
  if (time >= 930 && time < 1600) return 'regular';
  if (time >= 1600 && time < 2000) return 'after';
  return 'overnight';
}

export default function Footer() {
  const router = useRouter();
  const [marketStatus, setMarketStatus] = useState<FooterMarketStatus>('regular');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminInputError, setAdminInputError] = useState(false);
  const [isVerifyingAdmin, setIsVerifyingAdmin] = useState(false);
  const [hasAdminSession, setHasAdminSession] = useState(false);
  const adminInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const updateMarketStatus = () => {
      setMarketStatus(getMarketStatus());
    };

    updateMarketStatus();
    const interval = setInterval(updateMarketStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const syncAdminSession = () => {
      setHasAdminSession(isAdminAuthenticated());
    };
    syncAdminSession();
    window.addEventListener('focus', syncAdminSession);
    window.addEventListener('storage', syncAdminSession);
    return () => {
      window.removeEventListener('focus', syncAdminSession);
      window.removeEventListener('storage', syncAdminSession);
    };
  }, []);

  useEffect(() => {
    if (!showAdminModal) {
      return;
    }

    adminInputRef.current?.focus();

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowAdminModal(false);
        setAdminPassword('');
        setAdminInputError(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showAdminModal]);

  const showToastMessage = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2500);
  };

  const handleShareClick = () => {
    navigator.clipboard.writeText(window.location.href);
    showToastMessage('URL 복사 완료!');
  };

  const handleMarketStatusClick = () => {
    const status = marketStatusConfig[marketStatus];
    const now = new Date();
    const etTime = formatETClock(now);
    const etMeta = getETSnapshot(now);
    showToastMessage(`${status.label} | ET ${etTime} (${etMeta.zone})`);
  };

  const handleNotificationClick = () => {
    showToastMessage('알림 없음');
  };

  const handleHelpClick = () => {
    showToastMessage('도움말: 100xFenok 시장 모니터링 도구');
  };

  const handleAdminClick = () => {
    const sessionActive = hasAdminSession || isAdminAuthenticated();
    if (sessionActive) {
      setHasAdminSession(true);
      router.push('/admin');
      return;
    }

    setAdminPassword('');
    setAdminInputError(false);
    setShowAdminModal(true);
  };

  const closeAdminModal = () => {
    if (isVerifyingAdmin) {
      return;
    }
    setShowAdminModal(false);
    setAdminPassword('');
    setAdminInputError(false);
  };

  const handleVerifyAdminPassword = async () => {
    const input = adminPassword.trim();
    if (!input || isVerifyingAdmin) {
      return;
    }

    setIsVerifyingAdmin(true);

    try {
      const result = await verifyAdminPassword(input);

      if (result === 'matched') {
        setAdminAuthenticated();
        setHasAdminSession(true);
        setShowAdminModal(false);
        setAdminPassword('');
        setAdminInputError(false);
        router.push('/admin');
        return;
      }

      setAdminPassword('');
      setAdminInputError(true);
      if (result === 'unsupported') {
        showToastMessage('브라우저 인증 기능을 사용할 수 없습니다.');
      } else {
        showToastMessage('Access denied');
      }
      adminInputRef.current?.focus();
    } catch {
      showToastMessage('인증 처리 중 오류가 발생했습니다.');
    } finally {
      setIsVerifyingAdmin(false);
    }
  };

  const status = marketStatusConfig[marketStatus];
  const etClock = formatETClock();

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
                  <span className="text-[8px] text-slate-600">© 2025 All rights reserved</span>
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
                  onClick={handleAdminClick}
                  className={`w-11 h-11 rounded-lg border flex items-center justify-center transition-all duration-200 ${hasAdminSession ? 'bg-brand-navy text-white border-brand-navy hover:bg-brand-interactive' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-brand-interactive'}`}
                  aria-label={hasAdminSession ? 'Admin (authenticated)' : 'Admin'}
                  aria-haspopup="dialog"
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

      {showAdminModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeAdminModal();
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Admin Access Control"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="mb-2 flex items-center gap-2 text-lg font-bold text-brand-navy">
              <i className="fas fa-lock text-brand-interactive" />
              Access Control
            </h3>
            <p className="mb-4 text-sm text-slate-500">관리자 인증이 필요합니다.</p>
            <input
              ref={adminInputRef}
              type="password"
              value={adminPassword}
              onChange={(event) => {
                setAdminPassword(event.target.value);
                if (adminInputError) {
                  setAdminInputError(false);
                }
              }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleVerifyAdminPassword();
                  }
                }}
              className={`w-full rounded-lg border px-4 py-3 outline-none transition ${adminInputError ? 'border-red-500 ring-2 ring-red-100' : 'border-slate-300 focus:ring-2 focus:ring-brand-interactive'}`}
              placeholder="Password"
              autoComplete="off"
              aria-invalid={adminInputError}
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={closeAdminModal}
                className="flex-1 rounded-lg bg-slate-100 px-4 py-2 font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isVerifyingAdmin}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleVerifyAdminPassword();
                }}
                className="flex-1 rounded-lg bg-brand-interactive px-4 py-2 font-medium text-white transition-colors hover:bg-brand-navy disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isVerifyingAdmin || adminPassword.trim().length === 0}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

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
