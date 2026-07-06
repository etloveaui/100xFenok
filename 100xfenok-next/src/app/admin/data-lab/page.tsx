import type { Metadata } from "next";
import Link from "next/link";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";
import { ROUTES } from "@/lib/routes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin Data Lab | 100xFenok",
  description: "100xFenok 관리자 데이터 상태와 레거시 Data Lab 경계를 분리한 진단 화면",
};

export default function AdminDataLabPage() {
  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4"
      data-admin-data-lab-surface="true"
      data-admin-data-lab-route-owner="legacy-admin-data-lab"
    >
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-admin-data-lab-boundary="true">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">Admin Data Lab</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">Data Lab (레거시)</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
              관리자 데이터 진단은 기존 HTML Data Lab을 기본 소유 화면으로 유지하고, 공개 제품 화면과 원시 진단
              경계를 분리합니다.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-[0.08em]">
              <span
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600"
                data-admin-data-lab-boundary-chip="admin-only"
              >
                admin only
              </span>
              <span
                className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700"
                data-admin-data-lab-boundary-chip="legacy-html"
              >
                legacy html
              </span>
              <span
                className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700"
                data-admin-data-lab-boundary-chip="source-audit"
              >
                source audit
              </span>
            </div>
          </div>
          <nav className="grid min-w-[min(100%,24rem)] grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Data Lab 경로">
            <Link
              href="/admin"
              className="flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-black text-slate-700 transition hover:bg-slate-100"
              data-admin-data-lab-owner-link="admin-hub"
            >
              Admin Hub
            </Link>
            <Link
              href={ROUTES.market}
              className="flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-black text-slate-700 transition hover:bg-slate-100"
              data-admin-data-lab-owner-link="market"
            >
              시장 화면
            </Link>
            <Link
              href={ROUTES.explore}
              className="flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-black text-slate-700 transition hover:bg-slate-100"
              data-admin-data-lab-owner-link="explore"
            >
              홈 탐색
            </Link>
          </nav>
        </div>
      </section>

      <div data-admin-data-lab-legacy-frame="true">
        <RouteEmbedFrame src="/admin/data-lab/index.html" title="100x Admin Data Lab" loading="eager" />
      </div>
    </main>
  );
}
