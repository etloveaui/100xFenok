import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Admin Hub",
  description: "100xFenok 관리자 허브",
};

const adminLinks = [
  {
    href: "/admin/data-lab",
    title: "Data Lab",
    description: "JSON 상태와 데이터 소스 품질을 점검합니다.",
    icon: "fa-database",
    badge: "DATA",
  },
  {
    href: "/admin/macro-monitor",
    title: "Macro Monitor",
    description: "매크로 위젯 동작과 출력 품질을 검증합니다.",
    icon: "fa-satellite-dish",
    badge: "MACRO",
  },
  {
    href: "/admin/design-lab?mode=native",
    title: "Design Lab (Native)",
    description: "Figma 포팅 결과를 네이티브 컴포넌트로 점검합니다.",
    icon: "fa-palette",
    badge: "UI",
  },
  {
    href: "/admin/ib-helper",
    title: "IB Helper",
    description: "계산/실행 보조 도구를 브리지 경로로 진입합니다.",
    icon: "fa-calculator",
    badge: "TRADING",
  },
];

export default function AdminRootPage() {
  return (
    <main className="container mx-auto px-4 py-5">
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 via-brand-navy to-brand-interactive p-5 text-white shadow-[0_26px_55px_-38px_rgba(2,6,23,0.92)]">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/75">100xFenok Control Tower</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Admin Hub</h1>
        <p className="mt-3 max-w-2xl text-sm text-white/85">
          마이그레이션 검증, 레거시 브리지 점검, 디자인 고도화를 하나의 진입점에서 관리합니다.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/admin/design-lab?mode=native"
            className="min-h-11 rounded-xl border border-white/25 bg-white/10 px-4 text-sm font-bold text-white transition hover:bg-white/20"
          >
            Native Preview 열기
          </Link>
          <Link
            href="/admin/design-lab"
            className="min-h-11 rounded-xl border border-white/25 bg-transparent px-4 text-sm font-bold text-white transition hover:bg-white/15"
          >
            Legacy Bridge 열기
          </Link>
        </div>
      </section>

      <section className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
        {adminLinks.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-interactive hover:shadow-[0_18px_34px_-30px_rgba(15,23,42,0.7)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600">
                  {item.badge}
                </span>
                <h2 className="mt-3 text-lg font-black text-slate-900">{item.title}</h2>
                <p className="mt-1 text-sm text-slate-600">{item.description}</p>
              </div>
              <span className="inline-flex size-11 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition group-hover:bg-brand-interactive group-hover:text-white">
                <i className={`fas ${item.icon}`} aria-hidden="true" />
              </span>
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}
