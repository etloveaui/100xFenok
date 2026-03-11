import type { Metadata } from "next";

import { StockAnalyzerDashboard } from "@/features/stock-analyzer/components/stock-analyzer-dashboard";

export const metadata: Metadata = {
  title: "Stock Analyzer",
  description: "종목 탐색과 비교를 위한 분석 대시보드",
};

export default function StockAnalyzerNativePage() {
  return <StockAnalyzerDashboard />;
}
