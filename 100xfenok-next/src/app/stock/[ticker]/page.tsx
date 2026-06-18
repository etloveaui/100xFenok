import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import StockDetailClient from "./StockDetailClient";

interface Props {
  params: Promise<{ ticker: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  return {
    title: `${ticker.toUpperCase()} 종목 상세 | 100xFenok`,
    description: `${ticker.toUpperCase()} 종목 상세 분석 — PER 밴드, 매출/EPS 추이, 13F 투자자 보유 현황`,
  };
}

export default async function StockDetailPage({ params }: Props) {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();
  return (
    <div className="fnk-shell">
      <AppShell title={symbol} backHref={`/screener?ticker=${encodeURIComponent(symbol)}`}>
        <StockDetailClient ticker={symbol} />
      </AppShell>
    </div>
  );
}
