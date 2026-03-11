import type { Metadata } from "next";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";

export const metadata: Metadata = {
  title: "Stock Analyzer",
  description: "종목 탐색과 비교를 위한 분석 대시보드",
};

export default function StockAnalyzerPage() {
  return (
    <main className="route-embed-page container mx-auto px-4 py-4">
      <div className="route-embed-page-body">
        <RouteEmbedFrame
          src="/tools/stock_analyzer/stock_analyzer.html"
          title="Stock Analyzer"
          loading="eager"
          shellClassName="route-embed-shell-fill-parent"
        />
      </div>
    </main>
  );
}
