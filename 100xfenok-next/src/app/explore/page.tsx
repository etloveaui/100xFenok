import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import ExploreHotTopics from "./ExploreHotTopics";
import ExploreDashboard from "./ExploreDashboard";
import MarketThermometer from "./MarketThermometer";
import SignalStrip from "./SignalStrip";
import MyWatchlistStrip from "./MyWatchlistStrip";
import StockWorkbenchCard from "./StockWorkbenchCard";
import MacroPlaybookCard from "./MacroPlaybookCard";
import EtfUniverseCard from "./EtfUniverseCard";
import { EXPLORE_META_TITLE, EXPLORE_PRODUCT_TITLE } from "@/lib/product-nav";

export const metadata: Metadata = {
  title: EXPLORE_META_TITLE,
  description: "시장 신호·체온계·일정·섹터·종목까지 — 오늘 시장을 30초에 파악하는 대시보드.",
};

export default function ExplorePage() {
  return (
    <div className="fnk-shell">
      <AppShell active="explore" title={EXPLORE_PRODUCT_TITLE}>
        {/* 3-second read: signals + thermometer headline */}
        <SignalStrip />

        {/* workspace columns (design v3): primary = thermometer + sectors,
            secondary = watchlist + calendar + movers */}
        <div className="cols" style={{ marginTop: "var(--s4)" }}>
          <div className="col-a">
            <MarketThermometer />
            <MacroPlaybookCard />
            <ExploreDashboard />
          </div>
          <div className="col-b">
            <MyWatchlistStrip />
            <StockWorkbenchCard />
            <EtfUniverseCard limit={8} />
          </div>
        </div>

        <div className="f13-wrap-outer" style={{ marginTop: "var(--s4)" }}>
          <ExploreHotTopics />
        </div>

        <p className="data-cap">데이터: 시장 신호 · 밸류에이션 · 일정 · 기관 동향 · 종목 리더보드 · 계산 지표</p>
      </AppShell>
    </div>
  );
}
