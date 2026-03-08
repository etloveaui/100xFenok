'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ADMIN_AUTH_CHANGE_EVENT,
  ADMIN_MAX_FAILURES,
  ADMIN_VERIFY_STATE_EVENT,
  clearAdminAuthenticated,
  clearAdminVerifyState,
  getAdminVerifyLockRemainingMs,
  isAdminAuthenticated,
  refreshAdminAuthenticated,
  registerAdminVerifyFailure,
  setAdminAuthenticated,
  verifyAdminPassword,
  type AdminVerifyResult,
} from "@/lib/client/admin-auth";

type AdminAccessGateProps = {
  children?: ReactNode;
};

export default function AdminAccessGate({ children }: AdminAccessGateProps) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [lockRemainingMs, setLockRemainingMs] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const lockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const syncAdminState = async () => {
      const authenticatedState = await refreshAdminAuthenticated();
      setAuthenticated(authenticatedState);
      setLockRemainingMs(getAdminVerifyLockRemainingMs());
    };

    void syncAdminState().finally(() => {
      setReady(true);
    });

    const handleSync = () => {
      void syncAdminState();
    };

    window.addEventListener("focus", handleSync);
    window.addEventListener("storage", handleSync);
    window.addEventListener(ADMIN_AUTH_CHANGE_EVENT, handleSync as EventListener);
    window.addEventListener(ADMIN_VERIFY_STATE_EVENT, handleSync as EventListener);

    return () => {
      window.removeEventListener("focus", handleSync);
      window.removeEventListener("storage", handleSync);
      window.removeEventListener(ADMIN_AUTH_CHANGE_EVENT, handleSync as EventListener);
      window.removeEventListener(ADMIN_VERIFY_STATE_EVENT, handleSync as EventListener);
    };
  }, [router]);

  useEffect(() => {
    if (!ready || authenticated) return;
    inputRef.current?.focus();
  }, [authenticated, ready]);

  useEffect(() => {
    if (lockRemainingMs <= 0) {
      if (lockTimerRef.current) {
        clearInterval(lockTimerRef.current);
        lockTimerRef.current = null;
      }
      return;
    }

    if (lockTimerRef.current) {
      clearInterval(lockTimerRef.current);
    }

    lockTimerRef.current = setInterval(() => {
      const remainingMs = getAdminVerifyLockRemainingMs();
      setLockRemainingMs(remainingMs);
      if (remainingMs <= 0 && lockTimerRef.current) {
        clearInterval(lockTimerRef.current);
        lockTimerRef.current = null;
      }
    }, 200);

    return () => {
      if (lockTimerRef.current) {
        clearInterval(lockTimerRef.current);
        lockTimerRef.current = null;
      }
    };
  }, [lockRemainingMs]);

  const helperText = useMemo(() => {
    if (lockRemainingMs > 0) {
      const seconds = Math.max(1, Math.ceil(lockRemainingMs / 1000));
      return `보호 모드 활성화: ${seconds}s 후 재시도`;
    }
    if (errorMessage) return errorMessage;
    return "관리자 비밀번호를 입력해야 대시보드를 볼 수 있습니다.";
  }, [errorMessage, lockRemainingMs]);

  const onVerify = async () => {
    const input = password.trim();
    if (!input || isVerifying) return;
    if (lockRemainingMs > 0) {
      setErrorMessage(helperText);
      return;
    }

    setIsVerifying(true);
    setErrorMessage("");

    try {
      const result: AdminVerifyResult = await verifyAdminPassword(input);
      if (result === "matched") {
        setAdminAuthenticated();
        setAuthenticated(true);
        setPassword("");
        setErrorMessage("");
        setLockRemainingMs(0);
        router.refresh();
        return;
      }

      if (result === "unsupported") {
        clearAdminVerifyState();
        setLockRemainingMs(0);
        setErrorMessage("브라우저 인증 기능을 사용할 수 없습니다.");
      } else {
        const failureState = registerAdminVerifyFailure();
        setLockRemainingMs(failureState.remainingMs);
        if (failureState.locked) {
          const seconds = Math.max(1, Math.ceil(failureState.remainingMs / 1000));
          setErrorMessage(`보호 모드 활성화: ${seconds}s 후 재시도`);
        } else {
          setErrorMessage(`비밀번호가 일치하지 않습니다. (${failureState.failCount}/${ADMIN_MAX_FAILURES})`);
        }
      }
      setPassword("");
      inputRef.current?.focus();
    } catch {
      setErrorMessage("인증 처리 중 오류가 발생했습니다.");
    } finally {
      setIsVerifying(false);
    }
  };

  if (!ready) {
    return (
      <main className="container mx-auto px-4 py-8">
        <section className="rounded-2xl border border-slate-200 bg-white px-5 py-6 shadow-sm">
          <p className="text-sm font-medium text-slate-600">관리자 세션을 확인하는 중입니다...</p>
        </section>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="container mx-auto px-4 py-8">
        <section className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white px-5 py-6 shadow-[0_22px_48px_-34px_rgba(15,23,42,0.7)]">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Admin Access</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">관리자 인증</h1>
            <p className={`mt-2 text-sm ${errorMessage ? "text-red-600" : "text-slate-600"}`} aria-live="polite">
              {helperText}
            </p>
          </div>
          <label htmlFor="admin-auth-input" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Password
          </label>
          <input
            id="admin-auth-input"
            ref={inputRef}
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (errorMessage) {
                setErrorMessage("");
              }
            }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void onVerify();
                }
              }}
            disabled={lockRemainingMs > 0}
            className={`w-full rounded-xl border px-4 py-3 outline-none transition ${errorMessage ? "border-red-500 ring-2 ring-red-100" : "border-slate-300 focus:border-brand-interactive focus:ring-2 focus:ring-brand-interactive/20"}`}
            placeholder="••••••••"
            autoComplete="off"
            aria-invalid={Boolean(errorMessage)}
          />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                clearAdminAuthenticated();
                clearAdminVerifyState();
                setPassword("");
                setErrorMessage("");
                setLockRemainingMs(getAdminVerifyLockRemainingMs());
                inputRef.current?.focus();
              }}
              className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              disabled={isVerifying}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => {
                void onVerify();
              }}
              className="min-h-11 rounded-xl bg-brand-navy px-3 text-sm font-bold text-white transition hover:bg-brand-interactive disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isVerifying || lockRemainingMs > 0 || password.trim().length === 0}
            >
              Confirm
            </button>
          </div>
          <div className="mt-4">
            <Link href="/" className="text-sm font-semibold text-brand-interactive hover:underline">
              메인으로 돌아가기
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
