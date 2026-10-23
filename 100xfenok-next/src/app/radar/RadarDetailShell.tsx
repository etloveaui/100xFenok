"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { CardState } from "./useRadarData";

export default function RadarDetailShell({ title, legacyPath, state, retry, children }: {
  title: string; legacyPath: string; state: CardState; retry: () => void; children: ReactNode;
}) {
  return <main className="mx-auto max-w-7xl space-y-5 p-3 sm:p-6" data-radar-native-detail="true">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><Link href="/radar" className="text-sm text-blue-700">← Market Radar</Link><h1 className="mt-2 text-2xl font-black">{title}</h1></div>
      <div className="flex gap-4 text-sm"><button type="button" onClick={retry}>새로고침</button><Link href={`/radar?legacy=1&path=${encodeURIComponent(legacyPath)}`}>기존 상세 보기</Link></div>
    </header>
    {state === "loading" ? <p role="status">자료를 불러오는 중입니다.</p> : null}
    {state === "missing" || state === "failed" ? <p role="alert">{state === "failed" ? "자료를 불러오지 못했습니다." : "일부 관측값이 없습니다."} <button type="button" onClick={retry}>다시 시도</button></p> : null}
    {children}
  </main>;
}

export function DetailMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4"><dt className="text-sm font-bold text-slate-500">{label}</dt><dd className="my-1 text-2xl font-black">{value}</dd><dd className="text-xs text-slate-500">{detail}</dd></div>;
}
