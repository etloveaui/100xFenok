import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Stock Analyzer",
  description: "Week3 전환을 위한 Stock Analyzer iframe 스켈레톤 라우트",
};

export default function StockAnalyzerPage() {
  return (
    <main className="container mx-auto px-4 py-4">
      <section className="mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
              Stock Analyzer Legacy
            </p>
            <p className="text-sm text-slate-600">
              운영 안정성을 위해 기존 iframe 경로를 유지합니다.
            </p>
          </div>
          <Link
            href="/tools/stock-analyzer/native/"
            className="min-h-11 rounded-lg border border-blue-200 bg-blue-50 px-3 text-sm font-bold text-blue-700 transition hover:bg-blue-100"
          >
            Native Pilot 열기
          </Link>
        </div>
      </section>

      <div className="route-embed-shell">
        <iframe
          src="/tools/stock_analyzer/stock_analyzer.html"
          title="Stock Analyzer"
          loading="eager"
          className="h-full w-full border-0"
        />
      </div>
    </main>
  );
}
