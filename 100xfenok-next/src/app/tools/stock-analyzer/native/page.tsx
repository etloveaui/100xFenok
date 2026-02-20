import type { Metadata } from "next";

import { StockAnalyzerDashboard } from "@/features/stock-analyzer/components/stock-analyzer-dashboard";

export const metadata: Metadata = {
  title: "Stock Analyzer Native Pilot",
  description: "Week3 Phase 6-2 네이티브 모듈 기반 Stock Analyzer 파일럿",
};

export default function StockAnalyzerNativePage() {
  return <StockAnalyzerDashboard />;
}
