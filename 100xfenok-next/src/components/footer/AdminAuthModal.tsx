'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  ADMIN_MAX_FAILURES,
  clearAdminVerifyState,
  getAdminVerifyLockRemainingMs,
  registerAdminVerifyFailure,
  setAdminAuthenticated,
  verifyAdminPassword,
} from '@/lib/client/admin-auth';
import { lockBodyScroll, unlockBodyScroll } from '@/lib/client/body-scroll-lock';

type AdminAuthModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: () => void;
  syncAdminState: () => Promise<void>;
  showToast: (message: string) => void;
};

export default function AdminAuthModal({
  isOpen,
  onClose,
  onAuthenticated,
  syncAdminState,
  showToast,
}: AdminAuthModalProps) {
  const [adminPassword, setAdminPassword] = useState('');
  const [adminInputError, setAdminInputError] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [lockRemainingMs, setLockRemainingMs] = useState(0);
  const adminInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const lockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearLockTimer = useCallback(() => {
    if (lockTimerRef.current) {
      clearInterval(lockTimerRef.current);
      lockTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const remaining = getAdminVerifyLockRemainingMs();
    setLockRemainingMs(remaining);
    if (remaining > 0) {
      const deadline = Date.now() + remaining;
      lockTimerRef.current = setInterval(() => {
        const r = Math.max(0, deadline - Date.now());
        setLockRemainingMs(r);
        if (r <= 0) clearLockTimer();
      }, 200);
    }
    return clearLockTimer;
  }, [clearLockTimer]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => {
        adminInputRef.current?.focus();
      });
    } else if (!isOpen && dialog.open) {
      dialog.close();
      setAdminPassword('');
      setAdminInputError(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    lockBodyScroll('admin-auth-modal');
    return () => unlockBodyScroll('admin-auth-modal');
  }, [isOpen]);

  const handleCancel = useCallback((event: React.SyntheticEvent) => {
    event.preventDefault();
    if (!isVerifying) {
      onClose();
    }
  }, [isVerifying, onClose]);

  const handleVerify = async () => {
    if (lockRemainingMs > 0) {
      const lockSeconds = Math.max(1, Math.ceil(lockRemainingMs / 1000));
      showToast(`잠시 후 다시 시도하세요 (${lockSeconds}s)`);
      return;
    }

    const input = adminPassword.trim();
    if (!input || isVerifying) return;

    setIsVerifying(true);

    try {
      const result = await verifyAdminPassword(input);

      const win = window as Window & { scheduler?: { yield?: () => Promise<void> } };
      if (win.scheduler?.yield) {
        await win.scheduler.yield();
      }

      if (result === 'matched') {
        setAdminAuthenticated();
        await syncAdminState();
        setAdminPassword('');
        setAdminInputError(false);
        onClose();
        onAuthenticated();
        return;
      }

      setAdminPassword('');
      setAdminInputError(true);
      if (result === 'unsupported') {
        clearAdminVerifyState();
        showToast('브라우저 인증 기능을 사용할 수 없습니다.');
      } else {
        const failureState = registerAdminVerifyFailure();
        if (failureState.locked) {
          setLockRemainingMs(failureState.remainingMs);
          const deadline = Date.now() + failureState.remainingMs;
          clearLockTimer();
          lockTimerRef.current = setInterval(() => {
            const r = Math.max(0, deadline - Date.now());
            setLockRemainingMs(r);
            if (r <= 0) clearLockTimer();
          }, 200);
          showToast('Access denied · 3초 후 재시도');
        } else {
          showToast(`Access denied (${failureState.failCount}/${ADMIN_MAX_FAILURES})`);
        }
      }
      adminInputRef.current?.focus();
    } catch {
      showToast('인증 처리 중 오류가 발생했습니다.');
    } finally {
      setIsVerifying(false);
    }
  };

  const isLocked = lockRemainingMs > 0;
  const lockSeconds = Math.max(1, Math.ceil(lockRemainingMs / 1000));

  return (
    <dialog
      ref={dialogRef}
      className="backdrop:bg-black/50 backdrop:backdrop-blur-sm bg-transparent p-0 max-w-sm w-full mx-auto"
      onCancel={handleCancel}
      aria-label="Admin Access Control"
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <h3 className="mb-2 flex items-center gap-2 text-lg font-bold text-brand-navy">
          <i className="fas fa-lock text-brand-interactive" />
          Access Control
        </h3>
        <p className="mb-4 text-sm text-slate-500">관리자 인증이 필요합니다.</p>
        <input
          ref={adminInputRef}
          type="password"
          value={adminPassword}
          disabled={isLocked}
          onChange={(event) => {
            setAdminPassword(event.target.value);
            if (adminInputError) {
              setAdminInputError(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void handleVerify();
            }
          }}
          className={`w-full rounded-lg border px-4 py-3 outline-none transition ${adminInputError ? 'border-red-500 ring-2 ring-red-100' : 'border-slate-300 focus:ring-2 focus:ring-brand-interactive'}`}
          placeholder="Password"
          autoComplete="off"
          aria-invalid={adminInputError}
        />
        {isLocked ? (
          <p className="mt-2 text-xs font-semibold text-amber-700">
            보호 모드 활성화: {lockSeconds}s 후 재시도
          </p>
        ) : null}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => {
              if (!isVerifying) onClose();
            }}
            className="flex-1 rounded-lg bg-slate-100 px-4 py-2 font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isVerifying}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void handleVerify();
            }}
            className="flex-1 rounded-lg bg-brand-interactive px-4 py-2 font-medium text-white transition-colors hover:bg-brand-navy disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isVerifying || isLocked || adminPassword.trim().length === 0}
          >
            Confirm
          </button>
        </div>
      </div>
    </dialog>
  );
}
