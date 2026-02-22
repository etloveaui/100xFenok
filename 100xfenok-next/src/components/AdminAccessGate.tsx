'use client';

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearAdminAuthenticated,
  isAdminAuthenticated,
  setAdminAuthenticated,
  verifyAdminPassword,
  type AdminVerifyResult,
} from "@/lib/client/admin-auth";

type AdminAccessGateProps = {
  children: ReactNode;
};

export default function AdminAccessGate({ children }: AdminAccessGateProps) {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAuthenticated(isAdminAuthenticated());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || authenticated) return;
    inputRef.current?.focus();
  }, [authenticated, ready]);

  const helperText = useMemo(() => {
    if (errorMessage) return errorMessage;
    return "관리자 비밀번호를 입력해야 대시보드를 볼 수 있습니다.";
  }, [errorMessage]);

  const onVerify = async () => {
    const input = password.trim();
    if (!input || isVerifying) return;

    setIsVerifying(true);
    setErrorMessage("");

    try {
      const result: AdminVerifyResult = await verifyAdminPassword(input);
      if (result === "matched") {
        setAdminAuthenticated();
        setAuthenticated(true);
        setPassword("");
        setErrorMessage("");
        return;
      }

      if (result === "unsupported") {
        setErrorMessage("브라우저 인증 기능을 사용할 수 없습니다.");
      } else {
        setErrorMessage("비밀번호가 일치하지 않습니다.");
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
                setPassword("");
                setErrorMessage("");
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
              disabled={isVerifying || password.trim().length === 0}
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
