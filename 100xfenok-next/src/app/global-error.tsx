'use client';

import "./globals.css";
import { useEffect } from "react";
import { ROUTES } from "@/lib/routes";

/**
 * Last-resort boundary for errors thrown by the root layout itself. It
 * replaces the whole document, so it owns <html>/<body> and imports the global
 * stylesheet directly instead of relying on the (failed) root layout for it.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error.digest ?? "", error);
  }, [error]);

  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-50 text-slate-800">
        <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-4 text-center" role="alert">
          <p className="mb-2 text-[12px] font-semibold tracking-[0.2em] text-slate-600">
            FENOK SYSTEM
          </p>
          <h1 className="mb-3 text-3xl font-black text-slate-900">예상치 못한 오류</h1>
          <p className="mb-6 text-sm text-slate-600">
            잠시 후 다시 시도하거나 홈으로 이동해주세요.
          </p>
          <div className="mb-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="min-h-11 rounded-lg bg-[var(--c-brand)] px-5 py-2.5 text-sm font-semibold text-white"
            >
              다시 시도
            </button>
            {/* A plain anchor on purpose: the router may be what failed. */}
            <a
              href={ROUTES.home}
              className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700"
            >
              홈으로
            </a>
          </div>
          {error.digest ? <p className="text-[11px] text-slate-600">오류 코드 {error.digest}</p> : null}
        </div>
      </body>
    </html>
  );
}
