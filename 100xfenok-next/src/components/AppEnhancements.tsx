'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

type InstallChoice = {
  outcome: 'accepted' | 'dismissed';
  platform: string;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

type NetworkInformationLike = {
  effectiveType?: string;
  saveData?: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
};

type NavigatorWithConnection = Navigator & {
  connection?: NetworkInformationLike;
};

const INSTALL_HINT_DISMISS_KEY = 'fenok_install_hint_dismissed_v1';

const dockItems = [
  {
    href: '/',
    label: 'HOME',
    icon: '⌂',
    isActive: (pathname: string) => pathname === '/',
  },
  {
    href: '/market',
    label: 'MARKET',
    icon: '◔',
    isActive: (pathname: string) => pathname === '/market' || pathname === '/alpha-scout',
  },
  {
    href: '/posts',
    label: 'INSIGHT',
    icon: '✦',
    isActive: (pathname: string) =>
      pathname === '/posts' ||
      pathname.startsWith('/posts/') ||
      pathname === '/multichart' ||
      pathname === '/radar',
  },
  {
    href: '/ib',
    label: 'IB',
    icon: '∞',
    isActive: (pathname: string) =>
      pathname === '/ib' || pathname === '/infinite-buying' || pathname === '/vr',
  },
] as const;

function isDockRoute(pathname: string) {
  return (
    pathname === '/' ||
    pathname === '/market' ||
    pathname === '/alpha-scout' ||
    pathname === '/posts' ||
    pathname.startsWith('/posts/') ||
    pathname === '/multichart' ||
    pathname === '/radar' ||
    pathname === '/ib' ||
    pathname === '/infinite-buying' ||
    pathname === '/vr'
  );
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    target.isContentEditable ||
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT'
  );
}

function getIsStandaloneMode() {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as NavigatorWithStandalone;
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

function getIsIOS() {
  if (typeof window === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function getDismissedInstallHint() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(INSTALL_HINT_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function dismissInstallHint() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(INSTALL_HINT_DISMISS_KEY, '1');
  } catch {
    // no-op
  }
}

function getConnection() {
  if (typeof window === 'undefined') return null;
  return (window.navigator as NavigatorWithConnection).connection ?? null;
}

function getIsDataSaverMode() {
  const connection = getConnection();
  if (!connection) return false;
  if (connection.saveData) return true;
  const effectiveType = (connection.effectiveType || '').toLowerCase();
  return effectiveType.includes('2g');
}

export default function AppEnhancements() {
  const pathname = usePathname();
  const router = useRouter();
  const dockEnabled = isDockRoute(pathname);
  const lastScrollYRef = useRef(0);
  const dockNavTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dockLockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dockNavLockUntilRef = useRef(0);
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.navigator.onLine;
  });
  const [scrollProgress, setScrollProgress] = useState(() => {
    if (typeof window === 'undefined') return 0;
    const doc = document.documentElement;
    const scrollableHeight = Math.max(1, doc.scrollHeight - window.innerHeight);
    return Math.min(1, Math.max(0, window.scrollY / scrollableHeight));
  });
  const [showBackToTop, setShowBackToTop] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.scrollY > 560;
  });
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallButton, setShowInstallButton] = useState(false);
  const [isDataSaver, setIsDataSaver] = useState(() => getIsDataSaverMode());
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return false;
    return window.visualViewport.height < window.innerHeight * 0.78;
  });
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [isDockNavigating, setIsDockNavigating] = useState(false);
  const [isDockLockPinned, setIsDockLockPinned] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showIOSHint, setShowIOSHint] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (getDismissedInstallHint()) return false;
    if (getIsStandaloneMode()) return false;
    return getIsIOS();
  });

  const armDockLock = useCallback((durationMs: number) => {
    dockNavLockUntilRef.current = Date.now() + durationMs;
    setIsDockLockPinned(true);
    if (dockLockTimeoutRef.current) {
      clearTimeout(dockLockTimeoutRef.current);
    }
    dockLockTimeoutRef.current = setTimeout(() => {
      setIsDockLockPinned(false);
      dockLockTimeoutRef.current = null;
    }, durationMs + 40);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    const handleScroll = () => {
      const currentY = window.scrollY;
      const doc = document.documentElement;
      const scrollableHeight = Math.max(1, doc.scrollHeight - window.innerHeight);
      const progress = Math.min(1, Math.max(0, currentY / scrollableHeight));
      setScrollProgress(progress);
      setShowBackToTop(currentY > 560);
      setDockCollapsed((prev) => {
        if (currentY < 72) return false;
        if (Date.now() < dockNavLockUntilRef.current) return false;
        const delta = currentY - lastScrollYRef.current;
        if (delta > 28 && currentY > 220) return true;
        if (delta < -18) return false;
        return prev;
      });
      lastScrollYRef.current = currentY;
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (getDismissedInstallHint()) return;
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setShowInstallButton(true);
      setShowIOSHint(false);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setShowInstallButton(false);
      setShowIOSHint(false);
      dismissInstallHint();
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (isEditableTarget(event.target)) {
        setIsInputFocused(true);
        setDockCollapsed(true);
      }
    };

    const handleFocusOut = (event: FocusEvent) => {
      if (isEditableTarget(event.target)) {
        window.setTimeout(() => {
          const active = document.activeElement;
          setIsInputFocused(isEditableTarget(active));
        }, 0);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('focusin', handleFocusIn);
    window.addEventListener('focusout', handleFocusOut);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    lastScrollYRef.current = window.scrollY;
    dockNavLockUntilRef.current = Date.now() + 1400;
    if (dockLockTimeoutRef.current) {
      clearTimeout(dockLockTimeoutRef.current);
    }
    dockLockTimeoutRef.current = setTimeout(() => {
      setIsDockLockPinned(false);
      dockLockTimeoutRef.current = null;
    }, 1440);
    const frameId = window.requestAnimationFrame(() => {
      setIsDockLockPinned(true);
      setDockCollapsed(false);
      setIsDockNavigating(false);
      setIsInputFocused(false);
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [pathname]);

  useEffect(() => {
    return () => {
      if (dockNavTimeoutRef.current) {
        clearTimeout(dockNavTimeoutRef.current);
      }
      if (dockLockTimeoutRef.current) {
        clearTimeout(dockLockTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const viewport = window.visualViewport;
    if (!viewport) return;

    const handleViewportResize = () => {
      const keyboardLikelyOpen = viewport.height < window.innerHeight * 0.78;
      setIsKeyboardOpen((prev) => (prev === keyboardLikelyOpen ? prev : keyboardLikelyOpen));
      if (keyboardLikelyOpen) {
        setDockCollapsed(true);
      }
    };

    viewport.addEventListener('resize', handleViewportResize);
    return () => {
      viewport.removeEventListener('resize', handleViewportResize);
    };
  }, []);

  useEffect(() => {
    const connection = getConnection();
    if (!connection || !connection.addEventListener || !connection.removeEventListener) return;

    const handleConnectionChange = () => {
      const next = getIsDataSaverMode();
      setIsDataSaver((prev) => (prev === next ? prev : next));
    };

    connection.addEventListener('change', handleConnectionChange);
    return () => {
      connection.removeEventListener?.('change', handleConnectionChange);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (isDataSaver) {
      root.setAttribute('data-data-saver', '1');
      return () => {
        root.removeAttribute('data-data-saver');
      };
    }
    root.removeAttribute('data-data-saver');
    return () => {
      root.removeAttribute('data-data-saver');
    };
  }, [isDataSaver]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (dockEnabled) {
      root.setAttribute('data-mobile-dock-route', '1');
      return () => {
        root.removeAttribute('data-mobile-dock-route');
      };
    }
    root.removeAttribute('data-mobile-dock-route');
    return () => {
      root.removeAttribute('data-mobile-dock-route');
    };
  }, [dockEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isDataSaver) return;

    const warmupRoutes = ['/market', '/posts', '/ib', '/tools/stock-analyzer/native'];
    let idleId: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const warmup = () => {
      for (const route of warmupRoutes) {
        router.prefetch(route);
      }
    };

    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(
        () => {
          warmup();
        },
        { timeout: 1800 },
      );
    } else {
      timerId = setTimeout(() => {
        warmup();
      }, 450);
    }

    return () => {
      if (idleId !== null && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    };
  }, [router, isDataSaver]);

  const progressStyle = useMemo(
    () => ({ transform: `scaleX(${scrollProgress})` }),
    [scrollProgress],
  );

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setShowInstallButton(false);
    if (choice.outcome === 'accepted') {
      dismissInstallHint();
      setShowIOSHint(false);
    }
  };

  const handleDismissHint = () => {
    dismissInstallHint();
    setShowInstallButton(false);
    setShowIOSHint(false);
  };

  const handleBackToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDockNavigation = () => {
    setDockCollapsed(false);
    setIsDockNavigating(true);
    armDockLock(2200);
    if (dockNavTimeoutRef.current) {
      clearTimeout(dockNavTimeoutRef.current);
    }
    dockNavTimeoutRef.current = setTimeout(() => {
      setIsDockNavigating(false);
      dockNavTimeoutRef.current = null;
    }, 520);
  };

  const handleDockIntentPrefetch = (href: string) => {
    armDockLock(900);
    if (isDataSaver) return;
    router.prefetch(href);
  };

  const dockHidden =
    !dockEnabled ||
    isKeyboardOpen ||
    isInputFocused ||
    (dockCollapsed && !isDockNavigating && !isDockLockPinned);
  const showActionStack =
    !isKeyboardOpen &&
    !isInputFocused &&
    (isDataSaver || !isOnline || showInstallButton || showIOSHint || showBackToTop);
  const stackCollapsed = dockCollapsed && !isDockNavigating && isOnline && !showInstallButton && !showIOSHint;

  return (
    <>
      <div
        className={`app-scroll-progress ${scrollProgress > 0.01 ? 'visible' : ''}`}
        style={progressStyle}
        aria-hidden="true"
      />
      <div className={`app-route-pulse ${isDockNavigating ? 'active' : ''}`} aria-hidden="true" />

      {showActionStack ? (
        <aside className={`app-floating-stack ${stackCollapsed ? 'collapsed' : ''}`} aria-label="Quick app actions">
          {isDataSaver && isOnline ? (
            <div className="app-float-pill app-float-pill-info" aria-live="polite">
              LITE MODE
            </div>
          ) : null}

          {!isOnline ? (
            <div className="app-float-pill app-float-pill-alert" aria-live="polite">
              OFFLINE MODE
            </div>
          ) : null}

          {showInstallButton ? (
            <div className="app-float-inline">
              <button
                type="button"
                className="app-float-pill app-float-pill-primary"
                onClick={() => {
                  void handleInstallClick();
                }}
                aria-label="앱 설치"
              >
                앱 설치
              </button>
              <button
                type="button"
                className="app-float-dismiss"
                onClick={handleDismissHint}
                aria-label="설치 힌트 닫기"
              >
                ×
              </button>
            </div>
          ) : null}

          {showIOSHint ? (
            <div className="app-float-inline">
              <div className="app-float-pill app-float-pill-muted">
                iOS: 공유 → 홈 화면 추가
              </div>
              <button
                type="button"
                className="app-float-dismiss"
                onClick={handleDismissHint}
                aria-label="iOS 설치 힌트 닫기"
              >
                ×
              </button>
            </div>
          ) : null}

          {showBackToTop ? (
            <button
              type="button"
              className="app-float-pill"
              onClick={handleBackToTop}
              aria-label="맨 위로 이동"
            >
              TOP
            </button>
          ) : null}
        </aside>
      ) : null}

      <nav className={`app-mobile-dock md:hidden ${dockHidden ? 'collapsed' : ''} ${isDockNavigating ? 'navigating' : ''}`} aria-label="Primary quick navigation">
        {dockItems.map((item) => {
          const active = item.isActive(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`app-mobile-dock-item ${active ? 'active' : ''}`}
              tabIndex={dockHidden ? -1 : 0}
              aria-current={active ? 'page' : undefined}
              onClick={handleDockNavigation}
              onMouseEnter={() => handleDockIntentPrefetch(item.href)}
              onTouchStart={() => handleDockIntentPrefetch(item.href)}
            >
              <span aria-hidden="true" className="app-mobile-dock-icon">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
