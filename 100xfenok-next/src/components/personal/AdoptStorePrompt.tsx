"use client";

import { useEffect, useState } from "react";
import { onAdoptConflict, type AdoptConflict } from "@/lib/personal/personalStore";
import { ROUTES } from "@/lib/routes";

export default function AdoptStorePrompt() {
  const [conflict, setConflict] = useState<AdoptConflict | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Never show on /intro
    if (typeof window !== "undefined" && window.location.pathname.startsWith(ROUTES.intro)) {
      return;
    }

    const unsub = onAdoptConflict((c) => {
      setConflict(c);
    });
    return unsub;
  }, []);

  if (!conflict) return null;

  const itemsList =
    conflict.items && conflict.items.length > 0
      ? conflict.items.join(" · ")
      : conflict.key === "portfolio"
        ? "포트폴리오"
        : conflict.key === "watchlist"
          ? "관심종목"
          : conflict.key === "ib"
            ? "무한매수 기록"
            : "매크로 프리셋";

  const isSingle = !conflict.items || conflict.items.length <= 1;
  const title =
    isSingle && conflict.key === "portfolio"
      ? "이 기기의 포트폴리오를 계정으로 가져올까요?"
      : isSingle && conflict.key === "watchlist"
        ? "이 기기의 관심종목을 계정으로 가져올까요?"
        : `이 기기의 ${itemsList} 데이터를 계정으로 가져올까요?`;

  const description = `현재 기기에 보관된 ${itemsList} 데이터와 계정에 저장된 내용이 다릅니다. 이 기기의 데이터를 계정에 동기화하시겠습니까?`;

  const handleChoice = async (choice: "adopt_local" | "keep_account") => {
    if (busy) return;
    setBusy(true);
    try {
      await conflict.resolve(choice);
    } finally {
      setBusy(false);
      setConflict(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adopt-prompt-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-brand-navy/10 text-brand-navy">
            <i className="fas fa-cloud-arrow-up text-[16px]" aria-hidden="true" />
          </div>
          <div>
            <h3 id="adopt-prompt-title" className="text-[16px] font-bold text-slate-900">
              {title}
            </h3>
            <p className="mt-0.5 text-[12px] text-slate-500">데이터 동기화 확인</p>
          </div>
        </div>

        <p className="mt-4 text-[13px] leading-relaxed text-slate-600">
          {description}
        </p>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={() => handleChoice("keep_account")}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 bg-slate-100 px-4 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50"
          >
            계정 것 유지
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => handleChoice("adopt_local")}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-brand-navy px-4 text-[13px] font-semibold text-white shadow transition hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? "동기화 중..." : "가져오기"}
          </button>
        </div>
      </div>
    </div>
  );
}
