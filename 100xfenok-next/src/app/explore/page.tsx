import type { Metadata } from "next";
import TransitionLink from "@/components/TransitionLink";

export const metadata: Metadata = {
  title: "Explore | 100xFenok",
  description: "시장 → 섹터 → 종목으로 좁혀 들어가는 데이터 탐색 허브.",
};

type Tier = {
  step: string;
  tier: string;
  title: string;
  desc: string;
  href: string | null;
  icon: string;
  accent: string;
};

const TIERS: ReadonlyArray<Tier> = [
  {
    step: "01",
    tier: "시장",
    title: "시장 밸류에이션",
    desc: "S&P500·나스닥·러셀 등 지수 밸류에이션과 신용 환경. 시장 전체가 비싼지 싼지.",
    href: null, // v1: corporate-health native 이관 예정 (#294)
    icon: "fa-globe",
    accent: "text-brand-navy",
  },
  {
    step: "02",
    tier: "섹터",
    title: "섹터 히트맵",
    desc: "11개 미국 업종의 다기간 성과 히트맵, 강·약 순위, 섹터 ETF 비교.",
    href: "/sectors",
    icon: "fa-th",
    accent: "text-emerald-600",
  },
  {
    step: "03",
    tier: "종목",
    title: "종목 스크리너",
    desc: "글로벌 1,066개 종목을 PER·PBR·배당·12개월 수익률로 거르고 줄세우기.",
    href: "/screener",
    icon: "fa-filter",
    accent: "text-brand-interactive",
  },
];

export default function ExplorePage() {
  return (
    <main className="container mx-auto max-w-5xl px-3 py-6 sm:px-4 sm:py-10">
      <header className="max-w-2xl">
        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-interactive">Explore</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">데이터 탐색</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          <strong className="text-slate-800">시장 → 섹터 → 종목</strong>으로 좁혀 들어가며 살펴보세요.
          전체 시장이 어떤지 보고, 어떤 업종이 강한지 찾고, 그 안의 종목을 거릅니다.
        </p>
      </header>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {TIERS.map((tier) => {
          const inner = (
            <>
              <div className="flex items-center justify-between">
                <span className="orbitron text-2xl font-black text-slate-200">{tier.step}</span>
                <i className={`fas ${tier.icon} text-xl ${tier.accent}`} aria-hidden="true" />
              </div>
              <p className="mt-4 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">{tier.tier}</p>
              <h2 className="mt-1 text-lg font-black tracking-tight text-slate-950">{tier.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{tier.desc}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-[0.12em]">
                {tier.href ? (
                  <span className="text-brand-interactive">열기 →</span>
                ) : (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-400">준비 중</span>
                )}
              </span>
            </>
          );

          const cardClass =
            "group flex min-h-[200px] flex-col rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] transition";

          return tier.href ? (
            <TransitionLink key={tier.step} href={tier.href} className={`${cardClass} hover:-translate-y-0.5 hover:border-brand-interactive hover:shadow-[0_18px_48px_-12px_rgba(0,0,0,0.16)]`}>
              {inner}
            </TransitionLink>
          ) : (
            <div key={tier.step} className={`${cardClass} opacity-70`} aria-disabled="true">
              {inner}
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-[11px] text-slate-400">
        시장 밸류에이션은 곧 추가됩니다 (지수 밸류 + 신용). 데이터: Global Scouter · Bloomberg benchmarks.
      </p>
    </main>
  );
}
