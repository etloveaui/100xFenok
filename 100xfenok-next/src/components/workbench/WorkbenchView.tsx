import AppShell from "@/components/shell/AppShell";
import ExploreHotTopics from "@/app/explore/ExploreHotTopics";
import ExploreDashboard from "@/app/explore/ExploreDashboard";
import MarketThermometer from "@/app/explore/MarketThermometer";
import SignalStrip from "@/app/explore/SignalStrip";
import MyWatchlistStrip from "@/app/explore/MyWatchlistStrip";
import StockWorkbenchCard from "@/app/explore/StockWorkbenchCard";
import MacroPlaybookCard from "@/app/explore/MacroPlaybookCard";
import EtfUniverseCard from "@/app/explore/EtfUniverseCard";
import { WORKBENCH_PRODUCT_TITLE } from "@/lib/product-nav";

export default function WorkbenchView() {
  return (
    <div className="fnk-shell">
      <AppShell active="workbench" title={WORKBENCH_PRODUCT_TITLE}>
        <SignalStrip />

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
