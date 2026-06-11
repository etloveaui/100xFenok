import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import TransitionLink from "@/components/TransitionLink";
import ExploreHotTopics from "./ExploreHotTopics";
import ExploreDashboard from "./ExploreDashboard";
import MarketThermometer from "./MarketThermometer";
import SignalStrip from "./SignalStrip";
import WeekAheadCard from "./WeekAheadCard";
import MyWatchlistStrip from "./MyWatchlistStrip";
import RevisionMoversCard from "./RevisionMoversCard";
import DataNav from "@/components/DataNav";

// Theme C (Korean fintech minimal) — pilot page font
const plexKr = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Explore | 100xFenok",
  description: "시장 신호·체온계·일정·섹터·종목까지 — 오늘 시장을 30초에 파악하는 대시보드.",
};

const TIERS: ReadonlyArray<{ title: string; href: string; icon: string }> = [
  { title: "시장 밸류에이션", href: "/market-valuation", icon: "fa-globe" },
  { title: "섹터 히트맵", href: "/sectors", icon: "fa-th" },
  { title: "종목 스크리너", href: "/screener", icon: "fa-filter" },
  { title: "13F Superinvestors", href: "/superinvestors", icon: "fa-user-tie" },
  { title: "내 포트폴리오", href: "/portfolio", icon: "fa-briefcase" },
];

export default function ExplorePage() {
  return (
    <div className={`theme-c ${plexKr.className}`}>
      <main className="container mx-auto max-w-5xl px-4 py-6 sm:py-8">
        <header className="hero">
          <p className="eyebrow">탐색 · EXPLORE</p>
          <h1>오늘의 시장</h1>
          <p>
            한 화면에서 <b>시장 신호 · 체온 · 일정 · 섹터 · 종목</b>까지. 지금 시장이 어떤
            상태인지 30초 안에 파악하세요.
          </p>
          <div className="mt-4">
            <DataNav active="explore" />
          </div>
        </header>

        <MyWatchlistStrip />
        <SignalStrip />
        <ExploreDashboard />

        <div className="lower mt-3.5">
          <MarketThermometer />
          <WeekAheadCard />
        </div>

        <RevisionMoversCard />
        <ExploreHotTopics />

        {/* Deep-dive destinations */}
        <nav aria-label="더 깊이 보기" className="mt-7">
          <p className="heat-cap">더 깊이 보기</p>
          <div className="deep-pills">
            {TIERS.map((tier) => (
              <TransitionLink key={tier.href} href={tier.href}>
                <i className={`fas ${tier.icon}`} aria-hidden="true" />
                {tier.title}
                <span aria-hidden="true">→</span>
              </TransitionLink>
            ))}
          </div>
        </nav>

        <p className="heat-cap mt-5">데이터: Global Scouter · Bloomberg benchmarks · SEC 13F · Yahoo Finance.</p>
      </main>
    </div>
  );
}
