'use client';

import { useState, useEffect } from 'react';

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

function canInstallOnIOS() {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as NavigatorWithStandalone;
  const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
  return isIOS && !isStandalone;
}

export function useInstallPrompt(showToast: (message: string) => void) {
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallAction, setShowInstallAction] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncInstallState = () => {
      setShowInstallAction(canInstallOnIOS());
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
      setShowInstallAction(true);
    };

    const handleAppInstalled = () => {
      setInstallPromptEvent(null);
      setShowInstallAction(false);
    };

    syncInstallState();
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (installPromptEvent) {
      await installPromptEvent.prompt();
      const choice = await installPromptEvent.userChoice;
      setInstallPromptEvent(null);
      setShowInstallAction(false);
      showToast(choice.outcome === 'accepted' ? '앱 설치를 진행합니다.' : '앱 설치가 취소되었습니다.');
      return;
    }

    if (canInstallOnIOS()) {
      showToast('iPhone/iPad: 공유 -> 홈 화면에 추가');
      return;
    }

    showToast('이 브라우저에서는 앱 설치를 지원하지 않습니다.');
  };

  return { showInstallAction, handleInstallClick };
}
