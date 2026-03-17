'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ADMIN_AUTH_CHANGE_EVENT,
  ADMIN_VERIFY_STATE_EVENT,
  isAdminAuthenticated,
  refreshAdminAuthenticated,
} from '@/lib/client/admin-auth';
import { useToast } from '@/hooks/useToast';
import { useInstallPrompt } from '@/components/footer/InstallPrompt';
import FooterTickerBar from '@/components/footer/FooterTickerBar';
import FooterMainBar from '@/components/footer/FooterMainBar';
import AdminAuthModal from '@/components/footer/AdminAuthModal';

type FooterMarketStatus = 'regular' | 'pre' | 'after' | 'overnight' | 'closed';

const marketStatusConfig: Record<FooterMarketStatus, { label: string; className: string; tickerLabel: string }> = {
  regular: { label: 'MARKET OPEN', className: 'market-regular', tickerLabel: 'Market data live' },
  pre: { label: 'MARKET PRE', className: 'market-pre', tickerLabel: 'Pre-market session' },
  after: { label: 'MARKET AFTER', className: 'market-after', tickerLabel: 'After-hours session' },
  overnight: { label: 'MARKET NIGHT', className: 'market-overnight', tickerLabel: 'Market closed' },
  closed: { label: 'MARKET CLOSED', className: 'market-closed', tickerLabel: 'Market closed' },
};

const ET_WEEKDAY_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

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
  const toast = useToast();
  const { showInstallAction, handleInstallClick } = useInstallPrompt(toast.show);

  const [marketStatus, setMarketStatus] = useState<FooterMarketStatus>('closed');
  const [etClock, setEtClock] = useState('--');
  const [hasAdminSession, setHasAdminSession] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);

  const syncAdminState = useCallback(async () => {
    const authenticatedState = await refreshAdminAuthenticated();
    setHasAdminSession(authenticatedState);
  }, []);

  const navigateToAdmin = useCallback(() => {
    router.push('/admin');
    window.setTimeout(() => {
      if (window.location.pathname !== '/admin') {
        window.location.assign('/admin');
      }
    }, 420);
  }, [router]);

  const handleAdminClick = useCallback(() => {
    const sessionActive = hasAdminSession || isAdminAuthenticated();
    if (sessionActive) {
      void syncAdminState();
      navigateToAdmin();
      return;
    }
    setShowAdminModal(true);
  }, [hasAdminSession, navigateToAdmin, syncAdminState]);

  // Market status + ET clock polling
  useEffect(() => {
    const update = () => {
      const now = new Date();
      setMarketStatus(getMarketStatus(now));
      setEtClock(formatETClock(now));
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, []);

  // Admin modal state event
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('fenok:admin-modal-state', {
      detail: { open: showAdminModal },
    }));
  }, [showAdminModal]);

  // Admin session sync
  useEffect(() => {
    void syncAdminState();
    const handleSync = () => { void syncAdminState(); };
    window.addEventListener('focus', handleSync);
    window.addEventListener('storage', handleSync);
    window.addEventListener(ADMIN_AUTH_CHANGE_EVENT, handleSync as EventListener);
    window.addEventListener(ADMIN_VERIFY_STATE_EVENT, handleSync as EventListener);
    return () => {
      window.removeEventListener('focus', handleSync);
      window.removeEventListener('storage', handleSync);
      window.removeEventListener(ADMIN_AUTH_CHANGE_EVENT, handleSync as EventListener);
      window.removeEventListener(ADMIN_VERIFY_STATE_EVENT, handleSync as EventListener);
    };
  }, [syncAdminState]);

  // Alt+A keyboard shortcut
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || !event.altKey) return;
      if (event.key.toLowerCase() !== 'a') return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      handleAdminClick();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [handleAdminClick]);

  const handleShareClick = async () => {
    try {
      if (!window.isSecureContext || !navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(window.location.href);
      toast.show('URL 복사 완료!');
    } catch {
      toast.show('URL 복사 실패');
    }
  };

  const handleMarketStatusClick = () => {
    const cfg = marketStatusConfig[marketStatus];
    const now = new Date();
    const etTime = formatETClock(now);
    const etMeta = getETSnapshot(now);
    toast.show(`${cfg.label} | ET ${etTime} (${etMeta.zone})`);
  };

  const handleNotificationClick = () => {
    toast.show('알림 없음');
  };

  const status = marketStatusConfig[marketStatus];

  return (
    <>
      <footer className="fixed bottom-0 left-0 right-0 z-40 hidden md:block">
        <FooterTickerBar
          marketStatus={marketStatus}
          tickerLabel={status.tickerLabel}
          statusLabel={status.label}
          statusClassName={status.className}
          onMarketStatusClick={handleMarketStatusClick}
        />
        <FooterMainBar
          statusLabel={status.label}
          statusClassName={status.className}
          etClock={etClock}
          hasAdminSession={hasAdminSession}
          showInstallAction={showInstallAction}
          onShareClick={() => { void handleShareClick(); }}
          onMarketStatusClick={handleMarketStatusClick}
          onNotificationClick={handleNotificationClick}
          onAdminClick={handleAdminClick}
          onInstallClick={() => { void handleInstallClick(); }}
        />
      </footer>

      <AdminAuthModal
        isOpen={showAdminModal}
        onClose={() => setShowAdminModal(false)}
        onAuthenticated={navigateToAdmin}
        syncAdminState={syncAdminState}
        showToast={toast.show}
      />

      {toast.isVisible && (
        <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-[calc(6rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-50 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg toast-animate">
          {toast.message}
        </div>
      )}

      <div className="hidden md:block md:h-[calc(48px+24px+24px+env(safe-area-inset-bottom))]" />
    </>
  );
}
