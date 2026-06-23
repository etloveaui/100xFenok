import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import { canonicalPath } from "@/lib/site-url";
import StockDetailClient from "./StockDetailClient";

interface Props {
  params: Promise<{ ticker: string }>;
  searchParams?: Promise<{ tab?: string | string[] }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();
  return {
    title: `${symbol} 종목 상세 | 100xFenok`,
    description: `${symbol} 종목 상세 분석 — PER 밴드, 매출/EPS 추이, 13F 투자자 보유 현황`,
    alternates: {
      canonical: canonicalPath(`/stock/${symbol}`),
    },
  };
}

export default async function StockDetailPage({ params, searchParams }: Props) {
  const { ticker } = await params;
  const query = searchParams ? await searchParams : {};
  const symbol = ticker.toUpperCase();
  const requestedTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const initialTab = requestedTab === "filings" ? "filings" : undefined;
  return (
    <div className="fnk-shell">
      <AppShell active="screener" title={symbol} backHref={`/screener?ticker=${encodeURIComponent(symbol)}`}>
        <StockDetailClient ticker={symbol} initialTab={initialTab} />
      </AppShell>
    </div>
  );
}
