'use client';

import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-50 text-slate-800">
        <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-4 text-center">
          <p className="mb-2 text-xs font-semibold tracking-[0.2em] text-slate-400">
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
              className="rounded-lg bg-[#010079] px-5 py-2.5 text-sm font-semibold text-white"
            >
              다시 시도
            </button>
            <Link
              href="/"
              className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700"
            >
              홈으로
            </Link>
          </div>
          <p className="max-w-xl break-words rounded-md bg-white px-3 py-2 text-xs text-slate-500">
            {error.message || "Unknown error"}
          </p>
        </div>
      </body>
    </html>
  );
}
