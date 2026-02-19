import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stock Analyzer",
  description: "Week3 전환을 위한 Stock Analyzer iframe 스켈레톤 라우트",
};

export default function StockAnalyzerPage() {
  return (
    <div className="route-embed-shell">
      <iframe
        src="/tools/stock_analyzer/stock_analyzer.html"
        title="Stock Analyzer"
        className="h-full w-full border-0"
      />
    </div>
  );
}

