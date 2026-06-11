import type { Metadata } from "next";
import TransitionLink from "@/components/TransitionLink";
import ExploreHotTopics from "./ExploreHotTopics";
import ExploreDashboard from "./ExploreDashboard";
import MarketThermometer from "./MarketThermometer";
import SignalStrip from "./SignalStrip";
import WeekAheadCard from "./WeekAheadCard";
import MyWatchlistStrip from "./MyWatchlistStrip";
import DataNav from "@/components/DataNav";

export const metadata: Metadata = {
  title: "Explore | 100xFenok",
  description: "시장 신호·체온계·일정·섹터·종목까지 — 오늘 시장을 30초에 파악하는 대시보드.",
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
    href: "/market-valuation",
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
  {
    step: "04",
    tier: "구루",
    title: "13F Superinvestors",
    desc: "버핏·클라먼·드러컨밀러 등 30개 슈퍼인베스터의 13F 보유 데이터와 컨센서스.",
    href: "/superinvestors",
    icon: "fa-user-tie",
    accent: "text-violet-600",
  },
];

export default function ExplorePage() {
  return (
    <main className="container mx-auto max-w-5xl px-3 py-6 sm:px-4 sm:py-10">
      <header className="max-w-2xl">
        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand-interactive">Explore</p>
        <h1 className="mt-1 text-xl font-black tracking-tight text-slate-950 sm:text-2xl">오늘의 시장</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          한 화면에서 <strong className="text-slate-800">시장 신호 → 체온 → 일정 → 섹터 → 종목</strong>까지.
          지금 시장이 어떤 상태인지 30초 안에 파악하세요.
        </p>
        <div className="mt-3">
          <DataNav active="explore" />
        </div>
      </header>

      <div className="mt-6 space-y-3">
        <MyWatchlistStrip />
        <SignalStrip />
      </div>

      <ExploreDashboard />

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <MarketThermometer />
        <WeekAheadCard />
      </div>

      <ExploreHotTopics />

      {/* Deep-dive destinations — compact pill row (demoted from hero tiles) */}
      <nav aria-label="더 깊이 보기" className="mt-8">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">더 깊이 보기</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {TIERS.filter((t) => t.href).map((tier) => (
            <TransitionLink
              key={tier.step}
              href={tier.href as string}
              className="inline-flex min-h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 text-[11px] font-black text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
            >
              <i className={`fas ${tier.icon} ${tier.accent}`} aria-hidden="true" />
              {tier.title}
              <span className="text-slate-300">→</span>
            </TransitionLink>
          ))}
        </div>
      </nav>

      <p className="mt-6 text-[11px] text-slate-400">
        데이터: Global Scouter · Bloomberg benchmarks · SEC 13F.
      </p>
    </main>
  );
}
