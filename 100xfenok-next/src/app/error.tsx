'use client';

import { useEffect } from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";

/**
 * Route error boundary. It renders INSIDE the root layout (and, on shell
 * routes, inside the persistent chrome), so it must not emit <html>/<body> —
 * that is global-error.tsx's job. Keeping the chrome visible means a failed
 * page never strands the user: the rail, tab bar and search still work.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route-error]", error.digest ?? "", error);
  }, [error]);

  const safeErrorMessage =
    process.env.NODE_ENV === "production"
      ? "일시적인 내부 오류가 발생했습니다."
      : error.message || "Unknown error";

  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-2xl items-center justify-center px-4 py-10" role="alert">
      {/* The slate-50 card keeps the slate-500 eyebrow at >= 4.5:1; on the
          shell background alone it would fall just short. */}
      <div className="flex w-full flex-col items-center rounded-2xl border border-slate-200 bg-slate-50 px-6 py-10 text-center">
        <p className="mb-2 text-[12px] font-semibold tracking-[0.2em] text-slate-500">
          FENOK SYSTEM
        </p>
        <h1 className="mb-3 text-3xl font-black text-slate-900">예상치 못한 오류</h1>
        <p className="mb-6 text-sm text-slate-600">
          페이지를 다시 시도하거나 홈으로 이동해주세요.
        </p>
        <div className="mb-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="min-h-11 rounded-lg bg-[var(--c-brand)] px-5 py-2.5 text-sm font-semibold text-white"
          >
            다시 시도
          </button>
          <Link
            href={ROUTES.home}
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700"
          >
            홈으로
          </Link>
        </div>
        <p className="max-w-xl break-words rounded-md bg-white px-3 py-2 text-[12px] text-slate-500">
          {safeErrorMessage}
          {error.digest ? <span className="block text-[11px] text-slate-600">오류 코드 {error.digest}</span> : null}
        </p>
      </div>
    </div>
  );
}
