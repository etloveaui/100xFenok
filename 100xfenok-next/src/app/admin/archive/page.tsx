import type { Metadata } from "next";
import Link from "next/link";

import { RETIRED_PUBLIC_SURFACES } from "@/lib/retired-public-routes";
import { ROUTES } from "@/lib/routes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Public Archive",
  description: "100xFenok 공개 보관 화면",
};

const archiveCopy: Record<string, { label: string; description: string; icon: string }> = {
  [ROUTES.stockAnalyzer]: {
    label: "종목 분석기",
    description: "기존 종목 분석 화면을 관리자 전용으로 확인합니다.",
    icon: "fa-chart-line",
  },
  [ROUTES.alphaScout]: {
    label: "알파 스카우트",
    description: "보관된 알파 리포트와 탐색 화면을 확인합니다.",
    icon: "fa-binoculars",
  },
  [ROUTES.posts]: {
    label: "분석 아카이브",
    description: "기존 분석 글과 발행 기록을 관리자 전용으로 엽니다.",
    icon: "fa-newspaper",
  },
  [ROUTES.dailyWrap]: {
    label: "데일리 랩",
    description: "보관된 시장 데일리 랩 화면을 확인합니다.",
    icon: "fa-calendar-days",
  },
  [ROUTES.workbench]: {
    label: "워크벤치",
    description: "기존 데이터 작업 화면을 관리자 전용으로 확인합니다.",
    icon: "fa-screwdriver-wrench",
  },
};

export default function AdminArchivePage() {
  return (
    <main className="container mx-auto px-4 py-5">
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 via-brand-navy to-brand-interactive p-5 text-white shadow-[var(--shadow-card-dark)]">
        <Link href="/admin" className="text-sm font-semibold text-white/75 transition hover:text-white">
          ← Admin Hub
        </Link>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-white/75">Admin Archive</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Public Archive</h1>
        <p className="mt-3 max-w-2xl text-sm text-white/85">
          공개 메뉴에서 보관한 화면을 관리자 전용으로 확인합니다.
        </p>
      </section>

      <section className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
        {RETIRED_PUBLIC_SURFACES.map((surface) => {
          const copy = archiveCopy[surface.href];

          return (
            <Link
              key={surface.href}
              href={surface.href}
              className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-interactive hover:shadow-[var(--sh-sm)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600">
                    ARCHIVE
                  </span>
                  <h2 className="mt-3 text-lg font-black text-slate-900">{copy?.label ?? surface.href}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {copy?.description ?? "보관된 화면을 관리자 전용으로 확인합니다."}
                  </p>
                </div>
                <span className="inline-flex size-11 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition group-hover:bg-brand-interactive group-hover:text-white">
                  <i className={`fas ${copy?.icon ?? "fa-box-archive"}`} aria-hidden="true" />
                </span>
              </div>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
