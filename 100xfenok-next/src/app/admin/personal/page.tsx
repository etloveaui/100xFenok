import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Personal Hub",
  description: "개인 콘텐츠 허브",
};

const personalLinks = [
  {
    href: "/admin/personal/travel",
    title: "Travel Records",
    description: "여행 기록과 일정을 관리합니다.",
    icon: "fa-plane-departure",
    badge: "TRAVEL",
  },
];

export default function PersonalHubPage() {
  return (
    <main className="container mx-auto px-4 py-5">
      <section className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-900 via-purple-900 to-indigo-800 p-5 text-white shadow-[0_26px_55px_-38px_rgba(49,46,129,0.92)]">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/75">Private Space</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Personal Hub</h1>
        <p className="mt-3 max-w-2xl text-sm text-white/85">
          여행, 메모 등 개인 콘텐츠를 관리합니다.
        </p>
      </section>

      <section className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
        {personalLinks.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-purple-500 hover:shadow-[0_18px_34px_-30px_rgba(88,28,135,0.7)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="inline-flex rounded-full border border-purple-200 bg-purple-50 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-purple-700">
                  {item.badge}
                </span>
                <h2 className="mt-3 text-lg font-black text-slate-900">{item.title}</h2>
                <p className="mt-1 text-sm text-slate-600">{item.description}</p>
              </div>
              <span className="inline-flex size-11 items-center justify-center rounded-xl bg-purple-100 text-purple-600 transition group-hover:bg-purple-600 group-hover:text-white">
                <i className={`fas ${item.icon}`} aria-hidden="true" />
              </span>
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}
