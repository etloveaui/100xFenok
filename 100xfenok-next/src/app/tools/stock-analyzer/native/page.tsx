import type { Metadata } from "next";

import AppShell from "@/components/shell/AppShell";
import { StockAnalyzerDashboard } from "@/features/stock-analyzer/components/stock-analyzer-dashboard";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Stock Analyzer",
  description: "종목 탐색과 비교를 위한 분석 대시보드",
};

export default function StockAnalyzerNativePage() {
  return (
    <div
      className="fnk-shell"
      data-stock-analyzer-native-surface="true"
      data-stock-analyzer-native-route-owner="native-dashboard"
    >
      <AppShell active="stockAnalyzer" title="종목분석 네이티브" backHref={ROUTES.stockAnalyzer}>
        <StockAnalyzerDashboard />
      </AppShell>
    </div>
  );
}
