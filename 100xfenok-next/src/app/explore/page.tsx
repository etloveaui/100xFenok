import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import AppShell from "@/components/shell/AppShell";
import ExploreHotTopics from "./ExploreHotTopics";
import ExploreDashboard from "./ExploreDashboard";
import MarketThermometer from "./MarketThermometer";
import SignalStrip from "./SignalStrip";
import MyWatchlistStrip from "./MyWatchlistStrip";
import StockWorkbenchCard from "./StockWorkbenchCard";
import MarketStructureIndexCard from "./MarketStructureIndexCard";
import EtfGatewayCard from "./EtfGatewayCard";
import MarketEventSurfacesCard from "./MarketEventSurfacesCard";
import StockanalysisSurfaceInsightCard from "./StockanalysisSurfaceInsightCard";

const plexKr = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  // next/font ships CJK glyphs via unicode-range slices regardless of `subsets`
  // (which only controls preload); "korean" is not an accepted subset name here.
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "탐색 | 100xFenok",
  description: "시장 신호·체온계·일정·섹터·종목까지 — 오늘 시장을 30초에 파악하는 대시보드.",
};

export default function ExplorePage() {
  return (
    <div className={`fnk-shell ${plexKr.className}`}>
      <AppShell active="explore" title="탐색">
        {/* 3-second read: signals + thermometer headline */}
        <SignalStrip />

        {/* workspace columns (design v3): primary = thermometer + sectors,
            secondary = watchlist + calendar + movers */}
        <div className="cols" style={{ marginTop: "var(--s4)" }}>
          <div className="col-a">
            <MarketThermometer />
            <ExploreDashboard />
          </div>
          <div className="col-b">
            <MyWatchlistStrip />
            <StockWorkbenchCard />
          </div>
        </div>

        <div className="surface-grid" aria-label="시장 데이터 표면">
          <EtfGatewayCard />
          <MarketEventSurfacesCard />
          <StockanalysisSurfaceInsightCard />
          <MarketStructureIndexCard />
        </div>

        <div className="f13-wrap-outer" style={{ marginTop: "var(--s4)" }}>
          <ExploreHotTopics />
        </div>

        <p className="data-cap">데이터: 시장 신호 · 밸류에이션 · 일정 · 기관 동향 · 종목 리더보드 · 계산 지표</p>
      </AppShell>
    </div>
  );
}
