import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import ExploreHotTopics from "./ExploreHotTopics";
import ExploreDashboard from "./ExploreDashboard";
import MarketThermometer from "./MarketThermometer";
import SignalStrip from "./SignalStrip";
import WeekAheadCard from "./WeekAheadCard";
import MyWatchlistStrip from "./MyWatchlistStrip";
import RevisionMoversCard from "./RevisionMoversCard";
import DataNav from "@/components/DataNav";
import TickerTypeahead from "@/components/TickerTypeahead";
import ThemeCChrome from "@/components/design/ThemeCChrome";

// Theme C (Korean fintech minimal) — pilot page font
const plexKr = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  // next/font ships CJK glyphs via unicode-range slices regardless of `subsets`
  // (which only controls preload); "korean" is not an accepted subset name here.
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Explore | 100xFenok",
  description: "시장 신호·체온계·일정·섹터·종목까지 — 오늘 시장을 30초에 파악하는 대시보드.",
};

export default function ExplorePage() {
  return (
    <div className={`theme-c ${plexKr.className}`}>
      <ThemeCChrome />
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

        <div className="c-card search-card">
          <TickerTypeahead
            placeholder="티커 검색 — 종목 상세로 바로 이동 (예: AAPL, NVDA, TSM)"
            className="min-w-0 flex-1 bg-transparent py-3.5 text-[15px] font-semibold outline-none"
            formClass="flex w-full items-center gap-3"
            showButton
            buttonLabel="종목 상세"
            buttonClass="search-btn"
          />
        </div>

        {/* rows are height-matched by content budget, not by packing tricks:
            heat 4 rows == calendar 5 events; movers up/down 5+5 side by side;
            thermometer halves its height with an internal 2-col grid */}
        <div className="row2">
          <ExploreDashboard />
          <WeekAheadCard />
        </div>
        <MarketThermometer />
        <RevisionMoversCard />
        <ExploreHotTopics />

        <p className="heat-cap mt-5">데이터: Global Scouter · Bloomberg benchmarks · SEC 13F · Yahoo Finance.</p>
      </main>
    </div>
  );
}
